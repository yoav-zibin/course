const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// A small DOM stand-in exercises the actual page, including lazy evidence,
// localization redraws and status requests, without an additional dependency.
function setup(report, detail = report) {
  const nodes = [], listeners = {}, calls = [];
  class Element {
    constructor(tag, attrs = {}, children = []) {
      this.tagName = tag;
      this.attributes = {};
      this.listeners = {};
      this.children = [];
      this._text = "";
      nodes.push(this);
      for (const [name, value] of Object.entries(attrs)) {
        if (name === "class") this.className = value;
        else this[name] = value;
      }
      this.append(...children);
    }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(""); }
    set textContent(value) { this._text = String(value); this.children = []; }
    set innerHTML(_value) { throw new Error("Report content must be rendered as text"); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this._text = ""; this.children = children; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    focus() { this.focused = true; }
  }
  const roots = Object.fromEntries(["status", "reports", "more", "freshness", "error", "refresh"].map(id => [id, new Element("div")]));
  roots.status.value = "all";
  let alternateLanguage = false;
  const english = require("./i18n-stub.cjs");
  const context = vm.createContext({
    URLSearchParams,
    document: {
      getElementById: id => roots[id],
      querySelectorAll: () => nodes.filter(node => "data-bug-localized" in node.attributes),
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
      return {ok: true, json: async () => url.includes("?") ? {items: [report], next_cursor: null} : detail};
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../../static/bug-reports.js"), "utf8"), context);
  return {
    roots, nodes, calls,
    async ready() { await new Promise(resolve => setImmediate(resolve)); },
    async expand() {
      const card = roots.reports.children[0];
      const evidence = card.children.find(node => node.tagName === "details");
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
  assert.equal(page.nodes.filter(node => node.tagName === "input").length, 1, "assessment stays read-only");
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
  assert.equal(page.nodes.some(node => ["img", "script"].includes(node.tagName)), false);
});

test("language changes preserve evidence, metadata and unsaved resolution drafts", async () => {
  const page = setup(report);
  await page.ready();
  const evidence = await page.expand();
  const notes = page.nodes.find(node => node.tagName === "textarea");
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
