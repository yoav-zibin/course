// Roster identities and activity are returned only by the authenticated endpoint.
// Render all account names and report text with textContent, never HTML.
"use strict";

const $ = (id) => document.getElementById(id);
const state = {data: null, loading: false, error: false, tableScroll: {left: 0, top: 0}};
const requestedStudent = new URLSearchParams(location.search).get("student");
let selectedStudentShown = false;
const count = (value) => I18n.number(Number(value) || 0);
const isScore = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10;
const recruitedLabel = label => `${I18n.t("ui.students.recruits_matches", {}, "Recruited matches")} · ${label}`;

const columns = [
  {key: "name", kind: "name", label: () => I18n.t("ui.students.person", {}, "Person"), value: row => row.name},
  {key: "institutional_email", kind: "email", label: () => I18n.t("ui.students.institutional_email", {}, "Columbia / Barnard email"), value: row => row.institutional_email},
  {key: "personal_email", kind: "email", label: () => I18n.t("ui.students.personal_email", {}, "Personal email"), value: row => row.personal_email},
  {key: "accounts", kind: "accounts", label: () => I18n.t("ui.students.accounts", {}, "Matched account IDs"), value: row => row.accounts.length},
  {key: "total_matches", label: () => I18n.t("ui.students.total_matches", {}, "Total matches"), value: row => row.matches.total},
  {key: "computer", label: () => I18n.t("ui.students.computer", {}, "Computer"), value: row => row.matches.computer},
  {key: "pass_and_play", label: () => I18n.t("ui.students.pass_and_play", {}, "Pass & play"), value: row => row.matches.pass_and_play},
  {key: "multiplayer", label: () => I18n.t("ui.students.multiplayer", {}, "Multiplayer"), value: row => row.matches.multiplayer},
  {key: "waiting", label: () => I18n.t("ui.students.waiting", {}, "Waiting lobbies"), value: row => row.matches.waiting},
  {key: "other_players", label: () => I18n.t("ui.students.other_players", {}, "Other players"), value: row => row.other_players},
  {key: "direct_recruits", label: () => I18n.t("ui.students.direct_recruits", {}, "Direct invites"), value: row => row.direct_recruits},
  {key: "transitive_recruits", label: () => I18n.t("ui.students.transitive_recruits", {}, "All invited players"), value: row => row.transitive_recruits},
  {key: "recruits_matches", label: () => I18n.t("ui.students.recruits_matches", {}, "Recruited matches"), value: row => row.recruits_matches.total},
  {key: "recruits_computer", label: () => recruitedLabel(I18n.t("ui.students.computer", {}, "Computer")), value: row => row.recruits_matches.computer},
  {key: "recruits_pass_and_play", label: () => recruitedLabel(I18n.t("ui.students.pass_and_play", {}, "Pass & play")), value: row => row.recruits_matches.pass_and_play},
  {key: "recruits_multiplayer", label: () => recruitedLabel(I18n.t("ui.students.multiplayer", {}, "Multiplayer")), value: row => row.recruits_matches.multiplayer},
  {key: "recruits_waiting", label: () => recruitedLabel(I18n.t("ui.students.waiting", {}, "Waiting lobbies")), value: row => row.recruits_matches.waiting},
  {key: "reports", label: () => I18n.t("ui.students.reports", {}, "Bug reports"), value: row => row.reports.total},
  {key: "manual_reports", label: () => I18n.t("ui.students.manual_reports", {}, "Manual reports"), value: row => row.reports.manual ?? Math.max(0, row.reports.total - (row.reports.automatic || 0))},
  {key: "automatic_reports", label: () => I18n.t("ui.students.automatic_reports", {}, "Automatic reports"), value: row => row.reports.automatic || 0},
  {key: "assessed", label: () => I18n.t("ui.reports.assessed", {}, "Assessed"), value: row => row.reports.assessed},
  {key: "unassessed", label: () => I18n.t("ui.reports.unassessed", {}, "Not assessed"), value: row => row.reports.unassessed},
  ...["open", "handling", "escalated", "handled"].map(status => ({key: `status_${status}`,
    label: () => `${I18n.t("ui.students.reports", {}, "Bug reports")} · ${statusLabel(status)}`,
    value: row => row.reports.status_counts?.[status] || 0})),
  {key: "average_score", kind: "score", label: () => I18n.t("ui.students.average_score", {}, "Average score"), value: row => row.reports.average_score},
  {key: "top", kind: "examples", label: () => I18n.t("ui.students.top", {}, "Highest scoring reports")},
  {key: "lowest", kind: "examples", label: () => I18n.t("ui.students.lowest", {}, "Lowest scoring reports")},
  {key: "links", kind: "links", label: () => I18n.t("ui.students.links", {}, "Links")},
];
const sortOptions = columns.filter(column => column.value);

