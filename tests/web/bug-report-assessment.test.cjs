const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// A small DOM stand-in exercises the actual page, including lazy evidence,
// localization redraws and status requests, without an additional dependency.
function setup(report, detail = report, {pages = [[report]], students = [], search = ""} = {}) {
  const nodes = [], listeners = {}, calls = [];
  class Element {
    constructor(tag, attrs = {}, children = []) {
      this.tagName = tag.toUpperCase();
      this.attributes = {};
      this.listeners = {};
      this.children = [];
      this.value = "";
      this._text = "";
      nodes.push(this);
      for (const [name, value] of Object.entries(attrs)) {
        if (name === "class") this.className = value;
        else if (name.startsWith("data-") || name.startsWith("aria-")) this.setAttribute(name, value);
        else this[name] = value;
      }
      this.append(...children);
    }
    get textContent() { return this._text + this.children.map(node => typeof node === "string" ? node : node.textContent).join(""); }
    set textContent(value) { this._text = String(value); this.children = []; }
    set innerHTML(_value) { throw new Error("Report content must be rendered as text"); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    append(...children) {
      for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false) continue;
        this.children.push(child);
        if (typeof child !== "string") child.parentElement = this;
      }
    }
    replaceChildren(...children) { this._text = ""; this.children = []; this.append(...children); }
    get options() { return this.children.filter(node => node.tagName === "OPTION"); }
    querySelectorAll(selector) {
      const match = node => selector === "*" ? true : selector.startsWith(".")
        ? node.className?.split(" ").includes(selector.slice(1))
        : selector === "option[data-course-student]"
          ? node.tagName === "OPTION" && "data-course-student" in node.attributes
          : node.tagName === selector.toUpperCase();
      return this.children.filter(node => typeof node !== "string")
        .flatMap(node => [...(match(node) ? [node] : []), ...node.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
      this.parentElement = null;
    }
    replaceWith(node) {
      if (!this.parentElement) return;
      const parent = this.parentElement;
      parent.children.splice(parent.children.indexOf(this), 1, node);
      node.parentElement = parent;
      this.parentElement = null;
    }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    focus() { this.focused = true; }
    scrollIntoView() { this.scrolledIntoView = true; }
  }
  const roots = Object.fromEntries(["reports", "more", "freshness", "error", "refresh", "summary", "student-warning", "clear-filters"].map(id => [id, new Element("div")]));
  const selects = {
    status: ["all", "open", "handling", "escalated", "handled"],
    student: ["all", "course", "other"],
    score: ["all", "assessed", "unassessed", "high", "middle", "low"],
    changes: ["all", "yes", "no"],
    sort: ["newest", "oldest", "highest", "lowest"],
  };
  for (const [id, values] of Object.entries(selects)) roots[id] = new Element("select", {value: values[0]}, values.map(value => new Element("option", {value})));
  for (const id of ["search", "from", "through"]) roots[id] = new Element("input");
  const attachedNodes = () => Object.values(roots).flatMap(root => [root, ...root.querySelectorAll("*")]);
  const location = {pathname: "/bug-reports", search};
  let alternateLanguage = false;
  const english = require("./i18n-stub.cjs");
  const context = vm.createContext({
    URLSearchParams,
    location,
    history: {replaceState: (_data, _title, url) => { location.search = new URL(url, "https://example.invalid").search; }},
    document: {
      getElementById: id => roots[id] || attachedNodes().find(node => node.id === id),
      querySelectorAll: () => attachedNodes().filter(node => "data-bug-localized" in node.attributes),
      addEventListener: (name, listener) => { listeners[name] = listener; },
    },
    el: (tag, attrs, ...children) => new Element(tag, attrs, children),
    formatTime: value => value,
    I18n: {
      ...english, ready: Promise.resolve(),
      t: (...args) => (alternateLanguage ? "Translated: " : "") + english.t(...args),
    },
    fetch: async (url, options = {}) => {
      calls.push({url, body: options.body && JSON.parse(options.body)});
      if (url === "/admin/students/data") return {ok: true, json: async () => ({students})};
      if (url.startsWith("/admin/bug-reports?")) {
        const index = Number(new URL(url, "https://example.invalid").searchParams.get("cursor") || 0);
        return {ok: true, json: async () => ({items: pages[index], next_cursor: index + 1 < pages.length ? String(index + 1) : null})};
      }
      return {ok: true, json: async () => detail};
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../../static/bug-reports.js"), "utf8"), context);
  return {
    roots, nodes, calls,
    async ready() { await new Promise(resolve => setImmediate(resolve)); },
    async expand() {
      const card = roots.reports.children[0];
      const evidence = card.querySelector("details");
      evidence.open = true;
      await evidence.listeners.toggle();
      return evidence;
    },
    changeLanguage() { alternateLanguage = true; listeners["i18n-changed"](); },
  };
}

const report = {
  id: "report-one", status: "handling", text: "A reported problem", created_at: "2026-11-21T11:00:00Z",
  updated_at: "2026-11-21T11:01:00Z", score: 0,
  score_rationale: "The requested behavior would hide useful controls.",
  changes_summary: "No code or game logic changed; waiting for the owner's decision.",
  resolution: "Existing investigation notes", commit: "published-revision",
};

test("zero is a real score and rationale is separate from actual changes", async () => {
  const page = setup(report);
  await page.ready();
  const card = page.roots.reports.children[0];
  assert.match(card.textContent, /Score: 0\/10/);
  await page.expand();
  const assessment = page.nodes.find(node => node.className === "report-assessment");
  assert.match(assessment.textContent, /Score: 0\/10/);
  assert.match(assessment.textContent, /Score rationaleThe requested behavior would hide useful controls\./);
  assert.match(assessment.textContent, /Code or game logic changesNo code or game logic changed/);
  assert.equal(assessment.querySelectorAll("input").length, 0, "assessment stays read-only");
});

test("missing and null scores remain unassessed, never defaulting to zero", async () => {
  for (const score of [undefined, null]) {
    const legacy = {...report, score, score_rationale: "", changes_summary: ""};
    const page = setup(legacy);
    await page.ready();
    assert.match(page.roots.reports.textContent, /Score: Not assessed/);
    await page.expand();
    const assessment = page.nodes.find(node => node.className === "report-assessment");
    assert.match(assessment.textContent, /No assessment recorded yet\./);
    assert.match(assessment.textContent, /No changes recorded\./);
    assert.doesNotMatch(assessment.textContent, /0\/10/);
  }
});

test("fresh detail scores replace stale headers and metadata markup stays literal", async () => {
  const markup = '<img src=x onerror="steal()">';
  const page = setup({...report, score: null}, {...report, score: 8, score_rationale: markup, changes_summary: `<script>${markup}</script>`});
  await page.ready();
  await page.expand();
  const card = page.roots.reports.children[0];
  assert.match(card.children.find(node => node.className === "muted report-score").textContent, /Score: 8\/10/);
  const assessment = page.nodes.find(node => node.className === "report-assessment");
  assert.ok(assessment.textContent.includes(markup));
  assert.ok(assessment.textContent.includes(`<script>${markup}</script>`));
  assert.equal(page.nodes.some(node => ["IMG", "SCRIPT"].includes(node.tagName)), false);
});

test("language changes preserve evidence, metadata and unsaved resolution drafts", async () => {
  const page = setup(report);
  await page.ready();
  const evidence = await page.expand();
  const notes = page.nodes.find(node => node.tagName === "TEXTAREA");
  notes.value = "Unsaved review draft";
  page.changeLanguage();
  assert.equal(evidence.open, true);
  assert.equal(notes.value, "Unsaved review draft");
  assert.ok(page.roots.reports.textContent.includes(report.score_rationale));
  assert.ok(page.roots.reports.textContent.includes(report.changes_summary));
  assert.match(page.roots.reports.textContent, /Translated: Score: 0\/10/);
  const requestCount = page.calls.length;
  await evidence.listeners.toggle();
  assert.equal(page.calls.length, requestCount, "redraw does not reload private evidence");
});

test("status actions keep review metadata untouched and retain concurrency guards", async () => {
  const page = setup(report);
  await page.ready();
  await page.expand();
  const actions = page.nodes.find(node => node.className === "actions");
  const escalate = actions.children.find(node => node.textContent === "Escalate to owner");
  await escalate.listeners.click();
  const body = page.calls.find(call => call.url.endsWith("/status")).body;
  assert.equal(body.expected_status, report.status);
  assert.equal(body.expected_updated_at, report.updated_at);
  for (const field of ["score", "score_rationale", "changes_summary"])
    assert.equal(Object.hasOwn(body, field), false, "status actions must not replace assessment metadata");
});

test("student and score filters search every report page, including merged accounts", async () => {
  const other = {...report, id: "anonymous", reporter_user_id: null, score: null};
  const zero = {...report, id: "later-zero", reporter_user_id: "old-account", score: 0};
  const high = {...report, id: "later-high", reporter_user_id: "current-account", score: 10};
  const page = setup(other, other, {
    pages: [[other], [zero, high]],
    students: [{id: "student-one", name: "Example Learner", emails: ["learner@example.invalid"],
      accounts: [{id: "old-account", canonical_user_id: "current-account"}]}],
    search: "?student=student-one",
  });
  await page.ready();
  assert.deepEqual(page.roots.reports.children.map(card => card.id), ["report-later-high", "report-later-zero"]);
  assert.match(page.roots.summary.textContent, /2 of 3 reports match/);
  assert.match(page.roots.summary.textContent, /Average score 5.00\/10 across 2 assessed reports/);
  assert.match(page.roots.reports.textContent, /Example Learner/);
  const listCalls = page.calls.filter(call => call.url.startsWith("/admin/bug-reports?"));
  assert.equal(listCalls.length, 2);
  assert.ok(listCalls.every(call => new URL(call.url, "https://example.invalid").searchParams.get("status") === "all"));
  assert.equal(new URL(listCalls[1].url, "https://example.invalid").searchParams.get("cursor"), "1");
  page.roots.score.value = "low";
  page.roots.score.listeners.change();
  assert.deepEqual(page.roots.reports.children.map(card => card.id), ["report-later-zero"]);
  assert.match(page.roots.summary.textContent, /Average score 0.00\/10/);
  page.roots["clear-filters"].listeners.click();
  assert.equal(page.roots.reports.children.length, 3);
  page.roots.search.value = "learner@example.invalid";
  page.roots.search.listeners.input();
  assert.equal(page.roots.reports.children.length, 2, "email search includes both linked account IDs");
});
