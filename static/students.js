// Roster identities and activity are returned only by the authenticated endpoint.
// Render all account names and report text with textContent, never HTML.
"use strict";

const $ = (id) => document.getElementById(id);
const state = {data: null, expanded: new Set(), loading: false, error: false};
const requestedStudent = new URLSearchParams(location.search).get("student");
let selectedStudentShown = false;
if (requestedStudent) state.expanded.add(requestedStudent);
const count = (value) => I18n.number(Number(value) || 0);
const isScore = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10;

const columns = [
  {key: "name", label: () => I18n.t("ui.students.person", {}, "Person"), value: row => row.name},
  {key: "computer", label: () => I18n.t("ui.students.computer", {}, "Computer"), value: row => row.matches.computer},
  {key: "pass_and_play", label: () => I18n.t("ui.students.pass_and_play", {}, "Pass & play"), value: row => row.matches.pass_and_play},
  {key: "multiplayer", label: () => I18n.t("ui.students.multiplayer", {}, "Multiplayer"), value: row => row.matches.multiplayer},
  {key: "other_players", label: () => I18n.t("ui.students.other_players", {}, "Other players"), value: row => row.other_players},
  {key: "direct_recruits", label: () => I18n.t("ui.students.direct_recruits", {}, "Direct invites"), value: row => row.direct_recruits},
  {key: "transitive_recruits", label: () => I18n.t("ui.students.transitive_recruits", {}, "All invited players"), value: row => row.transitive_recruits},
  {key: "recruits_matches", label: () => I18n.t("ui.students.recruits_matches", {}, "Recruited matches"), value: row => row.recruits_matches.total},
  {key: "reports", label: () => I18n.t("ui.students.reports", {}, "Bug reports"), value: row => row.reports.total},
  {key: "average_score", label: () => I18n.t("ui.students.average_score", {}, "Average score"), value: row => row.reports.average_score},
];
const sortOptions = [
  ...columns,
  {key: "total_matches", label: () => I18n.t("ui.students.total_matches", {}, "Total matches"), value: row => row.matches.total},
  {key: "accounts", label: () => I18n.t("ui.students.accounts", {}, "Matched account IDs"), value: row => row.accounts.length},
];

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

function statistic(label, value) {
  return el("div", {}, el("dt", {textContent: label}), el("dd", {textContent: count(value)}));
}