function reportsUrl(student, report) {
  const query = new URLSearchParams({student: student.id});
  if (report) query.set("report", report.id);
  return `/bug-reports?${query}`;
}

function emailNode(email) {
  return email
    ? el("a", {class: "student-email", href: `mailto:${encodeURIComponent(email)}`, textContent: email})
    : el("span", {class: "muted", textContent: I18n.t("ui.students.unavailable", {}, "Not provided")});
}

function statusLabel(status) {
  return ({
    open: () => I18n.t("ui.admin.open", {}, "Open"),
    handling: () => I18n.t("ui.bug_reports.status_handling", {}, "Handling"),
    escalated: () => I18n.t("ui.bug_reports.status_escalated", {}, "Needs your decision"),
    handled: () => I18n.t("ui.bug_reports.status_handled", {}, "Handled"),
  })[status]?.() || status;
}

function reportExample(student, report, lowest) {
  const card = el("article", {class: `report-card${lowest ? " lowest" : ""}`},
    el("header", {},
      el("strong", {textContent: I18n.t("ui.bug_reports.score", {score: report.score}, "Score: {score}/10")}),
      el("span", {class: "muted", textContent: report.automatic === true
        ? I18n.t("ui.reports.source_automatic", {}, "Automatic")
        : I18n.t("ui.reports.source_manual", {}, "Manual")}),
      el("span", {class: "muted", textContent: statusLabel(report.status)})),
    el("p", {class: "report-text", textContent: report.text}),
    el("p", {class: "muted", textContent: `${report.id} · ${formatTime(report.created_at)}`}));
  for (const [label, text] of [
    [I18n.t("ui.bug_reports.score_rationale", {}, "Score rationale"), report.score_rationale],
    [I18n.t("ui.bug_reports.resolution", {}, "Resolution or escalation reason"), report.resolution],
    [I18n.t("ui.bug_reports.changes_summary", {}, "Code or game logic changes"), report.changes_summary],
  ]) {
    if (text) card.append(el("p", {class: "report-text"}, el("b", {textContent: label}), ": ", text));
  }
  card.append(el("a", {href: reportsUrl(student, report), target: "_blank", rel: "noopener",
    textContent: I18n.t("ui.students.read_report", {}, "Open full report")}));
  return card;
}

function accountCard(account) {
  const methods = account.login_methods?.length ? account.login_methods.join(", ") : I18n.t("ui.students.guest", {}, "Guest");
  const card = el("article", {class: "account-card"},
    el("h4", {textContent: account.display_name}),
    el("code", {textContent: account.id}),
    (account.emails || []).map(emailNode),
    el("p", {class: "muted", textContent: I18n.t("ui.students.login_methods", {methods}, "Login methods: {methods}")}),
    el("p", {class: "muted", textContent: I18n.t("ui.students.match_reason", {
      reasons: (account.match_reasons || []).join("; "),
    }, "Match: {reasons}")}));
  if (account.canonical_user_id && account.canonical_user_id !== account.id)
    card.append(el("p", {class: "muted", textContent: I18n.t("ui.students.merged_into", {id: account.canonical_user_id}, "Merged into {id}")}));
  return card;
}

