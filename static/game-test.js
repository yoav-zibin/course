/* The game test page: paste a game's server and client code, its three JSON
 * Schemas and its unit test cases, run the same checks the import endpoint
 * runs (here, in the browser, in a Web Worker), and play the game in a
 * local emulator before submitting it. See the "How to Write a Game for
 * BuildPlay" guide for how to use it.
 *
 * What this page does NOT check: per-call memory (the platform allows 64 MiB
 * per call), the exact 100 ms per-call time limit (a 5 s watchdog is used
 * instead), translations, images, the tutorial, and package sizes — those
 * are validated when you submit. The server re-runs its own checks with its
 * own random draws at submit time, so a pass here is not a guarantee of a
 * 201, and a failure here is a failure the server would also report.
 *
 * The checks mirror game_platform/game_checks.py (run_checks), game_testing.py
 * (test_server_code), game_contract.py (verify_examples, probe_leaving,
 * probe_move_agreement) and game_text.py (lint). The server-code host is
 * static/game-test-host.js.
 */

"use strict";

function $(id) {
  return document.getElementById(id);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => deepEqual(item, right[index]))
    );
  }
  if (typeof left !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]),
    )
  );
}

// The page's own seeded RNG (mulberry32, the same algorithm the game host
// uses). It drives the random walks' choices — player counts, stakes,
// movers, joins and leaves — so a walk is reproducible from its seed.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

// ---------------------------------------------------------------------------
// The log: every game API exchange (make_move and state_changed) is written
// to the browser console and to the log panel.
// ---------------------------------------------------------------------------

const Log = {
  add(kind, text) {
    console.log("[game-test]", kind, text);
    const panel = typeof document !== "undefined" ? $("log") : null;
    if (!panel) return;
    const line = document.createElement("div");
    line.className = "log-line log-" + kind;
    line.textContent = `${new Date().toLocaleTimeString()} ${kind}: ${text}`;
    panel.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
  },
  clear() {
    const panel = typeof document !== "undefined" ? $("log") : null;
    if (panel) panel.replaceChildren();
  },
};

// ---------------------------------------------------------------------------
// ServerHost: the game's server code in a Web Worker (static/game-test-host.js).
// A call is a postMessage round trip; a call that does not answer within the
// watchdog is a failure and the worker is terminated — the next call reloads
// the code, the way the platform rebuilds a QuickJS context after a timeout.
// ---------------------------------------------------------------------------

const READY_TIMEOUT_MS = 2000;
const CALL_TIMEOUT_MS = 5000;
const PLAYER_LEFT_TIMEOUT_MS = 10000;
const LOAD_TIMEOUT_MS = 10000;

class ServerHost {
  constructor() {
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map();
    this.loadEntry = null;
    this.serverCode = "";
    this.schemas = null;
    this.functions = {};
    this.loaded = false;
    this.lastCallUsedRandom = false;
    this.lastCallResult = undefined;
    this.lastCallDurationMs = 0;
  }

