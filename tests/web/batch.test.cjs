const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Loads portal.js in a vm so the real portalTransport (and its batcher) can be
// exercised against a stubbed fetch. Mirrors the portal.test.cjs harness.
function setup(fetchStub) {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        value: "",
        hidden: false,
        disabled: false,
        dataset: {},
        children: [],
        classList: { toggle() {} },
        replaceChildren(...children) {
          this.children = children;
        },
        setAttribute() {},
        addEventListener() {},
        focus() {},
      });
    return nodes.get(id);
  };
  const ctx = vm.createContext({
    console,
    Map,
    Set,
    URLSearchParams,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: fetchStub,
    navigator: { onLine: true },
    localStorage: {},
    document: { getElementById: node, body: { classList: { toggle() {} } } },
    window: { addEventListener() {} },
    location: { hash: "", search: "", assign() {} },
    history: { replaceState() {} },
    Auth: { current: () => ({ id: "owner", password: "pw" }) },
    I18n: require("./i18n-stub.cjs"),
    PortalOffline: class {
      constructor() {
        this.network = true;
      }
      api() {}
      read() {
        return {};
      }
    },
    StoragePages: {
      enabled: async () => false,
      list: (request, p, options) => request("GET", p, options),
      controls() {},
      search() {
        return false;
      },
    },
    GameFrame: class {
      load() {}
      unload() {}
      send() {}
    },
    PushNotifications: { setup: () => {}, toggle: () => {} },
    ApiError: class ApiError extends Error {
      constructor(status, detail) {
        super(typeof detail === "string" ? detail : JSON.stringify(detail));
        this.status = status;
        this.detail = detail;
      }
    },
    apiRequest: async () => {},
    formatTime: () => "",
    shortId: (x) => x,
    showPageError: () => {},
    el: (tag, attrs = {}, ...children) => ({ ...attrs, children }),
  });
  vm.runInContext(
    fs
      .readFileSync(path.join(__dirname, "../../static/portal.js"), "utf8")
      .replace(/main\(\);\s*$/, ""),
    ctx,
  );
  return { run: (code) => vm.runInContext(code, ctx) };
}

function batchResponder(bodiesByPath) {
  // Answers a /batch fetch by splitting its requests and returning each body's
  // status, so the test can see what the batcher sent and what it returned.
  return async (url, options) => {
    const parsed = new URL(url, "http://test");
    if (parsed.pathname === "/batch") {
      const requests = JSON.parse(parsed.searchParams.get("requests"));
      const results = requests.map(({ path }) => {
        const body = bodiesByPath[path];
        return body === undefined
          ? { status: 404, body: { detail: "Not found" } }
          : { status: 200, body };
      });
      return { ok: true, status: 200, text: async () => JSON.stringify(results) };
    }
    const body = bodiesByPath[parsed.pathname + parsed.search];
    return body === undefined
      ? { ok: false, status: 404, text: async () => JSON.stringify({ detail: "Not found" }) }
      : { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
}

test("simultaneous GETs go out as one /batch call and split back to each caller", async () => {
  const calls = [];
  const fetchStub = async (url, options) => {
    calls.push(url);
    return batchResponder({
      "/games": [{ id: "g1" }],
      "/matches": [{ id: "m1" }],
      "/matches/open": [],
    })(url, options);
  };
  const { run } = setup(fetchStub);
  const user = { id: "alice", password: "pw" };
  const results = await run(`Promise.all([
    portalTransport("GET", "/games", {user: ${JSON.stringify(user)}}),
    portalTransport("GET", "/matches", {user: ${JSON.stringify(user)}}),
    portalTransport("GET", "/matches/open", {user: ${JSON.stringify(user)}}),
  ])`);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\/batch\?requests=/);
  const sent = JSON.parse(new URL(calls[0], "http://test").searchParams.get("requests"));
  assert.deepEqual(sent.map((r) => r.path), ["/games", "/matches", "/matches/open"]);
  assert.deepEqual(results, [[{ id: "g1" }], [{ id: "m1" }], []]);
});

test("a GET arriving after the batch is dispatched waits for the next batch", async () => {
  const calls = [];
  const fetchStub = async (url) => {
    calls.push(url);
    return batchResponder({ "/games": [], "/matches": [] })(url);
  };
  const { run } = setup(fetchStub);
  const user = { id: "alice", password: "pw" };
  const first = run(`portalTransport("GET", "/games", {user: ${JSON.stringify(user)}})`);
  await delay(150);
  const second = run(`portalTransport("GET", "/matches", {user: ${JSON.stringify(user)}})`);
  await Promise.all([first, second]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.startsWith("/batch?requests=")));
  const firstBatch = JSON.parse(new URL(calls[0], "http://test").searchParams.get("requests"));
  const secondBatch = JSON.parse(new URL(calls[1], "http://test").searchParams.get("requests"));
  assert.deepEqual(firstBatch.map((r) => r.path), ["/games"]);
  assert.deepEqual(secondBatch.map((r) => r.path), ["/matches"]);
});

test("a failing sub-request rejects only its caller; the rest resolve", async () => {
  const fetchStub = async (url) =>
    batchResponder({ "/games": [{ id: "g1" }] })(url);
  const { run } = setup(fetchStub);
  const user = { id: "alice", password: "pw" };
  const settled = await run(`Promise.allSettled([
    portalTransport("GET", "/games", {user: ${JSON.stringify(user)}}),
    portalTransport("GET", "/games/no-such-game", {user: ${JSON.stringify(user)}}),
  ])`);
  assert.equal(settled[0].status, "fulfilled");
  assert.deepEqual(settled[0].value, [{ id: "g1" }]);
  assert.equal(settled[1].status, "rejected");
  assert.equal(settled[1].reason.status, 404);
});

test("writes bypass the batcher and go straight out", async () => {
  const calls = [];
  const fetchStub = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: "m1" }) };
  };
  const { run } = setup(fetchStub);
  const user = { id: "alice", password: "pw" };
  await run(`portalTransport("POST", "/matches", {user: ${JSON.stringify(user)}, body: {game_id: "g1"}})`);
  assert.deepEqual(calls, ["/matches"]);
});
