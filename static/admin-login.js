"use strict";

(() => {
  const $ = id => document.getElementById(id);
  // The translation script may be unavailable or have failed to initialize.
  // Keep sign-in independent of it and use the existing English strings.
  let i18n;
  try { i18n = I18n; } catch { /* The locale script did not initialize. */ }
  const translate = (key, params, fallback) => i18n
    ? i18n.t(key, params, fallback)
    : fallback.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
  const copy = {
    page_title: (params = {}) => translate("ui.admin_signin.page_title", params, "BuildPlay · Admin sign-in"),
    heading: (params = {}) => translate("ui.admin_signin.heading", params, "Sign in to admin"),
    intro: (params = {}) => translate("ui.admin_signin.intro", params, "Sign in with the Google account for your email listed in the course roster. Admin access is available to the instructor and the 12 students."),
    email_note: (params = {}) => translate("ui.admin_signin.email_note", params, "Google shares your name and email with BuildPlay. We save your Google email on your platform account so your activity and bug reports can be attributed to you."),
    loading: (params = {}) => translate("ui.admin_signin.loading", params, "Loading sign-in…"),
    needed: (params = {}) => translate("ui.admin_signin.needed", params, "Sign in with Google to continue."),
    verifying: (params = {}) => translate("ui.admin_signin.verifying", params, "Verifying your Google sign-in…"),
    complete: (params = {}) => translate("ui.admin_signin.complete", params, "Google sign-in is complete."),
    identity: (params = {}) => translate("ui.admin_signin.identity", params, "Signed in as {name} ({email})."),
    continue: (params = {}) => translate("ui.admin_signin.continue", params, "Continue to admin"),
    change_google: (params = {}) => translate("ui.admin_signin.change_google", params, "Use another Google account"),
    back: (params = {}) => translate("ui.admin_signin.back", params, "Return to games"),
    verify_failed: (params = {}) => translate("ui.admin_signin.verify_failed", params, "Google sign-in could not be verified. Sign in again."),
    not_allowed: (params = {}) => translate("ui.admin_signin.not_allowed", params, "This Google account is not listed for course admin access. Use your Columbia or personal Google account listed in the roster."),
    complete_failed: (params = {}) => translate("ui.admin_signin.complete_failed", params, "Admin sign-in could not be completed. Try again shortly."),
    google_failed: (params = {}) => translate("ui.admin_signin.google_failed", params, "Google sign-in could not be verified."),
    load_google_failed: (params = {}) => translate("ui.admin_signin.load_google_failed", params, "Google sign-in could not be loaded. Check your connection and reload this page."),
    signout_failed: (params = {}) => translate("ui.admin_signin.signout_failed", params, "Could not sign out. Try again."),
    load_failed: (params = {}) => translate("ui.admin_signin.load_failed", params, "Could not load admin sign-in. Reload this page to try again."),
    not_configured: (params = {}) => translate("ui.admin_signin.not_configured", params, "Google sign-in is not configured. Contact the site administrator."),
  };
  let statusCopy = copy.loading, errorKey = "", signedIdentity = null;
  function setStatus(value) { statusCopy = value; $("status").textContent = value ? value() : ""; }
  const paths = new Set(["/admin", "/browse", "/stats", "/feedback", "/bug-reports", "/console", "/docs", "/redoc", "/invites", "/game-test", "/game-server-bugs"]);
  const staticPages = new Set(["admin.html", "browse.html", "stats.html", "feedback.html", "bug-reports.html", "students.html", "invites.html", "console.html", "game-test.html", "game-server-bugs.html"]);
  function safeNext(value) {
    if (!value || !value.startsWith("/") || value.startsWith("//") || Array.from(value).some(char => char.codePointAt(0) === 92 || char.codePointAt(0) < 32)) return "/admin";
    try {
      const url = new URL(value, location.origin);
      const path = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
      if (url.origin !== location.origin || path === "/admin/login") return "/admin";
      if (!paths.has(path) && !path.startsWith("/admin/") && !(path.startsWith("/static/") && staticPages.has(path.slice(8)))) return "/admin";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch { return "/admin"; }
  }
  let destination = safeNext(new URLSearchParams(location.search).get("next"));
  // A browser retains the original fragment across the server's sign-in
  // redirect. Preserve it so /admin#students returns to the leaderboard tab.
  if (!destination.includes("#") && location.hash) destination += location.hash;
  $("continue").href = destination;
  let submitting = false;
  function showError(key) {
    key = key && Object.hasOwn(copy, key) ? key : key ? "complete_failed" : "";
    errorKey = key;
    $("error").textContent = key ? copy[key]() : "";
    $("error").hidden = !key;
  }
  function signedIn(data) {
    $("google-sign-in").hidden = true;
    $("signed-in").hidden = false;
    signedIdentity = data;
    $("identity").textContent = copy.identity({name: data.user.display_name || data.user.email, email: data.user.email});
    setStatus(copy.complete);
  }
  async function googleCallback(result) {
    if (submitting || !result.credential) return;
    window.SiteBugReporter?.rememberSecrets?.([result.credential]);
    submitting = true;
    showError("");
    setStatus(copy.verifying);
    try {
      const response = await fetch("/auth/admin-session", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: {"Content-Type": "application/json"}, body: JSON.stringify({id_token: result.credential}),
      });
      if (!response.ok) throw new Error(response.status === 401
        ? "verify_failed"
        : response.status === 403 ? "not_allowed" : "complete_failed");
      const data = await response.json();
      if (!data.signed_in) throw new Error("google_failed");
      signedIn(data);
      location.replace(destination);
    } catch (error) {
      showError(error.message);
      setStatus(copy.needed);
    } finally { submitting = false; }
  }
  async function loadGoogle(clientId) {
    if (!window.google?.accounts?.id) await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("load_google_failed"));
      document.head.append(script);
    });
    window.google.accounts.id.initialize({client_id: clientId, callback: googleCallback, auto_select: false});
    window.google.accounts.id.renderButton($("google-sign-in"), {theme: "outline", size: "large", width: 280});
    $("google-sign-in").hidden = false;
  }
  $("sign-out").addEventListener("click", async () => {
    $("sign-out").disabled = true;
    try {
      const response = await fetch("/auth/admin-session", {method: "DELETE", credentials: "same-origin", cache: "no-store"});
      if (!response.ok) throw new Error("signout_failed");
      window.google?.accounts?.id?.disableAutoSelect();
      location.reload();
    } catch (error) {
      showError(error.message);
      $("sign-out").disabled = false;
    }
  });
  async function main() {
    try {
      const [configResponse, sessionResponse] = await Promise.all([
        fetch("/auth/config", {cache: "no-store"}),
        fetch("/auth/admin-session", {credentials: "same-origin", cache: "no-store"}),
      ]);
      if (!configResponse.ok || !sessionResponse.ok) throw new Error("load_failed");
      const [config, session] = await Promise.all([configResponse.json(), sessionResponse.json()]);
      if (session.signed_in) { signedIn(session); return; }
      if (!config.google_client_id) throw new Error("not_configured");
      await loadGoogle(config.google_client_id);
      setStatus(copy.needed);
    } catch (error) { setStatus(""); showError(error.message); }
  }
  document.addEventListener("i18n-changed", () => {
    setStatus(statusCopy);
    showError(errorKey);
    if (signedIdentity) signedIn(signedIdentity);
  });
  Promise.resolve(i18n?.ready).then(main, main);
})();