  terminate() {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch (e) {
        // Already gone.
      }
    }
    this.worker = null;
    this.loaded = false;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("the server-code worker stopped"));
    }
    this.pending.clear();
    if (this.loadEntry) {
      const entry = this.loadEntry;
      this.loadEntry = null;
      clearTimeout(entry.timer);
      entry.reject(new Error("the server-code worker stopped"));
    }
  }

  has(fn) {
    return !!this.functions[fn];
  }

  async load(serverCode, schemas) {
    if (this.loadEntry) return this.loadEntry.promise;
    this.serverCode = serverCode;
    this.schemas = schemas;
    this.terminate();
    this.worker = new Worker("/static/game-test-host.js?v=2");
    this.worker.onmessage = (event) => this.onMessage(event.data);
    this.worker.onerror = () => this.terminate();
    let entry;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.terminate();
        reject(new Error("the server code took too long to load"));
      }, LOAD_TIMEOUT_MS);
      entry = { resolve, reject, timer };
      this.worker.postMessage({ type: "load", serverCode, schemas });
    });
    entry.promise = promise;
    this.loadEntry = entry;
    return promise;
  }

  onMessage(msg) {
    if (msg.type === "loaded") {
      const entry = this.loadEntry;
      this.loadEntry = null;
      if (!entry) return;
      clearTimeout(entry.timer);
      if (msg.ok) {
        this.functions = msg.functions || {};
        this.loaded = true;
        entry.resolve(msg.functions);
      } else {
        entry.reject(new Error(msg.error || "the server code does not load"));
      }
      return;
    }
    if (msg.type !== "result") return;
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) {
      this.lastCallUsedRandom = !!msg.usedRandom;
      this.lastCallResult = msg.result;
      entry.resolve({ result: msg.result, usedRandom: !!msg.usedRandom });
    } else {
      const error = new Error(msg.message || "game call failed");
      error.kind = msg.kind || "error";
      entry.reject(error);
    }
  }

  // Calls game[name](...args, ctx) with the call's seed. Returns
  // {result, usedRandom}; throws an Error with .kind "invalid_move" when the
  // game rejects the call with InvalidMove, and "error" for any other bug.
  async call(name, args, ctx, seed, now) {
    if (!this.loaded) await this.load(this.serverCode, this.schemas);
    const id = this.nextId++;
    const timeout = name === "playerLeft" ? PLAYER_LEFT_TIMEOUT_MS : CALL_TIMEOUT_MS;
    const started = performance.now();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.terminate();
        const error = new Error(
          `game.${name} took longer than ${timeout / 1000} s ` +
          "(the platform allows 100 ms per call, 2 s for playerLeft)",
        );
        error.kind = "error";
        reject(error);
      }, timeout);
      const entry = {
        resolve: (value) => {
          this.lastCallDurationMs = Math.round((performance.now() - started) * 10) / 10;
          resolve(value);
        },
        reject: (error) => {
          this.lastCallDurationMs = Math.round((performance.now() - started) * 10) / 10;
          reject(error);
        },
        timer,
      };
      this.pending.set(id, entry);
      this.worker.postMessage({
        type: "call",
        id,
        name,
        args,
        ctx,
        seed: (seed || 0) >>> 0,
        now: now || 0,
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Localization lint: a port of game_platform/game_text.py (lint,
// extract_strings, server_text_problems) plus the applyLocale check from
// game_checks.py. The server-text part is simplified: the platform parses
// every expression the server code can write (game_server_texts.py); this
// page checks the InvalidMove reasons, the form the guide documents, and
// says so. Any display text the server puts in the match state is checked
// only when you submit.
// ---------------------------------------------------------------------------

const I18N_BLOCK_RE =
  /<script\b(?=[^>]*\bid\s*=\s*["']i18n-strings["'])[^>]*>([\s\S]*?)<\/script\s*>/i;
const I18N_KEY_RE = /^[A-Za-z0-9_.\-]{1,64}$/;
const T_CALL_RE = /\bt\(\s*["']([A-Za-z0-9_.\-]+)["']/g;
const T_CALL_TEST_RE = /\bt\(\s*["']([A-Za-z0-9_.\-]+)["']/;
const ASSIGNMENT_RE =
  /(?:\.textContent|\.innerText|\.innerHTML|\.title|\.placeholder|\.alt)\s*\+?=\s*([^;\n]+)/g;
const LITERAL_WITH_WORDS_RE =
  /(["'`])((?:\\.|(?!\1).)*?[A-Za-z]{3,}(?:\\.|(?!\1).)*?)\1/g;
const JOIN_RE = /["'`]\s*\+|\+\s*["'`]/;
const CANVAS_TEXT_RE = /\b(?:fillText|strokeText)\s*\(([^;\n]*)/g;
const ATTRIBUTE_RE =
  /\b(?:aria-label|aria-description|aria-placeholder|placeholder|title|alt)\b\s*=\s*\\?(?:"([^"\\]*)"|'([^'\\]*)')|setAttribute\(\s*["'](?:aria-[a-z]+|placeholder|title|alt)["']\s*,\s*(?:"([^"\\]*)"|'([^'\\]*)')\s*\)/g;
const DIALOG_RE = /\b(?:alert|confirm|prompt|createTextNode)\s*\(([^;\n]*)/g;
const JS_ESCAPE_RE = /\\u\{([0-9A-Fa-f]+)\}|\\u([0-9A-Fa-f]{4})|\\x([0-9A-Fa-f]{2})/g;
const PLACEHOLDER_RE = /\{(\w+)\}/g;
const SERVER_KEY_PREFIX = "server_";

function displayedText(literal) {
  return literal.replace(JS_ESCAPE_RE, (match, braced, four, two) => {
    const digits = braced || four || two;
    try {
      return String.fromCodePoint(parseInt(digits, 16));
    } catch (e) {
      return match;
    }
  });
}

function onlySymbols(literal) {
  return !/[A-Za-z]/.test(displayedText(literal));
}

function withoutStringsBlock(code) {
  return code.replace(I18N_BLOCK_RE, "");
}

function extractStrings(code) {
  const match = I18N_BLOCK_RE.exec(code);
  if (!match) return null;
  let table;
  try {
    table = JSON.parse(match[1]);
  } catch (e) {
    throw new Error(`the i18n-strings block is not valid JSON: ${e.message}`);
  }
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    throw new Error("the i18n-strings block must be a JSON object of key: text");
  }
  const keys = Object.keys(table);
  if (keys.length > 400) {
    throw new Error(`the i18n-strings block has ${keys.length} texts; the most is 400`);
  }
  for (const key of keys) {
    if (!I18N_KEY_RE.test(key)) {
      throw new Error(`the key ${JSON.stringify(key.slice(0, 40))} must be letters, digits, _ . - (at most 64)`);
    }
    if (typeof table[key] !== "string") {
      throw new Error(`the text of ${JSON.stringify(key)} must be a string`);
    }
    if (table[key].length > 1000) {
      throw new Error(`the text of ${JSON.stringify(key)} is ${table[key].length} characters; the most is 1000`);
    }
  }
  return table;
}

function usedKeys(code) {
  const used = new Set();
  for (const match of code.matchAll(T_CALL_RE)) used.add(match[1]);
  return used;
}

function literalsWithWords(value) {
  const found = [];
  for (const match of value.matchAll(LITERAL_WITH_WORDS_RE)) {
    if (!onlySymbols(match[2])) found.push(match[2]);
  }
  return found;
}

// The server_ templates of a string table, most specific first, as in
// game_platform/game_messages.py (compile_templates / match).
function compileTemplates(table) {
  const templates = [];
  for (const [key, text] of Object.entries(table || {})) {
    if (!key.startsWith(SERVER_KEY_PREFIX) || !text) continue;
    const pieces = text.split(PLACEHOLDER_RE);
    const names = [];
    let regex = "";
    let literal = 0;
    pieces.forEach((piece, index) => {
      if (index % 2) {
        names.push(piece);
        regex += "(.+?)";
      } else {
        literal += piece.length;
        regex += piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
    });
    templates.push({
      key,
      text,
      pattern: new RegExp(`^${regex}$`, "s"),
      names,
      literalLength: literal,
    });
  }
  templates.sort(
    (a, b) => b.literalLength - a.literalLength || a.names.length - b.names.length ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  return templates;
}

function matchTemplate(templates, text) {
  for (const template of templates) {
    const found = template.pattern.exec(text);
    if (found) return template;
  }
  return null;
}

// The texts a server writes as InvalidMove reasons, as templates: a string
// literal is its text, a template literal has {name} for each ${...}, and a
// concatenation joins its parts (an identifier or other value becomes
// {name}). This is the simplified form of game_server_texts.extract — the
// platform also checks log lines and labels the server puts in the state.
function extractInvalidMoveTemplates(serverCode) {
  const templates = [];
  const throwRe = /new\s+InvalidMove\s*\(/g;
  for (const match of serverCode.matchAll(throwRe)) {
    const expr = readBalanced(serverCode, match.index + match[0].length - 1);
    if (expr === null) continue;
    const template = expressionTemplate(expr);
    if (template !== null && !templates.includes(template)) templates.push(template);
  }
  return templates;
}

// The text inside the parentheses starting at the "(" at [openIndex], or
// null when the parentheses do not balance.
function readBalanced(src, openIndex) {
  let depth = 0;
  let i = openIndex;
  let quote = null;
  let escaped = false;
  let templateDepth = 0;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openIndex + 1, i);
    }
    i++;
  }
  return null;
}

function splitTopLevel(expr, separator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let escaped = false;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
    } else if (ch === separator && depth === 0) {
      parts.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}

function expressionTemplate(expr) {
  const trimmed = expr.trim();
  const parts = splitTopLevel(trimmed, "+");
  if (parts.length > 1) {
    const rendered = parts.map((part) => expressionTemplate(part));
    if (rendered.some((part) => part === null)) return null;
    return rendered.join("");
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(trimmed.replace(/^'|'$/g, '"'));
    } catch (e) {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1).replace(/\$\{([^}]*)\}/g, (match, inner) => {
      const name = inner.trim();
      return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? `{${name}}` : "{value}";
    });
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) return `{${trimmed}}`;
  return null;
}

function serverTextProblems(table, serverCode) {
  const templates = compileTemplates(table);
  const missing = [];
  for (const found of extractInvalidMoveTemplates(serverCode)) {
    if (matchTemplate(templates, found) === null && !missing.includes(found)) {
      missing.push(found);
    }
  }
  if (!missing.length) return [];
  const shown = missing.slice(0, 3).map((text) => JSON.stringify(text.slice(0, 50))).join(", ");
  const more = missing.length > 3 ? ` (and ${missing.length - 3} more)` : "";
  return [
    `the server writes texts that the strings block has no template for: ${shown}${more}: ` +
    'add each as a "server_..." text (with {placeholders} for the parts that vary, e.g. ' +
    '"server_not_your_turn": "not your turn") so it can be translated',
  ];
}

function lintClientCode(code, serverCode) {
  let table;
  try {
    table = extractStrings(code);
  } catch (e) {
    return [e.message];
  }
  if (table === null) {
    return [
      "the game has no i18n-strings block, so only its name and description can be " +
      "translated: list every text it shows in " +
      '<script type="application/json" id="i18n-strings"> and show them with t()',
    ];
  }
  const warnings = [];
  const used = usedKeys(code);
  for (const key of [...used].sort()) {
    if (!(key in table)) {
      warnings.push(`the code uses t(${JSON.stringify(key)}) but the strings block has no ${JSON.stringify(key)}`);
    }
  }
  for (const key of Object.keys(table).sort()) {
    if (!used.has(key) && !key.startsWith(SERVER_KEY_PREFIX)) {
      warnings.push(`the strings block has ${JSON.stringify(key)}, which the code never shows`);
    }
  }
  const body = withoutStringsBlock(code);
  const hardCoded = [];
  const joined = [];
  for (const match of body.matchAll(ASSIGNMENT_RE)) {
    const value = match[1];
    if (/^\s*t\(/.test(value) && !JOIN_RE.test(value)) continue;
    const displayValue = value.replace(T_CALL_RE, "t(KEY");
    const literals = literalsWithWords(displayValue);
    if ((literals.length || T_CALL_TEST_RE.test(value)) && JOIN_RE.test(value)) {
      joined.push(value.trim().slice(0, 70));
    } else if (literals.length && !/^\s*t\(/.test(value)) {
      hardCoded.push(literals[0].slice(0, 50));
    }
  }
  if (hardCoded.length) {
    const shown = hardCoded.slice(0, 3).map((text) => JSON.stringify(text)).join(", ");
    const more = hardCoded.length > 3 ? ` (and ${hardCoded.length - 3} more)` : "";
    warnings.push(`text written in the code instead of the strings block: ${shown}${more}`);
  }
  if (joined.length) {
    warnings.push(
      `${joined.length} sentence(s) are built by joining pieces (e.g. ${JSON.stringify(joined[0])}): ` +
      "word order differs between languages, so use one string with {placeholders}",
    );
  }
  for (const [key, text] of Object.entries(table)) {
    const pattern = key.startsWith(SERVER_KEY_PREFIX)
      ? /<[A-Za-z/!]|&\w+;/
      : /[<>]|&\w+;/;
    if (pattern.test(text)) {
      warnings.push(`the text of ${JSON.stringify(key)} contains markup; strings are plain text`);
      break;
    }
  }
  const canvas = [];
  for (const match of body.matchAll(CANVAS_TEXT_RE)) {
    const value = match[1];
    if (/^\s*t\(/.test(value) && !JOIN_RE.test(value)) continue;
    if (literalsWithWords(value.replace(T_CALL_RE, "t(KEY")).length) {
      canvas.push(value.trim().slice(0, 50));
    }
  }
  if (canvas.length) {
    warnings.push(
      `the game draws text on a canvas without t() (e.g. ${JSON.stringify(canvas[0])}): ` +
      "draw only t(...) results, one whole string each, and leave room for longer words",
    );
  }
  const attributes = [];
  for (const match of body.matchAll(ATTRIBUTE_RE)) {
    const value = match.slice(1).find((group) => group !== undefined);
    if (
      value !== undefined && /[A-Za-z]{3,}/.test(value) && !onlySymbols(value)
    ) {
      attributes.push(value);
    }
  }
  if (attributes.length) {
    const shown = attributes.slice(0, 3).map((text) => JSON.stringify(text.slice(0, 40))).join(", ");
    const more = attributes.length > 3 ? ` (and ${attributes.length - 3} more)` : "";
    warnings.push(
      `text written in an aria-label, placeholder, title or alt attribute: ${shown}${more}: ` +
      "set these from t() in the code (el.setAttribute('aria-label', t('key')))",
    );
  }
  const shownTexts = [];
  for (const match of body.matchAll(DIALOG_RE)) {
    const value = match[1];
    if (literalsWithWords(value.replace(T_CALL_RE, "t(KEY")).length) {
      shownTexts.push(value.trim().slice(0, 50));
    }
  }
  if (shownTexts.length) {
    warnings.push(
      `text written in alert/confirm/prompt/createTextNode instead of the strings block: ${JSON.stringify(shownTexts[0])}`,
    );
  }
  if (serverCode) warnings.push(...serverTextProblems(table, serverCode));
  return warnings;
}

// ---------------------------------------------------------------------------
// The deterministic verification suite: ports of game_contract.py
// (verify_examples, probe_leaving, probe_move_agreement). Each returns
// failures as plain strings with the reproduction attached; an empty list
// means the check passed.
// ---------------------------------------------------------------------------

async function verifyExamples(host, cases) {
  const results = [];
  for (const testCase of cases) {
    try {
      const ctx = {};
      for (const [key, value] of Object.entries(testCase.ctx || {})) {
        if (key !== "seed") ctx[key] = value;
      }
      const seed = testCase.ctx.seed;
      async function call(fn, ...args) {
        const first = await host.call(fn, args, clone(ctx), seed, 0);
        const randomDraw =
          host.lastCallUsedRandom && (fn === "newMatch" || fn === "applyMove");
        const second = await host.call(fn, args, clone(ctx), seed, 0);
        if (!deepEqual(first.result, second.result)) {
          throw new Error(`${fn} is not deterministic`);
        }
        if (randomDraw) {
          const error = new Error(fn);
          error.randomExample = true;
          throw error;
        }
        return first.result;
      }
      if (testCase.kind === "initial") {
        const opening = await call("newMatch");
        if (!deepEqual(opening.state, testCase.state)) {
          throw new Error("Initial state differs");
        }
      }
      for (const [who, key] of [
        ["player_id", "view_of_mover"],
        ["other_player_id", "view_of_other"],
      ]) {
        const view = await call("viewFor", testCase.state, testCase[who]);
        if (!deepEqual(view, testCase[key])) throw new Error(`${key} differs`);
      }
      if ("expected_error" in testCase) {
        if (testCase.expected_error !== "InvalidMove") {
          throw new Error(`Unknown expected_error ${JSON.stringify(testCase.expected_error)}`);
        }
        for (let i = 0; i < 2; i++) {
          try {
            await host.call(
              "applyMove",
              [testCase.state, testCase.player_id, testCase.move],
              clone(ctx),
              seed,
              0,
            );
          } catch (e) {
            if (e.kind === "invalid_move") continue;
            throw e;
          }
          throw new Error("Expected InvalidMove, but the move was accepted");
        }
        for (const [who, key] of [
          ["player_id", "view_of_mover"],
          ["other_player_id", "view_of_other"],
        ]) {
          const view = await call("viewFor", testCase.state, testCase[who]);
          if (!deepEqual(view, testCase[key])) {
            throw new Error("Rejected move changed the player view");
          }
        }
        results.push({ name: testCase.name, passed: true, expectedError: "InvalidMove" });
        continue;
      }
      let result;
      if (testCase.move === null || deepEqual(testCase.move, { type: "leave" })) {
        if (!host.has("playerLeft")) {
          throw new Error("playerLeft is not implemented, so this leave example cannot be executed");
        }
        result = await call("playerLeft", testCase.state, testCase.player_id);
      } else {
        result = await call("applyMove", testCase.state, testCase.player_id, testCase.move);
      }
      for (const [actual, expected] of [
        ["state", "expected_state"],
        ["turn", "expected_turn"],
      ]) {
        if (!deepEqual(result[actual], testCase[expected])) {
          throw new Error(`${expected} differs`);
        }
      }
      if (
        "expected_payouts" in testCase &&
        !deepEqual(result.payouts, testCase.expected_payouts)
      ) {
        throw new Error("Payouts differ");
      }
      ctx.move_count = (ctx.move_count || 0) + 1;
      for (const [who, key] of [
        ["player_id", "expected_view_of_mover"],
        ["other_player_id", "expected_view_of_other"],
      ]) {
        const view = await call("viewFor", result.state, testCase[who]);
        if (!deepEqual(view, testCase[key])) throw new Error(`${key} differs`);
      }
      results.push({ name: testCase.name, passed: true });
    } catch (e) {
      if (e.randomExample) {
        results.push({
          name: testCase.name,
          passed: true,
          randomOutcome: e.message,
          detail: "Determinism checked; illustrated random outcome skipped",
        });
      } else {
        results.push({ name: testCase.name, passed: false, error: e.message });
      }
    }
  }
  return results;
}

function probePlayer(pid, kind, active) {
  const entry = {
    id: pid,
    kind,
    display_name: pid,
    picture_url: "",
    max_loss: 0,
  };
  if (active !== undefined) entry.active = active;
  return entry;
}

function probeCtx(players, pot, moveCount) {
  return {
    players: players.map((p) => ({ ...p })),
    pot,
    move_count: moveCount || 0,
  };
}

async function probeLeaving(host, inputs) {
  if (!host.has("playerLeft")) return [];
  const failures = [];
  const allowed = inputs.allowedPlayerCounts;
  const allowsLeave = inputs.allowsLeaveMidMatch;

  function paid(result) {
    return Object.values(result.payouts || {}).reduce((a, b) => a + b, 0);
  }

  async function start(players, pot, label) {
    try {
      const result = await host.call("newMatch", [], probeCtx(players, pot), 4242, 0);
      return [result.result.state, result.result.turn];
    } catch (e) {
      failures.push(`${label}: newMatch failed: ${e.message}`);
      return [null, null];
    }
  }

  async function leave(state, who, players, pot, label, moveCount) {
    try {
      const result = await host.call(
        "playerLeft",
        [state, who],
        probeCtx(players, pot, moveCount),
        4243,
        0,
      );
      return result.result;
    } catch (e) {
      failures.push(`${label}: playerLeft raised: ${e.message}`);
      return null;
    }
  }

  async function advance(state, turn, players, pot) {
    const generator = host.has("randomMove")
      ? "randomMove"
      : host.has("computerMove")
        ? "computerMove"
        : null;
    if (!generator || !turn) return null;
    let currentState = state;
    let currentTurn = turn;
    for (let step = 0; step < 5; step++) {
      if (!currentTurn) return null;
      const mover = currentTurn[0];
      const ctx = probeCtx(players, pot, step);
      try {
        const move = await host.call(generator, [currentState, mover], clone(ctx), 5000 + step, 0);
        const following = await host.call(
          "applyMove",
          [currentState, mover, move.result],
          clone(ctx),
          5000 + step,
          0,
        );
        currentState = following.result.state;
        currentTurn = following.result.turn;
      } catch (e) {
        return null;
      }
    }
    return currentTurn ? [currentState, currentTurn] : null;
  }

  function expectNoop(label, result, state, turn) {
    if (result === null) return;
    if (!deepEqual(result.state, state)) {
      failures.push(`${label}: the leave changed the state; it must change nothing`);
    }
    if (!deepEqual(result.turn, turn)) {
      failures.push(`${label}: the leave changed the turn; it must change nothing`);
    }
    if (paid(result) !== 0) {
      failures.push(`${label}: the leave paid out tokens; it must pay nothing`);
    }
  }

  const twoHumans = [probePlayer("human-1", "human"), probePlayer("human-2", "human")];

  // The platform rejects leave requests from callers without a seat before
  // invoking game code, so these IDs are invalid playerLeft inputs.
  {
    const [state, turn] = await start(twoHumans, 10, "non-seat leave");
    if (state !== null) {
      try {
        await host.call(
          "playerLeft",
          [state, "spectator-1"],
          probeCtx(twoHumans, 10),
          4243,
          0,
        );
        failures.push("non-seat leave: playerLeft accepted a caller without a seat");
      } catch (e) {
        if (!String(e.message).includes("playerId is not in ctx.players")) {
          failures.push(`non-seat leave: unexpected rejection: ${e.message}`);
        }
      }
      const mid = await advance(state, turn, twoHumans, 10);
      if (mid !== null) {
        try {
          await host.call(
            "playerLeft",
            [mid[0], "spectator-1"],
            probeCtx(twoHumans, 10, 5),
            4243,
            0,
          );
          failures.push("non-seat leave (mid-game): playerLeft accepted a caller without a seat");
        } catch (e) {
          if (!String(e.message).includes("playerId is not in ctx.players")) {
            failures.push(`non-seat leave (mid-game): unexpected rejection: ${e.message}`);
          }
        }
      }
    }
  }

  async function forfeit(players, pot, leaver, label) {
    const [state, turn] = await start(players, pot, label);
    if (state === null) return;
    const result = await leave(state, leaver, players, pot, label);
    if (result === null) return;
    if (result.turn !== null) {
      failures.push(
        `${label}: the match must end when fewer than two active humans remain, but playerLeft returned a turn`,
      );
      return;
    }
    if (paid(result) !== pot) {
      failures.push(`${label}: final payouts add up to ${paid(result)}, not the pot of ${pot}`);
      return;
    }
    const after = players.map((p) =>
      p.id === leaver ? { ...p, active: false } : { ...p },
    );
    const recorded = result.payouts || {};
    const stillActive = new Set(
      after.filter((p) => p.kind === "human" && p.active !== false).map((p) => p.id),
    );
    for (const other of players) {
      if (other.id === leaver) continue;
      const again = await leave(result.state, other.id, after, pot, `${label} (after the end)`);
      if (again === null) continue;
      if (again.turn !== null || !deepEqual(again.state, result.state)) {
        failures.push(
          `${label}: a leave after the match ended must return the recorded state unchanged and a null turn; settlement is computed once and never recomputed`,
        );
      } else if (Object.keys(recorded).every((id) => stillActive.has(id))) {
        if (!deepEqual(again.payouts, recorded)) {
          failures.push(
            `${label}: a leave after the match ended must return the recorded payouts identically; settlement is computed once and never recomputed`,
          );
        }
      } else {
        const reported = again.payouts || {};
        for (const [pid, amount] of Object.entries(recorded)) {
          if (stillActive.has(pid) && (reported[pid] || 0) < amount) {
            failures.push(
              `${label}: a leave after the match ended reduced the recorded payout of still-active ${pid}; recorded amounts for still-active players never decrease`,
            );
            break;
          }
        }
      }
    }
  }

  await forfeit(twoHumans, 10, "human-1", "two-human forfeit");

  const mixed = [probePlayer("human-1", "human"), probePlayer("computer-1", "computer")];
  if (host.has("computerMove") || host.has("randomMove")) {
    const [state, turn] = await start(mixed, 25, "human-vs-computer forfeit");
    if (state !== null) {
      const result = await leave(state, "human-1", mixed, 25, "human-vs-computer forfeit");
      if (result !== null) {
        if (result.turn !== null) {
          failures.push(
            "human-vs-computer forfeit: the match must end when the only human leaves, but playerLeft returned a turn",
          );
        } else if (!deepEqual(result.payouts, { "human-1": 25 })) {
          failures.push(
            `human-vs-computer forfeit: payouts must be exactly {'human-1': 25} (the computer seat is never payable and the departing human is still active), got ${JSON.stringify(result.payouts)}`,
          );
        }
      }
    }
  }

  if (allowed.includes(1)) {
    await forfeit([probePlayer("human-1", "human")], 10, "human-1", "solo leave");
  }

  if (allowsLeave && allowed.some((count) => count >= 3)) {
    const trio = [1, 2, 3].map((n) => probePlayer(`human-${n}`, "human"));
    const [state, turn] = await start(trio, 30, "continuing leave");
    if (state !== null) {
      const result = await leave(state, "human-1", trio, 30, "continuing leave");
      if (result !== null) {
        if (result.turn === null) {
          failures.push(
            "continuing leave: the match ended although two active humans remain and the game allows leaving mid-match",
          );
        } else if (result.turn.includes("human-1")) {
          failures.push("continuing leave: the returned turn still contains the departing player");
        } else {
          const after = trio.map((p) =>
            p.id === "human-1" ? { ...p, active: false } : { ...p },
          );
          expectNoop(
            "duplicate leave",
            await leave(result.state, "human-1", after, 30, "duplicate leave"),
            result.state,
            result.turn,
          );
        }
      }
    }
  }
  return failures;
}

async function probeMoveAgreement(host, inputs) {
  if (!host.has("randomMove") && !host.has("computerMove")) return [];
  const failures = [];
  const cases = inputs.cases;
  const difficultyField =
    (((inputs.schemas.state || {}).properties || {}).difficulty) || null;
  const declared =
    difficultyField && Array.isArray(difficultyField.enum)
      ? difficultyField.enum
      : null;
  const difficultyLevels =
    declared && declared.length && declared.every((level) => typeof level === "string")
      ? declared
      : ["easy", "medium", "hard"];

  async function accepted(state, mover, move, ctx, seed) {
    try {
      await host.call("applyMove", [state, mover, move], clone(ctx), seed, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function sampleState(state, mover, ctx, label) {
    if (host.has("randomMove")) {
      const distinct = [];
      for (let i = 0; i < 24; i++) {
        let move;
        try {
          move = await host.call("randomMove", [state, mover], clone(ctx), 7300 + i, 0);
        } catch (e) {
          failures.push(`${label}: randomMove failed on an approved position: ${e.message}`);
          break;
        }
        if (move.result === null || move.result === undefined) {
          failures.push(`${label}: randomMove returned no move on a live approved position`);
          break;
        }
        if (!distinct.some((other) => deepEqual(move.result, other))) {
          distinct.push(move.result);
        }
      }
      for (const move of distinct) {
        if (!(await accepted(state, mover, move, ctx, 7400))) {
          failures.push(
            `${label}: randomMove returned a move applyMove rejects: ${JSON.stringify(move)} — the move generator and the validator disagree about legality`,
          );
        }
      }
      try {
        const first = await host.call("randomMove", [state, mover], clone(ctx), 7399, 0);
        const second = await host.call("randomMove", [state, mover], clone(ctx), 7399, 0);
        if (!deepEqual(first.result, second.result)) {
          failures.push(
            `${label}: randomMove is not deterministic for a fixed seed (it must draw only from ctx.random)`,
          );
        }
      } catch (e) {
        // A generator that fails on a re-run is reported by the walks.
      }
    }
    if (host.has("computerMove")) {
      const variants = [[state, label]];
      if (state && typeof state === "object" && "difficulty" in state) {
        for (const level of difficultyLevels) {
          if (level === state.difficulty) continue;
          variants.push([
            { ...state, difficulty: level },
            `${label} (difficulty ${level})`,
          ]);
        }
      }
      for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
        const [variant, variantLabel] = variants[variantIndex];
        let move;
        let again;
        try {
          move = await host.call("computerMove", [variant, mover], clone(ctx), 7500, 0);
          again = await host.call("computerMove", [variant, mover], clone(ctx), 7500, 0);
        } catch (e) {
          if (variantIndex && String(e.message).includes("state_schema")) continue;
          failures.push(
            `${variantLabel}: computerMove raised instead of returning a legal move: ${e.message}`,
          );
          continue;
        }
        if (!deepEqual(move.result, again.result)) {
          failures.push(
            `${variantLabel}: computerMove is not deterministic for a fixed seed (it must draw only from ctx.random)`,
          );
        }
        if (move.result === null || move.result === undefined) {
          failures.push(`${variantLabel}: computerMove returned no move on a live approved position`);
        } else if (!(await accepted(variant, mover, move.result, ctx, 7500))) {
          failures.push(
            `${variantLabel}: computerMove returned a move applyMove rejects: ${JSON.stringify(move.result)}`,
          );
        }
      }
    }
  }

  const seen = [];
  for (const testCase of cases) {
    if (failures.length >= 6) break;
    if ("expected_error" in testCase) continue;
    const state = testCase.state;
    if (seen.some((other) => deepEqual(state, other))) continue;
    seen.push(state);
    const ctx = {};
    for (const [key, value] of Object.entries(testCase.ctx || {})) {
      if (key !== "seed") ctx[key] = value;
    }
    await sampleState(state, testCase.player_id, ctx, `example '${testCase.name}'`);
  }

  if (cases.length && failures.length < 6) {
    const generator = host.has("randomMove") ? "randomMove" : "computerMove";
    const ctx = {};
    for (const [key, value] of Object.entries(cases[0].ctx || {})) {
      if (key !== "seed") ctx[key] = value;
    }
    let state = null;
    let turn = null;
    try {
      const opening = await host.call("newMatch", [], clone(ctx), 4242, 0);
      state = opening.result.state;
      turn = opening.result.turn;
    } catch (e) {
      state = null;
      turn = null;
    }
    let plies = 0;
    while (state !== null && turn && plies < 24) {
      const mover = turn[0];
      let move = null;
      for (let seed = 7600; seed < 7608; seed++) {
        let candidate = null;
        try {
          const got = await host.call(generator, [state, mover], clone(ctx), seed, 0);
          candidate = got.result;
        } catch (e) {
          candidate = null;
        }
        if (candidate === null || candidate === undefined) continue;
        if (await accepted(state, mover, candidate, ctx, seed)) {
          move = candidate;
          break;
        }
        failures.push(
          `played-out position (ply ${plies}): ${generator} returned a move applyMove rejects: ${JSON.stringify(candidate)} — the move generator and the validator disagree about legality`,
        );
        break;
      }
      if (move === null) break;
      try {
        const result = await host.call(
          "applyMove",
          [state, mover, move],
          clone(ctx),
          7700 + plies,
          0,
        );
        state = result.result.state;
        turn = result.result.turn;
      } catch (e) {
        break;
      }
      ctx.move_count = (ctx.move_count || 0) + 1;
      plies++;
    }
    if (state !== null && turn && plies >= 4 && failures.length < 6) {
      await sampleState(state, turn[0], ctx, `played-out position after ${plies} moves`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Random walks: a port of game_testing.py (test_server_code and _Walk).
// A walk plays a whole match with the game's own move generators, from a
// fresh seed. The seeds are this page's own draws — the server runs its own
// walks at submit time — so a failure's seed replays the walk here, not
// there. The platform's per-call limits (100 ms, 64 MiB) are not enforced:
// the host's 5 s watchdog stands in for them and memory is not measured.
// ---------------------------------------------------------------------------

const FUZZ_MOVES = [null, true, 0, "move", [], {}, { __fuzz__: [1, 2, 3] }];
const EVENT_CHANCE = 0.02;
const MAX_FAILURES = 10;
const STAKES = [0, 1, 10, 25, 100];

class Walk {
  constructor(host, rules, seed, deadlineMs) {
    this.host = host;
    this.rules = rules;
    this.seed = seed >>> 0;
    this.deadlineMs = deadlineMs;
    this.rng = mulberry32(this.seed);
    this.failures = [];
    this.moveCount = 0;
    this.callNumber = 0;
    this.lastMoves = [];
    this.nextHuman = 1;
    this.nextComputer = 1;
    const count = this.choice(rules.allowedPlayerCounts);
    const solo = this.rng() < 0.5;
    this.players = [];
    for (let i = 0; i < count; i++) {
      this.players.push(this.randomPlayer(solo && i > 0));
    }
    this.playerCount = this.players.length;
    this.pot = this.players.reduce((sum, p) => sum + p.max_loss, 0);
  }

  choice(list) {
    return list[Math.floor(this.rng() * list.length)];
  }

  randomPlayer(computer) {
    if (computer) {
      const n = this.nextComputer++;
      return {
        id: `computer-${n}`,
        kind: "computer",
        display_name: `Computer ${n}`,
        picture_url: "",
        max_loss: 0,
      };
    }
    const n = this.nextHuman++;
    return {
      id: `human-${n}`,
      kind: "human",
      display_name: `Human ${n}`,
      picture_url: "",
      max_loss: this.choice(STAKES),
    };
  }

  ctx() {
    return {
      players: this.players.map((p) => ({ ...p })),
      pot: this.pot,
      move_count: this.moveCount,
    };
  }

  async call(fn, ...args) {
    const seed = (this.seed + this.callNumber) % 4294967296;
    this.callNumber++;
    const { result } = await this.host.call(fn, args, this.ctx(), seed, 0);
    return result;
  }

  fail(fn, message, options) {
    const opts = options || {};
    this.failures.push({
      function: fn,
      message,
      seed: this.seed,
      playerCount: this.playerCount,
      moveNumber: this.moveCount,
      state: opts.state,
      playerId: opts.playerId,
      move: opts.move,
      lastMoves: this.lastMoves.slice(-5),
      ctx: opts.ctx || this.ctx(),
      arguments: opts.args,
      result: opts.result !== undefined ? opts.result : this.host.lastCallResult,
      durationMs: this.host.lastCallDurationMs,
    });
  }

  async callOrFail(fn, ...args) {
    const opts = args.length && typeof args[args.length - 1] === "object" &&
      args[args.length - 1] !== null && "_failOpts" in args[args.length - 1]
      ? args.pop()
      : {};
    try {
      const result = await this.call(fn, ...args);
      return [true, result];
    } catch (e) {
      this.fail(fn, e.message, { ...opts, args: [...args] });
      return [false, null];
    }
  }

  async checkViews(state) {
    const ids = [...this.players.map((p) => p.id), null];
    for (const playerId of ids) {
      const [ok, result] = await this.callOrFail("viewFor", state, playerId, {
        _failOpts: true,
        state,
        playerId,
      });
      if (!ok) return false;
      if (
        !(await this.checkDeterministic("viewFor", result, state, playerId, { _failOpts: true, state }))
      ) {
        return false;
      }
    }
    return true;
  }

  async checkDeterministic(fn, result, ...args) {
    const opts = args.length && typeof args[args.length - 1] === "object" &&
      args[args.length - 1] !== null && "_failOpts" in args[args.length - 1]
      ? args.pop()
      : {};
    this.callNumber -= 1; // the re-run reuses the original call's seed
    let again;
    try {
      again = await this.call(fn, ...args);
    } catch (e) {
      this.fail(
        fn,
        `non-deterministic: the first call succeeded but the identical re-run failed: ${e.message}`,
        { ...opts, args: [...args], result },
      );
      return false;
    }
    if (!deepEqual(again, result)) {
      this.fail(
        fn,
        "non-deterministic: two identical calls returned different results",
        { ...opts, args: [...args], result },
      );
      return false;
    }
    return true;
  }

  async run(maxMoves) {
    const [ok, result] = await this.callOrFail("newMatch");
    if (!ok) return true;
    if (!(await this.checkDeterministic("newMatch", result))) return true;
    let state = result.state;
    let turn = result.turn;
    if (!(await this.checkViews(state))) return true;
    let steps = 0;
    while (turn !== null) {
      if (steps >= maxMoves) break;
      if (Date.now() >= this.deadlineMs) return false;
      steps++;
      const event = await this.maybeEvent(state);
      if (event !== null) {
        const [failed, newState, newTurn] = event;
        if (failed || !this.players.length) return true;
        state = newState;
        turn = newTurn;
        continue;
      }
      const [stepOk, newState, newTurn] = await this.step(state, turn);
      if (!stepOk) return true;
      state = newState;
      turn = newTurn;
    }
    return true;
  }

  async maybeEvent(state) {
    if (this.rng() >= EVENT_CHANCE || this.players.length < 2) return null;
    const humans = this.players.filter(
      (p) => p.kind === "human" && p.active !== false,
    );
    if (
      this.rules.allowsLeaveMidMatch && humans.length && this.host.has("playerLeft")
    ) {
      return this.leave(state);
    }
    if (
      this.rules.allowsJoinMidMatch &&
      !this.players.some((p) => p.kind === "computer") &&
      this.players.length < Math.max(...this.rules.allowedPlayerCounts) &&
      this.host.has("playerJoined")
    ) {
      return this.join(state);
    }
    return null;
  }

  async leave(state) {
    const humans = this.players.filter(
      (p) => p.kind === "human" && p.active !== false,
    );
    const leaver = this.choice(humans);
    const [ok, result] = await this.callOrFail("playerLeft", state, leaver.id, {
      _failOpts: true,
      state,
      playerId: leaver.id,
    });
    if (!ok) return [true, state, null];
    this.callNumber -= 1;
    const [againOk, again] = await this.callOrFail("playerLeft", state, leaver.id, {
      _failOpts: true,
      state,
      playerId: leaver.id,
    });
    if (!againOk || !deepEqual(again, result)) {
      if (againOk) {
        this.fail("playerLeft", "non-deterministic leave result", {
          state,
          playerId: leaver.id,
          args: [state, leaver.id],
          result,
        });
      }
      return [true, state, null];
    }
    this.pot -= Object.values(result.payouts || {}).reduce((a, b) => a + b, 0);
    leaver.active = false;
    this.moveCount++;
    this.lastMoves.push({ player_id: leaver.id, move: { type: "player_left" } });
    const newState = result.state;
    const newTurn = result.turn;
    if (!(await this.checkViews(newState))) return [true, state, null];
    return [false, newState, newTurn];
  }

  async join(state) {
    const joiner = this.randomPlayer(false);
    this.players.push(joiner);
    const [ok, result] = await this.callOrFail("playerJoined", state, joiner.id, {
      _failOpts: true,
      state,
      playerId: joiner.id,
    });
    if (!ok) {
      this.players.pop();
      return [true, state, null];
    }
    if (
      !(await this.checkDeterministic("playerJoined", result, state, joiner.id, { _failOpts: true, state }))
    ) {
      this.players.pop();
      return [true, state, null];
    }
    this.pot += joiner.max_loss;
    const newState = result.state;
    const newTurn = result.turn;
    if (!(await this.checkViews(newState))) return [true, state, null];
    return [false, newState, newTurn];
  }

  async step(state, turn) {
    const mover = this.choice(turn);
    if (!(await this.fuzz(state, mover))) return [false, state, turn];
    let source = this.rng() < 0.5 ? "computerMove" : "randomMove";
    if (!this.host.has(source)) {
      const other = source === "computerMove" ? "randomMove" : "computerMove";
      if (this.host.has(other)) {
        source = other;
      } else {
        this.fail(
          "computerMove",
          "the game defines neither computerMove nor randomMove, so its matches cannot be play-tested",
          { state, playerId: mover },
        );
        return [false, state, turn];
      }
    }
    const [ok, move] = await this.callOrFail(source, state, mover, {
      _failOpts: true,
      state,
      playerId: mover,
    });
    if (!ok) return [false, state, turn];
    if (
      !(await this.checkDeterministic(source, move, state, mover, { _failOpts: true, state }))
    ) {
      return [false, state, turn];
    }
    let result;
    try {
      result = await this.call("applyMove", state, mover, move);
    } catch (e) {
      if (e.kind === "invalid_move") {
        this.fail(
          "applyMove",
          `the game's own ${source} move was rejected: ${e.message}`,
          { state, playerId: mover, move, args: [state, mover, move] },
        );
      } else {
        this.fail("applyMove", e.message, {
          state,
          playerId: mover,
          move,
          args: [state, mover, move],
        });
      }
      return [false, state, turn];
    }
    if (
      !(await this.checkDeterministic("applyMove", result, state, mover, move, { _failOpts: true, state }))
    ) {
      return [false, state, turn];
    }
    this.pot -= Object.values(result.payouts || {}).reduce((a, b) => a + b, 0);
    this.moveCount++;
    this.lastMoves.push({ player_id: mover, move });
    const newState = result.state;
    const newTurn = result.turn;
    if (!(await this.checkViews(newState))) return [false, state, turn];
    return [true, newState, newTurn];
  }

  async fuzz(state, mover) {
    const shuffled = [...FUZZ_MOVES];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (const move of shuffled.slice(0, 2)) {
      try {
        await this.call("applyMove", state, mover, move);
      } catch (e) {
        if (e.kind === "invalid_move") continue;
        this.fail(
          "applyMove",
          `a malformed move crashed the game instead of being rejected with InvalidMove: ${e.message}`,
          { state, playerId: mover, move, args: [state, mover, move] },
        );
        return false;
      }
    }
    return true;
  }
}

function formatFailure(failure) {
  const lines = [`${failure.function}: ${failure.message}`];
  lines.push(
    `  seed ${failure.seed} (replay this walk on this page with this seed; the server runs its own walks at submit), ` +
    `${failure.playerCount} players, move ${failure.moveNumber}`,
  );
  if (failure.ctx) lines.push(`  ctx: ${JSON.stringify(failure.ctx)}`);
  if (failure.arguments) lines.push(`  arguments: ${JSON.stringify(failure.arguments)}`);
  if (failure.result !== undefined) lines.push(`  result: ${JSON.stringify(failure.result)}`);
  if (failure.durationMs !== undefined) {
    lines.push(
      `  took ${failure.durationMs} ms (the platform allows 100 ms per call; this page does not measure memory)`,
    );
  }
  if (failure.lastMoves && failure.lastMoves.length) {
    lines.push(`  last moves: ${JSON.stringify(failure.lastMoves)}`);
  }
  return lines.join("\n");
}

async function testServerCode(host, inputs, onProgress) {
  const rules = inputs.rules;
  const budgetMs = 9000;
  const maxWalks = 1000;
  const deadlineMs = Date.now() + budgetMs;
  const rng = mulberry32((Math.random() * 4294967296) >>> 0);
  const failures = [];
  const seen = new Set();
  const failedSeeds = [];
  let walksCompleted = 0;
  let movesMade = 0;
  while (walksCompleted < maxWalks && Date.now() < deadlineMs) {
    const seed = (rng() * 4294967296) >>> 0;
    const walk = new Walk(host, rules, seed, deadlineMs);
    const completed = await walk.run(1000);
    if (completed) walksCompleted++;
    movesMade += walk.moveCount;
    for (const failure of walk.failures) {
      const key = `${failure.function}:${failure.message}`;
      if (!seen.has(key) && failures.length < MAX_FAILURES) {
        seen.add(key);
        failures.push(failure);
      }
    }
    if (walk.failures.length && !failedSeeds.includes(seed)) failedSeeds.push(seed);
    if (onProgress) onProgress({ walks: walksCompleted, moves: movesMade });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const tooSlow = walksCompleted === 0;
  if (tooSlow && failures.length === 0) {
    failures.push({
      function: "test",
      message: `too slow: no random walk finished within the ${budgetMs / 1000}-second test budget`,
      seed: 0,
      playerCount: 0,
      moveNumber: 0,
    });
  }
  return {
    passed: failures.length === 0 && !tooSlow,
    walksCompleted,
    movesMade,
    tooSlow,
    failures,
    failedSeeds,
  };
}

// ---------------------------------------------------------------------------
// Reading the inputs and running the five checks, in the platform's order.
// ---------------------------------------------------------------------------

function readInputs() {
  const errors = [];
  const serverCode = $("server-code").value;
  const clientCode = $("client-code").value;
  if (!serverCode.trim()) errors.push("paste the server code");
  if (!clientCode.trim()) errors.push("paste the client code");
  const schemas = {};
  for (const [key, id] of [
    ["state", "schema-state"],
    ["view", "schema-view"],
    ["move", "schema-move"],
  ]) {
    const text = $(id).value.trim();
    if (!text) {
      errors.push(`paste the ${key} schema`);
      continue;
    }
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("a schema must be a JSON object");
      }
      schemas[key] = parsed;
    } catch (e) {
      errors.push(`the ${key} schema is not valid JSON: ${e.message}`);
    }
  }
  let cases = null;
  const casesText = $("cases").value.trim();
  if (casesText) {
    try {
      const parsed = JSON.parse(casesText);
      const list = Array.isArray(parsed) ? parsed : parsed.cases;
      if (!Array.isArray(list)) {
        throw new Error("paste a JSON array of cases, or a unit_tests object with a cases field");
      }
      cases = list;
    } catch (e) {
      errors.push(`the unit test cases are not valid JSON: ${e.message}`);
    }
  }
  const allowedText = $("allowed-player-counts").value.trim();
  const allowedPlayerCounts = [
    ...new Set(
      allowedText
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((s) => Number(s)),
    ),
  ].filter((n) => Number.isInteger(n) && n >= 1 && n <= 10);
  if (!allowedPlayerCounts.length) {
    errors.push("allowed player counts must be integers 1-10, e.g. 2 or 1,2,4");
  }
  if (cases) {
    if (cases.length < 3 || cases.length > 10) {
      errors.push(`unit tests have ${cases.length} cases; the platform wants 3-10`);
    }
    cases.forEach((testCase, index) => {
      if (!testCase || typeof testCase !== "object") {
        errors.push(`case ${index + 1} is not an object`);
        return;
      }
      const players = (testCase.ctx && testCase.ctx.players) || [];
      if (!allowedPlayerCounts.includes(players.length)) {
        errors.push(
          `case ${index + 1} (${testCase.name || "unnamed"}) has ${players.length} players, ` +
          `which is not in allowed player counts ${allowedPlayerCounts.join(", ")}`,
        );
      }
      if (!testCase.ctx || !Number.isInteger(testCase.ctx.seed)) {
        errors.push(`case ${index + 1} (${testCase.name || "unnamed"}) needs an integer ctx.seed`);
      }
    });
  }
  const allowsLeaveMidMatch = $("allows-leave").checked;
  const allowsJoinMidMatch = $("allows-join").checked;
  return {
    inputs: {
      serverCode,
      clientCode,
      schemas,
      cases,
      allowedPlayerCounts,
      allowsLeaveMidMatch,
      allowsJoinMidMatch,
      rules: { allowedPlayerCounts, allowsLeaveMidMatch, allowsJoinMidMatch },
    },
    errors,
  };
}

function fieldValue(id) {
  const el = $(id);
  return el ? el.value : "";
}

// Assemble the exact POST /games payload from every input field. This is
// what step 1 of the test flow submits to the server, and what the author
// later POSTs to /games unchanged — any difference restarts the run.
function buildImportBody() {
  const { inputs, errors } = readInputs();
  const jsonField = (id, label, fallback) => {
    const text = fieldValue(id).trim();
    if (!text) return fallback;
    try {
      return JSON.parse(text);
    } catch (e) {
      errors.push(`the ${label} is not valid JSON: ${e.message}`);
      return fallback;
    }
  };
  const images = jsonField("images-json", "images", []);
  if (!Array.isArray(images)) errors.push("the images must be a JSON array");
  const translations = jsonField("translations-json", "translations", {});
  if (typeof translations !== "object" || translations === null || Array.isArray(translations)) {
    errors.push("the translations must be a JSON object keyed by locale");
  }
  const name = fieldValue("game-name").trim();
  if (!name) errors.push("give the game a name");
  const description = fieldValue("description").trim();
  if (!description) errors.push("write a short description");
  const rulesText = fieldValue("rules-text").trim();
  if (!rulesText) errors.push("write the rules text");
  const uiText = fieldValue("ui-text").trim();
  if (!uiText) errors.push("write the UI instructions");
  const secret = fieldValue("game-secret").trim();
  if (secret.length < 16 || secret.length > 200) {
    errors.push("the secret string must be 16–200 characters");
  }
  const body = {
    name,
    description,
    allowed_player_counts: inputs.allowedPlayerCounts,
    client_code: inputs.clientCode,
    server_code: inputs.serverCode,
    rules: rulesText,
    ui_instructions: uiText,
    tutorial: {
      text: fieldValue("tutorial-text"),
      html: fieldValue("tutorial-html"),
    },
    images,
    unit_tests: {
      state_schema: inputs.schemas.state || {},
      view_schema: inputs.schemas.view || {},
      move_schema: inputs.schemas.move || {},
      cases: inputs.cases || [],
    },
    translations,
    game_addition_request_id_and_secret: secret,
    language: fieldValue("language") || "en",
    allows_leave_mid_match: inputs.allowsLeaveMidMatch,
    allows_join_mid_match: inputs.allowsJoinMidMatch,
  };
  return { body, errors };
}

async function runChecks(inputs, onProgress, createHost) {
  const results = [];
  const push = (name, status, details) => {
    const result = { name, status, details };
    results.push(result);
    if (onProgress) onProgress(result);
    return result;
  };
  const host = (createHost || (() => new ServerHost()))();
  let loadError = null;
  try {
    await host.load(inputs.serverCode, inputs.schemas);
  } catch (e) {
    loadError = e;
  }
  const lint = lintClientCode(inputs.clientCode, inputs.serverCode);
  if (!inputs.clientCode.includes("applyLocale(")) {
    lint.push("Missing applyLocale(message) integration");
  }
  push(
    "localization",
    lint.length ? "failed" : "passed",
    lint.length ? lint : ["the client code passes the translation lint"],
  );
  if (!inputs.cases) {
    push("approved_examples", "skipped", ["paste unit test cases to run this check"]);
  } else if (loadError) {
    push("approved_examples", "failed", [`the server code does not load: ${loadError.message}`]);
  } else {
    const items = await verifyExamples(host, inputs.cases);
    const failed = items.filter((i) => !i.passed);
    const skipped = items.filter((i) => i.randomOutcome);
    const details = [
      `${items.length} cases, ${failed.length} failed` +
      (skipped.length ? `, ${skipped.length} skipped (random outcome)` : ""),
    ];
    for (const item of failed) details.push(`${item.name}: ${item.error}`);
    for (const item of skipped) details.push(`${item.name}: ${item.detail}`);
    push("approved_examples", failed.length ? "failed" : "passed", details);
  }
  if (loadError) {
    push("settlement_probes", "failed", [`the server code does not load: ${loadError.message}`]);
  } else {
    let failures;
    try {
      failures = await probeLeaving(host, inputs);
    } catch (e) {
      failures = [`settlement probes could not run: ${e.message}`];
    }
    push(
      "settlement_probes",
      failures.length ? "failed" : "passed",
      failures.length
        ? failures
        : ["all leaving scenarios behave as the platform contract requires"],
    );
  }
  if (!inputs.cases) {
    push("move_agreement", "skipped", ["paste unit test cases to run this check"]);
  } else if (loadError) {
    push("move_agreement", "failed", [`the server code does not load: ${loadError.message}`]);
  } else {
    let failures;
    try {
      failures = await probeMoveAgreement(host, inputs);
    } catch (e) {
      failures = [`move agreement probes could not run: ${e.message}`];
    }
    push(
      "move_agreement",
      failures.length ? "failed" : "passed",
      failures.length
        ? failures
        : ["every move the generators return is accepted by applyMove"],
    );
  }
  if (loadError) {
    push("random_walks", "failed", [`the server code does not load: ${loadError.message}`]);
  } else {
    const report = await testServerCode(host, inputs, onProgress);
    const details = [
      `${report.walksCompleted} walks, ${report.movesMade} moves` +
      (report.tooSlow ? ", too slow" : ""),
    ];
    for (const failure of report.failures) details.push(formatFailure(failure));
    push("random_walks", report.passed ? "passed" : "failed", details);
  }
  host.terminate();
  return results;
}

// ---------------------------------------------------------------------------
// The player: a local emulator. It keeps the match (roster, state, turn,
// move count, history) and drives the client iframe with state_changed
// messages, the way the portal does. The author may see the full state —
// the way the old builder emulator did — while the client's view is its
// viewFor view for the seat it is acting as.
// ---------------------------------------------------------------------------

const RESOLUTIONS = [
  { label: "iPhone 16 Pro Max (phone)", width: 430, height: 932 },
  { label: "Samsung Galaxy S25 Ultra (phone)", width: 412, height: 915 },
  { label: "iPad Air 11-inch (tablet)", width: 820, height: 1180 },
  { label: "Samsung Galaxy Tab S10 (tablet)", width: 800, height: 1280 },
  { label: "MacBook Air 13-inch (laptop)", width: 1440, height: 900 },
];

// fitGameViewport is copied from common.js: it runs inside the game iframe
// and reports the game's natural size to the parent, which scales it down
// when it does not fit the chosen resolution.
function fitGameViewport() {
  const root = document.documentElement;
  let scheduled = false;
  let previous = "";
  function fit() {
    scheduled = false;
    if (!document.body || !innerWidth || !innerHeight) return;
    const body = document.body, rect = body.getBoundingClientRect(), style = getComputedStyle(body);
    const width = Math.ceil(Math.max(rect.right, body.scrollWidth + rect.left) + (parseFloat(style.marginRight) || 0));
    const height = Math.ceil(Math.max(rect.bottom, body.scrollHeight + rect.top) + (parseFloat(style.marginBottom) || 0));
    const key = [width, height, innerWidth, innerHeight].join(",");
    if (key === previous) return;
    previous = key;
    parent.postMessage({type:"game_viewport", width, height, viewport_width:innerWidth, viewport_height:innerHeight}, "*");
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(fit); }
  }
  addEventListener("resize", schedule);
  addEventListener("load", schedule, true); // late images and fonts can change the board size
  new MutationObserver(schedule).observe(root, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:["style","class","width","height","hidden"]});
  new ResizeObserver(schedule).observe(document.body);
  document.fonts?.ready.then(schedule);
  schedule();
}

const Player = {
  host: null,
  inputs: null,
  strings: null,
  match: null,
  frame: null,
  frameReady: null,
  frames: [],
  multiFrame: false,
  messageSeat: null,
  autoPlaying: false,

  mode() {
    return $("mode").value;
  },

  playerCount() {
    return Number($("player-count").value) || 2;
  },

  // The seat the author is viewing as, or null for a viewer. In
  // pass-and-play this is the seat whose turn it is.
  actingSeat() {
    if (this.mode() === "single-pass") {
      if (!this.match || !this.match.turn) return 0;
      return this.seatIndexOf(this.match.turn[0]);
    }
    const value = $("my-seat").value;
    return value === "viewer" ? null : Number(value);
  },

  seatIndexOf(playerId) {
    return this.match.players.findIndex((p) => p.id === playerId);
  },

  // Single-player modes (pass-and-play and against the computer) share
  // one screen, which can act for only one seat at a time: a result whose
  // turn names more than one player is a validation failure there, not a
  // playable position. Returns true when the turn is allowed in the
  // current mode (any non-empty turn is allowed in multiplayer, where
  // every seat has its own screen). A failing result is discarded by the
  // caller, and a recorded flow run fails outright.
  checkSingleTurn(fn, result) {
    if (this.multiFrame || !result || !Array.isArray(result.turn)) return true;
    const mode = this.mode();
    if (mode !== "single-pass" && mode !== "single-computers") return true;
    if (result.turn.length <= 1) return true;
    const message =
      `${fn} returned a turn with ${result.turn.length} players; in the ` +
      "single-player modes (pass-and-play and against the computer) a turn " +
      "must name exactly one player, or null to end the match";
    Log.add("error", message);
    if (Flow.active) Flow.fail(`Step ${Flow.step}: ${message}`);
    return false;
  },

  roster() {
    const mode = this.mode();
    const count = this.playerCount();
    // Against computers, the author's chosen seat is the only human; every
    // other seat is a computer (a viewer watches computers play each other).
    const mySeat = mode === "single-computers" ? this.actingSeat() : null;
    const roster = [];
    for (let i = 0; i < count; i++) {
      if (mode === "single-computers" && i !== mySeat) {
        roster.push({
          id: `computer-${i}`,
          kind: "computer",
          display_name: `Computer ${i}`,
          picture_url: "",
          max_loss: 0,
          active: true,
        });
      } else {
        roster.push({
          id: `human-${i + 1}`,
          kind: "human",
          display_name: `Player ${i + 1}`,
          picture_url: "",
          max_loss: 0,
          active: true,
        });
      }
    }
    return roster;
  },

  ctx() {
    return {
      players: this.match.players
        .filter((p) => p.active)
        .map((p) => ({
          id: p.id,
          kind: p.kind,
          display_name: p.display_name,
          picture_url: p.picture_url,
          max_loss: p.max_loss,
        })),
      pot: this.match.pot,
      move_count: this.match.moveCount,
    };
  },

  callSeed() {
    return (this.match.matchSeed + this.match.moveCount) % 4294967296;
  },

  async ensureHost() {
    const inputs = readInputs().inputs;
    const codeChanged =
      !this.inputs ||
      this.inputs.serverCode !== inputs.serverCode ||
      JSON.stringify(this.inputs.schemas) !== JSON.stringify(inputs.schemas);
    if (codeChanged) {
      if (this.host) this.host.terminate();
      this.host = new ServerHost();
      await this.host.load(inputs.serverCode, inputs.schemas);
      this.inputs = inputs;
      this.strings = extractStrings(inputs.clientCode);
    }
    return this.host;
  },

  loadClient(code) {
    const box = $("game-box");
    box.replaceChildren();
    box.classList.toggle("multi", this.multiFrame);
    this.frames = [];
    // In multiplayer test-flow matches there is one frame per seat, each
    // showing only that seat's view; everywhere else a single frame follows
    // the acting seat, as before.
    const seats = this.multiFrame
      ? this.match.players.map((_, i) => i)
      : [null];
    const loads = [];
    for (const seat of seats) {
      const iframe = document.createElement("iframe");
      iframe.className = "game-frame";
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.setAttribute(
        "title",
        seat === null
          ? "game under test"
          : `game under test — player ${seat + 1}`,
      );
      iframe.srcdoc =
        code + `<script>(${fitGameViewport.toString()})()</script>`;
      const entry = { frame: iframe, seat, viewport: null, box: null, holder: null };
      if (seat === null) {
        box.appendChild(iframe);
      } else {
        const holder = document.createElement("div");
        holder.className = "seat-frame";
        const name = document.createElement("p");
        name.className = "seat-name";
        name.textContent =
          `Player ${seat + 1} (seat ${seat}) — this frame only sees that player's view`;
        const seatBox = document.createElement("div");
        seatBox.className = "seat-box";
        seatBox.appendChild(iframe);
        holder.appendChild(name);
        holder.appendChild(seatBox);
        box.appendChild(holder);
        entry.box = seatBox;
        entry.holder = holder;
      }
      const loaded = new Promise((resolve) =>
        iframe.addEventListener("load", resolve, { once: true }),
      );
      loads.push(loaded);
      // The frame's ready gate, mirroring GameFrame in the portal: the
      // first state_changed to this frame waits for the game's game_ready
      // handshake, with the same 2 second fallback after the frame loads.
      let openGate;
      const gate = new Promise((resolve) => { openGate = resolve; });
      entry.openGate = openGate;
      entry.gateTimedOut = false;
      entry.gateLogged = false;
      entry.readyGate = (async () => {
        await loaded;
        let timer;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => { entry.gateTimedOut = true; resolve(); }, READY_TIMEOUT_MS);
        });
        await Promise.race([gate, timeout]);
        clearTimeout(timer);
      })();
      this.frames.push(entry);
    }
    this.frame = this.frames[0].frame;
    this.frameReady = Promise.all(loads);
    this.applyResolution();
  },

  // The viewport the game lays out in, ported from GameFrame (common.js):
  // the iframe's layout size is the box size divided by the scale, and it
  // is scaled down visually to fit. The box size is fixed by the chosen
  // resolution, so there is no auto-height growth here.
  viewport: null,

  applyViewport(entry) {
    const entries = entry ? [entry] : this.frames;
    for (const e of entries) {
      const frame = e.frame;
      const view = e.viewport || this.viewport;
      if (!frame || !view || !view.width || !view.height) continue;
      const { width, height, scale } = view;
      Object.assign(frame.style, {
        width: Math.ceil(width / scale) + "px",
        height: Math.ceil(height / scale) + "px",
        minHeight: "0",
        maxWidth: "none",
        flex: "none",
        transformOrigin: "top left",
        transform: `scale(${scale})`,
      });
    }
  },

  fitViewport(message, entry) {
    const view = (entry && entry.viewport) || this.viewport;
    if (!view || !this.frame) return;
    const { width, height, viewport_width: vw, viewport_height: vh } = message;
    if (![width, height, vw, vh].every((n) => Number.isFinite(n) && n > 0)) return;
    if (Math.abs(vw - Math.ceil(view.width / view.scale)) > 1 ||
        Math.abs(vh - Math.ceil(view.height / view.scale)) > 1) return;
    const ratio = Math.min(
      1,
      width <= vw + 1 ? 1 : vw / width,
      height <= vh + 1 ? 1 : vh / height,
    );
    // Ignore rounding and bound viewport-dependent games (e.g. 100vh + a
    // footer). Their own scrolling remains available instead of shrinking
    // forever.
    if (ratio >= .998 || view.passes >= 8) return;
    const scale = Math.max(.1, view.scale * ratio);
    if (view.scale - scale < .001) return;
    view.scale = scale;
    view.passes++;
    this.applyViewport(entry);
  },

  async newMatch() {
    const { errors } = readInputs();
    if (errors.length) {
      Log.add("error", errors.join("; "));
      return;
    }
    if (Trace.session && !Flow.driving) {
      Log.add(
        "error",
        "a test-flow match is in progress — finish it before starting a free match",
      );
      return;
    }
    const inputs = readInputs().inputs;
    const count = this.playerCount();
    if (!inputs.allowedPlayerCounts.includes(count)) {
      Log.add(
        "error",
        `this game allows ${inputs.allowedPlayerCounts.join(", ")} players, ` +
        `not ${count}`,
      );
      return;
    }
    try {
      await this.ensureHost();
    } catch (e) {
      Log.add("error", `the server code does not load: ${e.message}`);
      return;
    }
    const roster = this.roster();
    this.match = {
      players: roster,
      state: null,
      turn: null,
      moveCount: 0,
      status: "ongoing",
      endReason: null,
      payouts: null,
      pot: 0,
      matchSeed: (Math.random() * 4294967296) >>> 0,
      history: [],
      historyIndex: -1,
      lastMove: null,
      lastEvent: null,
    };
    $("match-seed").textContent = `match seed: ${this.match.matchSeed}`;
    this.loadClient(inputs.clientCode);
    await this.frameReady;
    let result;
    try {
      result = (await this.host.call("newMatch", [], this.ctx(), this.callSeed(), Date.now())).result;
    } catch (e) {
      Log.add("error", `newMatch failed: ${e.message}`);
      return;
    }
    if (!this.checkSingleTurn("newMatch", result)) return;
    this.match.state = result.state;
    this.match.turn = result.turn;
    this.snapshot(null, null);
    try {
      await Trace.matchStarted();
    } catch (e) {
      Log.add("error", `the match could not be recorded on the server: ${e.message}`);
      if (Flow.active) {
        Flow.fail(`Step ${Flow.step}: the match could not be recorded on the server: ${e.message}`);
      }
      return;
    }
    await this.sendStateChanged(null);
    this.refreshOutputs();
    this.refreshButtons();
    Log.add("info", `new match started, ${count} players, seed ${this.match.matchSeed}`);
    await this.autoPlayComputers();
  },

  snapshot(move, event) {
    const m = this.match;
    // A move made while viewing history truncates the future.
    m.history.length = m.historyIndex + 1;
    m.history.push({
      state: clone(m.state),
      turn: m.turn === null ? null : [...m.turn],
      moveCount: m.moveCount,
      status: m.status,
      endReason: m.endReason,
      payouts: m.payouts === null ? null : { ...m.payouts },
      players: m.players.map((p) => ({ ...p })),
      lastMove: move === undefined ? null : clone(move),
      lastEvent: event === undefined ? null : event,
    });
    m.historyIndex = m.history.length - 1;
    m.lastMove = move === undefined ? null : clone(move);
    m.lastEvent = event === undefined ? null : event;
  },

  async viewForPlayer(playerId) {
    if (!this.host.has("viewFor")) return undefined;
    try {
      const { result } = await this.host.call(
        "viewFor",
        [this.match.state, playerId],
        this.ctx(),
        this.callSeed(),
        Date.now(),
      );
      return result;
    } catch (e) {
      Log.add("error", `viewFor failed: ${e.message}`);
      return undefined;
    }
  },

  async viewForSeat() {
    const seat = this.actingSeat();
    const playerId =
      seat === null ? null : this.match.players[seat].id;
    return this.viewForPlayer(playerId);
  },

  // The view a player was looking at when they chose a move, recomputed
  // with the move's own ctx and seed so a trace row can hash it.
  async traceView(state, playerId, moveNumber) {
    if (!this.host || !this.host.has("viewFor")) return clone(state);
    const ctx = {
      players: this.ctx().players,
      pot: this.match.pot,
      move_count: moveNumber,
    };
    try {
      const { result } = await this.host.call(
        "viewFor",
        [state, playerId],
        ctx,
        (this.match.matchSeed + moveNumber) % 4294967296,
        Date.now(),
      );
      return result;
    } catch (e) {
      return clone(state);
    }
  },

  // Waits out a frame's ready gate before its first state_changed. When
  // the 2s fallback fires (the game never posted game_ready), say so once
  // in the log — the guide asks games to post the handshake — and play on.
  async waitForReady(entry) {
    if (!entry?.readyGate) return;
    await entry.readyGate;
    if (entry.gateTimedOut && !entry.gateLogged) {
      entry.gateLogged = true;
      Log.add(
        "info",
        "the game did not post game_ready within 2s of loading — state_changed sent anyway; the guide asks games to post game_ready once their message listener is installed",
      );
    }
  },

  async sendStateChanged(replay) {
    if (!this.frame || !this.match) return;
    if (this.multiFrame) return this.sendStateChangedMulti(replay);
    const m = this.match;
    const view = await this.viewForSeat();
    m.view = view;
    const message = {
      type: "state_changed",
      state: m.state,
      view,
      players: m.players.map((p, i) => ({
        player_index: i,
        player_id: p.id,
        kind: p.kind,
        name: p.display_name,
        picture_url: p.picture_url,
      })),
      turn_of_player_indices:
        m.turn === null ? null : m.turn.map((id) => this.seatIndexOf(id)),
      status: m.status,
      end_reason: m.endReason,
      move_count: m.moveCount,
      my_player_index: this.actingSeat(),
      token_pot: m.pot,
      replay,
      strings: this.strings,
      locale: "en",
      direction: "ltr",
    };
    // Same derived legacy field as the portal's stateChangedMessage.
    message.acting_for_player_index =
      message.my_player_index !== null &&
      Array.isArray(message.turn_of_player_indices) &&
      message.turn_of_player_indices.includes(message.my_player_index)
        ? message.my_player_index
        : null;
    await this.waitForReady(this.frames[0]);
    this.frame.contentWindow.postMessage(message, "*");
    Log.add("api", `state_changed → ${JSON.stringify(message)}`);
    this.refreshOutputs();
    this.refreshButtons();
  },

  // Multiplayer test-flow matches: every seat's frame gets the same state
  // with its own view and its own my_player_index, like real multiplayer.
  async sendStateChangedMulti(replay) {
    const m = this.match;
    for (const entry of this.frames) {
      const seat = entry.seat;
      const view = await this.viewForPlayer(m.players[seat].id);
      if (seat === 0) m.view = view;
      const message = {
        type: "state_changed",
        state: m.state,
        view,
        players: m.players.map((p, i) => ({
          player_index: i,
          player_id: p.id,
          kind: p.kind,
          name: p.display_name,
          picture_url: p.picture_url,
        })),
        turn_of_player_indices:
          m.turn === null ? null : m.turn.map((id) => this.seatIndexOf(id)),
        status: m.status,
        end_reason: m.endReason,
        move_count: m.moveCount,
        my_player_index: seat,
        token_pot: m.pot,
        replay,
        strings: this.strings,
        locale: "en",
        direction: "ltr",
      };
      message.acting_for_player_index =
        Array.isArray(message.turn_of_player_indices) &&
        message.turn_of_player_indices.includes(seat)
          ? seat
          : null;
      await this.waitForReady(entry);
      entry.frame.contentWindow.postMessage(message, "*");
      Log.add("api", `state_changed (seat ${seat}) → ${JSON.stringify(message)}`);
    }
    this.refreshOutputs();
    this.refreshButtons();
  },

  async onMakeMove(message) {
    if (!this.match || !this.host) return;
    if (Trace.blocked) {
      Log.add(
        "info",
        "recording is paused — reload this page and load by secret to resume the saved match, or restart the step",
      );
      return;
    }
    if (message.new_state !== undefined || message.next_turn_player_indices !== undefined) {
      Log.add(
        "error",
        "the client must post {type: 'make_move', move} " +
        "and let the server code apply the move (got a make_move with new_state)",
      );
      return;
    }
    if (this.match.historyIndex < this.match.history.length - 1) {
      Log.add(
        "info",
        "you are viewing history — use the forward button to return to the latest move before playing",
      );
      MoveAlert.show(
        "✕ That move was not played — you are viewing an earlier position. " +
        "Go forward to the latest move first, then play.",
      );
      return;
    }
    const seat = this.messageSeat != null ? this.messageSeat : this.actingSeat();
    this.messageSeat = null;
    if (seat === null) {
      Log.add("info", "you are watching as a viewer; pick a seat to play");
      MoveAlert.show(
        "✕ That move was not played — you are watching as a viewer; pick a seat to play.",
      );
      return;
    }
    const mover = this.match.players[seat];
    if (!mover.active || !this.match.turn || !this.match.turn.includes(mover.id)) {
      Log.add("info", "it is not your turn");
      MoveAlert.show("✕ That move was not played — it is not your turn.");
      return;
    }
    Log.add("api", `make_move ← ${JSON.stringify(message)}`);
    const stateBefore = this.match.state;
    let result;
    try {
      result = (
        await this.host.call(
          "applyMove",
          [this.match.state, mover.id, message.move],
          this.ctx(),
          this.callSeed(),
          Date.now(),
        )
      ).result;
    } catch (e) {
      Log.add("error", `applyMove rejected the move: ${e.message}`);
      MoveAlert.show(
        `✕ That move is ILLEGAL — it was not played, it was not recorded, ` +
        `and the board is unchanged. The game rejected it: “${e.message}”. ` +
        `Choose a different move.`,
      );
      await this.sendStateChanged(null);
      return;
    }
    if (!this.checkSingleTurn("applyMove", result)) return;
    MoveAlert.hide();
    this.match.state = result.state;
    this.match.turn = result.turn;
    this.match.payouts = result.payouts || null;
    this.match.moveCount++;
    if (result.turn === null) {
      this.match.status = "over";
      this.match.endReason = "finished";
    }
    this.snapshot(message.move, null);
    await Trace.moveApplied({
      stateBefore,
      seat,
      moverId: mover.id,
      move: message.move,
      stateAfter: result.state,
    });
    await this.sendStateChanged(null);
    await this.autoPlayComputers();
  },

  async autoPlayComputers() {
    if (this.mode() !== "single-computers" || this.autoPlaying) return;
    this.autoPlaying = true;
    try {
      for (let guard = 0; guard < 100; guard++) {
        const m = this.match;
        if (Trace.blocked) break;
        if (!m || m.turn === null || m.historyIndex < m.history.length - 1) break;
        const next = m.turn
          .map((id) => m.players.find((p) => p.id === id))
          .find((p) => p && p.kind === "computer" && p.active);
        if (!next) break;
        const source = this.host.has("computerMove") ? "computerMove" : "randomMove";
        let move;
        try {
          move = (
            await this.host.call(source, [m.state, next.id], this.ctx(), this.callSeed(), Date.now())
          ).result;
        } catch (e) {
          Log.add("error", `${source} failed for ${next.display_name}: ${e.message}`);
          break;
        }
        const stateBefore = m.state;
        let result;
        try {
          result = (
            await this.host.call(
              "applyMove",
              [m.state, next.id, move],
              this.ctx(),
              this.callSeed(),
              Date.now(),
            )
          ).result;
        } catch (e) {
          Log.add("error", `applyMove rejected the computer's move: ${e.message}`);
          MoveAlert.show(
            `✕ The computer's move was rejected as ILLEGAL: “${e.message}”. ` +
            `That is a bug in the game's own move generation — the game ` +
            `offered a move its server code will not accept.`,
          );
          break;
        }
        if (!this.checkSingleTurn("applyMove", result)) break;
        m.state = result.state;
        m.turn = result.turn;
        m.payouts = result.payouts || null;
        m.moveCount++;
        if (result.turn === null) {
          m.status = "over";
          m.endReason = "finished";
        }
        m.lastMove = clone(move);
        this.snapshot(move, null);
        await Trace.moveApplied({
          stateBefore,
          seat: this.seatIndexOf(next.id),
          moverId: next.id,
          move,
          stateAfter: result.state,
        });
        await this.sendStateChanged(null);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      this.autoPlaying = false;
    }
  },

  async goBack() {
    if (!this.match || this.match.historyIndex <= 0) return;
    this.match.historyIndex--;
    this.restoreSnapshot();
    await this.sendStateChanged({
      index: this.match.historyIndex,
      total: this.match.history.length - 1,
    });
  },

  async goForward() {
    if (!this.match || this.match.historyIndex >= this.match.history.length - 1) return;
    this.match.historyIndex++;
    this.restoreSnapshot();
    const replay =
      this.match.historyIndex < this.match.history.length - 1
        ? { index: this.match.historyIndex, total: this.match.history.length - 1 }
        : null;
    await this.sendStateChanged(replay);
  },

  restoreSnapshot() {
    const m = this.match;
    const entry = m.history[m.historyIndex];
    m.state = clone(entry.state);
    m.turn = entry.turn === null ? null : [...entry.turn];
    m.moveCount = entry.moveCount;
    m.status = entry.status;
    m.endReason = entry.endReason;
    m.payouts = entry.payouts === null ? null : { ...entry.payouts };
    m.players = entry.players.map((p) => ({ ...p }));
    m.lastMove = entry.lastMove === undefined ? null : clone(entry.lastMove);
    m.lastEvent = entry.lastEvent === undefined ? null : entry.lastEvent;
  },

  async leaveMatch() {
    if (!this.match || !this.host || !this.host.has("playerLeft")) {
      Log.add("info", "this game does not define playerLeft");
      return;
    }
    const seat = this.actingSeat();
    if (seat === null) {
      Log.add("info", "a viewer cannot leave; pick a seat");
      return;
    }
    const leaver = this.match.players[seat];
    if (!leaver.active) return;
    let result;
    try {
      result = (
        await this.host.call(
          "playerLeft",
          [this.match.state, leaver.id],
          this.ctx(),
          this.callSeed(),
          Date.now(),
        )
      ).result;
    } catch (e) {
      Log.add("error", `playerLeft failed: ${e.message}`);
      return;
    }
    if (!this.checkSingleTurn("playerLeft", result)) return;
    leaver.active = false;
    this.match.state = result.state;
    this.match.turn = result.turn;
    this.match.payouts = result.payouts || null;
    this.match.moveCount++;
    if (result.turn === null) {
      this.match.status = "over";
      this.match.endReason = "player_left";
    }
    this.snapshot(null, { type: "player_left", player_id: leaver.id });
    await this.sendStateChanged(null);
    if (this.match.status === "over") await Trace.matchEnded();
  },

  async joinMatch() {
    if (!this.match || !this.host || !this.host.has("playerJoined")) {
      Log.add("info", "this game does not define playerJoined");
      return;
    }
    const m = this.match;
    if (m.players.length >= Math.max(...this.inputs.allowedPlayerCounts)) {
      Log.add("info", "the game already has the maximum number of players");
      return;
    }
    if (m.players.some((p) => p.kind === "computer")) {
      Log.add("info", "a new player cannot join while computers are playing");
      return;
    }
    const index = m.players.length;
    const joiner = {
      id: `human-${index + 1}`,
      kind: "human",
      display_name: `Player ${index + 1}`,
      picture_url: "",
      max_loss: 0,
      active: true,
    };
    m.players.push(joiner);
    let result;
    try {
      result = (
        await this.host.call(
          "playerJoined",
          [m.state, joiner.id],
          this.ctx(),
          this.callSeed(),
          Date.now(),
        )
      ).result;
    } catch (e) {
      m.players.pop();
      Log.add("error", `playerJoined failed: ${e.message}`);
      return;
    }
    if (!this.checkSingleTurn("playerJoined", result)) {
      m.players.pop();
      return;
    }
    m.state = result.state;
    m.turn = result.turn;
    m.payouts = result.payouts || null;
    this.snapshot(null, { type: "player_joined", player_id: joiner.id });
    await this.sendStateChanged(null);
  },

  refreshOutputs() {
    const m = this.match;
    if (!m) return;
    $("state-out").value = m.state === null ? "" : pretty(m.state);
    $("view-out").value = m.view === undefined ? "" : pretty(m.view);
    const last = m.lastEvent || m.lastMove;
    $("last-move-out").value = last === null ? "" : pretty(last);
  },

  refreshButtons() {
    const m = this.match;
    const hasMatch = !!m;
    $("back").disabled = !hasMatch || m.historyIndex <= 0;
    $("forward").disabled =
      !hasMatch || m.historyIndex >= m.history.length - 1;
    const replaying = hasMatch && m.historyIndex < m.history.length - 1;
    $("replay-label").textContent = replaying
      ? `viewing move ${m.historyIndex} of ${m.history.length - 1} (history)`
      : hasMatch
        ? `move ${m.moveCount}`
        : "";
    const seat = hasMatch ? this.actingSeat() : null;
    $("seat-label").textContent = !hasMatch
      ? ""
      : seat === null
        ? "watching as a viewer"
        : this.mode() === "single-pass"
          ? `pass-and-play — playing as seat ${seat} (${m.players[seat].display_name})`
          : `playing as seat ${seat} (${m.players[seat].display_name})`;
  },

  applyResolution() {
    const selected = RESOLUTIONS[Number($("resolution").value) || 0];
    const horizontal = $("orientation").value === "horizontal";
    const width = horizontal ? selected.height : selected.width;
    const height = horizontal ? selected.width : selected.height;
    const box = $("game-box");
    const wrap = $("game-wrap");
    const available = Math.max(320, wrap.clientWidth || 800);
    const scale = Math.min(1, available / width);
    $("resolution-label").textContent =
      `${selected.label} — ${width}×${height}` +
      (scale < 1 ? ` (scaled to ${Math.round(scale * 100)}%)` : "");
    this.viewport = { width, height, scale: 1, passes: 0 };
    if (this.multiFrame) {
      box.style.width = "";
      box.style.height = "";
      box.style.transform = "";
      wrap.style.height = "";
      for (const entry of this.frames) {
        entry.viewport = { width, height, scale: 1, passes: 0 };
        if (entry.box) {
          entry.box.style.width = `${width}px`;
          entry.box.style.height = `${height}px`;
          entry.box.style.transform = `scale(${scale})`;
        }
        if (entry.holder) {
          entry.holder.style.height = `${Math.round(height * scale) + 28}px`;
        }
      }
    } else {
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      box.style.transform = `scale(${scale})`;
      wrap.style.height = `${Math.round(height * scale)}px`;
      if (this.frames.length) this.frames[0].viewport = this.viewport;
    }
    this.applyViewport();
  },
};

// ---------------------------------------------------------------------------
// The recorded test flow: Trace talks to the /game-test endpoints, Flow
// drives the five linear steps. Moves made while a session is active are
// recorded on the server; a finished pass-and-play or multiplayer match is
// verified by replaying it against the step 1 server code.
// ---------------------------------------------------------------------------

async function traceFetch(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch (e) {
    throw new Error(`could not reach the server (${e.message})`);
  }
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    /* not JSON — the raw text is the detail */
  }
  if (!response.ok) {
    let detail = data && data.detail !== undefined ? data.detail : text;
    if (typeof detail !== "string") detail = JSON.stringify(detail);
    throw new Error(detail || `the server answered ${response.status}`);
  }
  return data;
}

const Trace = {
  session: null,
  // Set when a move could not be recorded: play halts (the in-page match
  // is now ahead of the server's record), and the saved prefix is resumed
  // by reloading the page and loading by secret. Restarting the step
  // abandons the saved session on the server and clears this.
  blocked: false,

  async post(path, payload) {
    return traceFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async get(path) {
    return traceFetch(path, { method: "GET" });
  },

  beginSession(mode, config) {
    this.blocked = false;
    this.session = {
      id:
        window.crypto && crypto.randomUUID
          ? crypto.randomUUID()
          : `session-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      mode,
      config,
      states: [],
      moves: [],
      roster: null,
      matchSeed: null,
      serverStarted: false,
      serverFinished: false,
    };
  },

  endSession() {
    MoveClock.stop();
    this.session = null;
    this.blocked = false;
  },

  // Opens the match's session on the server before play begins: from
  // here on every move is appended (and verified) as it is played, so
  // the match's record is durable from its first move.
  async matchStarted() {
    const s = this.session;
    if (!s || !Player.match) return;
    s.states = [clone(Player.match.state)];
    s.moves = [];
    s.roster = Player.match.players.map((p) => ({
      id: p.id,
      kind: p.kind,
      display_name: p.display_name,
      picture_url: p.picture_url,
      max_loss: p.max_loss,
    }));
    s.matchSeed = Player.match.matchSeed;
    if (!Flow.submissionId) return;
    await this.post("/game-test/sessions", {
      secret: Flow.secret(),
      submission_id: Flow.submissionId,
      session_id: s.id,
      mode: s.mode,
      config: s.config,
      players: s.roster,
      pot: Player.match.pot || 0,
      match_seed: s.matchSeed,
      initial_state: clone(Player.match.state),
      initial_turn: Player.match.turn === null ? null : [...Player.match.turn],
    });
    s.serverStarted = true;
    MoveClock.arm();
  },

  async moveApplied({ stateBefore, seat, moverId, move, stateAfter }) {
    const s = this.session;
    if (!s || !Flow.submissionId || this.blocked) return;
    const moveNumber = s.moves.length;
    let response;
    try {
      const view = await Player.traceView(stateBefore, moverId, moveNumber);
      response = await this.post(`/game-test/sessions/${s.id}/moves`, {
        secret: Flow.secret(),
        submission_id: Flow.submissionId,
        player_index: seat,
        move,
        view,
        state_after: clone(stateAfter),
        turn_after:
          Player.match.turn === null ? null : [...Player.match.turn],
      });
    } catch (e) {
      this.blocked = true;
      MoveClock.stop();
      Flow.banner(
        `Move ${moveNumber + 1} could not be recorded on the server: ${e.message} ` +
        `Every move before it is saved. Reload this page and load the stored ` +
        `inputs by secret to resume this match at move ${moveNumber}; or press ` +
        `this step's Start button to discard the saved match and begin the step again.`,
      );
      Log.add(
        "error",
        `recording move ${moveNumber + 1} failed: ${e.message} — play is paused; ` +
        `the recorded prefix (moves 0–${moveNumber - 1}) is saved on the server`,
      );
      return;
    }
    s.moves.push({ player_index: seat, move: clone(move) });
    s.states.push(clone(stateAfter));
    MoveClock.arm();
    if (response && response.finished) s.serverFinished = true;
    if (Player.match && Player.match.status === "over") {
      await this.matchEnded();
    } else if (s.mode === "against_computers" && s.moves.length >= 100) {
      await this.matchEnded();
    }
  },

  async matchEnded() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    await Flow.sessionFinished(s);
  },

  // A step-4 session stopped at the move cap has no terminal move; the
  // server closes it (every move was verified as it was appended).
  async closeSession(s) {
    return this.post(`/game-test/sessions/${s.id}/close`, {
      secret: Flow.secret(),
      submission_id: Flow.submissionId,
    });
  },
};

// A prominent alert above the game frame: an illegal move (or a stalled
// match) must never fail silently into the log — the player has to see
// that the move was not played and why.
const MoveAlert = {
  show(text, { restart = false } = {}) {
    const box = $("move-alert");
    if (!box) return;
    $("move-alert-text").textContent = text;
    $("move-alert-restart").hidden = !restart;
    box.hidden = false;
  },

  hide() {
    const box = $("move-alert");
    if (box) box.hidden = true;
  },
};

// The 30-second per-move clock for the recorded flow (steps 3–5): each
// move must follow the previous applied move (or the match starting /
// resuming) within 30 seconds. Only applied moves re-arm it — a rejected
// move does not buy more time. When it fires, the match is not lost:
// every recorded move stays on the server, and loading the stored inputs
// by secret resumes the match at its last recorded move.
const MOVE_TIMEOUT_MS = 30000;

const MoveClock = {
  timer: null,
  // True once the timeout has fired for the current wait: the alert is
  // re-shown every 30 seconds until a move is applied (an illegal-move
  // alert may cover it in between), but the log line is written once.
  expired: false,

  conditions() {
    return !!(
      Trace.session &&
      Player.match &&
      Player.match.status === "ongoing" &&
      !Trace.blocked
    );
  },

  arm() {
    this.expired = false;
    this.schedule();
  },

  schedule() {
    this.stop();
    if (!this.conditions()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.conditions()) return;
      const moveCount = Player.match.moveCount;
      if (!this.expired) {
        Log.add(
          "error",
          `no move was played within 30 seconds — the match is saved on the ` +
          `server up to move ${moveCount}; reload and load by secret to resume there`,
        );
      }
      this.expired = true;
      MoveAlert.show(
        `No move was played within 30 seconds. The match is saved on the server ` +
        `up to the last recorded move (move ${moveCount} of this match). ` +
        `Press “Back to the beginning”, enter the secret again and load the ` +
        `stored inputs — the match resumes at that move.`,
        { restart: true },
      );
      this.schedule();
    }, MOVE_TIMEOUT_MS);
  },

  stop() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },
};

const Flow = {
  step: 1,
  driving: false,
  active: false,
  submissionId: null,
  submittedBody: null,
  combos: [],
  comboIndex: 0,
  configs4: [],
  config4Index: 0,

  secret() {
    return fieldValue("game-secret").trim();
  },

  card(n, state, statusText) {
    const card = $(`step-card-${n}`);
    if (card) card.className = `step-card${state ? " " + state : ""}`;
    const status = $(`step${n}-status`);
    if (status && statusText !== undefined) {
      status.textContent = statusText;
      status.className =
        "check-status " +
        (state === "done"
          ? "passed"
          : state === "failed"
            ? "failed"
            : state === "active"
              ? "running"
              : "");
    }
  },

  banner(message) {
    const b = $("flow-banner");
    if (!b) return;
    if (message) {
      b.textContent = message;
      b.hidden = false;
    } else {
      b.hidden = true;
      b.textContent = "";
    }
  },

  refreshButtons() {
    $("step2-run").disabled = this.step !== 2;
    $("step3-start").disabled = this.step !== 3;
    $("step4-start").disabled = this.step !== 4;
    $("step5-start").disabled = this.step !== 5;
  },

  fail(message) {
    const step = this.step;
    this.active = false;
    Trace.endSession();
    if (step >= 1 && step <= 5) this.card(step, "failed", "Failed");
    this.step = 1;
    this.submissionId = null;
    this.submittedBody = null;
    this.banner(`${message} Fix the code and start again from step 1.`);
    $("flow-finish").hidden = true;
    this.refreshButtons();
    Log.add("error", message);
  },

  abandon() {
    this.active = false;
    Trace.endSession();
    this.step = 1;
    this.submissionId = null;
    this.submittedBody = null;
    for (const n of [1, 2, 3, 4, 5]) this.card(n, "", "");
    $("flow-finish").hidden = true;
    this.refreshButtons();
  },

  inputsChanged() {
    if (!this.submittedBody) return;
    const { body, errors } = buildImportBody();
    if (errors.length || !deepEqual(body, this.submittedBody)) {
      this.fail("The inputs changed during the run.");
    }
  },

  adoptSubmission(body, submissionId, createdAt, logMessage) {
    for (const n of [2, 3, 4, 5]) this.card(n, "", "");
    $("step2-results").replaceChildren();
    $("flow-finish").hidden = true;
    this.submissionId = submissionId;
    this.submittedBody = body;
    this.step = 2;
    this.active = true;
    this.card(1, "done", `Recorded (${createdAt})`);
    Log.add("info", logMessage);
    this.refreshButtons();
  },

  // After loading stored inputs: pick the run up where the server left
  // it. Steps the server already counts as done are marked, an open
  // play session (a match in progress) is restored move for move, and
  // otherwise the walkthrough lands on the first step still owed.
  async resumeFromServer() {
    const secret = encodeURIComponent(this.secret());
    let status, open;
    try {
      status = await Trace.get(`/game-test/status?secret=${secret}`);
      open = await Trace.get(`/game-test/open-session?secret=${secret}`);
    } catch (e) {
      Log.add("info", `could not check for a resumable run: ${e.message}`);
      return;
    }
    const steps = status.steps || {};
    if (steps.step2 && steps.step2.done) this.card(2, "done", "Passed (recorded earlier)");
    if (steps.step3 && steps.step3.done) this.card(3, "done", "Passed");
    if (steps.step4 && steps.step4.done) this.card(4, "done", "Passed");
    if (steps.step5 && steps.step5.done) this.card(5, "done", "Passed");
    // Seed the shared display planner with the coverage the server
    // already has, so new matches prefer what is still missing.
    this.planner = this.displayPlanner();
    const missingRes = (steps.step5 && steps.step5.missing_resolutions) || [];
    const missingOri = (steps.step5 && steps.step5.missing_orientations) || [];
    this.planner.seed(
      RESOLUTIONS.map((r) => r.label).filter((label) => !missingRes.includes(label)),
      ["vertical", "horizontal"].filter((o) => !missingOri.includes(o)),
    );
    const session = open && open.session;
    if (session) {
      await this.restoreSession(session, steps);
      return;
    }
    if (steps.complete) {
      this.finish();
      return;
    }
    this.step = !steps.step2 || !steps.step2.done ? 2
      : !steps.step3 || !steps.step3.done ? 3
      : !steps.step4 || !steps.step4.done ? 4
      : 5;
    this.refreshButtons();
    Log.add(
      "info",
      `resumed the recorded run at step ${this.step} — press the step's Start button to continue`,
    );
  },

  // Restore a match the server has a recorded prefix for: rebuild the
  // in-page match from the recorded states and continue the same
  // session, so the next move appends where the last session stopped.
  async restoreSession(session, steps) {
    const stepByMode = { pass_and_play: 3, against_computers: 4, multiplayer: 5 };
    const step = stepByMode[session.mode];
    if (!step) return;
    const cfg = session.config;
    if (step === 4) {
      this.configs4 = this.step4Pairs().map(([count, humanSeat]) => ({
        count,
        humanSeat,
        ...this.planner.next(),
      }));
      const played = (steps.step4 && steps.step4.configs) || 0;
      this.config4Index = Math.min(played, this.configs4.length - 1);
    } else {
      const counts = this.submittedBody.allowed_player_counts;
      this.combos = counts.map((count) => ({ count, ...this.planner.next() }));
      if (step === 5) {
        for (;;) {
          const missing = this.planner.uncovered();
          if (!missing.resolutions && !missing.orientations) break;
          this.combos.push({ count: counts[0], ...this.planner.next() });
        }
      }
      const verified = (steps[`step${step}`] && steps[`step${step}`].verified) || 0;
      this.comboIndex = Math.min(verified, this.combos.length - 1);
    }
    $("mode").value =
      session.mode === "pass_and_play" ? "single-pass"
      : session.mode === "against_computers" ? "single-computers"
      : "multiplayer";
    populateSeats();
    $("player-count").value = String(cfg.num_players);
    populateSeats();
    if (session.mode === "against_computers" && cfg.human_player_index !== null) {
      $("my-seat").value = String(cfg.human_player_index);
    }
    const resolutionIndex = RESOLUTIONS.findIndex((r) => r.label === cfg.resolution);
    if (resolutionIndex >= 0) $("resolution").value = String(resolutionIndex);
    $("orientation").value = cfg.orientation;
    Player.multiFrame = session.mode === "multiplayer";
    Player.applyResolution();
    const players = session.players.map((p) => ({ ...p, active: true }));
    const last = session.move_count;
    Player.match = {
      players,
      state: clone(session.states[last]),
      turn: session.turns[last] === null ? null : [...session.turns[last]],
      moveCount: last,
      status: "ongoing",
      endReason: null,
      payouts: null,
      pot: session.pot || 0,
      matchSeed: session.match_seed,
      history: [],
      historyIndex: -1,
      lastMove: null,
      lastEvent: null,
    };
    for (let i = 0; i <= last; i++) {
      Player.match.history.push({
        state: clone(session.states[i]),
        turn: session.turns[i] === null ? null : [...session.turns[i]],
        moveCount: i,
        status: "ongoing",
        endReason: null,
        payouts: null,
        players: players.map((p) => ({ ...p })),
        lastMove: i === 0 ? null : clone(session.moves[i - 1].move),
        lastEvent: null,
      });
    }
    Player.match.historyIndex = last;
    $("match-seed").textContent = `match seed: ${session.match_seed}`;
    Trace.session = {
      id: session.session_id,
      mode: session.mode,
      config: {
        num_players: cfg.num_players,
        resolution: cfg.resolution,
        orientation: cfg.orientation,
        human_player_index: cfg.human_player_index,
      },
      states: session.states.map((s) => clone(s)),
      moves: session.moves.map((m) => ({
        player_index: m.player_index,
        move: clone(m.move),
      })),
      roster: session.players.map((p) => ({ ...p })),
      matchSeed: session.match_seed,
      serverStarted: true,
      serverFinished: false,
    };
    Trace.blocked = false;
    this.step = step;
    this.active = true;
    this.card(step, "active", "Running…");
    if (step === 4) {
      $("step4-progress").textContent =
        `${this.config4Index} of ${this.configs4.length} matches played`;
      $("step4-instruction").textContent =
        `Resumed a saved match at move ${last} — keep playing seat ${cfg.human_player_index} ` +
        `against the computer: ${cfg.num_players} players, ${cfg.resolution}, ${cfg.orientation}.`;
    } else {
      $(`step${step}-progress`).textContent =
        `${this.comboIndex} of ${this.combos.length} matches verified`;
      $(`step${step}-instruction`).textContent =
        `Resumed a saved match at move ${last} — play it to the end: ` +
        `${cfg.num_players} players, ${cfg.resolution}, ${cfg.orientation}.`;
    }
    this.refreshButtons();
    try {
      const inputs = readInputs().inputs;
      await Player.ensureHost();
      Player.loadClient(inputs.clientCode);
      await Player.frameReady;
      await Player.sendStateChanged(null);
      Player.refreshOutputs();
      Player.refreshButtons();
      Log.add(
        "info",
        `resumed the step ${step} match at move ${last} ` +
        `(${cfg.num_players} players, ${cfg.resolution}, ${cfg.orientation})`,
      );
      await Player.autoPlayComputers();
    } catch (e) {
      Log.add("error", `the saved match could not be brought back: ${e.message}`);
    }
    MoveClock.arm();
  },

  async step1() {
    this.banner(null);
    const { body, errors } = buildImportBody();
    if (errors.length) {
      this.card(1, "failed", "Fix the inputs first");
      Log.add("error", `step 1: ${errors.join("; ")}`);
      return;
    }
    for (const n of [2, 3, 4, 5]) this.card(n, "", "");
    $("step2-results").replaceChildren();
    this.card(1, "active", "Checking and submitting…");
    try {
      const result = await Trace.post("/game-test/submissions", {
        secret: body.game_addition_request_id_and_secret,
        game_name: body.name,
        body,
      });
      this.adoptSubmission(
        body, result.submission_id, result.created_at,
        `step 1 recorded: submission ${result.submission_id}`);
    } catch (e) {
      this.card(1, "failed", "Failed");
      this.banner(`Step 1 failed: ${e.message} Fix the inputs and submit again.`);
      Log.add("error", `step 1 failed: ${e.message}`);
    }
    this.refreshButtons();
  },

  async step2() {
    if (!this.submissionId) return;
    this.banner(null);
    this.card(2, "active", "Running on the server…");
    const resultsEl = $("step2-results");
    resultsEl.replaceChildren();
    let report;
    try {
      report = await Trace.post("/game-test/server-check", {
        secret: this.secret(),
        submission_id: this.submissionId,
      });
    } catch (e) {
      this.fail(`Step 2 could not run: ${e.message}`);
      return;
    }
    if (report.checks) {
      for (const [name, result] of Object.entries(report.checks)) {
        const li = document.createElement("li");
        li.className = result.passed ? "passed" : "failed";
        const head = document.createElement("strong");
        head.textContent = `${name}: ${result.passed ? "passed" : "failed"}`;
        li.appendChild(head);
        const details = document.createElement("pre");
        details.textContent =
          typeof result.details === "string"
            ? result.details
            : JSON.stringify(result.details, null, 2);
        li.appendChild(details);
        resultsEl.appendChild(li);
      }
    }
    if (!report.passed) {
      this.fail(
        `Step 2 failed: ${report.error || "one or more server checks failed — see the results above."}`,
      );
      return;
    }
    this.card(
      2,
      "done",
      `Passed in ${report.duration_ms} ms — ${report.walks_completed} walks, ` +
        `${report.moves_made} moves, ${report.states_visited} states visited, ` +
        `${report.terminal_states} terminal states`,
    );
    Log.add(
      "info",
      `step 2 passed: ${report.walks_completed} walks, ${report.states_visited} states visited, ${report.terminal_states} terminal states`,
    );
    this.step = 3;
    this.refreshButtons();
  },

  displayPlanner() {
    // Hands out screen configurations for steps 3–5, preferring sizes
    // and orientations this run has not covered yet. Screen coverage is
    // judged once across the whole flow (see display_missing in
    // game_traces.py), so one planner is shared by all three steps.
    const coveredRes = new Set();
    const coveredOri = new Set();
    let rotation = 0;
    return {
      next() {
        let resolutionIndex = RESOLUTIONS.findIndex(
          (_, i) => !coveredRes.has(i),
        );
        if (resolutionIndex < 0) resolutionIndex = rotation % RESOLUTIONS.length;
        let orientation = ["vertical", "horizontal"].find(
          (o) => !coveredOri.has(o),
        );
        if (!orientation) orientation = ["vertical", "horizontal"][rotation % 2];
        rotation++;
        coveredRes.add(resolutionIndex);
        coveredOri.add(orientation);
        return { resolutionIndex, orientation };
      },
      uncovered() {
        return {
          resolutions: RESOLUTIONS.filter((_, i) => !coveredRes.has(i)).length,
          orientations: ["vertical", "horizontal"].filter(
            (o) => !coveredOri.has(o),
          ).length,
        };
      },
      // Resume support: mark coverage the server already has (from an
      // earlier page session) as covered, so new matches prefer the
      // sizes and orientations still missing.
      seed(coveredResolutionLabels, coveredOrientationNames) {
        RESOLUTIONS.forEach((entry, i) => {
          if (coveredResolutionLabels.includes(entry.label)) coveredRes.add(i);
        });
        for (const name of coveredOrientationNames) coveredOri.add(name);
      },
    };
  },

  step4Pairs() {
    // Mirror of step4_required_pairs in game_traces.py: the smallest
    // player count played from its first and last seat, plus the largest
    // count from its last seat when the game allows more than one count.
    const counts = this.submittedBody.allowed_player_counts;
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const keys = new Set([`${min},0`, `${min},${min - 1}`]);
    if (max !== min) keys.add(`${max},${max - 1}`);
    return [...keys].map((key) => key.split(",").map(Number));
  },

  async startPlayStep(step) {
    if (!this.submissionId) return;
    this.banner(null);
    if (step === 3 || !this.planner) this.planner = this.displayPlanner();
    const counts = this.submittedBody.allowed_player_counts;
    // One match per allowed player count. Step 5 adds a match for each
    // screen size or orientation steps 3–5 have not covered yet.
    this.combos = counts.map((count) => ({ count, ...this.planner.next() }));
    if (step === 5) {
      for (;;) {
        const missing = this.planner.uncovered();
        if (!missing.resolutions && !missing.orientations) break;
        this.combos.push({ count: counts[0], ...this.planner.next() });
      }
    }
    this.comboIndex = 0;
    this.step = step;
    this.active = true;
    this.card(step, "active", "Running…");
    this.refreshButtons();
    await this.startCombo();
  },

  async startCombo() {
    const step = this.step;
    const combo = this.combos[this.comboIndex];
    $("mode").value = step === 3 ? "single-pass" : "multiplayer";
    populateSeats();
    $("player-count").value = String(combo.count);
    populateSeats();
    $("resolution").value = String(combo.resolutionIndex);
    $("orientation").value = combo.orientation;
    Player.multiFrame = step === 5;
    Player.applyResolution();
    const label = RESOLUTIONS[combo.resolutionIndex].label;
    Trace.beginSession(step === 3 ? "pass_and_play" : "multiplayer", {
      num_players: combo.count,
      resolution: label,
      orientation: combo.orientation,
      human_player_index: null,
    });
    $(`step${step}-progress`).textContent =
      `${this.comboIndex} of ${this.combos.length} matches verified`;
    $(`step${step}-instruction`).textContent =
      `Play this match to the end: ${combo.count} player${combo.count === 1 ? "" : "s"}, ` +
      `${label}, ${combo.orientation}.`;
    this.driving = true;
    try {
      await Player.newMatch();
    } finally {
      this.driving = false;
    }
    if (!Player.match || Player.match.state == null) {
      this.fail(`Step ${step}: the match could not start — see the log for the error.`);
    }
  },

  async startStep4() {
    if (!this.submissionId) return;
    this.banner(null);
    if (!this.planner) this.planner = this.displayPlanner();
    this.configs4 = this.step4Pairs().map(([count, humanSeat]) => ({
      count,
      humanSeat,
      ...this.planner.next(),
    }));
    this.config4Index = 0;
    this.step = 4;
    this.active = true;
    this.card(4, "active", "Running…");
    this.refreshButtons();
    await this.startConfig4();
  },

  async startConfig4() {
    const cfg = this.configs4[this.config4Index];
    $("mode").value = "single-computers";
    populateSeats();
    $("player-count").value = String(cfg.count);
    populateSeats();
    $("my-seat").value = String(cfg.humanSeat);
    $("resolution").value = String(cfg.resolutionIndex);
    $("orientation").value = cfg.orientation;
    Player.multiFrame = false;
    Player.applyResolution();
    const label = RESOLUTIONS[cfg.resolutionIndex].label;
    Trace.beginSession("against_computers", {
      num_players: cfg.count,
      resolution: label,
      orientation: cfg.orientation,
      human_player_index: cfg.humanSeat,
    });
    $("step4-progress").textContent =
      `${this.config4Index} of ${this.configs4.length} matches played`;
    $("step4-instruction").textContent =
      `Play seat ${cfg.humanSeat} against the computer: ${cfg.count} players, ` +
      `${label}, ${cfg.orientation}. Play until the match ends or 100 moves are played.`;
    this.driving = true;
    try {
      await Player.newMatch();
    } finally {
      this.driving = false;
    }
    if (!Player.match || Player.match.state == null) {
      this.fail("Step 4: the match could not start — see the log for the error.");
    }
  },

  async sessionFinished(session) {
    MoveClock.stop();
    if (!this.active) return;
    const finished = Player.match && Player.match.endReason === "finished";
    const capped =
      session.mode === "against_computers" && session.moves.length >= 100;
    if (!finished && !capped) {
      Log.add("info", "the match ended without finishing; restarting it");
      if (this.step === 3 || this.step === 5) return this.startCombo();
      if (this.step === 4) return this.startConfig4();
      return;
    }
    if (session.mode === "against_computers") {
      // Every move was verified on the server as it was appended. A
      // session that reached a terminal move is already verified; one
      // stopped at the 100-move cap is closed (and thereby verified)
      // here — it may end mid-match.
      if (!session.serverFinished) {
        try {
          await Trace.closeSession(session);
        } catch (e) {
          this.fail(
            `Step 4: the server could not close the finished session: ${e.message}`,
          );
          return;
        }
      }
      this.config4Index++;
      $("step4-progress").textContent =
        `${this.config4Index} of ${this.configs4.length} matches played`;
      if (this.config4Index >= this.configs4.length) {
        this.active = false;
        this.card(4, "done", "Passed");
        this.step = 5;
        this.refreshButtons();
      } else {
        await this.startConfig4();
      }
      return;
    }
    if (!session.serverFinished) {
      // The page thinks the match ended, but the server's per-move
      // record never saw a terminal move (its last recorded move still
      // has a next turn). Treat it like an unfinished match and restart
      // the combo; starting the new session abandons this one.
      Log.add(
        "info",
        "the server has not recorded a terminal move for this match; restarting it",
      );
      if (this.step === 3 || this.step === 5) return this.startCombo();
      return;
    }
    this.comboIndex++;
    const step = this.step;
    $(`step${step}-progress`).textContent =
      `${this.comboIndex} of ${this.combos.length} matches verified`;
    if (this.comboIndex >= this.combos.length) {
      this.active = false;
      this.card(step, "done", "Passed");
      if (step === 3) {
        this.step = 4;
        this.refreshButtons();
      } else {
        this.finish();
      }
    } else {
      await this.startCombo();
    }
  },

  finish() {
    this.step = 6;
    this.card(5, "done", "Passed");
    $("submission-json").value = pretty(this.submittedBody);
    $("flow-finish").hidden = false;
    this.refreshButtons();
    Log.add(
      "info",
      "the test flow is complete — submit the payload with POST /games",
    );
  },
};

// ---------------------------------------------------------------------------
// UI wiring.
// ---------------------------------------------------------------------------

function populateSeats() {
  const count = Number($("player-count").value) || 2;
  const select = $("my-seat");
  const previous = select.value;
  select.replaceChildren();
  for (let i = 0; i < count; i++) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `Seat ${i} (Player ${i + 1})`;
    select.appendChild(option);
  }
  const viewer = document.createElement("option");
  viewer.value = "viewer";
  viewer.textContent = "Viewer (watch only)";
  select.appendChild(viewer);
  select.value = [...select.options].some((o) => o.value === previous)
    ? previous
    : "0";
  const mode = $("mode").value;
  $("my-seat-row").style.display = mode === "single-pass" ? "none" : "";
  Player.refreshButtons();
}

async function runChecksUi() {
  const button = $("run-checks");
  const status = $("check-status");
  const resultsEl = $("check-results");
  button.disabled = true;
  button.textContent = "Running checks…";
  status.textContent = "Running…";
  status.className = "check-status running";
  resultsEl.replaceChildren();
  Log.add("info", "checks started");
  const { inputs, errors } = readInputs();
  if (errors.length) {
    status.textContent = "Fix the inputs first";
    status.className = "check-status failed";
    const li = document.createElement("li");
    li.className = "failed";
    li.textContent = errors.join("; ");
    resultsEl.appendChild(li);
    button.disabled = false;
    button.textContent = "Run the platform checks";
    return;
  }
  const results = await runChecks(inputs, (update) => {
    if (update && update.walks !== undefined) {
      status.textContent = `Running… random walks: ${update.walks} walks, ${update.moves} moves`;
      return;
    }
    if (update && update.name) {
      const li = document.createElement("li");
      li.className = update.status;
      li.textContent = `${update.name}: ${update.status}`;
      resultsEl.appendChild(li);
    }
  });
  resultsEl.replaceChildren();
  let failed = 0;
  let skipped = 0;
  for (const result of results) {
    if (result.status === "failed") failed++;
    if (result.status === "skipped") skipped++;
    const li = document.createElement("li");
    li.className = result.status;
    const head = document.createElement("strong");
    head.textContent = `${result.name}: ${result.status}`;
    li.appendChild(head);
    const details = document.createElement("pre");
    details.textContent = result.details.join("\n\n");
    li.appendChild(details);
    resultsEl.appendChild(li);
    Log.add(
      "info",
      `${result.name}: ${result.status} — ${result.details.join(" | ")}`,
    );
  }
  if (failed) {
    status.textContent = `${failed} check${failed === 1 ? "" : "s"} failed` +
      (skipped ? `, ${skipped} skipped` : "");
    status.className = "check-status failed";
  } else if (skipped) {
    status.textContent = `All checks passed (${skipped} skipped — paste unit test cases to run them)`;
    status.className = "check-status passed";
  } else {
    status.textContent = "All checks passed";
    status.className = "check-status passed";
  }
  button.disabled = false;
  button.textContent = "Run the platform checks";
  Log.add("info", `checks finished: ${status.textContent}`);
}

function fillForm(example) {
  const tests = example.unit_tests || {};
  $("game-name").value = example.name || "";
    $("game-secret").value = example.game_addition_request_id_and_secret || "";
    $("description").value = example.description || "";
    $("server-code").value = example.server_code || "";
    $("client-code").value = example.client_code || "";
    $("schema-state").value = pretty(tests.state_schema || {});
    $("schema-view").value = pretty(tests.view_schema || {});
    $("schema-move").value = pretty(tests.move_schema || {});
    $("cases").value = pretty(tests.cases || []);
    $("allowed-player-counts").value = (example.allowed_player_counts || [2]).join(", ");
    $("allows-leave").checked = !!example.allows_leave_mid_match;
    $("allows-join").checked = !!example.allows_join_mid_match;
    $("language").value = example.language || "en";
    $("rules-text").value = example.rules || "";
    $("ui-text").value = example.ui_instructions || "";
    $("tutorial-text").value = (example.tutorial || {}).text || "";
    $("tutorial-html").value = (example.tutorial || {}).html || "";
    $("images-json").value = pretty(example.images || []);
    $("translations-json").value = pretty(example.translations || {});
    $("player-count").value = String((example.allowed_player_counts || [2])[0]);
    populateSeats();
}

async function loadExample() {
  try {
    const response = await fetch("/static/game-test-example.json");
    const example = await response.json();
    Flow.abandon();
    fillForm(example);
    Log.add("info", "loaded the counter example (\"Count to three\")");
  } catch (e) {
    Log.add("error", `could not load the example: ${e.message}`);
  }
}

async function loadBySecret() {
  const secret = $("game-secret").value;
  if (!secret) {
    Log.add("error", "type the game's secret first, then load its stored inputs");
    return;
  }
  try {
    const response = await fetch(
      `/game-test/submission?secret=${encodeURIComponent(secret)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
    Flow.abandon();
    fillForm(data.body);
    Flow.adoptSubmission(
      data.body, data.submission_id, data.created_at,
      `step 1 loaded from the stored inputs: submission ${data.submission_id}`);
    await Flow.resumeFromServer();
  } catch (e) {
    Log.add("error", `could not load stored inputs: ${e.message}`);
  }
}

function init() {
  const resolutionSelect = $("resolution");
  RESOLUTIONS.forEach((entry, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = entry.label;
    resolutionSelect.appendChild(option);
  });
  $("run-checks").addEventListener("click", runChecksUi);
  $("load-example").addEventListener("click", loadExample);
  $("load-by-secret").addEventListener("click", loadBySecret);
  $("step1-submit").addEventListener("click", () => Flow.step1());
  $("step2-run").addEventListener("click", () => Flow.step2());
  $("step3-start").addEventListener("click", () => Flow.startPlayStep(3));
  $("step4-start").addEventListener("click", () => Flow.startStep4());
  $("step5-start").addEventListener("click", () => Flow.startPlayStep(5));
  const inputsSection = document.querySelector(
    "section[aria-labelledby='inputs-heading']",
  );
  if (inputsSection) {
    inputsSection.addEventListener("input", () => Flow.inputsChanged());
    inputsSection.addEventListener("change", () => Flow.inputsChanged());
  }
  $("move-alert-dismiss").addEventListener("click", () => MoveAlert.hide());
  $("move-alert-restart").addEventListener("click", () => location.reload());
  $("new-match").addEventListener("click", () => Player.newMatch());
  $("back").addEventListener("click", () => Player.goBack());
  $("forward").addEventListener("click", () => Player.goForward());
  $("leave").addEventListener("click", () => Player.leaveMatch());
  $("join").addEventListener("click", () => Player.joinMatch());
  $("mode").addEventListener("change", populateSeats);
  $("player-count").addEventListener("change", populateSeats);
  $("my-seat").addEventListener("change", () => {
    if (Player.match) Player.sendStateChanged(null);
  });
  $("resolution").addEventListener("change", () => Player.applyResolution());
  $("orientation").addEventListener("change", () => Player.applyResolution());
  window.addEventListener("resize", () => Player.applyResolution());
  window.addEventListener("message", (event) => {
    const entry = Player.frames.find(
      (e) => e.frame.contentWindow && e.frame.contentWindow === event.source,
    );
    if (!entry) return;
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "game_viewport") { Player.fitViewport(message, entry); return; }
    // The game's handshake: its listener is installed, so this frame's
    // ready gate opens and its first state_changed can go out. "ready" is
    // the spelling some already-published games use; both are accepted.
    if (message.type === "game_ready" || message.type === "ready") { entry.openGate?.(); return; }
    if (message.type !== "make_move") {
      Log.add("warn", `ignored a message that is not make_move: ${JSON.stringify(message)}`);
      return;
    }
    if (entry.seat !== null && entry.seat !== undefined) {
      Player.messageSeat = entry.seat;
    }
    Player.onMakeMove(message);
  });
  populateSeats();
  Player.applyResolution();
  Log.add("info", "game test page ready — paste a game or load the counter example");
}

// The pure check functions, exposed for a Node harness (the UI init runs
// only when a document exists).
var GameTest = {
  ServerHost,
  lintClientCode,
  extractStrings,
  compileTemplates,
  matchTemplate,
  verifyExamples,
  probeLeaving,
  probeMoveAgreement,
  testServerCode,
  runChecks,
  readInputs,
  buildImportBody,
  Walk,
  RESOLUTIONS,
};
if (typeof window !== "undefined") {
  window.GameTest = GameTest;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
