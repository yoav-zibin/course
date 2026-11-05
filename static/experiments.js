"use strict";

(() => {
  const ACCOUNTS_KEY = "game-platform.accounts.v1";
  const CURRENT_KEY = "game-platform.current-account.v1";
  const SKIN_CACHE_PREFIX = "game-platform.experiment-skin.v1:";
  const PORTAL_SKIN_COOKIE = "game-platform.portal-skin.v1";
  const PORTAL_SKIN_STORAGE_KEY = "game-platform.portal-skin-preference.v1";
  const PORTAL_SKIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
  const SKIN_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;
  const PORTAL_SKINS = new Set(["classic", "aurora", "sunset", "immersive"]);
  const PORTAL_LAYOUTS = new Set(["left", "hamburger", "top"]);
  let assignedSkin = "classic";
  let previewSkin = portalSkinFromUrl();
  let savedSkin = readSavedPortalSkin();
  let previewLayout = portalLayoutFromUrl();

  if (previewSkin) {
    savePortalSkinPreference(previewSkin);
  }

  function portalSkinFromUrl() {
    const key = new URLSearchParams(location.search).get("skin");
    return PORTAL_SKINS.has(key) ? key : null;
  }

  function readPortalSkinCookie() {
    try {
      const prefix = `${PORTAL_SKIN_COOKIE}=`;
      const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
      if (!entry) return null;
      const key = decodeURIComponent(entry.slice(prefix.length));
      return PORTAL_SKINS.has(key) ? key : null;
    } catch (error) {
      console.warn("Saved skin preference could not be read.", error);
      return null;
    }
  }

  function readSavedPortalSkin() {
    try {
      const key = localStorage.getItem(PORTAL_SKIN_STORAGE_KEY);
      if (PORTAL_SKINS.has(key)) return key;
    } catch (error) {
      console.warn("Saved skin preference could not be read from browser storage.", error);
    }
    return readPortalSkinCookie();
  }

  function writePortalSkinCookie(key) {
    if (!PORTAL_SKINS.has(key)) return;
    try {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${PORTAL_SKIN_COOKIE}=${encodeURIComponent(key)}; Path=/; Max-Age=${PORTAL_SKIN_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    } catch (error) {
      console.warn("Saved skin preference could not be stored.", error);
    }
  }

  function clearPortalSkinCookie() {
    try {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${PORTAL_SKIN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    } catch (error) {
      console.warn("Saved skin preference could not be cleared.", error);
    }
  }

  function savePortalSkinPreference(key) {
    if (!PORTAL_SKINS.has(key)) return;
    savedSkin = key;
    try {
      localStorage.setItem(PORTAL_SKIN_STORAGE_KEY, key);
    } catch (error) {
      console.warn("Saved skin preference could not be stored in browser storage.", error);
    }
    writePortalSkinCookie(key);
  }

  function clearSavedPortalSkin() {
    savedSkin = null;
    try {
      localStorage.removeItem(PORTAL_SKIN_STORAGE_KEY);
    } catch (error) {
      console.warn("Saved skin preference could not be cleared from browser storage.", error);
    }
    clearPortalSkinCookie();
  }

  function portalLayoutFromUrl() {
    if (!document.querySelector(".portal-shell")) return null;
    const key = new URLSearchParams(location.search).get("layout");
    return PORTAL_LAYOUTS.has(key) ? key : null;
  }

  function currentAccount() {
    try {
      const currentId = localStorage.getItem(CURRENT_KEY);
      const accounts = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
      return accounts.find((account) => account.id === currentId) ?? null;
    } catch (error) {
      console.warn("Skin assignment is unavailable in this browser.", error);
      return null;
    }
  }

  function applySkin(key) {
    const previous = document.documentElement.dataset.skin || "";
    if (key && SKIN_KEY_PATTERN.test(key))
      document.documentElement.dataset.skin = key;
    else delete document.documentElement.dataset.skin;
    const current = document.documentElement.dataset.skin || "";
    if (previous !== current)
      document.dispatchEvent(new CustomEvent("portal-skin-change", { detail: { key: current || null } }));
    return previous !== current;
  }

  function activeSkin() {
    return previewSkin || savedSkin || assignedSkin || "classic";
  }

  function syncSkinPicker() {
    const picker = document.getElementById("portal-skin-picker");
    if (picker) picker.value = previewSkin || savedSkin || "";
  }

  function syncLayoutPicker() {
    const picker = document.getElementById("portal-layout-picker");
    if (picker) picker.value = previewLayout || "";
  }

  function setPreviewSkin(key) {
    previewSkin = PORTAL_SKINS.has(key) ? key : null;
    if (previewSkin) {
      savePortalSkinPreference(previewSkin);
    } else {
      clearSavedPortalSkin();
    }
    const url = new URL(location.href);
    if (previewSkin) url.searchParams.set("skin", previewSkin);
    else url.searchParams.delete("skin");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    const changed = applySkin(activeSkin());
    syncSkinPicker();
    window.syncPortalPreviewLinks?.();
    if (!changed)
      document.dispatchEvent(new CustomEvent("portal-skin-change", { detail: { key: activeSkin(), preview: Boolean(previewSkin) } }));
  }

  function applyLayout() {
    const previous = document.documentElement.dataset.portalLayout || "";
    if (previewLayout) document.documentElement.dataset.portalLayout = previewLayout;
    else delete document.documentElement.dataset.portalLayout;
    const current = document.documentElement.dataset.portalLayout || "";
    if (previous !== current)
      document.dispatchEvent(new CustomEvent("portal-layout-change", { detail: { key: current || null } }));
    return previous !== current;
  }

  function setPreviewLayout(key) {
    previewLayout = PORTAL_LAYOUTS.has(key) ? key : null;
    const url = new URL(location.href);
    if (previewLayout) url.searchParams.set("layout", previewLayout);
    else url.searchParams.delete("layout");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    applyLayout();
    syncLayoutPicker();
    window.syncPortalPreviewLinks?.();
  }

  async function applyCurrentSkin() {
    const account = currentAccount();
    if (!account) {
      assignedSkin = "classic";
      applySkin(activeSkin());
      syncSkinPicker();
      return;
    }
    const cacheKey = `${SKIN_CACHE_PREFIX}${account.id}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached && SKIN_KEY_PATTERN.test(cached)) assignedSkin = cached;
      applySkin(activeSkin());
      syncSkinPicker();
    } catch (error) {
      console.warn("Cached skin assignment could not be read.", error);
    }

    try {
      const response = await fetch("/users/me/experiments/skin", {
        headers: {
          "X-User-Id": account.id,
          "X-User-Password": account.password,
        },
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(`GET skin assignment: ${response.status}`);
      const assignment = await response.json();
      const key = assignment?.key;
      assignedSkin = key && SKIN_KEY_PATTERN.test(key) ? key : "classic";
      applySkin(activeSkin());
      syncSkinPicker();
      if (key && SKIN_KEY_PATTERN.test(key))
        localStorage.setItem(cacheKey, key);
    } catch (error) {
      console.error("Could not refresh the UI skin assignment.", error);
      applySkin(activeSkin());
      syncSkinPicker();
    }
  }

  document.getElementById("portal-skin-picker")?.addEventListener("change", (event) => {
    setPreviewSkin(event.currentTarget.value);
  });
  document.getElementById("portal-layout-picker")?.addEventListener("change", (event) => {
    setPreviewLayout(event.currentTarget.value);
  });

  // Keep the selected skin in the URL across portal screens and in browser
  // storage across visits; the server assignment remains the fallback when none is saved.
  syncSkinPicker();
  applyLayout();
  syncLayoutPicker();
  window.syncPortalPreviewLinks?.();

  window.ExperimentCampaignCode = () => {
    try {
      const code = localStorage.getItem("game-platform.experiment-campaign.v1");
      return code && /^[a-z0-9][a-z0-9-]{0,49}$/.test(code) ? code : null;
    } catch (error) {
      console.warn("Campaign attribution is unavailable in this browser.", error);
      return null;
    }
  };

  applyCurrentSkin();
  document.addEventListener("auth-changed", applyCurrentSkin);
})();
