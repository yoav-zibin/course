"use strict";

const $ = id => document.getElementById(id);
let cursor = null;
let generation = 0;

async function request(path, body) {
  const response = await fetch(path, {cache: "no-store", ...(body ? {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
  } : {})});
  if (!response.ok) throw new Error(response.status === 409
    ? "This report changed. Refresh before updating it."
    : `Request failed (${response.status}).`);
  return response.json();
}

function reportCard(row) {
  const details = el("details", {}, el("summary", {textContent: "Screenshot, diagnostics and resolution"}));
  const card = el("article", {},
    el("p", {class: "muted", textContent: `${row.id} · ${row.status} · ${formatTime(row.created_at)}`}),
    el("p", {class: "report-text", textContent: row.text}),
    el("p", {class: "muted", textContent: `From ${row.user?.display_name || row.user?.name || "visitor"}${row.reporter_user_id ? ` (${row.reporter_user_id})` : ""}`}),
    details);
  let loaded = false;
  details.addEventListener("toggle", async () => {
    if (!details.open || loaded) return;
    loaded = true;
    const content = el("div", {textContent: "Loading…"});
    details.append(content);
    try {
      const report = await request(`/admin/bug-reports/${encodeURIComponent(row.id)}`);
      content.replaceChildren();
      if (typeof report.screenshot === "string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(report.screenshot)) {
        content.append(el("img", {class: "report-image", src: report.screenshot, alt: "Screen captured before opening the bug reporter"}));
      } else content.append(el("p", {class: "muted", textContent: "Screenshot unavailable; see capture diagnostics."}));
      content.append(el("p", {class: "muted", textContent: `Last updated ${formatTime(report.updated_at)}${report.changed_by ? ` by ${report.changed_by}` : ""}`}),
        el("details", {}, el("summary", {textContent: "User and app diagnostics"}),
          el("pre", {textContent: JSON.stringify({user: report.user, diagnostics: report.diagnostics}, null, 2)})));
      const notes = el("textarea", {maxLength: 20000, value: report.resolution || "", "aria-label": "Resolution or escalation reason"});
      const commit = el("input", {class: "commit", value: report.commit || "", maxLength: 128, "aria-label": "Fix commit", placeholder: "Fix commit (when code changed)"});
      const error = el("p", {role: "alert", style: "color:var(--color-error)"});
      const actions = el("div", {class: "actions"});
      const choices = [["handling", "Start handling"], ["escalated", "Escalate to owner"], ["handled", "Mark handled"], ["open", "Reopen"]];
      for (const [status, label] of choices) {
        if (status === report.status) continue;
        const button = el("button", {type: "button", textContent: label});
        button.addEventListener("click", async () => {
          if (["escalated", "handled"].includes(status) && !notes.value.trim()) {
            error.textContent = "Enter the resolution or the reason this needs the owner's decision.";
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
            error.textContent = failure.message;
            for (const item of actions.children) item.disabled = false;
          }
        });
        actions.append(button);
      }
      content.append(el("label", {textContent: "Resolution or escalation reason"}, notes), commit, actions, error);
    } catch (error) {
      content.textContent = error.message;
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
    if (!$("reports").children.length) $("reports").append(el("p", {textContent: "No reports with this status."}));
    cursor = data.next_cursor;
    $("more").hidden = !cursor;
    $("freshness").textContent = `Loaded ${formatTime(new Date().toISOString())}`;
    $("error").textContent = "";
  } catch (error) {
    if (current === generation) $("error").textContent = error.message;
  } finally {
    if (current === generation) $("more").disabled = false;
  }
}

$("refresh").addEventListener("click", () => refresh());
$("status").addEventListener("change", () => refresh());
$("more").addEventListener("click", () => refresh(true));
refresh();
