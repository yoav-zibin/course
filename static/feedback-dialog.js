"use strict";

// Feedback: a small dialog that sends POST /feedback about a player, a game, a match or
// the platform: a bug, a suggestion or a problem. Feedback is private; nothing changes
// for anyone when it's sent.
window.FeedbackDialog = (() => {
  const MIN = 5;
  const MAX = 1000;
  const KINDS = ["bug", "suggestion", "problem"];
  const t = (key, params, fallback) => I18n.t(key, params, fallback);

  /** The dialog's title for a [kind] of feedback. */
  function titleFor(kind) {
    if (kind === "bug") return t("ui.feedback.title_bug", {}, "Report a bug");
    if (kind === "suggestion") return t("ui.feedback.title_suggestion", {}, "Suggest something");
    return t("ui.feedback.title_problem", {}, "What's wrong?");
  }

  function placeholderFor(kind) {
    if (kind === "bug") return t("ui.feedback.placeholder_bug", {}, "What happened, and what did you expect?");
    if (kind === "suggestion") return t("ui.feedback.placeholder_suggestion", {}, "What would make it better?");
    return t("ui.feedback.placeholder_problem", {}, "Describe the problem and why it's a problem");
  }

  function kindLabel(kind) {
    if (kind === "bug") return t("ui.feedback.kind_bug", {}, "Bug");
    if (kind === "suggestion") return t("ui.feedback.kind_suggestion", {}, "Suggestion");
    return t("ui.feedback.kind_problem", {}, "Problem");
  }

  /** What the dialog says it's about. */
  function aboutText(target) {
    if (target.type === "user") return t("ui.feedback.about_player", { name: target.name }, `About ${target.name}`);
    if (target.type === "game") return t("ui.feedback.about_game", { name: target.name }, `About the game ${target.name}`);
    if (target.type === "match") return t("ui.feedback.about_match", { name: target.name }, `About this match of ${target.name}`);
    return t("ui.feedback.about_platform", {}, "About the website");
  }

  /** The dialog's logic, without the page: the kind, the counter, whether Send is
   * allowed, and sending. [request] is apiRequest (or a test double). */
  function createForm({ target, kind = "bug", user, page, request, online = () => navigator.onLine }) {
    const form = { kind, text: "", sending: false, sent: false, error: "" };
    form.counter = () => t("ui.feedback.counter", { count: form.text.length, max: MAX }, `${form.text.length} / ${MAX}`);
    form.canSend = () => !form.sending && !form.sent && form.text.trim().length >= MIN;
    form.setKind = (next) => { if (KINDS.includes(next)) form.kind = next; };
    form.input = (text) => {
      form.text = text.slice(0, MAX);
      form.error = "";
    };
    form.submit = async () => {
      if (form.text.trim().length < MIN) {
        form.error = t("ui.feedback.too_short", { min: MIN }, `Write at least ${MIN} characters.`);
        return false;
      }
      if (!online()) {
        form.error = t("ui.feedback.offline", {}, "Connect to the internet to send feedback.");
        return false;
      }
      form.sending = true;
      form.error = "";
      try {
        const body = { kind: form.kind, target_type: target.type, text: form.text.trim(), page };
        if (target.type !== "platform") body.target_id = target.id;
        await request("POST", "/feedback", { user, body });
        form.sent = true;
        return true;
      } catch (error) {
        // The server's message is already in the user's language (too short, daily limit…).
        form.error = error?.message || t("ui.feedback.failed", {}, "Couldn't send the feedback. Try again.");
        return false;
      } finally {
        form.sending = false;
      }
    };
    return form;
  }

  let current = null;

  function close() {
    if (!current) return;
    current.backdrop.remove();
    document.removeEventListener("keydown", current.onKey, true);
    current.returnFocus?.focus?.();
    current = null;
  }

  /** Opens the dialog for [target] {type: "user" | "game" | "match" | "platform", id,
   * name}. With [chooseKind] the sender picks bug, suggestion or problem (starting at
   * [kind]); otherwise [kind] is fixed (a player report is always a "problem"). */
  function open({ target, kind = "bug", chooseKind = false, user, page, request = apiRequest }) {
    close();
    const form = createForm({ target, kind, user, page, request });
    const title = el("h2", { id: "feedback-title" });
    const text = el("textarea", { id: "feedback-text", rows: 5, maxLength: MAX });
    const counter = el("span", { id: "feedback-counter", class: "feedback-counter", "aria-live": "polite" });
    const message = el("p", { id: "feedback-message", class: "feedback-message", role: "alert" });
    const cancel = el("button", { type: "button", id: "feedback-cancel", textContent: t("ui.feedback.cancel", {}, "Cancel"), onclick: close });
    const send = el("button", { type: "button", id: "feedback-send", class: "primary", textContent: t("ui.feedback.send", {}, "Send") });
    const kinds = chooseKind ? el("fieldset", { id: "feedback-kind", class: "feedback-kinds" },
      el("legend", { textContent: t("ui.feedback.kind", {}, "Kind") }),
      ...KINDS.map((value) => el("label", { class: "feedback-kind" },
        el("input", { type: "radio", name: "feedback-kind", id: `feedback-kind-${value}`, value, checked: value === form.kind,
          onchange: () => { form.setKind(value); refresh(); } }),
        el("span", { textContent: kindLabel(value) })))) : null;
    const body = el("div", { class: "feedback-body" },
      el("p", { class: "feedback-about", textContent: aboutText(target) }),
      kinds,
      text,
      el("div", { class: "feedback-meta" }, counter),
      message,
      el("div", { class: "feedback-buttons" }, cancel, send));
    const box = el("div", { class: "feedback-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "feedback-title" },
      title, body);
    const backdrop = el("div", { class: "feedback-backdrop" }, box);
    function refresh() {
      title.textContent = titleFor(form.kind);
      text.placeholder = placeholderFor(form.kind);
      text.setAttribute("aria-label", titleFor(form.kind));
      counter.textContent = form.counter();
      send.disabled = !form.canSend();
      send.textContent = form.sending ? t("ui.feedback.sending", {}, "Sending…") : t("ui.feedback.send", {}, "Send");
      message.textContent = form.error;
    }
    text.addEventListener("input", () => { form.input(text.value); refresh(); });
    send.addEventListener("click", async () => {
      refresh();
      const ok = await form.submit();
      if (!ok) { refresh(); return; }
      const done = el("button", { type: "button", id: "feedback-done", class: "primary", textContent: t("ui.feedback.close", {}, "Close"), onclick: close });
      body.replaceChildren(
        el("p", { id: "feedback-thanks", class: "feedback-thanks", role: "status", textContent: t("ui.feedback.thanks", {}, "Thanks for the feedback!") }),
        el("div", { class: "feedback-buttons" }, done));
      done.focus();
    });
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    current = { backdrop, onKey, returnFocus: document.activeElement };
    document.body.append(backdrop);
    refresh();
    text.focus();
    return form;
  }

  return { MIN, MAX, KINDS, createForm, titleFor, aboutText, open, close };
})();