function personRow(student, rank) {
  const cells = columns.map(column => {
    const kind = column.kind || "numeric";
    const cell = el(column.key === "name" ? "th" : "td", {
      class: `column-${kind}${kind === "numeric" || kind === "score" ? " numeric" : ""}`,
      "data-column": column.key, ...(column.key === "name" ? {scope: "row"} : {}),
    });
    if (kind === "name") {
      cell.append(el("div", {class: "student-name"},
        el("span", {class: "rank", textContent: count(rank)}),
        el("span", {class: "student-display-name", textContent: student.name})),
      el("p", {class: "student-meta muted", textContent: I18n.t("ui.students.person_summary", {
        matches: count(student.matches.total), accounts: count(student.accounts.length),
      }, "{matches} matches · {accounts} accounts")}));
    } else if (kind === "email") {
      cell.append(emailNode(column.value(student)));
    } else if (kind === "accounts") {
      cell.append(el("div", {class: "account-list", tabIndex: 0, role: "region",
        "aria-label": `${column.label()} · ${student.name}`}, student.accounts.length
        ? student.accounts.map(accountCard)
        : el("p", {class: "muted", textContent: I18n.t("ui.students.no_accounts", {}, "No platform account matches this person yet.")})));
    } else if (kind === "examples") {
      const reports = student.reports[column.key] || [];
      cell.append(el("div", {class: "report-examples", tabIndex: 0, role: "region",
        "aria-label": `${column.label()} · ${student.name}`}, reports.length
        ? reports.map(report => reportExample(student, report, column.key === "lowest"))
        : el("p", {class: "muted", textContent: I18n.t("ui.students.no_assessed", {}, "No assessed reports yet.")})));
    } else if (kind === "links") {
      cell.append(el("a", {href: reportsUrl(student), target: "_blank", rel: "noopener",
        textContent: I18n.t("ui.students.reports_for_person", {}, "Browse this person's reports")}));
    } else if (kind === "score") {
      const value = column.value(student);
      cell.append(el("span", {class: isScore(value) ? "" : "score-none",
        textContent: isScore(value) ? `${I18n.number(Number(value.toFixed(1)))}/10` : "—"}));
    } else cell.textContent = count(column.value(student));
    return cell;
  });
  return el("tr", {class: `student-row${student.id === requestedStudent ? " is-selected" : ""}`,
    id: `student-row-${encodeURIComponent(student.id)}`, "data-student-id": student.id, tabIndex: -1}, cells);
}

function renderOverview(students) {
  const accounts = new Set(students.flatMap(student => student.accounts.map(account => account.id)));
  const summaries = [
    [students.length, I18n.t("ui.students.people", {}, "People in the course")],
    [accounts.size, I18n.t("ui.students.accounts", {}, "Matched account IDs")],
    [students.filter(student => student.matches.total > 0).length, I18n.t("ui.students.active", {}, "People with started matches")],
    [students.filter(student => student.reports.total > 0).length, I18n.t("ui.students.reporters", {}, "People who reported bugs")],
  ];
  $("overview").replaceChildren(...summaries.map(([value, label]) =>
    el("div", {class: "overview-card"}, el("strong", {textContent: count(value)}), el("span", {textContent: label}))));
  $("overview").hidden = false;
}

