const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../../static/common.js"), "utf8");
// The reporting code, without the rest of the page's helpers.
const reporting = source.slice(
  source.indexOf("function showPageError"),
  source.indexOf("async function fetchAdminCollection"),
);

function setup() {
  const listeners = {},
    sent = [],
    banner = { textContent: "", hidden: true };
  const context = vm.createContext({
    I18n: require('./i18n-stub.cjs'),
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

test("a script error is logged and silently submitted as an automatic report", () => {
  const { listeners, sent, banner } = setup();
  listeners.error({ message: "x is not a function", filename: "/static/portal.js?v=56", lineno: 10 });
  assert.equal(banner.hidden, true);
  assert.equal(banner.textContent, "");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, "/client-errors");
  assert.equal(sent[0].method, "POST");
  assert.deepEqual(sent[0].body, {
    kind: "script_error",
    message: "x is not a function (portal.js:10)",
    page: "/static/portal.html",
    user_agent: "Test UA",
  });
  assert.equal(sent[1].url, "/bug-reports");
  assert.equal(sent[1].body.automatic, true);
  assert.equal(sent[1].body.screenshot, null);
  assert.equal(sent[1].body.diagnostics.automatic_error.kind, "script_error");
});

test("an unhandled promise rejection is reported", () => {
  const { listeners, sent } = setup();
  listeners.unhandledrejection({ reason: new Error("boom") });
  assert.equal(sent[0].body.kind, "unhandled_rejection");
  assert.equal(sent[0].body.message, "boom");
  assert.equal(sent[1].body.automatic, true);
});

test("error reports remove remembered credentials before truncation and after account switches", () => {
  const { listeners, sent, context } = setup();
  const previous = "previous-user-password", current = "current-user-password";
  context.Auth = { accounts: () => [{password: previous}, {password: current}, {}] };
  listeners.unhandledrejection({reason: new Error(`request failed: ${previous}; response: ${current}`)});
  assert.equal(sent[0].body.message, "request failed: <redacted>; response: <redacted>");
  context.reportClientError("script_error", "x".repeat(490) + current);
  assert.equal(sent.filter(row => row.url === "/client-errors")[1].body.message, "x".repeat(490) + "<redacted>");
  assert.ok(!JSON.stringify(sent).includes(previous));
  assert.ok(!JSON.stringify(sent).includes(current));
});

test("error reports remove password inputs and labeled URL or JSON secrets", () => {
  const {sent, context} = setup();
  context.document.querySelectorAll = () => [{value:"console-password"}];
  context.reportClientError("script_error", 'console-password /auth?token=url-secret&v=2 {"password":"json-secret"} Bearer access-secret');
  const message = sent[0].body.message;
  for (const secret of ["console-password", "url-secret", "json-secret", "access-secret"])
    assert.ok(!message.includes(secret), message);
  assert.ok(message.includes("v=2"));
});

test("the same error is reported once, and at most five per page load", () => {
  const { listeners, sent, context } = setup();
  for (let i = 0; i < 3; i++) listeners.error({ message: "same", filename: "a.js", lineno: 1 });
  assert.equal(sent.filter(row => row.url === "/client-errors").length, 1);
  assert.equal(sent.filter(row => row.url === "/bug-reports").length, 1);
  for (let i = 0; i < 10; i++) context.reportClientError("script_error", `different ${i}`);
  assert.equal(sent.filter(row => row.url === "/client-errors").length, 5);
});

test("reporting never throws, even when the network call does", () => {
  const { context } = setup();
  context.fetch = () => {
    throw new Error("offline");
  };
  assert.doesNotThrow(() => context.reportClientError("script_error", "x"));
});
