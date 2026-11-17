"use strict";

// Presentation only: preserves the game renderer and match state.
window.PortalMatchLayout = (() => {
  const $ = id => document.getElementById(id);
  const landscape = window.matchMedia(
    "(orientation: landscape) and (max-width: 1024px), (orientation: landscape) and (max-width: 1366px) and (pointer: coarse)",
  );
  let match = null;
  let manualFocus = null;
  let controlsOpen = false;
  let menuOpen = false;
  let online = navigator.onLine;
  let previousStatus = null;
  let previousConflict = null;

  function positionTools() {
    const toolbar = $("match-toolbar-title").parentElement;
    // Fixed offsets cannot account for wrapped titles, clocks and translated
    // buttons. Keep the panel below the actual toolbar, including after resize.
    if (!toolbar?.getBoundingClientRect) return;
    $("match").style.setProperty("--match-tools-top", `${toolbar.offsetTop + toolbar.offsetHeight + 8}px`);
  }

  function render() {
    const active = Boolean(match);
    const waiting = match?.status === "waiting_for_players";
    const boardOnly = active && !waiting && match.boardOnly === true;
    const immersive = document.documentElement?.dataset?.skin === "immersive";
    // Focus is match-first too: auto-focus a live match on any screen, like
    // immersive. (The generic body.match-focus CSS already hides the topbar
    // and sidebar for every skin; no rule moves here.)
    const focusArchetype = document.documentElement?.dataset?.portalArchetype === "focus";
    const focused = boardOnly || (active && !waiting && (manualFocus ?? (landscape.matches || immersive || focusArchetype)));
    const focusChanged = active && document.body.classList.contains("match-page") &&
      document.body.classList.contains("match-focus") !== focused;
    document.body.classList.toggle("match-page", active);
    document.body.classList.toggle("match-focus", focused);
    document.body.classList.toggle("match-lobby", active && waiting);
    document.body.classList.toggle("match-immersive", boardOnly);
    document.body.classList.toggle("match-menu-open", boardOnly && (menuOpen || controlsOpen));
    $("match-menu-toggle").hidden = !boardOnly;
    $("match-menu-toggle").setAttribute("aria-expanded", String(menuOpen || controlsOpen));
    $("match-menu-toggle").textContent = menuOpen || controlsOpen ? "×" : "⋯";
    // Fade the toolbar after the layout switches; keep the game renderer mounted.
    if (focusChanged && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const toolbar = $("match-focus-toggle").parentElement;
      toolbar?.getAnimations?.().forEach(animation => animation.cancel());
      toolbar?.animate?.([{opacity:.35, transform:"translateY(-4px)"}, {opacity:1, transform:"translateY(0)"}],
        {duration:220, easing:"ease-out"});
    }
    $("match-tools").hidden = !active || (!waiting && !controlsOpen);
    $("match-controls-toggle").hidden = waiting;
    $("match-controls-toggle").setAttribute("aria-expanded", String(waiting || controlsOpen));
    $("match-controls-toggle").textContent = controlsOpen ? I18n.t("ui.portal.hide_controls", {}, "Hide controls") : I18n.t("ui.portal.controls", {}, "Controls");
    $("match-focus-toggle").hidden = waiting || boardOnly;
    $("match-focus-toggle").setAttribute("aria-pressed", String(focused));
    $("match-focus-toggle").textContent = focused ? I18n.t("ui.portal.exit_focus", {}, "Exit focus") : I18n.t("ui.portal.focus", {}, "Focus");
    $("match-toolbar-title").textContent = active && !boardOnly ? $("match-title").textContent : "";
    const error = $("match-message").classList.contains("error") ? $("match-message").textContent : "";
    const notices = [];
    if (match?.conflict) notices.push(I18n.t("ui.portal.sync_review", {}, "Sync needs review — open Controls"));
    else if (error) notices.push(error);
    if (match?.pending) notices.push(I18n.t("ui.match.pending_sync", {count: match.pending}, `${match.pending} move${match.pending === 1 ? "" : "s"} saved on this device · waiting to sync`));
    else if (active && !online) notices.push(match.localMode
      ? I18n.t("ui.portal.offline_practice", {}, "Offline · playing on this device")
      : I18n.t("ui.portal.offline_moves", {}, "Offline · moves save on this device"));
    if (match?.speedNotice) notices.push(match.speedNotice); // speed matches: time ran out
    if (match?.joinNotice) notices.push(match.joinNotice); // why this match can't be joined
    if (match?.status === "over") notices.push($("match-result").textContent || I18n.t("ui.match.finished", {}, "Match finished"));
    $("match-play-notice").textContent = notices.join(" · ");
    $("match-play-notice").hidden = notices.length === 0;
    $("match-play-notice").classList.toggle("error", Boolean(error || match?.conflict));
    positionTools();
  }

  function update(next) {
    if (next?.id !== match?.id) {
      manualFocus = null;
      menuOpen = false;
      controlsOpen = next?.status === "over";
      previousStatus = null;
      previousConflict = null;
    }
    // Reveal rematch/conflict actions once, not again on every poll.
    if (next?.status === "over" && previousStatus !== "over") controlsOpen = true;
    const conflict = next?.conflict?.message || null;
    if (conflict && conflict !== previousConflict) controlsOpen = true;
    match = next;
    previousStatus = next?.status;
    previousConflict = conflict;
    render();
  }

  function init(onExit) {
    const toolbar = $("match-toolbar-title").parentElement;
    if (window.ResizeObserver && toolbar) new ResizeObserver(positionTools).observe(toolbar);
    window.addEventListener("resize", positionTools);
    $("match-back").addEventListener("click", onExit);
    $("match-menu-toggle").addEventListener("click", () => {
      menuOpen = !(menuOpen || controlsOpen);
      if (!menuOpen) controlsOpen = false;
      render();
    });
    $("match-controls-toggle").addEventListener("click", () => {
      controlsOpen = !controlsOpen;
      render();
    });
    $("match-focus-toggle").addEventListener("click", () => {
      // The initial focus state can come from the skin or the selected portal
      // layout as well as the screen orientation. Toggle what is shown.
      manualFocus = !document.body.classList.contains("match-focus");
      render();
    });
    document.addEventListener("i18n-changed", render);
    document.addEventListener("portal-skin-change", render);
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !match) return;
      if (match.boardOnly) {
        menuOpen = !(menuOpen || controlsOpen);
        controlsOpen = false;
        render();
        $("match-menu-toggle").focus();
        return;
      }
      if (controlsOpen && match.status !== "waiting_for_players") {
        controlsOpen = false;
        render();
        $("match-controls-toggle").focus();
      } else if (document.body.classList.contains("match-focus")) {
        manualFocus = false;
        render();
        $("match-focus-toggle").focus();
      }
    });
    // A new orientation gets its appropriate default; ordinary resizing and
    // polling preserve a person's explicit Focus/Controls choice.
    landscape.addEventListener("change", () => { manualFocus = null; render(); });
    new MutationObserver(render).observe($("match-message"), {childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"]});
    render();
  }

  return { init, update, connection(value) { online = value; render(); } };
})();
