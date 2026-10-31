// Languages for the web pages: a language picker in the top bar, translated page text,
// and a remembered choice. The texts come from the backend (GET /i18n/<language>), so the
// web pages, Android, iOS and React Native all show the same translations. See
// docs/i18n.md.
//
// Markup: English stays in the HTML (so a page works before, and without, a catalog).
//   data-i18n="ui.action.save"                 replaces the element's text
//   data-i18n-placeholder / -title / -aria-label="key"   replace that attribute
// Scripts use I18n.t(key, {name: "x"}, "English fallback") for generated text, and
// listen for the "i18n-changed" event to redraw what they generated.
//
// A language is loaded as one bundle (GET /i18n/bundle/<language>): the catalog, the
// published games' names and descriptions, and their translated string tables, in a single
// request that answers 304 while nothing changed. If the bundle can't be had, the separate
// requests (catalog, game names, one request per game version) are used as before.
//
// The choice is saved in this browser (localStorage) and, for a logged-in account, on
// the account (PATCH /users/{id}), so it follows the person to other devices.

"use strict";

const I18n = (() => {
  const CHOICE_KEY = "game-platform.locale.v1"; // an explicit choice, e.g. "es"
  const CATALOG_KEY = "game-platform.i18n-catalog.v1:"; // + language code
  const LOCALES_KEY = "game-platform.i18n-locales.v1";
  const GAMES_KEY = "game-platform.i18n-games.v1:"; // + language code
  const BUNDLE_KEY = "game-platform.i18n-bundle.v1:"; // + language code: {etag, data}
  // The browser's storage is small and shared with the offline cache (portal-offline.js):
  // a bundle bigger than this is saved without the games' string tables.
  const MAX_STORED_CHARS = 200_000;
  const DEFAULT = "en";
  // Used until /i18n/locales answers (and offline), so the picker always works. The
  // server's list is the source of truth and replaces this one.
  const BUILT_IN = [
    { code: "en", name: "English", direction: "ltr" },
    { code: "es", name: "Español", direction: "ltr" },
    { code: "fr", name: "Français", direction: "ltr" },
    { code: "de", name: "Deutsch", direction: "ltr" },
    { code: "pt", name: "Português", direction: "ltr" },
    { code: "zh", name: "中文（简体）", direction: "ltr" },
    { code: "hi", name: "हिन्दी", direction: "ltr" },
    { code: "ar", name: "العربية", direction: "rtl" },
  ];

  const read = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      // Private mode or a full disk: the choice just doesn't persist.
      return false;
    }
  };
  const remove = (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // nothing to remove from
    }
  };

  let locales = read(LOCALES_KEY) ?? BUILT_IN;
  let code = DEFAULT;
  let messages = {}; // of [code]; empty for English, whose texts are in the HTML
  let picker = null;
  // The published games' names and descriptions in the current language (game id ->
  // {name, description}); empty for English or until they arrive.
  let gamesText = {};
  // A game version's translations are asked for once per language, then kept.
  const gameStrings = new Map();
  // The bundle of the current language, when one was loaded: {locale, games: id -> {version,
  // name, description, status, translatable, strings}}. null when the separate requests are used.
  let bundle = null;
  let revision = 0; // changes whenever the texts do, for scripts that skip unchanged redraws

  /** "es-MX" -> "es"; null when the language isn't supported. */
  function normalize(tag) {
    const language = String(tag ?? "").toLowerCase().replace("_", "-").split("-")[0];
    return locales.some((locale) => locale.code === language) ? language : null;
  }

  function startingLanguage() {
    const chosen = normalize(read(CHOICE_KEY));
    if (chosen) return chosen;
    for (const tag of navigator.languages ?? [navigator.language]) {
      const found = normalize(tag);
      if (found) return found;
    }
    return DEFAULT;
  }

  /** The text of [key] in the current language, with {name} placeholders filled from
   * [params]; [fallback] (the English text) when there is none. */
  function t(key, params = {}, fallback = undefined) {
    const text = messages[key] ?? fallback ?? key;
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match));
  }

  // Translating the page

  const ATTRIBUTES = ["placeholder", "title", "aria-label"];

  /** Applies the current language to [root]'s data-i18n elements. English restores the
   * texts the HTML was written with. */
  function apply(root = document) {
    revision += 1;
    for (const node of root.querySelectorAll("[data-i18n]")) {
      node._i18nDefault ??= node.textContent;
      node.textContent = messages[node.dataset.i18n] ?? node._i18nDefault;
    }
    for (const attribute of ATTRIBUTES) {
      for (const node of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
        node._i18nDefaults ??= {};
        node._i18nDefaults[attribute] ??= node.getAttribute(attribute) ?? "";
        node.setAttribute(
          attribute,
          messages[node.getAttribute(`data-i18n-${attribute}`)] ?? node._i18nDefaults[attribute],
        );
      }
    }
  }

  function setDocument() {
    const locale = locales.find((item) => item.code === code);
    document.documentElement.lang = code;
    document.documentElement.dir = locale?.direction ?? "ltr";
  }

  // Loading a language

  /** Messages of [language]: the saved copy right away, then the server's if it
   * changed. English needs none (its texts are in the HTML). */
  async function load(language) {
    if (language === DEFAULT) return {};
    const fromBundle = await loadBundle(language);
    if (fromBundle) return fromBundle;
    bundle = null;
    const saved = read(CATALOG_KEY + language);
    const fetched = fetchCatalog(language, saved?.version);
    if (saved) {
      fetched.then((fresh) => {
        if (fresh && language === code) {
          messages = fresh.messages;
          apply();
          announce();
        }
      });
      return saved.messages;
    }
    return (await fetched)?.messages ?? {};
  }

  // The bundle: the saved copy right away, then the server's if it changed (a 304 costs
  // almost nothing). Resolves to the messages, or null when there is no bundle to be had
  // (the server doesn't have the endpoint, or is down and nothing is saved).
  async function loadBundle(language) {
    const saved = read(BUNDLE_KEY + language);
    const usable = saved?.data?.catalog?.messages ? saved : null;
    const fetched = fetchBundle(language, usable);
    if (usable) {
      adoptBundle(language, usable.data);
      fetched.then((fresh) => {
        if (fresh && language === code) {
          adoptBundle(language, fresh);
          apply();
          announce();
        }
      });
      return usable.data.catalog.messages;
    }
    const fresh = await fetched;
    if (!fresh) return null;
    adoptBundle(language, fresh);
    return fresh.catalog.messages;
  }

  /** The new bundle of [language] if the server has a different one than [saved], else null. */
  async function fetchBundle(language, saved) {
    try {
      const headers = saved?.etag ? { "If-None-Match": saved.etag } : {};
      const response = await fetch(`/i18n/bundle/${encodeURIComponent(language)}`, { headers });
      if (!response.ok) return null; // includes 304: the saved copy is current
      const data = await response.json();
      if (!data?.catalog?.messages || !data.games) return null;
      // Nothing could be translated just now: keep the games' texts saved earlier.
      if (data.status === "unavailable" && saved?.data?.games) data.games = saved.data.games;
      saveBundle(language, response.headers?.get?.("ETag") ?? null, data);
      return data;
    } catch {
      return null; // offline: whatever is saved (or English) stays
    }
  }

  function adoptBundle(language, data) {
    messages = data.catalog.messages;
    bundle = { locale: language, games: data.games };
    gamesText = {};
    for (const [id, game] of Object.entries(data.games)) {
      gamesText[id] = { name: game.name, description: game.description };
    }
  }

  /** Keeps the bundle for the next visit, small: without the string tables if it is big,
   * and in place of the older separate copies of the catalog and the game names. */
  function saveBundle(language, etag, data) {
    const entry = {
      etag,
      data: {
        status: data.status,
        catalog: { version: data.catalog.version, messages: data.catalog.messages },
        games: data.games,
      },
    };
    const withoutStrings = () => {
      const games = {};
      for (const [id, game] of Object.entries(data.games)) {
        const { strings, ...rest } = game; // eslint-disable-line no-unused-vars
        games[id] = rest;
      }
      return { ...entry, data: { ...entry.data, games } };
    };
    const big = JSON.stringify(entry).length > MAX_STORED_CHARS;
    // The older separate copies are not needed any more, and free space for this one.
    remove(CATALOG_KEY + language);
    remove(GAMES_KEY + language);
    if (!write(BUNDLE_KEY + language, big ? withoutStrings() : entry) && !big) {
      write(BUNDLE_KEY + language, withoutStrings());
    }
  }

  async function fetchCatalog(language, knownVersion) {
    try {
      const response = await fetch(`/i18n/${encodeURIComponent(language)}`);
      if (!response.ok) return null;
      const catalog = await response.json();
      if (catalog.version === knownVersion) return null;
      write(CATALOG_KEY + language, { version: catalog.version, messages: catalog.messages });
      return catalog;
    } catch {
      return null; // offline: whatever is saved (or English) stays
    }
  }

  async function refreshLocales() {
    try {
      const response = await fetch("/i18n/locales");
      if (!response.ok) return;
      locales = (await response.json()).locales;
      write(LOCALES_KEY, locales);
      renderPicker();
      setDocument();
    } catch {
      // keep the saved or built-in list
    }
  }

  function announce() {
    document.dispatchEvent(new CustomEvent("i18n-changed", { detail: { locale: code } }));
  }

  // Games' own texts (written by their builders) are translated by the server the first
  // time they are asked for, so they show in English first and then fill in.

  /** Fetches the games' names and descriptions in the current language. */
  async function loadGamesText() {
    const asked = code;
    if (asked === DEFAULT || bundle?.locale === asked) return; // the bundle has them
    const saved = read(GAMES_KEY + asked);
    if (saved && code === asked && !Object.keys(gamesText).length) {
      gamesText = saved;
      apply();
      announce();
    }
    try {
      const response = await fetch(`/i18n/games/${encodeURIComponent(asked)}`);
      if (!response.ok || code !== asked) return;
      const data = await response.json();
      if (data.status === "unavailable") return; // nothing translated: keep what we have
      gamesText = data.games ?? {};
      write(GAMES_KEY + asked, gamesText);
      apply();
      announce();
    } catch {
      // offline: the saved copy (or English) stays
    }
  }

  /** A game's name in the current language, else [fallback] (the name as its builder wrote it). */
  function gameName(id, fallback) {
    return gamesText[id]?.name || fallback;
  }

  function gameDescription(id, fallback) {
    return gamesText[id]?.description ?? fallback;
  }

  /** What a game needs to show itself in the current language, to put in its state_changed
   * message: {locale, direction} and, if the game has a translatable string table and the
   * language is not English, {strings}. Never fails: without a translation the game just
   * shows its English. */
  async function gameText(gameId, version) {
    const asked = code;
    const direction = locales.find((item) => item.code === asked)?.direction ?? "ltr";
    const plain = { locale: asked, direction };
    if (asked === DEFAULT) return plain;
    const inBundle = bundle?.locale === asked ? bundle.games[gameId] : null;
    if (
      inBundle &&
      inBundle.version === Number(version) &&
      (inBundle.status === "translated" || inBundle.status === "source") &&
      (!inBundle.translatable || inBundle.strings)
    ) {
      return { ...plain, ...(inBundle.translatable ? { strings: inBundle.strings } : {}) };
    }
    const key = `${asked}|${gameId}@${version}`;
    const known = gameStrings.get(key);
    if (known && Date.now() < known.until) return known.value;
    let value = plain;
    let until = Date.now() + 30_000; // a failed or partial answer is asked for again soon
    try {
      const path = `/games/${encodeURIComponent(gameId)}/versions/${version}/strings?lang=${asked}`;
      const data = await apiRequest("GET", path, { user: account() });
      value = { locale: data.locale, direction: data.direction, ...(data.translatable ? { strings: data.strings } : {}) };
      if (data.status === "translated" || data.status === "source") until = Infinity;
    } catch {
      // keep the English
    }
    gameStrings.set(key, { value, until });
    return value;
  }

  /** Switches the page to [language]. [remember] saves it as the person's choice. */
  async function setLanguage(language, { remember = false } = {}) {
    const next = normalize(language) ?? DEFAULT;
    if (remember) write(CHOICE_KEY, next);
    if (next === code && picker?.value === next) return;
    code = next;
    gamesText = {};
    bundle = null;
    messages = await load(next);
    if (code !== next) return; // another switch happened meanwhile
    setDocument();
    apply();
    if (picker) picker.value = code;
    announce();
    loadGamesText();
  }

  /** The person picked [language] in the picker. */
  async function choose(language) {
    await setLanguage(language, { remember: true });
    saveOnAccount();
  }

  // The account

  function account() {
    return typeof Auth !== "undefined" ? Auth.current() : null;
  }

  /** Saves the chosen language on the logged-in account (best effort). */
  async function saveOnAccount() {
    const who = account();
    if (!who) return;
    try {
      await apiRequest("PATCH", `/users/${encodeURIComponent(who.id)}`, {
        user: who,
        body: { locale: code },
      });
    } catch (error) {
      console.warn("Couldn't save the language on the account:", error);
    }
  }

  /** On login (and at page load): an account with a saved language gets it; one without
   * gets this browser's explicit choice. */
  async function syncWithAccount() {
    const who = account();
    if (!who) return;
    try {
      const user = await apiRequest("GET", `/users/${encodeURIComponent(who.id)}`);
      if (user.locale) {
        if (user.locale !== code) await setLanguage(user.locale, { remember: true });
      } else if (normalize(read(CHOICE_KEY))) {
        await saveOnAccount();
      }
    } catch {
      // offline or logged out meanwhile: nothing to sync
    }
  }

  // The picker

  function renderPicker() {
    if (!picker) return;
    picker.replaceChildren(
      ...locales.map((locale) => {
        const option = document.createElement("option");
        option.value = locale.code;
        option.textContent = locale.name; // each language in its own language
        option.lang = locale.code;
        return option;
      }),
    );
    picker.value = code;
  }

  function addPicker() {
    const bar = document.querySelector(".topbar");
    if (!bar || document.getElementById("language-picker")) return;
    picker = document.createElement("select");
    picker.id = "language-picker";
    picker.setAttribute("data-i18n-aria-label", "ui.language");
    picker.setAttribute("data-i18n-title", "ui.language");
    picker.setAttribute("aria-label", "Language");
    picker.title = "Language";
    picker.addEventListener("change", () => choose(picker.value));
    const wrapper = document.createElement("label");
    wrapper.className = "language-picker";
    const globe = document.createElement("span");
    globe.setAttribute("aria-hidden", "true");
    globe.textContent = "🌐";
    wrapper.append(globe, picker);
    // Right side of the bar, just before the account menu when there is one.
    const menu = document.getElementById("account-menu");
    if (menu && menu.parentNode === bar) bar.insertBefore(wrapper, menu);
    else bar.append(wrapper);
    renderPicker();
  }

  // Tell the server which language this page wants (errors come back translated).
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (url.origin === location.origin && !url.pathname.startsWith("/static/")) {
        const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has("Accept-Language")) headers.set("Accept-Language", code);
        init = { ...init, headers };
      }
    } catch {
      // not a URL we understand: send it as it is
    }
    return nativeFetch(input, init);
  };

  // Start: the saved choice, else the browser's language, else English.
  code = startingLanguage();
  const savedBundle = code === DEFAULT ? null : read(BUNDLE_KEY + code);
  const saved = code === DEFAULT || savedBundle ? null : read(CATALOG_KEY + code);
  if (savedBundle?.data?.catalog?.messages) messages = savedBundle.data.catalog.messages;
  else if (saved) messages = saved.messages;
  setDocument();
  addPicker();
  apply();
  const ready = (async () => {
    if (code !== DEFAULT) {
      messages = await load(code);
      apply();
      announce();
      loadGamesText();
    }
    refreshLocales();
    if (document.readyState === "complete") syncWithAccount();
    else window.addEventListener("load", syncWithAccount, { once: true });
  })();
  document.addEventListener("auth-changed", syncWithAccount);

  return { t, apply, choose, ready, locale: () => code, revision: () => revision, gameName, gameDescription, gameText };
})();
