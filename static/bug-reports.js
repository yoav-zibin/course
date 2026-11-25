"use strict";

const $ = id => document.getElementById(id);
let generation = 0;
let reports = [];
let students = [];
let studentsByAccount = new Map();
let rosterReady = false;
let reportsReady = false;
let visibleCount = 50;
let linkedReportOpened = false;
const initialParams = new URLSearchParams(location.search);
const filterIds = ["search", "student", "status", "source", "score", "changes", "from", "through", "sort"];

function assessed(report) {
  return Number.isInteger(report.score) && report.score >= 0 && report.score <= 10;
}

function attributedStudents(report) {
  return studentsByAccount.get(report.reporter_user_id || report.user?.id) || [];
}

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
  updateSummary();
}
function statusLabel(status) {
  return ({
    open: () => I18n.t("ui.admin.open", {}, "Open"),
    handling: () => I18n.t("ui.bug_reports.status_handling", {}, "Handling"),
    escalated: () => I18n.t("ui.bug_reports.status_escalated", {}, "Needs your decision"),
    handled: () => I18n.t("ui.bug_reports.status_handled", {}, "Handled"),
  })[status]?.() || status;
}
function workflowLabel(report) {
  return ({
    approved: () => I18n.t("ui.bug_reports.workflow_approved", {}, "Approved"),
    declined: () => I18n.t("ui.bug_reports.workflow_declined", {}, "Declined"),
    released: () => I18n.t("ui.bug_reports.workflow_released", {}, "Released to main"),
    rolled_out: () => I18n.t("ui.bug_reports.workflow_rolled_out", {}, "Live and verified"),
  })[report.workflow_stage]?.() || statusLabel(report.status);
}
function scoreLabel(report) {
  return assessed(report)
    ? I18n.t("ui.bug_reports.score", {score: report.score}, "Score: {score}/10")
    : I18n.t("ui.bug_reports.unassessed", {}, "Score: Not assessed");
}

function sourceLabel(report) {
  return report.automatic === true
    ? I18n.t("ui.reports.source_automatic", {}, "Automatic")
    : I18n.t("ui.reports.source_manual", {}, "Manual");
}

