"use strict";

// Navigation layout is a local presentation preference. The catalog, matches,
// wallet and controls use the same design for everyone.
(() => {
  const layouts = new Set(["left", "hamburger", "top"]);
  const picker = document.getElementById("portal-layout-picker");
  if (!picker) return;

  function selectedLayout() {
    const value = new URLSearchParams(location.search).get("layout");
    return layouts.has(value) ? value : "top";
  }

  function applyLayout() {
    const layout = selectedLayout();
    const modern = layout === "top";
    document.documentElement.dataset.portalLayout = layout;
    document.documentElement.dataset.portalNavigation = modern ? "modern" : "legacy";
    const sidebar = document.getElementById("legacy-match-navigation");
    const matches = document.getElementById("matches-groups-home");
    if (sidebar && matches) {
      const groups = ["portal-login-note", "my-matches", "group-open"]
        .map(id => document.getElementById(id))
        .filter(Boolean)
        .map(node => node.id === "group-open" ? node.closest(".open-matches-board") : node)
        .filter((node, index, all) => node && all.indexOf(node) === index);
      for (const group of groups) (modern ? matches : sidebar).append(group);
    }
    picker.value = layout;
    window.syncPortalNavigationLinks?.();
    document.dispatchEvent(new CustomEvent("portal-layout-change", {detail:{key:layout}}));
  }

  picker.addEventListener("change", event => {
    const layout = event.currentTarget.value;
    const url = new URL(location.href);
    if (layouts.has(layout) && layout !== "top") url.searchParams.set("layout", layout);
    else url.searchParams.delete("layout");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    applyLayout();
  });
  window.addEventListener("popstate", applyLayout);
  applyLayout();
})();
