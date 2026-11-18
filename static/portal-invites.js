"use strict";

// Keep a lobby's invitation visible and stable while the match polls. A private
// invitation belongs to the account that created it, including after a reload.
window.PortalInvites = (() => {
  const $ = id => document.getElementById(id);
  const urls = new Map();
  const pending = new Map();
  const failures = new Map();
  const hydrated = new Set();
  const copied = new Map();
  let dependencies = {};
  let active = null;
  let dialog = null;
  let initialized = false;

  const t = (key, fallback) => I18n.t(key, {}, fallback);
  const keyOf = (match, options) => JSON.stringify([options.user?.id || "", match.id, needsToken(match, options)]);
  const storageKey = key => `game-platform.portal-invite.v1:${key}`;
  const needsToken = (match, options) => Boolean(match.private && options.participant && options.canInvite);
  const currentUser = () => dependencies.currentUser?.();
  const isCurrent = key => active?.key === key && currentUser()?.id === active.options.user?.id &&
    new URLSearchParams(location.hash.slice(1)).get("match") === active.match.id;

  function validLink(value) {
    if (typeof value !== "string" || !value) return false;
    try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
  }

  function cachedLink(match, options) {
    const key = keyOf(match, options);
    if (!needsToken(match, options)) {
      return options.user && dependencies.inviteLink
        ? dependencies.inviteLink(options.user, `match=${match.id}`)
        : `${location.origin}/portal#match=${match.id}`;
    }
    if (!hydrated.has(key)) {
      hydrated.add(key);
      try {
        const saved = sessionStorage.getItem(storageKey(key));
        if (validLink(saved)) urls.set(key, saved);
      } catch {}
    }
    return urls.get(key) || "";
  }

  function linkFor(match, options, retry = false) {
    const key = keyOf(match, options);
    const saved = cachedLink(match, options);
    if (saved) return Promise.resolve(saved);
    if (pending.has(key)) return pending.get(key);
    if (failures.has(key) && !retry) return Promise.reject(failures.get(key));
    failures.delete(key);
    const task = Promise.resolve().then(async () => {
      const invite = await dependencies.request("POST", `/matches/${encodeURIComponent(match.id)}/invites`, {user: options.user});
      if (!validLink(invite?.url)) throw new Error(t("ui.match.link_failed", "Could not create an invite link. Try again."));
      urls.set(key, invite.url);
      try { sessionStorage.setItem(storageKey(key), invite.url); } catch {}
      return invite.url;
    }).catch(error => {
      failures.set(key, error);
      throw error;
    }).finally(() => {
      pending.delete(key);
      if (isCurrent(key)) renderPanel();
    });
    pending.set(key, task);
    return task;
  }

  function renderPanel() {
    const panel = $("lobby-invite-panel");
    if (!panel) return;
    const shown = active?.eligible && isCurrent(active.key);
    panel.hidden = !shown;
    if (!shown) return;
    const {match, options, key} = active;
    const link = cachedLink(match, options);
    const loading = pending.has(key);
    const failed = failures.has(key);
    const input = $("lobby-invite-link");
    // Do not replace this input or disturb its selection on every poll.
    if (input.value !== link) input.value = link;
    input.placeholder = loading ? t("ui.match.link_loading", "Preparing invite link…") : "";
    $("lobby-invite-label").textContent = t("ui.match.invite_link", "Invite link");
    const button = $("lobby-invite-copy");
    button.disabled = loading;
    button.textContent = failed ? t("ui.action.retry", "Retry") : t("ui.match.copy_link", "Copy link");
    panel.setAttribute("aria-busy", String(loading));
    const status = $("lobby-invite-status");
    status.classList.toggle("error", failed);
    status.textContent = loading ? t("ui.match.link_loading", "Preparing invite link…")
      : failed ? t("ui.match.link_failed", "Could not create an invite link. Try again.")
      : copied.get(key) === "copied" ? t("ui.match.link_copied", "Link copied. Send it to a friend.")
      : copied.get(key) === "manual" ? t("ui.match.link_manual", "Copy this link and send it to a friend.") : "";
  }

  function selectLink(input) {
    input.focus();
    input.select();
  }

  function closeDialog() {
    if (!dialog) return;
    const previous = dialog;
    dialog = null;
    previous.node.close();
    previous.node.remove();
    if (previous.opener?.isConnected) previous.opener.focus();
    else document.querySelector(".invite-action")?.focus();
  }

  function renderDialog() {
    if (!dialog) return;
    dialog.title.textContent = t("ui.match.share_match", "Share match");
    dialog.label.textContent = t("ui.match.invite_link", "Invite link");
    const hasLink = Boolean(dialog.input.value);
    dialog.input.hidden = !hasLink;
    dialog.label.hidden = !hasLink;
    dialog.open.hidden = !hasLink;
    dialog.copy.textContent = dialog.retry ? t("ui.action.retry", "Retry") : t("ui.match.copy_link", "Copy link");
    dialog.copy.disabled = Boolean(dialog.loading);
    dialog.close.textContent = t("ui.action.close", "Close");
    dialog.status.classList.toggle("error", Boolean(dialog.retry && !dialog.loading));
    dialog.status.textContent = dialog.loading ? t("ui.match.link_loading", "Preparing invite link…")
      : dialog.retry ? t("ui.match.link_failed", "Could not create an invite link. Try again.") : dialog.copied
      ? t("ui.match.link_copied", "Link copied. Send it to a friend.")
      : t("ui.match.link_manual", "Copy this link and send it to a friend.");
    dialog.notice.hidden = !dialog.restricted;
    dialog.notice.textContent = t("ui.match.private_share_notice", "Only players in this private match can open this link.");
  }

  function showDialog(link, key, restricted, retry = null) {
    if (dialog?.key === key) { selectLink(dialog.input); return; }
    closeDialog();
    const node = document.createElement("dialog");
    node.className = "portal-share-dialog";
    const title = document.createElement("h2");
    title.id = "portal-share-title";
    node.setAttribute("aria-labelledby", title.id);
    const label = document.createElement("label");
    label.htmlFor = "portal-share-link";
    const input = document.createElement("input");
    input.id = label.htmlFor;
    input.type = "text";
    input.readOnly = true;
    input.dir = "ltr";
    input.value = link;
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    const controls = document.createElement("div");
    controls.className = "lobby-invite-controls";
    controls.append(input, copyButton);
    const open = document.createElement("a");
    open.className = "portal-share-open";
    if (link) open.href = link;
    open.textContent = link;
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const notice = document.createElement("p");
    notice.className = "portal-share-notice";
    const close = document.createElement("button");
    close.type = "button";
    close.addEventListener("click", closeDialog);
    node.addEventListener("click", event => { if (event.target === node) closeDialog(); });
    node.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
    node.addEventListener("close", () => { if (dialog?.node === node) closeDialog(); });
    copyButton.addEventListener("click", async () => {
      if (dialog?.retry) {
        const target = dialog;
        target.loading = true;
        renderDialog();
        try {
          const prepared = await linkFor(target.retry.match, target.retry.options, true);
          if (dialog !== target || !isCurrent(key)) return;
          target.input.value = prepared;
          target.open.href = prepared;
          target.open.textContent = prepared;
          target.retry = null;
          selectLink(input);
        } catch {} finally {
          if (dialog === target) { target.loading = false; renderDialog(); }
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(input.value);
        if (dialog?.node === node) { dialog.copied = true; renderDialog(); }
      } catch { selectLink(input); }
    });
    node.append(title, label, controls, open, status, notice, close);
    dialog = {node, key, title, label, input, open, copy: copyButton, status, notice, restricted, retry, close, opener: document.activeElement, copied: false};
    renderDialog();
    document.body.append(node);
    node.showModal();
    if (link) selectLink(input);
    else copyButton.focus();
  }

  async function copy(match, options) {
    const key = keyOf(match, options);
    try {
      const link = await linkFor(match, options, true);
      if (!isCurrent(key)) return;
      try {
        await navigator.clipboard.writeText(link);
        if (!isCurrent(key)) return;
        copied.set(key, "copied");
        renderPanel();
        const message = t("ui.match.link_copied", "Link copied. Send it to a friend.");
        dependencies.notify?.(match.private && !needsToken(match, options)
          ? `${message} ${t("ui.match.private_share_notice", "Only players in this private match can open this link.")}` : message);
      } catch {
        if (!isCurrent(key)) return;
        copied.set(key, "manual");
        renderPanel();
        if (active.eligible) selectLink($("lobby-invite-link"));
        else showDialog(link, key, match.private && !needsToken(match, options));
      }
    } catch {
      if (!isCurrent(key)) return;
      renderPanel();
      if (!active.eligible) showDialog("", key, false, {match, options});
    }
  }

  function update(match, options = {}) {
    const key = match ? keyOf(match, options) : null;
    if (key !== active?.key) {
      closeDialog();
      if ($("lobby-invite-link")) $("lobby-invite-link").value = "";
    }
    active = match ? {match, options, key, eligible: Boolean(options.user && options.participant && options.canInvite &&
      !match.localMode && match.status === "waiting_for_players")} : null;
    if (active?.eligible) void linkFor(match, options).catch(() => {});
    renderPanel();
  }

  function init(options) {
    dependencies = options;
    if (initialized) return;
    initialized = true;
    $("lobby-invite-copy").addEventListener("click", () => {
      if (!active || !isCurrent(active.key)) return;
      if (failures.has(active.key)) {
        void linkFor(active.match, active.options, true).catch(() => {});
        renderPanel();
      } else void copy(active.match, active.options);
    });
    document.addEventListener("i18n-changed", () => { renderPanel(); renderDialog(); });
    document.addEventListener("auth-changed", () => update(null));
  }

  return {init, update, copy};
})();