function matchBreakdown(matches) {
  return el("dl", {class: "breakdown"},
    statistic(I18n.t("ui.students.total_matches", {}, "Total matches"), matches.total),
    ...columns.slice(1, 4).map(column => statistic(column.label(), matches[column.key])),
    statistic(I18n.t("ui.students.waiting", {}, "Waiting lobbies"), matches.waiting));
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

function personDetails(student) {
  const reports = student.reports;
  const accounts = el("section", {class: "detail-section full"},
    el("h3", {textContent: I18n.t("ui.students.accounts_heading", {}, "Matched platform accounts")}),
    el("div", {class: "account-list"}, student.accounts.length
      ? student.accounts.map(accountCard)
      : el("p", {class: "muted", textContent: I18n.t("ui.students.no_accounts", {}, "No platform account matches this person yet.")})));
  const identity = el("dl", {class: "identity-list"},
    el("div", {}, el("dt", {textContent: I18n.t("ui.students.institutional_email", {}, "Columbia / Barnard email")}), el("dd", {}, emailNode(student.institutional_email))),
    el("div", {}, el("dt", {textContent: I18n.t("ui.students.personal_email", {}, "Personal email")}), el("dd", {}, emailNode(student.personal_email))));
  const activity = el("section", {class: "detail-section"},
    el("h3", {textContent: I18n.t("ui.students.total_matches", {}, "Total matches")}), matchBreakdown(student.matches),
    el("dl", {class: "breakdown"}, statistic(I18n.t("ui.students.other_players", {}, "Other players"), student.other_players)));
  const referrals = el("section", {class: "detail-section"},
    el("h3", {textContent: I18n.t("ui.students.recruits_matches", {}, "Recruited matches")}),
    el("dl", {class: "breakdown"},
      statistic(I18n.t("ui.students.direct_recruits", {}, "Direct invites"), student.direct_recruits),
      statistic(I18n.t("ui.students.transitive_recruits", {}, "All invited players"), student.transitive_recruits)),
    matchBreakdown(student.recruits_matches));
  const reportSummary = el("section", {class: "detail-section full"},
    el("h3", {textContent: I18n.t("ui.students.reports", {}, "Bug reports")}),
    el("dl", {class: "breakdown"},
      statistic(I18n.t("ui.students.reports", {}, "Bug reports"), reports.total),
      ...Object.entries(reports.status_counts || {}).map(([status, total]) => statistic(statusLabel(status), total))),
    el("p", {class: "muted", textContent: I18n.t("ui.students.assessed_summary", {
      assessed: count(reports.assessed), unassessed: count(reports.unassessed),
    }, "{assessed} assessed · {unassessed} unassessed")}),
    el("a", {href: reportsUrl(student), target: "_blank", rel: "noopener",
      textContent: I18n.t("ui.students.reports_for_person", {}, "Browse this person's reports")}));
  const examples = [
    [I18n.t("ui.students.top", {}, "Highest scoring reports"), reports.top || [], false],
    [I18n.t("ui.students.lowest", {}, "Lowest scoring reports"), reports.lowest || [], true],
  ].map(([label, rows, lowest]) => el("section", {class: "detail-section"},
    el("h3", {textContent: label}), rows.length
      ? rows.map(report => reportExample(student, report, lowest))
      : el("p", {class: "muted", textContent: I18n.t("ui.students.no_assessed", {}, "No assessed reports yet.")})));
  return el("div", {}, identity, el("div", {class: "detail-grid"}, activity, referrals, accounts, reportSummary, examples));
}

function personRows(student, rank) {
  const detailId = `student-detail-${encodeURIComponent(student.id)}`;
  const detail = el("tr", {class: "student-detail", id: detailId, hidden: !state.expanded.has(student.id)},
    el("td", {colSpan: columns.length}, personDetails(student)));
  const toggle = el("button", {type: "button", textContent: student.name,
    "aria-expanded": String(state.expanded.has(student.id)), "aria-controls": detailId});
  toggle.addEventListener("click", () => {
    if (state.expanded.has(student.id)) state.expanded.delete(student.id);
    else state.expanded.add(student.id);
    detail.hidden = !state.expanded.has(student.id);
    toggle.setAttribute("aria-expanded", String(!detail.hidden));
  });
  const nameCell = el("td", {},
    el("div", {class: "student-name"}, el("span", {class: "rank", textContent: count(rank)}), toggle),
    el("p", {class: "student-meta muted", textContent: I18n.t("ui.students.person_summary", {
      matches: count(student.matches.total), accounts: count(student.accounts.length),
    }, "{matches} matches · {accounts} accounts")}),
    student.institutional_email ? emailNode(student.institutional_email) : null,
    student.personal_email ? emailNode(student.personal_email) : null);
  const cells = columns.slice(1).map(column => {
    const value = column.value(student);
    const cell = el("td", {class: "numeric", "data-label": column.label()});
    if (column.key === "reports") {
      cell.append(el("a", {href: reportsUrl(student), target: "_blank", rel: "noopener", textContent: count(value)}));
    } else if (column.key === "average_score") {
      cell.append(el("span", {class: isScore(value) ? "" : "score-none",
        textContent: isScore(value) ? `${I18n.number(Number(value.toFixed(1)))}/10` : "—"}));
    } else cell.textContent = count(value);
    return cell;
  });
  return [el("tr", {class: "student-row", "data-student-id": student.id}, nameCell, cells), detail];
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
    const headings = columns.map((item, index) => el("th", {scope: "col", class: index ? "numeric" : "", textContent: item.label()}));
    $("leaderboard").replaceChildren(el("div", {class: "table-wrap"},
      el("table", {class: "leaderboard-table"},
        el("thead", {}, el("tr", {}, headings)),
        el("tbody", {}, matching.flatMap(student => personRows(student, ordered.indexOf(student) + 1))))));
  } else $("leaderboard").replaceChildren(el("p", {class: "empty", textContent: I18n.t("ui.students.no_results", {}, "No people match this search.")}));
  if (requestedStudent && !selectedStudentShown) {
    const selected = Array.from($("leaderboard").querySelectorAll(".student-row"))
      .find(row => row.dataset.studentId === requestedStudent);
    if (selected) {
      selectedStudentShown = true;
      selected.scrollIntoView({block: "start"});
      selected.querySelector("button").focus({preventScroll: true});
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