function assessmentDetails(report) {
  return el("section", {class: "report-assessment"},
    translated("h3", {}, () => I18n.t("ui.bug_reports.assessment", {}, "Assessment")),
    translated("p", {}, () => scoreLabel(report)),
    translated("h4", {}, () => I18n.t("ui.bug_reports.score_rationale", {}, "Score rationale")),
    report.score_rationale
      ? el("p", {class: "report-text", textContent: report.score_rationale})
      : translated("p", {class: "muted"}, () => I18n.t("ui.bug_reports.no_rationale", {}, "No assessment recorded yet.")),
    translated("h4", {}, () => I18n.t("ui.bug_reports.changes_summary", {}, "Code or game logic changes")),
    report.changes_summary
      ? el("p", {class: "report-text", textContent: report.changes_summary})
      : translated("p", {class: "muted"}, () => I18n.t("ui.bug_reports.no_changes", {}, "No changes recorded.")));
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

function studentAttribution(row) {
  const studentLine = el("p", {class: "report-student"});
  const attributed = attributedStudents(row);
  if (attributed.length) {
    studentLine.append(translated("span", {}, () => I18n.t("ui.reports.student_label", {}, "Student: ")));
    attributed.forEach((student, index) => {
      if (index) studentLine.append(" · ");
      studentLine.append(el("a", {href: `/admin/students?student=${encodeURIComponent(student.id)}`, textContent: student.name}));
    });
  } else {
    localize(studentLine, "textContent", () => !row.reporter_user_id && !row.user?.id
      ? I18n.t("ui.reports.anonymous", {}, "Student: Anonymous reporter")
      : !rosterReady
        ? I18n.t("ui.reports.attribution_unavailable", {}, "Student attribution is loading or unavailable")
        : I18n.t("ui.reports.not_course", {}, "Student: No linked course account"));
  }
  return studentLine;
}

function reportCard(row) {
  let current = row;
  const score = translated("p", {class: "muted report-score"}, () => scoreLabel(current));
  const details = el("details", {}, translated("summary", {}, () => I18n.t("ui.bug_reports.evidence", {}, "Screenshot, diagnostics and resolution")));
  const card = el("article", {id: `report-${row.id}`},
    el("div", {class: "report-heading"},
      el("h2", {}, el("a", {href: reportLink(row), textContent: row.id})),
      translated("span", {class: "report-source"}, () => sourceLabel(row)),
      translated("p", {class: "muted"}, () => `${workflowLabel(row)} · ${formatTime(row.created_at)}`)),
    el("p", {class: "report-text", textContent: row.text}),
    score, studentAttribution(row),
    translated("p", {class: "muted"}, () => I18n.t("ui.bug_reports.from", {
      name: row.user?.display_name || row.user?.name || I18n.t("ui.bug_reports.visitor", {}, "visitor"),
      identity: row.reporter_user_id ? ` (${row.reporter_user_id})` : "",
    }, "From {name}{identity}")),
    el("section", {class: "changes-summary"},
      translated("h3", {}, () => I18n.t("ui.bug_reports.changes_summary", {}, "Code or game logic changes")),
      row.changes_summary
        ? el("p", {class: "report-text", textContent: row.changes_summary})
        : translated("p", {class: "muted"}, () => I18n.t("ui.bug_reports.no_changes", {}, "No changes recorded."))),
    row.resolution ? el("p", {class: "report-text", textContent: row.resolution}) : null,
    details);
  let loaded = false;
  details.addEventListener("toggle", async () => {
    if (!details.open || loaded) return;
    loaded = true;
    const content = translated("div", {}, () => I18n.t("ui.state.loading", {}, "Loading…"));
    details.append(content);
    try {
      const report = await request(`/admin/bug-reports/${encodeURIComponent(row.id)}`);
      current = report;
      score._bugCopy.textContent();
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
      content.append(assessmentDetails(report));
      if (report.authorization?.decided_at) {
        content.append(translated("p", {class: "muted"}, () => report.authorization.decision === "approved"
          ? I18n.t("ui.bug_reports.approved_at", {time: formatTime(report.authorization.decided_at)}, "Approved {time}")
          : I18n.t("ui.bug_reports.declined_at", {time: formatTime(report.authorization.decided_at)}, "Declined {time}")));
      }
      if (report.release_commit && report.released_at) {
        content.append(translated("p", {class: "muted"}, () => I18n.t("ui.bug_reports.released_at",
          {time: formatTime(report.released_at), commit: report.release_commit}, "Released to main {time} ({commit})")));
      }
      if (report.rolled_out_at) {
        content.append(translated("p", {class: "muted"}, () => I18n.t("ui.bug_reports.rolled_out_at",
          {time: formatTime(report.rolled_out_at)}, "Production rollout verified {time}")));
      }
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
              status, resolution: notes.value.trim(), commit: status === "handling" ? null : commit.value.trim(),
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

function reportLink(report) {
  const params = new URLSearchParams({report: report.id, status: "all"});
  if ($("student").value !== "all") params.set("student", $("student").value);
  return `/bug-reports?${params}`;
}

function filteredReports() {
  const query = $("search").value.trim().toLocaleLowerCase();
  const studentFilter = $("student").value;
  if (studentFilter !== "all" && !rosterReady) return [];
  const status = $("status").value;
  const source = $("source").value;
  const score = $("score").value;
  const changes = $("changes").value;
  const from = $("from").value;
  const through = $("through").value;
  const filtered = reports.filter(report => {
    const attribution = attributedStudents(report);
    if (studentFilter === "course" && !attribution.length) return false;
    if (studentFilter === "other" && attribution.length) return false;
    if (!["all", "course", "other"].includes(studentFilter) && !attribution.some(student => student.id === studentFilter)) return false;
    if (status !== "all" && report.status !== status) return false;
    if (source === "automatic" && report.automatic !== true || source === "manual" && report.automatic === true) return false;
    const hasScore = assessed(report);
    if (score === "assessed" && !hasScore || score === "unassessed" && hasScore) return false;
    if (score === "high" && (!hasScore || report.score < 8)) return false;
    if (score === "middle" && (!hasScore || report.score < 4 || report.score > 7)) return false;
    if (score === "low" && (!hasScore || report.score > 3)) return false;
    const hasChanges = Boolean(report.changes_summary?.trim());
    if (changes === "yes" && !hasChanges || changes === "no" && hasChanges) return false;
    // Stored timestamps are UTC ISO strings; compare calendar days in UTC.
    const day = report.created_at?.slice(0, 10) || "";
    if (from && day < from || through && day > through) return false;
    if (query) {
      const haystack = [report.id, report.text, report.reporter_user_id, report.user?.display_name, report.user?.name,
        report.user?.email, report.score_rationale, report.resolution, report.changes_summary, report.commit,
        sourceLabel(report), ...attribution.flatMap(student => [student.name, ...(student.emails || []), student.columbia_email, student.personal_email,
          ...(student.accounts || []).flatMap(account => [account.id, account.display_name, ...(account.emails || [])])])];
      if (!haystack.filter(Boolean).join(" ").toLocaleLowerCase().includes(query)) return false;
    }
    return true;
  });
  const sort = $("sort").value;
  return filtered.sort((a, b) => {
    if (["highest", "lowest"].includes(sort)) {
      if (assessed(a) !== assessed(b)) return assessed(a) ? -1 : 1;
      if (assessed(a) && a.score !== b.score) return sort === "highest" ? b.score - a.score : a.score - b.score;
    }
    const order = String(b.created_at || "").localeCompare(String(a.created_at || "")) || a.id.localeCompare(b.id);
    return sort === "oldest" ? -order : order;
  });
}

function updateSummary() {
  if (!reportsReady) return;
  const filtered = filteredReports();
  const scored = filtered.filter(assessed);
  const average = scored.length ? (scored.reduce((sum, row) => sum + row.score, 0) / scored.length).toFixed(2) : null;
  $("summary").textContent = I18n.t("ui.reports.result_count", {count: filtered.length, total: reports.length, shown: Math.min(visibleCount, filtered.length)}, "{count} of {total} reports match · {shown} shown") + " · " +
    I18n.t("ui.reports.source_counts", {manual: filtered.filter(row => row.automatic !== true).length, automatic: filtered.filter(row => row.automatic === true).length}, "{manual} manual · {automatic} automatic") + " · " +
    (average === null
      ? I18n.t("ui.reports.no_assessed", {}, "No assessed reports in these results")
      : I18n.t("ui.reports.average", {score: average, count: scored.length}, "Average score {score}/10 across {count} assessed reports"));
}

function renderReports() {
  if (!reportsReady) return;
  const filtered = filteredReports();
  const linkedId = initialParams.get("report");
  if (linkedId && !linkedReportOpened) {
    const index = filtered.findIndex(report => report.id === linkedId);
    if (index >= 0) visibleCount = Math.max(visibleCount, index + 1);
  }
  $("reports").replaceChildren(...filtered.slice(0, visibleCount).map(reportCard));
  if (!filtered.length) $("reports").append(translated("p", {}, () =>
    $("student").value !== "all" && !rosterReady
      ? I18n.t("ui.reports.attribution_pending", {}, "Student filtering requires the course account list. Refresh to retry if attribution is unavailable.")
      : I18n.t("ui.reports.no_results", {}, "No reports match these filters.")));
  $("more").hidden = visibleCount >= filtered.length;
  $("more").disabled = false;
  updateSummary();
  if (linkedId && !linkedReportOpened) {
    const card = document.getElementById(`report-${linkedId}`);
    if (card) {
      linkedReportOpened = true;
      card.querySelector("details").open = true;
      card.scrollIntoView({block: "center"});
    }
  }
}

function syncUrl() {
  const params = new URLSearchParams(location.search);
  for (const id of filterIds) {
    const value = $(id).value;
    if (!value || value === "all" || id === "sort" && value === "newest") params.delete(id);
    else params.set(id, value);
  }
  params.delete("report");
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
}

async function loadStudents(current) {
  try {
    const data = await request("/admin/students/data");
    if (current !== generation) return;
    students = data.students || [];
    studentsByAccount = new Map();
    for (const student of students) {
      for (const account of student.accounts || []) {
        for (const id of new Set([account.id, account.canonical_user_id].filter(Boolean))) {
          if (!studentsByAccount.has(id)) studentsByAccount.set(id, []);
          const attributed = studentsByAccount.get(id);
          if (!attributed.some(person => person.id === student.id)) attributed.push(student);
        }
      }
    }
    const selected = $("student").value;
    $("student").querySelectorAll("option[data-course-student]").forEach(option => option.remove());
    for (const student of students) $("student").append(el("option", {value: student.id, textContent: student.name, "data-course-student": ""}));
    if (selected !== "all" && ![...$("student").options].some(option => option.value === selected)) {
      $("student").append(translated("option", {value: selected, "data-course-student": ""}, () => I18n.t("ui.reports.unknown_student", {}, "Unknown course member")));
    }
    $("student").value = selected;
    rosterReady = true;
    $("student-warning").hidden = true;
  } catch (error) {
    if (current !== generation) return;
    $("student-warning").hidden = false;
    localize($("student-warning"), "textContent", () => I18n.t("ui.reports.attribution_failed", {}, "Course account attribution could not be loaded. All reports remain available; refresh to retry student attribution."));
  }
  if (current === generation && reportsReady) {
    if ($("student").value !== "all" || $("search").value) renderReports();
    else {
      // Attribution often arrives after report headers. Update labels in place
      // so an already-open evidence panel keeps its unsaved resolution draft.
      for (const report of reports) {
        document.getElementById(`report-${report.id}`)?.querySelector(".report-student")?.replaceWith(studentAttribution(report));
      }
    }
  }
}

async function refresh() {
  const current = ++generation;
  reportsReady = false;
  rosterReady = false;
  reports = [];
  studentsByAccount = new Map();
  visibleCount = 50;
  $("reports").replaceChildren();
  $("more").disabled = true;
  $("more").hidden = true;
  $("refresh").disabled = true;
  $("summary").textContent = I18n.t("ui.reports.loading_all", {}, "Loading all reports…");
  const studentsLoaded = loadStudents(current);
  try {
    let cursor = null;
    const seenCursors = new Set();
    const all = new Map();
    do {
      const params = new URLSearchParams({status: "all", limit: "100"});
      if (cursor) params.set("cursor", cursor);
      const data = await request(`/admin/bug-reports?${params}`);
      if (current !== generation) return;
      for (const report of data.items) all.set(report.id, report);
      cursor = data.next_cursor;
      if (cursor && seenCursors.has(cursor)) throw new Error(I18n.t("ui.reports.pagination_failed", {}, "Report pagination repeated a cursor. Refresh to load the complete report list."));
      if (cursor) seenCursors.add(cursor);
      $("summary").textContent = I18n.t("ui.reports.loading_count", {count: all.size}, "Loading all reports… {count} loaded");
    } while (cursor);
    reports = [...all.values()];
    reportsReady = true;
    renderReports();
    const loadedAt = new Date().toISOString();
    localize($("freshness"), "textContent", () => I18n.t("ui.admin.loaded", {time: formatTime(loadedAt)}, "Loaded {time}"));
    $("error").removeAttribute("data-bug-localized");
    $("error").textContent = "";
  } catch (error) {
    if (current === generation) {
      $("summary").textContent = I18n.t("ui.reports.load_failed", {}, "The full report list could not be loaded. Refresh to retry.");
      localize($("error"), "textContent", error.translate || (() => error.message));
    }
  } finally {
    if (current === generation) $("refresh").disabled = false;
  }
  await studentsLoaded;
}

$("refresh").addEventListener("click", () => refresh());
for (const id of filterIds) {
  const node = $(id);
  const value = initialParams.get(id);
  if (value && (node.tagName !== "SELECT" || [...node.options].some(option => option.value === value))) node.value = value;
  if (id === "student" && value && ![...node.options].some(option => option.value === value)) {
    node.append(translated("option", {value, "data-course-student": ""}, () => I18n.t("ui.reports.loading_student", {}, "Loading course member…")));
    node.value = value;
  }
  node.addEventListener(id === "search" ? "input" : "change", () => {
    visibleCount = 50;
    linkedReportOpened = true;
    syncUrl();
    renderReports();
  });
}
$("clear-filters").addEventListener("click", () => {
  for (const id of filterIds) $(id).value = id === "search" || ["from", "through"].includes(id) ? "" : id === "sort" ? "newest" : "all";
  visibleCount = 50;
  linkedReportOpened = true;
  syncUrl();
  renderReports();
});
$("more").addEventListener("click", () => { visibleCount += 50; renderReports(); });
document.addEventListener("i18n-changed", redrawCopy);
I18n.ready.then(redrawCopy);
refresh();
