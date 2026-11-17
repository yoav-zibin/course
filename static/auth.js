// Accounts and login, shared by the site's pages.
//
// The browser remembers every logged-in account in localStorage:
// [{id, display_name, password, linked: [{kind, identifier, linked_at}]}].
// The password is the API credential (X-User-Password); it never leaves the browser
// except in API request headers.

"use strict";

// Pages that don't load i18n.js get English: the fallback text passed to I18n.t.
if (typeof I18n === "undefined") {
  globalThis.I18n = {
    t: (key, params = {}, fallback = key) =>
      fallback.replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match)),
  };
}

const Auth = (() => {
  const ACCOUNTS_KEY = "game-platform.accounts.v1";
  const CURRENT_KEY = "game-platform.current-account.v1";

  // When this browser denies storage entirely (private mode, blocked
  // cookies), accounts live in memory for this page load instead: login
  // still works and online play is unaffected; only persistence is lost.
  let memoryAccounts = null;
  let memoryCurrentId = undefined;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) ?? [];
    } catch {
      return memoryAccounts ?? [];
    }
  }

  function save(accounts) {
    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
      memoryAccounts = null;
    } catch {
      memoryAccounts = accounts;
    }
  }

  function changed() {
    document.dispatchEvent(new CustomEvent("auth-changed"));
  }

  /** All remembered accounts, oldest first. */
  function accounts() {
    return load();
  }

  /** The current account, or null when logged out. Never throws: denied
   * storage reads as logged out (or the in-memory current account). */
  function current() {
    let id;
    try {
      id = localStorage.getItem(CURRENT_KEY);
    } catch {
      id = memoryCurrentId ?? null;
    }
    return load().find((account) => account.id === id) ?? null;
  }

  function setCurrent(id) {
    try {
      if (id) localStorage.setItem(CURRENT_KEY, id);
      else localStorage.removeItem(CURRENT_KEY);
      memoryCurrentId = undefined;
    } catch {
      memoryCurrentId = id ?? null;
    }
    changed();
  }

  /** Stores an /auth/* response (or a POST /users response) and makes it current.
   * Drops the merged-away account from the local list, if the login merged one:
   * it still exists server-side, marked as replaced by the surviving account,
   * so keeping a separate local entry would just duplicate the survivor. */
  function upsert(response) {
    const rest = load().filter(
      (account) =>
        account.id !== response.user_id && account.id !== response.merged_from_user_id
    );
    rest.push({
      id: response.user_id,
      display_name: response.display_name,
      picture_url: response.picture_url ?? "",
      password: response.password,
      linked: response.linked_accounts ?? [],
      verified_login_bonus_granted: response.verified_login_bonus_granted === true,
      referral_code: response.referral_code ?? null,
    });
    save(rest);
    // This browser has an account now, so a remembered invite has done its job.
    forgetInviter();
    setCurrent(response.user_id);
    return response;
  }

  /** Saves [code] as account [id]'s referral code (accounts saved before codes existed
   * learn theirs from the server later). */
  function setPicture(id, picture) {
    const all = load(), account = all.find(a => a.id === id);
    if (!account || !picture || account.picture_url === picture) return false;
    account.picture_url = picture;
    save(all);
    return true;
  }

  function setReferralCode(id, code) {
    const accounts = load();
    const account = accounts.find((a) => a.id === id);
    if (!account || !code || account.referral_code === code) return;
    account.referral_code = code;
    save(accounts);
  }

  /** Forgets an account (log out). Falls back to another remembered account. */
  function remove(id) {
    const rest = load().filter((account) => account.id !== id);
    save(rest);
    setCurrent(rest[0]?.id ?? null);
  }

  function removeAll() {
    save([]);
    setCurrent(null);
  }

  /** Headers for apiRequest's {user}: the account itself works. */
  function headers(account) {
    return account
      ? { "X-User-Id": account.id, "X-User-Password": account.password }
      : {};
  }

  // Invite links
  //
  // An invite link names its sender: the short form is /r/<referral code>, or
  // /r/<code>#match=<match id> for a match; the server redirects it to
  // /portal?ref=<code> (keeping the #match part). Older links carry the sender's user
  // id instead: /portal#ref=<id> or /portal#match=<match id>&ref=<id>. The first ref this browser sees is
  // remembered until an account is created or logged in here, so it still counts if
  // the person looks around first and signs up later. The server records it as the
  // new account's inviter (and ignores it for accounts that already exist).

  const INVITER_KEY = "game-platform.invited-by.v1";

  function refInUrl() {
    for (const part of [location.hash.slice(1), location.search.slice(1)]) {
      const ref = new URLSearchParams(part).get("ref");
      if (ref) return ref;
    }
    return null;
  }

  /** Remembers the inviter named in the current URL, unless one is remembered already
   * or the link is one of this browser's own accounts. */
  function rememberInviter() {
    try {
      const ref = refInUrl();
      if (!ref || localStorage.getItem(INVITER_KEY)) return;
      if (load().some((account) => account.id === ref || account.referral_code === ref)) return;
      localStorage.setItem(INVITER_KEY, ref);
    } catch {
      // Storage can be unavailable (private mode); the invite just isn't counted.
    }
  }

  function forgetInviter() {
    try {
      localStorage.removeItem(INVITER_KEY);
    } catch {}
  }

  /** [body] for a request that may create an account, plus the remembered inviter. */
  function newAccountBody(body) {
    let ref = null;
    try {
      ref = localStorage.getItem(INVITER_KEY);
    } catch {}
    const token = inviteTokenInUrl();
    const attributed = token ? { ...body, invite_token: token } : body;
    return ref ? { ...attributed, invited_by_user_id: ref } : attributed;
  }

  /** A link that credits [account] with everyone who signs up through it: the short
   * /r/<code> form, or the long one for an account that has no code yet.
   * [hash] adds more of the portal's hash parameters, e.g. "match=<id>". */
  function inviteLink(account, hash = "") {
    if (account.referral_code) {
      return `${location.origin}/r/${encodeURIComponent(account.referral_code)}${hash ? `#${hash}` : ""}`;
    }
    const params = new URLSearchParams(hash);
    params.set("ref", account.id);
    return `${location.origin}/portal#${params}`;
  }

  rememberInviter();
  window.addEventListener?.("hashchange", rememberInviter);

  /** Sends a logged-out visitor to the login page, and back here after.
   * Every account page requires a login — a guest account counts and takes
   * seconds — so a visitor with no account never lands on a page that can
   * only refuse them. Exempt: the login page itself, and /admin, the
   * master-password page, which has its own sign-in. Runs only in a real
   * page context (test harnesses load this file with a stub location). */
  function requireLogin() {
    const exempt = ["/", "/static/welcome.html", "/admin", "/static/admin.html"];
    if (
      typeof location.pathname !== "string" ||
      typeof location.replace !== "function" ||
      exempt.includes(location.pathname) ||
      current()
    )
      return;
    const back = location.pathname + location.search + location.hash;
    location.replace(`/?next=${encodeURIComponent(back)}`);
  }

  requireLogin();

  // Logging out (the last account removed) leaves the visitor logged out
  // on this page: send them to the login page the same way, and back here
  // if they log in again.
  document.addEventListener?.("auth-changed", requireLogin);

  // Login dialog

  let configPromise = null;
  function authConfig() {
    configPromise ??= apiRequest("GET", "/auth/config").catch(() => ({
      google_client_id: "",
      phone_login_enabled: false,
      phone_call_enabled: false,
      email_login_enabled: false,
    }));
    return configPromise;
  }

  // The dialog being filled in, for the Google callback.
  let pendingDialog = null;

  let googleLoading = null;
  function ensureGoogle(clientId) {
    googleLoading ??= new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) return resolve();
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(I18n.t("ui.auth.google_script_failed", {}, "Couldn't load Google's login script")));
      document.head.appendChild(script);
    });
    return googleLoading.then(() => {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => pendingDialog?.onGoogle(response.credential),
        auto_select: false,
      });
    });
  }


  function toast(text) {
    let box = document.getElementById("auth-toast");
    if (!box) {
      box = el("div", { id: "auth-toast", class: "auth-toast" });
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.hidden = false;
    clearTimeout(box._timer);
    box._timer = setTimeout(() => (box.hidden = true), 6000);
  }

  function methodLabel(kind, identifier) {
    switch (kind) {
      case "google":
        return "Google";
      case "phone":
        return `text ${identifier}`;
      case "email":
        return identifier;
      default:
        return identifier;
    }
  }

  /** Opens the login dialog. In "link" mode the credential is linked to the current
   * account instead of logging in (merging whichever account already holds it). */
  function openDialog(mode = "login") {
    closeDialog();
    const account = current();
    if (mode === "link" && !account) mode = "login";
    const dialog = {
      mode,
      account,
      returnFocus: document.activeElement,
      root: el("div", { class: "auth-dialog-backdrop" }),
      message: el("div", { class: "message", role: "alert" }),
    };
    pendingDialog = dialog;

    const box = el("div", { class: "auth-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "auth-dialog-title" });
    const title = el("h2", {
      id: "auth-dialog-title",
      textContent: mode === "link" ? I18n.t("ui.auth.link_title", { name: account.display_name }, `Link a login to ${account.display_name}`) : I18n.t("ui.auth.log_in", {}, "Log in"),
    });
    const close = el("button", { type: "button", class: "auth-close", textContent: "×", "aria-label": I18n.t("ui.action.close", {}, "Close") });
    close.onclick = closeDialog;
    dialog.root.onclick = (event) => {
      if (event.target === dialog.root) closeDialog();
    };
    const bonus = el("p", {
      id: "auth-verified-bonus", class: "muted", hidden: !!account,
      textContent: I18n.t("ui.auth.verified_bonus", {}, "Get 1,000 tokens once with your first verified login. Use Google or verify a code sent to your email or phone. Guests receive no welcome bonus."),
    });
    box.append(close, title, bonus, dialog.message);
    if (account && !account.verified_login_bonus_granted) {
      // Old remembered accounts lack the flag, and another device may have
      // claimed it since our last login. Keep the offer hidden until checked.
      apiRequest("GET", "/auth/me", { user: account }).then(profile => {
        const granted = profile.verified_login_bonus_granted;
        if (typeof granted !== "boolean") return;
        const all = load(), stored = all.find(user => user.id === account.id);
        if (stored) {
          stored.verified_login_bonus_granted = stored.verified_login_bonus_granted === true || granted;
          save(all);
        }
        if (pendingDialog === dialog && current()?.id === account.id)
          bonus.hidden = granted || stored?.verified_login_bonus_granted === true;
      }).catch(() => {});
    }
    if (mode === "link") {
      box.append(
        el("p", { class: "muted", textContent: I18n.t("ui.auth.merge_note", {}, "If this login belongs to another of your accounts, that account is merged into this one.") })
      );
    }
    const methods = el("div", { class: "auth-methods" });
    box.append(methods);
    dialog.root.append(box);
    document.body.append(dialog.root);
    close.focus();
    // Disabling a focused submit button can return focus to the document.
    // Keep Escape and the focus trap active until this dialog is closed.
    dialog.onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeDialog();
      } else if (event.key === "Tab") {
        const controls = [...box.querySelectorAll("button:not([disabled]),input:not([disabled]),a[href],select,textarea,iframe,[tabindex='0']")]
          .filter(node => node.getClientRects().length && !node.closest("[hidden],[inert]"));
        const first = controls[0], last = controls.at(-1);
        const outside = !box.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || outside)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || outside)) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", dialog.onKeydown, true);

    dialog.onGoogle = async (idToken) => {
      try {
        const response = await apiRequest("POST", "/auth/google", {
          user: mode === "link" ? account : null,
          body: mode === "link" ? { id_token: idToken } : newAccountBody({ id_token: idToken }),
        });
        finishLogin(dialog, response);
      } catch (error) {
        dialogFailed(dialog, error);
      }
    };


    authConfig().then((config) => {
      if (pendingDialog !== dialog) return; // closed while loading
      if (config.google_client_id) {
        const holder = el("div", { class: "auth-method" });
        methods.append(holder);
        ensureGoogle(config.google_client_id)
          .then(() =>
            window.google.accounts.id.renderButton(holder, {
              theme: "outline",
              size: "large",
              width: 280,
            })
          )
          .catch((error) => dialogFailed(dialog, error));
      }
      if (config.phone_login_enabled) {
        methods.append(codeMethod(dialog, "phone", I18n.t("ui.auth.phone", {}, "Phone number"), "+15551234567", "/auth/phone", "phone_number", I18n.t("ui.auth.text_me_code", {}, "Text me a code"), config.phone_call_enabled));
      }
      if (config.email_login_enabled) {
        methods.append(codeMethod(dialog, "email", I18n.t("ui.auth.email", {}, "Email"), "player@example.com", "/auth/email", "email", I18n.t("ui.auth.email_me_code", {}, "Email me a code")));
      }
      // A guest has no verified credential to link. Offering guest creation
      // here silently switched accounts instead of protecting this account.
      if (mode === "login") methods.append(guestMethod(dialog));
      if (!methods.children.length) {
        dialog.message.textContent = I18n.t("ui.auth.no_methods", {}, "No login methods are configured on this server yet.");
        dialog.message.className = "message error";
      }
      if (document.activeElement === close) methods.querySelector("input")?.focus();
    });
  }

  function closeDialog() {
    if (!pendingDialog) return;
    const dialog = pendingDialog;
    pendingDialog = null;
    document.removeEventListener("keydown", dialog.onKeydown, true);
    dialog.root.remove();
    if (dialog.returnFocus?.isConnected && dialog.returnFocus.getClientRects().length && !dialog.returnFocus.closest("[hidden],[inert]"))
      dialog.returnFocus.focus({ preventScroll: true });
    else document.querySelector(".auth-menu-button")?.focus({ preventScroll: true });
  }

  function dialogFailed(dialog, error) {
    dialog.message.textContent =
      error instanceof ApiError ? error.message : String(error?.message ?? error);
    dialog.message.className = "message error";
  }

  function finishLogin(dialog, response) {
    if (pendingDialog !== dialog) return;
    upsert(response);
    closeDialog();
    if (response.merged_from_user_id) {
      toast(I18n.t("ui.auth.merged_toast", { name: response.display_name }, `Merged your other account into ${response.display_name}.`));
    }
  }

  /** A phone/email code form. Posts to [base]/start then [base]/verify. */
  function codeMethod(dialog, kind, label, placeholder, base, field, sendLabel, canCall = false) {
    const input = el("input", { type: kind === "phone" ? "tel" : "email", placeholder, "aria-label": label });
    const codeInput = el("input", { inputmode: "numeric", placeholder: "123456", "aria-label": I18n.t("ui.auth.code", {}, "Code"), hidden: true, style: "width: 120px" });
    const message = el("div", { class: "message", role: "status" });
    let verificationId = null;

    const send = async (channel = "sms") => {
      if (sendButton.disabled) return;
      sendButton.disabled = true;
      if (callButton) callButton.disabled = true;
      codeInput.disabled = true;
      verifyButton.disabled = true;
      let sent = false;
      message.textContent = "";
      message.className = "message";
      try {
        const started = await apiRequest("POST", `${base}/start`, {
          body: {
            [field]: input.value,
            ...(kind === "phone" ? { delivery_method: channel } : {}),
          },
        });
        verificationId = started.verification_id;
        codeInput.hidden = false;
        verifyButton.hidden = false;
        sendButton.textContent = I18n.t("ui.auth.send_again", {}, "Send again");
        message.textContent = I18n.t("ui.auth.code_sent", { minutes: Math.round(started.expires_in_seconds / 60) }, `Code sent — it expires in ${Math.round(started.expires_in_seconds / 60)} minutes.`);
        message.className = "message ok";
        sent = true;
      } catch (error) {
        dialogFailed({ message }, error);
      } finally {
        sendButton.disabled = false;
        if (callButton) callButton.disabled = false;
        codeInput.disabled = false;
        verifyButton.disabled = false;
        if (sent) codeInput.focus();
      }
    };
    const sendButton = el("button", {
      type: "submit",
      textContent: sendLabel,
    });
    const callButton = kind === "phone" && canCall
      ? el("button", {
          type: "button",
          textContent: I18n.t("ui.auth.call_me", {}, "Call me with a code"),
          onclick: () => send("call"),
        })
      : null;
    const verifyButton = el("button", { type: "button", class: "primary", textContent: I18n.t("ui.auth.verify", {}, "Verify"), hidden: true });
    verifyButton.onclick = async () => {
      message.textContent = "";
      message.className = "message";
      try {
        const body = { verification_id: verificationId, code: codeInput.value };
        const response = await apiRequest("POST", `${base}/verify`, {
          user: dialog.mode === "link" ? dialog.account : null,
          body: dialog.mode === "link" ? body : newAccountBody(body),
        });
        finishLogin(dialog, response);
      } catch (error) {
        dialogFailed({ message }, error);
      }
    };
    const form = el("form", { class: "auth-method" },
      el("label", { class: "inline" }, `${label} `, input),
      el("div", { class: "inline-row" },
        sendButton,
        ...(callButton ? [callButton] : []),
        codeInput,
        verifyButton
      ),
      message
    );
    form.addEventListener("submit", event => {
      event.preventDefault();
      send("sms");
    });
    codeInput.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      verifyButton.click();
    });
    return form;
  }

  function guestMethod(dialog) {
    const input = el("input", { placeholder: I18n.t("ui.auth.guest_name", {}, "Guest name"), "aria-label": I18n.t("ui.auth.guest_name", {}, "Guest name") });
    const button = el("button", { type: "submit", textContent: I18n.t("ui.auth.continue_as_guest", {}, "Continue as guest") });
    const form = el("form", { class: "auth-method" },
      el("label", { class: "inline" }, `${I18n.t("ui.auth.guest", {}, "Guest")} `, input),
      button,
      el("p", { class: "muted", textContent: I18n.t("ui.auth.guest_bonus_note", {}, "Play as a guest without a welcome bonus. Link a verified login later to receive your one-time 1,000 tokens.") })
    );
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (button.disabled) return;
      button.disabled = true;
      try {
        finishLogin(dialog, await createGuest(input.value));
      } catch (error) {
        dialogFailed(dialog, error);
      } finally {
        button.disabled = false;
      }
    });
    return form;
  }

  /** The match invite token in this page's #invite=, or, on the login page a
   * logged-out visitor is sent to (/?next=/static/portal.html#invite=<token>),
   * in the page they will return to. */
  function inviteTokenInUrl() {
    const fromHash = (hash) => new URLSearchParams(hash.replace(/^#/, "")).get("invite");
    const direct = fromHash(location.hash || "");
    if (direct) return direct;
    const next = new URLSearchParams(location.search || "").get("next") || "";
    const at = next.indexOf("#");
    return at >= 0 ? fromHash(next.slice(at)) : null;
  }

  async function createGuest(displayName = "") {
    const name = displayName.trim() || I18n.t("ui.auth.guest_default_name", { number: accounts().length + 1 }, `Guest ${accounts().length + 1}`);
    const user = await apiRequest("POST", "/users", {
      body: newAccountBody({ display_name: name }),
    });
    return {
      user_id: user.id,
      display_name: user.display_name,
      password: user.password,
      referral_code: user.referral_code,
      linked_accounts: [],
      merged_from_user_id: null,
    };
  }

  /** An <img> for a stored picture URL, or null when there is none. */
  function avatarImg(url) {
    return url ? el("img", { class: "auth-avatar", src: url, alt: "", referrerPolicy: "no-referrer" }) : null;
  }

  // Account menu for the top bar

  /** Renders the account menu into [container]; call again after auth changes. */
  function renderMenu(container) {
    const account = current();
    const all = accounts();
    const key = JSON.stringify([account?.id, all.map(user => [user.id, user.display_name, user.picture_url, user.linked]), I18n.revision?.() ?? 0]);
    if (container._authRenderKey === key && container.querySelector(".auth-menu-button")) return container;
    const panelWasOpen = container.querySelector(".auth-menu-panel")?.hidden === false;
    // A profile picture or translation can arrive during a poll while the
    // menu is in use. Restore the same action after replacing its DOM.
    const focusedAction = container.contains(document.activeElement)
      && container._authAccountId === account?.id
      ? document.activeElement.dataset.authAction : null;
    container._authMenuResizeObserver?.disconnect();
    container.replaceChildren();
    const button = el("button", {
      type: "button",
      class: "auth-menu-button",
      "aria-expanded": String(panelWasOpen),
      "aria-controls": `${container.id || "auth-menu"}-actions`,
      "data-auth-action": "toggle",
    },
      avatarImg(account?.picture_url) || el("span", {
        class: "auth-avatar auth-avatar-placeholder",
        "aria-hidden": "true",
        textContent: Array.from(account?.display_name?.trim() || "")[0]?.toLocaleUpperCase() || "○",
      }),
      el("span", { class: "auth-menu-label", textContent: account ? account.display_name : I18n.t("ui.auth.log_in", {}, "Log in") })
    );
    const panel = el("div", { id: `${container.id || "auth-menu"}-actions`, class: "auth-menu-panel", hidden: true });
    panel.hidden = !panelWasOpen;
    panel.inert = !panelWasOpen;
    panel.setAttribute("aria-hidden", String(!panelWasOpen));
    const positionPanel = () => {
      if (panel.hidden) return;
      // Right alignment can put a wrapped mobile header's menu off-screen.
      // Measure without a previous correction, then keep both edges visible.
      // Start from the reading direction's trailing edge. In RTL, measuring a
      // right-anchored menu beside a left-side avatar first scrolls the page
      // horizontally, so its viewport bounds no longer describe its placement.
      const rtl = document.documentElement.dir === "rtl";
      panel.style.right = rtl ? "auto" : "0px";
      panel.style.left = rtl ? "0px" : "auto";
      const bounds = panel.getBoundingClientRect();
      const viewport = document.documentElement;
      const left = Math.max(8, Math.min(bounds.left, viewport.clientWidth - bounds.width - 8));
      if (rtl) panel.style.left = `${left - bounds.left}px`;
      else panel.style.right = `${bounds.left - left}px`;
      // offsetTop excludes the reveal animation's temporary translation.
      const top = container.getBoundingClientRect().top + panel.offsetTop;
      panel.style.maxHeight = `${Math.max(0, viewport.clientHeight - top - 8)}px`;
    };
    const hidePanel = () => {
      button.setAttribute("aria-expanded", "false");
      panel.inert = true;
      panel.setAttribute("aria-hidden", "true");
      panel.hidden = true;
    };
    button.onclick = (event) => {
      event.stopPropagation();
      panel.hidden = !panel.hidden;
      panel.inert = panel.hidden;
      panel.setAttribute("aria-hidden", String(panel.hidden));
      button.setAttribute("aria-expanded", String(!panel.hidden));
      positionPanel();
    };
    container.onkeydown = event => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        event.stopPropagation();
        hidePanel();
        button.focus({ preventScroll: true });
      }
    };
    container._hideAuthMenu = hidePanel;
    container._positionAuthMenu = positionPanel;
    if (!container._authCloseBound) {
      container._authCloseBound = true;
      document.addEventListener("click", event => {
        if (!container.contains(event.target)) container._hideAuthMenu?.();
      });
      window.addEventListener("resize", () => container._positionAuthMenu?.());
    }

    if (account) {
      panel.append(el("div", { class: "auth-menu-heading" },
        avatarImg(account.picture_url),
        I18n.t("ui.auth.logged_in_as", { name: account.display_name }, `Logged in as ${account.display_name}`)));
      if (account.linked.length) {
        panel.append(
          el("div", { class: "auth-menu-section" },
            el("div", { class: "muted", textContent: I18n.t("ui.auth.linked_logins", {}, "Linked logins") }),
            ...account.linked.map((link) =>
              el("div", { class: "auth-linked", textContent: methodLabel(link.kind, link.identifier) })
            )
          )
        );
      }
      panel.append(
        el("button", { type: "button", "data-auth-action": "link", textContent: I18n.t("ui.auth.link_method", {}, "Link a login method"), onclick: () => { hidePanel(); openDialog("link"); } }),
        el("button", {
          type: "button",
          "data-auth-action": "invite",
          textContent: I18n.t("ui.auth.copy_invite", {}, "Copy my invite link"),
          title: I18n.t("ui.auth.invite_hint", {}, "Everyone who signs up through this link counts as invited by you"),
          onclick: () => {
            hidePanel();
            navigator.clipboard
              // Read again: the code may have arrived after the menu was drawn.
              .writeText(inviteLink(current() ?? account))
              .then(() => toast(I18n.t("ui.auth.invite_copied", {}, "Copied your invite link")));
          },
        }),
        // Feedback about the website, on pages that load the feedback dialog (the portal).
        window.FeedbackDialog ? el("button", {
          type: "button",
          class: "feedback-menu-item",
          "data-auth-action": "feedback",
          textContent: I18n.t("ui.feedback.send_feedback", {}, "Send feedback"),
          onclick: () => {
            hidePanel();
            window.FeedbackDialog.open({ target: { type: "platform", id: "", name: "" }, chooseKind: true,
              user: current() ?? account, page: location.pathname + location.hash });
          },
        }) : null
      );
    }
    if (all.length > 1 || (all.length === 1 && !account)) {
      panel.append(el("div", { class: "auth-menu-heading", textContent: I18n.t("ui.auth.switch_account", {}, "Switch account") }));
      for (const other of all) {
        if (account && other.id === account.id) continue;
        panel.append(
          el("button", {
            type: "button",
            "data-auth-action": `switch:${other.id}`,
            textContent: other.display_name,
            onclick: () => setCurrent(other.id),
          })
        );
      }
    }
    panel.append(
      el("button", { type: "button", "data-auth-action": "login", textContent: account ? I18n.t("ui.auth.add_account", {}, "Add another account") : I18n.t("ui.auth.log_in", {}, "Log in"), onclick: () => { hidePanel(); openDialog("login"); } })
    );
    if (account) {
      panel.append(
        el("button", { type: "button", "data-auth-action": "logout", textContent: I18n.t("ui.auth.log_out_name", { name: account.display_name }, `Log out ${account.display_name}`), onclick: () => remove(account.id) }),
        el("button", { type: "button", "data-auth-action": "logout-all", textContent: I18n.t("ui.auth.log_out_all", {}, "Log out of all accounts"), onclick: removeAll })
      );
    }
    container.append(button, panel);
    positionPanel();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(positionPanel);
      observer.observe(panel);
      const header = container.closest(".topbar");
      if (header) observer.observe(header);
      container._authMenuResizeObserver = observer;
    }
    container._authRenderKey = key;
    container._authAccountId = account?.id;
    if (focusedAction) {
      Array.from(container.querySelectorAll("[data-auth-action]"))
        .find(node => node.dataset.authAction === focusedAction)?.focus({preventScroll: true});
    }
    return container;
  }

  return {
    accounts,
    current,
    setCurrent,
    upsert,
    remove,
    removeAll,
    headers,
    inviteLink,
    setReferralCode,
    setPicture,
    newAccountBody,
    createGuest,
    openDialog,
    closeDialog,
    renderMenu,
    toast,
  };
})();
