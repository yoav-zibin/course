// Admin hub: tabs that embed the super-admin tools (API console, data browser,
// statistics, invites, API docs) as iframes. The /browse, /stats and /invites pages
// need the master password; the browser reuses the credentials entered for /admin
// itself.

"use strict";

const $ = (id) => document.getElementById(id);

const TABS = ["console", "browse", "stats", "invites", "feedback", "docs"];
const loaded = new Set();

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
}

function main() {
  for (const tab of TABS) {
    $(`tab-${tab}`).addEventListener("click", () => showTab(tab));
  }
  const initial = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "console";
  Auth.renderMenu($("account-menu"));
  document.addEventListener("auth-changed", () => Auth.renderMenu($("account-menu")));
  showTab(initial);
}

main();

// Preview in a separate portal tab; this never calls an assignment or admin write API.
(() => {
  const picker = document.getElementById("admin-skin-preview");
  if (!picker) return;
  const link = document.getElementById("admin-open-preview");
  picker.onchange = () => { link.href = "/static/portal.html?skin=" + encodeURIComponent(picker.value); };
  const sheet = document.querySelector('link[href*="experiments.css"]');
  if (!sheet) return;
  fetch(sheet.href).then(r => r.ok ? r.text() : "").then(css => {
    const names = new Set(Array.from(css.matchAll(/data-skin="([a-z0-9-]+)"/g), m => m[1]));
    for (const key of [...names].sort()) {
      if (![...picker.options].some(o => o.value === key))
        picker.add(new Option(key.split("-").map(w => w[0].toUpperCase()+w.slice(1)).join(" "),key));
    }
  }).catch(() => {}); // Keep the two built-in comparison options if discovery fails.
})();
