// Feedback page: users' bugs, suggestions and reports of problems, about users, games,
// matches and the platform, from /admin/feedback. Admins mark each one reviewed or
// dismissed, or reopen it; unpublishing and banning come later.

"use strict";

const $ = (id) => document.getElementById(id);
// Clicking a "Most reported" target shows only its feedback.
let targetFilter = null;

/** Where an admin can look at a target. */
function targetLink(type, id, name) {
  if (type === "platform") return el("span", { textContent: name || "Platform" });
  const href = type === "game" ? `/portal#game=${encodeURIComponent(id)}`
    : type === "match" ? `/portal#match=${encodeURIComponent(id)}`
    : "/browse"; // the browse page's filter box finds the user by this id
  return el("span", {},
    el("a", { href, target: "_blank", rel: "noopener", textContent: name || id }),
    el("span", { class: "id", textContent: id }));
}

function tag(text, cls = "type") {
  return el("span", { class: cls, textContent: text });
}

function table(headers, rows) {
  return el("table", {},
    el("thead", {}, el("tr", {}, headers.map(([label, cls]) => el("th", { class: cls || "", textContent: label })))),
    el("tbody", {}, rows));
}

/** Matches are saved without their game's name (it would cost sending feedback another
 * read), so this names them from their games, fetched together in one call. */
async function matchNames(rows) {
  const refs = [...new Set(rows.filter((r) => r.target_type === "match" && r.context?.game_id)
    .map((r) => `${r.context.game_id}@${r.context.game_version}`))];
  if (!refs.length) return new Map();
  try {
    const response = await fetch(`/games/versions?refs=${encodeURIComponent(refs.join(","))}`);
    if (!response.ok) return new Map();
    return new Map((await response.json()).map((game) => [`${game.id}@${game.version}`, game.name]));
  } catch {
    return new Map();
  }
}

const STATUS_LABELS = {
  open: () => I18n.t("ui.admin.open", {}, "Open"),
  reviewed: () => I18n.t("ui.admin.reviewed", {}, "Reviewed"),
  dismissed: () => I18n.t("ui.admin.dismissed", {}, "Dismissed"),
};

/** Marks one feedback [status] ("reviewed", "dismissed" or "open"), then reloads the
 * list (with the default "Open" filter, a reviewed one leaves the list). */
async function setStatus(row, status, buttons) {
  for (const button of buttons) button.disabled = true;
  try {
    const response = await fetch(`/admin/feedback/${encodeURIComponent(row.id)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error(String(response.status));
    await refresh();
  } catch (error) {
    for (const button of buttons) button.disabled = false;
    $("error").textContent = I18n.t("ui.admin.status_change_failed", { message: error.message }, "Couldn't change the status: {message}");
  }
}

/** The Status cell: the status, who changed it and when, and the buttons to change it. */
function statusCell(row) {
  const label = STATUS_LABELS[row.status]?.() ?? row.status;
  const choices = row.status === "open"
    ? [["reviewed", I18n.t("ui.admin.mark_reviewed", {}, "Mark reviewed")], ["dismissed", I18n.t("ui.admin.dismiss", {}, "Dismiss")]]
    : [["open", I18n.t("ui.admin.reopen", {}, "Reopen")]];
  const buttons = choices.map(([status, text]) => el("button", { type: "button", textContent: text }));
  buttons.forEach((button, i) => button.addEventListener("click", () => setStatus(row, choices[i][0], buttons)));
  return el("td", { class: "status" },
    el("span", { textContent: label }),
    row.status_changed_by
      ? el("span", { class: "status-by", textContent: I18n.t("ui.admin.status_changed_by",
          { name: row.status_changed_by, time: formatTime(row.status_changed_at) }, "by {name}, {time}") })
      : "",
    el("span", { class: "status-actions" }, buttons));
}

function render(data, games) {
  const nameOf = (r) => r.target_type === "match" && !r.target_name
    ? `${games.get(`${r.context?.game_id}@${r.context?.game_version}`) ?? "A game"} match`
    : r.target_name;
  $("count").textContent = `(${data.count}${data.more ? "+, newest first" : ""})`;
  $("most").replaceChildren(data.most_reported.length
    ? table([["Reports", "num"], ["About"], ["Target"], ["Last reported"]], data.most_reported.map((m) =>
        el("tr", {},
          el("td", { class: "num" }, el("button", { type: "button", class: "linklike", textContent: m.reports,
            title: "Show only this target's feedback",
            onclick: () => { targetFilter = { type: m.target_type, id: m.target_id, name: m.target_name }; refresh(); } })),
          el("td", {}, tag(m.target_type)),
          el("td", {}, targetLink(m.target_type, m.target_id, m.target_name || (m.target_type === "match" ? "A match" : ""))),
          el("td", { class: "when", textContent: formatTime(m.last_reported_at) }))))
    : el("p", { class: "muted", textContent: "No problems reported yet." }));
  $("feedback").replaceChildren(data.feedback.length
    ? table([["When"], ["Kind"], ["About"], ["Target"], ["From"], ["Feedback"], ["Status"]], data.feedback.map((r) =>
        el("tr", {},
          el("td", { class: "when", textContent: formatTime(r.updated_at) }),
          el("td", {}, tag(r.kind, `kind kind-${r.kind}`)),
          el("td", {}, tag(r.target_type)),
          el("td", {}, targetLink(r.target_type, r.target_id, nameOf(r))),
          el("td", {}, el("span", { textContent: r.reporter_name }), el("span", { class: "id", textContent: r.reporter_user_id })),
          el("td", { class: "text", textContent: r.text }),
          statusCell(r))))
    : el("p", { class: "muted", textContent: "No feedback matches these filters." }));
  $("target-filter").replaceChildren(targetFilter
    ? el("span", {}, `Only: ${targetFilter.name || targetFilter.id} `,
        el("button", { type: "button", textContent: "Show all", onclick: () => { targetFilter = null; refresh(); } }))
    : "");
}

async function refresh() {
  const params = new URLSearchParams();
  if ($("filter-kind").value) params.set("kind", $("filter-kind").value);
  if (targetFilter) {
    params.set("target_type", targetFilter.type);
    params.set("target_id", targetFilter.id);
  } else if ($("filter-type").value) params.set("target_type", $("filter-type").value);
  if ($("filter-status").value) params.set("status", $("filter-status").value);
  try {
    const response = await fetch(`/admin/feedback?${params}`);
    if (!response.ok) throw new Error(`GET /admin/feedback: ${response.status}`);
    const data = await response.json();
    render(data, await matchNames(data.feedback));
    $("error").textContent = "";
    $("freshness").textContent = I18n.t("ui.admin.loaded", { time: formatTime(new Date().toISOString()) }, "Loaded {time}");
  } catch (error) {
    $("error").textContent = I18n.t("ui.admin.feedback_load_failed", { message: error.message }, "Couldn't load the feedback: {message}");
  }
}

$("refresh").addEventListener("click", refresh);
for (const id of ["filter-kind", "filter-type", "filter-status"])
  $(id).addEventListener("change", () => { if (id === "filter-type") targetFilter = null; refresh(); });
refresh();
