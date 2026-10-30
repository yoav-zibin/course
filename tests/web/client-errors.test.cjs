const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const Offline = require("../../static/portal-offline.js");

const source = fs.readFileSync(path.join(__dirname, "../../static/common.js"), "utf8");
// The reporting code, without the rest of the page's helpers.
const reporting = source.slice(
  source.indexOf("function showPageError"),
  source.indexOf("async function fetchAllData"),
);

function setup() {
  const listeners = {},
    sent = [],
    banner = { textContent: "", hidden: true };
  const context = vm.createContext({
    window: { addEventListener: (type, fn) => (listeners[type] = fn) },
    document: {
      getElementById: () => banner,
      querySelector: () => null,
      body: { prepend() {} },
    },
    el: () => banner,
    location: { pathname: "/static/portal.html" },
    navigator: { userAgent: "Test UA" },
    fetch: (url, options) => {
      sent.push({ url, ...options, body: JSON.parse(options.body) });
      return Promise.resolve({ ok: true });
    },
  });
  vm.runInContext(reporting, context);
  return { listeners, sent, banner, context };
}

test("a script error is shown and reported to the server", () => {
  const { listeners, sent, banner } = setup();
  listeners.error({ message: "x is not a function", filename: "/static/portal.js?v=56", lineno: 10 });
  assert.match(banner.textContent, /x is not a function/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "/client-errors");
  assert.equal(sent[0].method, "POST");
  assert.deepEqual(sent[0].body, {
    kind: "script_error",
    message: "x is not a function (portal.js?v=56:10)",
    page: "/static/portal.html",
    user_agent: "Test UA",
  });
});

test("an unhandled promise rejection is reported", () => {
  const { listeners, sent } = setup();
  listeners.unhandledrejection({ reason: new Error("boom") });
  assert.equal(sent[0].body.kind, "unhandled_rejection");
  assert.equal(sent[0].body.message, "boom");
});

test("the same error is reported once, and at most five per page load", () => {
  const { listeners, sent, context } = setup();
  for (let i = 0; i < 3; i++) listeners.error({ message: "same", filename: "a.js", lineno: 1 });
  assert.equal(sent.length, 1);
  for (let i = 0; i < 10; i++) context.reportClientError("script_error", `different ${i}`);
  assert.equal(sent.length, 5);
});

test("reporting never throws, even when the network call does", () => {
  const { context } = setup();
  context.fetch = () => {
    throw new Error("offline");
  };
  assert.doesNotThrow(() => context.reportClientError("script_error", "x"));
});

test("a full device storage is reported to the server as storage_full", () => {
  const reports = [];
  globalThis.reportClientError = (kind, message) => reports.push({ kind, message });
  try {
    const storage = { getItem: () => null, setItem: () => { throw Error("quota"); } };
    const o = new Offline(storage, undefined, () => ({ id: "alice", password: "t" }), () => false);
    assert.throws(() => o.write({ responses: {}, queues: {}, archives: [] }), /Device storage is full/);
    assert.equal(reports[0].kind, "storage_full");
    assert.match(reports[0].message, /Device storage is full or unavailable/);
  } finally {
    delete globalThis.reportClientError;
  }
});

test("the offline cache works on pages that have no error reporting", () => {
  delete globalThis.reportClientError;
  const storage = { getItem: () => null, setItem: () => { throw Error("quota"); } };
  const o = new Offline(storage, undefined, () => ({ id: "alice", password: "t" }), () => false);
  assert.throws(() => o.write({ responses: {}, queues: {}, archives: [] }), /Device storage is full/);
});
