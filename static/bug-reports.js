"use strict";

const $ = id => document.getElementById(id);
let cursor = null;
let generation = 0;

// Refresh generated labels in place when the language changes. Keeping the
// existing nodes preserves open evidence panels and unsaved resolution drafts.
function localize(node, property, translate) {
  node.setAttribute("data-bug-localized", "");
  node._bugCopy ??= {};
  node._bugCopy[property] = () => {
    if (property.startsWith("aria-")) node.setAttribute(property, translate());
    else node[property] = translate();
  };
  node._bugCopy[property]();
  return node;
}
function translated(tag, attrs, translate) {
  return localize(el(tag, attrs), "textContent", translate);
}
function redrawCopy() {
  for (const node of document.querySelectorAll("[data-bug-localized]"))
    for (const update of Object.values(node._bugCopy || {})) update();
}
function statusLabel(status) {
  return ({
    open: () => I18n.t("ui.admin.open", {}, "Open"),
    handling: () => I18n.t("ui.bug_reports.status_handling", {}, "Handling"),
    escalated: () => I18n.t("ui.bug_reports.status_escalated", {}, "Needs your decision"),
    handled: () => I18n.t("ui.bug_reports.status_handled", {}, "Handled"),
  })[status]?.() || status;
}

async function request(path, body) {
  const response = await fetch(path, {cache: "no-store", ...(body ? {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
  } : {})});
  if (!response.ok) {
    const translate = () => response.status === 409
      ? I18n.t("ui.bug_reports.changed", {}, "This report changed. Refresh before updating it.")
      : I18n.t("ui.bug_reports.request_failed", {status: response.status}, "Request failed ({status}).");
    const error = new Error(translate());
    error.translate = translate;
    throw error;
  }
  return response.json();
}

function reportCard(row) {
  const details = el("details", {}, translated("summary", {}, () => I18n.t("ui.bug_reports.evidence", {}, "Screenshot, diagnostics and resolution")));
  const card = el("article", {},
    translated("p", {class: "muted"}, () => `${row.id} · ${statusLabel(row.status)} · ${formatTime(row.created_at)}`),
    el("p", {class: "report-text", textContent: row.text}),
    translated("p", {class: "muted"}, () => I18n.t("ui.bug_reports.from", {
      name: row.user?.display_name || row.user?.name || I18n.t("ui.bug_reports.visitor", {}, "visitor"),
      identity: row.reporter_user_id ? ` (${row.reporter_user_id})` : "",
    }, "From {name}{identity}")), details);
  let loaded = false;
  details.addEventListener("toggle", async () => {
    if (!details.open || loaded) return;
    loaded = true;
    const content = translated("div", {}, () => I18n.t("ui.state.loading", {}, "Loading…"));
    details.append(content);
    try {
      const report = await request(`/admin/bug-reports/${encodeURIComponent(row.id)}`);
      content.replaceChildren();
      // The loading message no longer owns this container's contents.
      content.removeAttribute("data-bug-localized");
      if (typeof report.screenshot === "string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(report.screenshot)) {
        content.append(localize(el("img", {class: "report-image", src: report.screenshot}), "alt", () => I18n.t("ui.bug_reports.screenshot_alt", {}, "Screen captured before opening the bug reporter")));
      } else content.append(translated("p", {class: "muted"}, () => I18n.t("ui.bug_reports.screenshot_unavailable", {}, "Screenshot unavailable; see capture diagnostics.")));
      content.append(translated("p", {class: "muted"}, () => report.changed_by
        ? I18n.t("ui.bug_reports.updated_by", {time: formatTime(report.updated_at), name: report.changed_by}, "Last updated {time} by {name}")
        : I18n.t("ui.bug_reports.updated", {time: formatTime(report.updated_at)}, "Last updated {time}")),
        el("details", {}, translated("summary", {}, () => I18n.t("ui.bug_reports.diagnostics", {}, "User and app diagnostics")),
          el("pre", {textContent: JSON.stringify({user: report.user, diagnostics: report.diagnostics}, null, 2)})));
      const resolutionLabel = () => I18n.t("ui.bug_reports.resolution", {}, "Resolution or escalation reason");
      const notes = localize(el("textarea", {maxLength: 20000, value: report.resolution || ""}), "aria-label", resolutionLabel);
      const commit = localize(el("input", {class: "commit", value: report.commit || "", maxLength: 128}), "aria-label", () => I18n.t("ui.bug_reports.commit", {}, "Fix commit"));
      localize(commit, "placeholder", () => I18n.t("ui.bug_reports.commit_placeholder", {}, "Fix commit (when code changed)"));
      const error = el("p", {role: "alert", style: "color:var(--color-error)"});
      const actions = el("div", {class: "actions"});
      const choices = [
        ["handling", () => I18n.t("ui.bug_reports.start", {}, "Start handling")],
        ["escalated", () => I18n.t("ui.bug_reports.escalate", {}, "Escalate to owner")],
        ["handled", () => I18n.t("ui.bug_reports.handle", {}, "Mark handled")],
        ["open", () => I18n.t("ui.admin.reopen", {}, "Reopen")],
      ];
      for (const [status, label] of choices) {
        if (status === report.status) continue;
        const button = translated("button", {type: "button"}, label);
        button.addEventListener("click", async () => {
          if (["escalated", "handled"].includes(status) && !notes.value.trim()) {
            localize(error, "textContent", () => I18n.t("ui.bug_reports.reason_required", {}, "Enter the resolution or the reason this needs the owner's decision."));
            notes.focus();
            return;
          }
          for (const item of actions.children) item.disabled = true;
          try {
            await request(`/admin/bug-reports/${encodeURIComponent(row.id)}/status`, {
              status, resolution: notes.value.trim(), commit: commit.value.trim(),
              expected_status: report.status, expected_updated_at: report.updated_at,
            });
            await refresh();
          } catch (failure) {
            localize(error, "textContent", failure.translate || (() => failure.message));
            for (const item of actions.children) item.disabled = false;
          }
        });
        actions.append(button);
      }
      content.append(el("label", {}, translated("span", {}, resolutionLabel), notes), commit, actions, error);
    } catch (error) {
      localize(content, "textContent", error.translate || (() => error.message));
      loaded = false;
    }
  });
  return card;
}

async function refresh(append = false) {
  const current = ++generation;
  const params = new URLSearchParams({status: $("status").value, limit: "50"});
  if (append && cursor) params.set("cursor", cursor);
  $("more").disabled = true;
  try {
    const data = await request(`/admin/bug-reports?${params}`);
    if (current !== generation) return;
    if (!append) $("reports").replaceChildren();
    $("reports").append(...data.items.map(reportCard));
    if (!$("reports").children.length) $("reports").append(translated("p", {}, () => I18n.t("ui.bug_reports.empty", {}, "No reports with this status.")));
    cursor = data.next_cursor;
    $("more").hidden = !cursor;
    const loadedAt = new Date().toISOString();
    localize($("freshness"), "textContent", () => I18n.t("ui.admin.loaded", {time: formatTime(loadedAt)}, "Loaded {time}"));
    $("error").removeAttribute("data-bug-localized");
    $("error").textContent = "";
  } catch (error) {
    if (current === generation) localize($("error"), "textContent", error.translate || (() => error.message));
  } finally {
    if (current === generation) $("more").disabled = false;
  }
}

$("refresh").addEventListener("click", () => refresh());
$("status").addEventListener("change", () => refresh());
$("more").addEventListener("click", () => refresh(true));
document.addEventListener("i18n-changed", redrawCopy);
I18n.ready.then(redrawCopy);
refresh();