function render() {
  const focusedStudent = document.activeElement?.classList.contains("student-row")
    ? document.activeElement.dataset.studentId : null;
  const previousViewport = $("leaderboard").querySelector(".table-wrap");
  const viewportHadFocus = document.activeElement === previousViewport;
  if (previousViewport) state.tableScroll = {left: previousViewport.scrollLeft, top: previousViewport.scrollTop};
  $("error").hidden = !state.error;
  $("error").textContent = state.error ? I18n.t("ui.students.load_failed", {}, "Could not load the students leaderboard. Select Refresh to try again.") : "";
  $("student-dashboard").setAttribute("aria-busy", String(state.loading));
  $("refresh").disabled = state.loading;
  if (!state.data) {
    $("freshness").textContent = state.loading ? I18n.t("ui.state.loading", {}, "Loading…") : "";
    return;
  }
  const students = state.data.students;
  const notes = state.data.notes || [];
  $("dashboard-notes").replaceChildren(...notes.map(note => el("li", {textContent: note})));
  $("dashboard-notes").hidden = !notes.length;
  renderOverview(students);
  const column = sortOptions.find(option => option.key === $("student-sort").value) || sortOptions[0];
  const direction = $("student-order").value === "asc" ? 1 : -1;
  const ordered = [...students].sort((a, b) => {
    const av = column.value(a), bv = column.value(b);
    // Unassessed averages always follow real scores, including a score of zero.
    if (av == null || bv == null) return av == null ? (bv == null ? a.name.localeCompare(b.name) : 1) : -1;
    const compared = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return direction * compared || a.name.localeCompare(b.name);
  });
  const query = $("student-search").value.trim().toLocaleLowerCase();
  const matching = ordered.filter(student => !query || JSON.stringify([
    student.name, student.institutional_email, student.personal_email, student.emails,
    student.accounts.map(account => [account.id, account.display_name, account.emails]),
  ]).toLocaleLowerCase().includes(query));
  if (matching.length) {
    const headings = columns.map(item => el("th", {scope: "col", "data-column": item.key,
      class: `column-${item.kind || "numeric"}${!item.kind || item.kind === "score" ? " numeric" : ""}`,
      textContent: item.label()}));
    $("leaderboard").replaceChildren(el("div", {class: "table-wrap", tabIndex: 0, role: "region",
      "aria-label": I18n.t("ui.admin.tab_students", {}, "Students leaderboard"), "data-testid": "students-table-scroll"},
      el("table", {class: "leaderboard-table"},
        el("thead", {}, el("tr", {}, headings)),
        el("tbody", {}, matching.map(student => personRow(student, ordered.indexOf(student) + 1))))));
  } else $("leaderboard").replaceChildren(el("p", {class: "empty", textContent: I18n.t("ui.students.no_results", {}, "No people match this search.")}));
  const viewport = $("leaderboard").querySelector(".table-wrap");
  if (viewport) {
    viewport.scrollLeft = state.tableScroll.left;
    viewport.scrollTop = state.tableScroll.top;
    if (viewportHadFocus) viewport.focus({preventScroll: true});
  }
  const revealInitialStudent = requestedStudent && !selectedStudentShown;
  const focusTarget = revealInitialStudent ? requestedStudent : focusedStudent;
  if (focusTarget) {
    const selected = Array.from($("leaderboard").querySelectorAll(".student-row"))
      .find(row => row.dataset.studentId === focusTarget);
    if (selected) {
      selectedStudentShown = true;
      if (revealInitialStudent) selected.scrollIntoView({block: "nearest", inline: "start"});
      selected.focus({preventScroll: true});
    }
  }
  $("freshness").textContent = [
    I18n.t("ui.students.shown", {shown: count(matching.length), total: count(students.length)}, "{shown} of {total} people"),
    I18n.t("ui.students.freshness", {time: formatTime(state.data.generated_at), seconds: state.data.cache_seconds || 60}, "Snapshot {time} · cached for up to {seconds} seconds"),
  ].join(" · ");
  $("roster-source").replaceChildren();
  try {
    const source = new URL(state.data.roster_source_url);
    if (source.protocol === "https:" && source.hostname === "docs.google.com")
      $("roster-source").append(el("a", {href: source.href, target: "_blank", rel: "noopener",
        textContent: I18n.t("ui.students.roster_source", {}, "Course roster spreadsheet")}), " · ");
  } catch { /* An unavailable source link does not hide the activity metrics. */ }
  if (state.data.roster_fetched_at) $("roster-source").append(I18n.t("ui.students.roster_fetched", {
    time: formatTime(state.data.roster_fetched_at),
  }, "Roster fetched {time}."));
}

function redrawCopy() {
  const selected = $("student-sort").value || "transitive_recruits";
  $("student-sort").replaceChildren(...sortOptions.map(option => el("option", {value: option.key, textContent: option.label()})));
  $("student-sort").value = selected;
  render();
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  state.error = false;
  render();
  try {
    const response = await fetch("/admin/students/data", {cache: "no-store"});
    if (!response.ok) throw new Error(I18n.t("ui.students.load_failed", {}, "Could not load the students leaderboard. Select Refresh to try again."));
    const data = await response.json();
    if (!Array.isArray(data.students)) throw new Error(I18n.t("ui.students.load_failed", {}, "Could not load the students leaderboard. Select Refresh to try again."));
    state.data = data;
  } catch {
    state.error = true;
  } finally {
    state.loading = false;
    render();
  }
}

$("student-search").addEventListener("input", render);
$("student-sort").addEventListener("change", render);
$("student-order").addEventListener("change", render);
$("refresh").addEventListener("click", refresh);
document.addEventListener("i18n-changed", redrawCopy);
I18n.ready.then(redrawCopy);
redrawCopy();
refresh();
