// Admin hub: tabs that embed the super-admin tools (API console, data browser,
// statistics, invites, API docs) as iframes. The header shows the verified Google
// admin session; Portal player accounts stay separate from admin sign-in.

"use strict";

const $ = (id) => document.getElementById(id);

const TABS = ["console", "browse", "stats", "students", "invites", "bug-reports", "feedback", "docs"];
const loaded = new Set();
let administrator = null, sessionLoading = true, signingOut = false, sessionError = "";

function signInUrl() {
  return "/admin/login?" + new URLSearchParams({next: location.pathname + location.search + location.hash});
}

function renderAdminIdentity() {
  const menu = $("account-menu");
  menu.replaceChildren();
  if (sessionLoading) {
    menu.append(el("span", {textContent: I18n.t("ui.admin_signin.loading", {}, "Loading sign-in…")}));
    return;
  }
  if (administrator) {
    menu.append(el("span", {id: "admin-identity", textContent: I18n.t("ui.admin_signin.identity", {
      name: administrator.display_name || administrator.email, email: administrator.email,
    }, "Signed in as {name} ({email}).")}));
    const change = el("button", {id: "admin-sign-out", type: "button", disabled: signingOut,
      textContent: I18n.t("ui.admin_signin.change_google", {}, "Use another Google account")});
    change.addEventListener("click", async () => {
      signingOut = true; sessionError = ""; renderAdminIdentity();
      try {
        const response = await fetch("/auth/admin-session", {method: "DELETE", credentials: "same-origin", cache: "no-store"});
        if (!response.ok) throw new Error("admin_signout_failed");
        window.google?.accounts?.id?.disableAutoSelect();
        location.replace(signInUrl());
      } catch {
        signingOut = false; sessionError = "signout"; renderAdminIdentity();
      }
    });
    menu.append(change);
  }
  if (sessionError) {
    menu.append(el("span", {role: "alert", textContent: sessionError === "signout"
      ? I18n.t("ui.admin_signin.signout_failed", {}, "Could not sign out. Try again.")
      : I18n.t("ui.admin_signin.load_failed", {}, "Could not load admin sign-in. Reload this page to try again.")}));
  }
}

async function loadAdminIdentity() {
  try {
    const response = await fetch("/auth/admin-session", {credentials: "same-origin", cache: "no-store"});
    if (!response.ok) throw new Error("admin_session_unavailable");
    const session = await response.json();
    if (!session.signed_in) {location.replace(signInUrl()); return;}
    administrator = session.user;
  } catch {sessionError = "load";}
  finally {sessionLoading = false; renderAdminIdentity();}
}

function showTab(name) {
  for (const tab of TABS) {
    $(`tab-${tab}`).setAttribute("aria-selected", String(name === tab));
  }
  const src = $(`tab-${name}`).dataset.src;
  const wrap = $("admin-frame-wrap");
  if (!loaded.has(name)) {
    const frame = document.createElement("iframe");
    frame.title = $(`tab-${name}`).textContent;
    frame.src = src;
    // Keep every tab's page alive so switching tabs doesn't lose state.
    frame.hidden = true;
    frame.dataset.tab = name;
    wrap.append(frame);
    loaded.add(name);
  }
  for (const frame of wrap.querySelectorAll("iframe")) {
    frame.hidden = frame.dataset.tab !== name;
  }
  const note = wrap.querySelector(".empty-note");
  if (note) note.remove();
  location.hash = name;
  $(`tab-${name}`).scrollIntoView({block: "nearest", inline: "nearest"});
}

function main() {
  for (const tab of TABS) {
    $(`tab-${tab}`).addEventListener("click", () => showTab(tab));
  }
  const initial = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "console";
  renderAdminIdentity();
  document.addEventListener("i18n-changed", renderAdminIdentity);
  void loadAdminIdentity();
  showTab(initial);
}

main();
