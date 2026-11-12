// The server-code host for the game test page (/game-test). It runs in a Web
// Worker, so a game's code cannot touch the page and a runaway call can be
// stopped by terminating the worker. The game host below is copied from
// game_platform/game_logic.py (_PRELUDE): the same seeded mulberry32 RNG,
// frozen Date, JSON Schema validator and ctx.estimateWinChance the platform
// runs in QuickJS. Keep it in sync with _PRELUDE when that changes.
//
// Differences from the platform: no per-call time or memory limit is
// enforced here (the page uses a wall-clock watchdog instead and cannot
// measure memory), and a schema failure says only which schema failed, not
// the exact path. The platform re-runs its own checks at submit time.
//
// Protocol (postMessage):
//   {type:"load", serverCode, schemas} ->
//     {type:"loaded", ok, functions, error}
//   {type:"call", id, name, args, ctx, seed, now} ->
//     {type:"result", id, ok, result, usedRandom, kind, message}
// A call that throws InvalidMove in the game code answers ok:false with
// kind "invalid_move"; any other game bug answers kind "error".

let __gameSchemas = {};


class InvalidMove extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidMove";
  }
}

// Deterministic randomness (mulberry32). The generator is reseeded by
// __invoke on every call, so Math.random and ctx.random draw from the
// same reproducible sequence for that call and no call can leak RNG
// state into the next one.
let __rngState = 0;
let __usedRandom = false;
function __seedRandom(seed) {
  __usedRandom = false;
  __rngState = seed >>> 0;
}
function __random() {
  __usedRandom = true;
  __rngState = (__rngState + 0x6D2B79F5) | 0;
  let t = __rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = __random;

// A frozen clock: a no-argument Date is the move's time (set by __invoke
// on every call) and Date.now() agrees with it, so a replay sees exactly
// the same time as the original call.
const __RealDate = Date;
let __frozenMillis = 0;
class __FrozenDate extends __RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(__frozenMillis);
    } else {
      super(...args);
    }
  }
  static now() {
    return __frozenMillis;
  }
  static parse(text) {
    return __RealDate.parse(text);
  }
  static UTC(...args) {
    return __RealDate.UTC(...args);
  }
}
Date = __FrozenDate;

// Monte-Carlo win estimate, exposed to game code as
// ctx.estimateWinChance(state, playerId, turn?): plays the game out from
// the given state with randomMove (or computerMove when the game defines
// no randomMove), up to __ESTIMATE_WALKS times, and returns the fraction
// of walks the player wins — a walk is won when the player's final payout
// is the largest (a tie for largest counts as an equal share of a win).
// [turn], when given, is who may move first; without it, the first mover
// is discovered by trying each player until one can move. The walk and
// move caps keep the estimate bounded (about a second for typical
// games), and because every random draw comes from the call's seeded
// generator the estimate is deterministic for a given call. A walk that
// errors or does not finish within the move cap counts as played but
// not won.
const __ESTIMATE_WALKS = 100;
const __ESTIMATE_MAX_MOVES = 200;
// Long games with large schemas otherwise perform 20,000 simulated moves
// and can exceed playerLeft's time limit. Count work, never elapsed time,
// so the same inputs still produce the same quote on every machine.
const __ESTIMATE_MOVE_BUDGET = 2000;
function __schemaTypeMatches(type, value) {
  switch (type) {
    case "null": return value === null;
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    default: return false;
  }
}
function __schemaDeepEqual(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((item, index) =>
        __schemaDeepEqual(item, right[index]));
  }
  if (typeof left !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] &&
      __schemaDeepEqual(left[key], right[key]));
}
function __resolveSchemaRef(ref, root) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  let value = root;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (value === null || typeof value !== "object" || !(key in value)) return null;
    value = value[key];
  }
  return value;
}
function __schemaIsValid(schema, value, root, depth) {
  if (depth > 128) return false;
  if (schema === true) return true;
  if (schema === false || schema === null || typeof schema !== "object") return false;
  if ("$ref" in schema) {
    const target = __resolveSchemaRef(schema.$ref, root);
    if (target === null || !__schemaIsValid(target, value, root, depth + 1)) return false;
  }
  if ("type" in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => __schemaTypeMatches(type, value))) return false;
  }
  if ("const" in schema && !__schemaDeepEqual(value, schema.const)) return false;
  if (Array.isArray(schema.enum) &&
      !schema.enum.some(item => __schemaDeepEqual(value, item))) return false;
  if (Array.isArray(schema.allOf) &&
      !schema.allOf.every(item => __schemaIsValid(item, value, root, depth + 1))) return false;
  if (Array.isArray(schema.anyOf) &&
      !schema.anyOf.some(item => __schemaIsValid(item, value, root, depth + 1))) return false;
  if (Array.isArray(schema.oneOf) &&
      schema.oneOf.filter(item => __schemaIsValid(item, value, root, depth + 1)).length !== 1) return false;
  if ("not" in schema && __schemaIsValid(schema.not, value, root, depth + 1)) return false;
  if ("if" in schema) {
    const branch = __schemaIsValid(schema.if, value, root, depth + 1)
      ? schema.then : schema.else;
    if (branch !== undefined && !__schemaIsValid(branch, value, root, depth + 1)) return false;
  }
  if (typeof value === "number") {
    if ("minimum" in schema && value < schema.minimum) return false;
    if ("maximum" in schema && value > schema.maximum) return false;
    if ("exclusiveMinimum" in schema && value <= schema.exclusiveMinimum) return false;
    if ("exclusiveMaximum" in schema && value >= schema.exclusiveMaximum) return false;
    if ("multipleOf" in schema &&
        Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-10) return false;
  }
  if (typeof value === "string") {
    if ("minLength" in schema && Array.from(value).length < schema.minLength) return false;
    if ("maxLength" in schema && Array.from(value).length > schema.maxLength) return false;
    if ("pattern" in schema && !(new RegExp(schema.pattern)).test(value)) return false;
  }
  if (Array.isArray(value)) {
    if ("minItems" in schema && value.length < schema.minItems) return false;
    if ("maxItems" in schema && value.length > schema.maxItems) return false;
    if (schema.uniqueItems &&
        value.some((item, index) => value.slice(index + 1).some(other =>
          __schemaDeepEqual(item, other)))) return false;
    const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
    for (let index = 0; index < prefix.length && index < value.length; index++) {
      if (!__schemaIsValid(prefix[index], value[index], root, depth + 1)) return false;
    }
    if (schema.items !== undefined) {
      for (let index = prefix.length; index < value.length; index++) {
        if (!__schemaIsValid(schema.items, value[index], root, depth + 1)) return false;
      }
    }
    if (schema.contains !== undefined) {
      const matches = value.filter(item =>
        __schemaIsValid(schema.contains, item, root, depth + 1)).length;
      if (matches < (schema.minContains === undefined ? 1 : schema.minContains)) return false;
      if (schema.maxContains !== undefined && matches > schema.maxContains) return false;
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if ("minProperties" in schema && keys.length < schema.minProperties) return false;
    if ("maxProperties" in schema && keys.length > schema.maxProperties) return false;
    if (Array.isArray(schema.required) &&
        !schema.required.every(key => Object.prototype.hasOwnProperty.call(value, key))) return false;
    if (schema.propertyNames !== undefined &&
        !keys.every(key => __schemaIsValid(schema.propertyNames, key, root, depth + 1))) return false;
    for (const [key, child] of Object.entries(value)) {
      let declared = false;
      if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, key)) {
        declared = true;
        if (!__schemaIsValid(schema.properties[key], child, root, depth + 1)) return false;
      }
      for (const [pattern, propertySchema] of Object.entries(schema.patternProperties || {})) {
        if ((new RegExp(pattern)).test(key)) {
          declared = true;
          if (!__schemaIsValid(propertySchema, child, root, depth + 1)) return false;
        }
      }
      if (!declared && schema.additionalProperties !== undefined &&
          !__schemaIsValid(schema.additionalProperties, child, root, depth + 1)) return false;
    }
    for (const [key, required] of Object.entries(schema.dependentRequired || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key) &&
          !required.every(dependency => Object.prototype.hasOwnProperty.call(value, dependency))) return false;
    }
    for (const [key, dependent] of Object.entries(schema.dependentSchemas || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key) &&
          !__schemaIsValid(dependent, value, root, depth + 1)) return false;
    }
  }
  return true;
}
function __gameSchemaIsValid(name, value) {
  return __schemaIsValid(__gameSchemas[name], value, __gameSchemas[name], 0);
}
function __estimateWalk(ctx, moveFor, state, firstTurn, budget) {
  // One walk: the final payouts object, or null when the walk fails or
  // the game does not end within the move cap.
  let current = JSON.parse(JSON.stringify(state === undefined ? null : state));
  let turn = firstTurn ? firstTurn.slice() : null;
  for (let step = 0; step < __ESTIMATE_MAX_MOVES; step++) {
    if (turn === null) {
      // First step, and the caller did not say whose turn it is: try
      // each player until one can actually move.
      let moved = false;
      for (const candidate of ctx.players) {
        if (budget.remaining-- <= 0) return null;
        try {
          __assertEstimateSchema("state", current);
          const move = moveFor.call(game, current, candidate.id, ctx);
          __assertEstimateSchema("move", move);
          const result = game.applyMove(current, candidate.id, move, ctx);
          __assertEstimateSchema("state", result.state);
          current = result.state;
          if (result.turn === null) return result.payouts || null;
          turn = result.turn;
          moved = true;
          break;
        } catch (e) {
          if (e && e.gameSchemaFailure) throw e;
        }
      }
      if (!moved) return null;
      continue;
    }
    if (turn.length === 0) return null;
    if (budget.remaining-- <= 0) return null;
    const mover = turn[Math.floor(__random() * turn.length)];
    let result;
    try {
      __assertEstimateSchema("state", current);
      const move = moveFor.call(game, current, mover, ctx);
      __assertEstimateSchema("move", move);
      result = game.applyMove(current, mover, move, ctx);
      __assertEstimateSchema("state", result.state);
    } catch (e) {
      if (e && e.gameSchemaFailure) throw e;
      return null;
    }
    current = result.state;
    if (result.turn === null) return result.payouts || null;
    turn = result.turn;
  }
  return null;
}
function __assertEstimateSchema(schemaName, value) {
  if (value === undefined || !__gameSchemaIsValid(schemaName, value)) {
    const error = new Error("invalid " + schemaName + " in estimateWinChance");
    error.gameSchemaFailure = true;
    throw error;
  }
}
function __estimateWinChance(ctx, state, playerId, firstTurn) {
  const moveFor = typeof game.randomMove === "function" ? game.randomMove
    : typeof game.computerMove === "function" ? game.computerMove : null;
  if (moveFor === null || typeof game.applyMove !== "function") return 0;
  let score = 0;
  let played = 0;
  const budget = {remaining: __ESTIMATE_MOVE_BUDGET};
  for (let walk = 0; walk < __ESTIMATE_WALKS && budget.remaining > 0; walk++) {
    played++;
    const payouts = __estimateWalk(ctx, moveFor, state, firstTurn, budget);
    if (payouts === null) continue;
    const mine = payouts[playerId] || 0;
    let best = 0;
    let tied = 0;
    for (const id of Object.keys(payouts)) {
      if (payouts[id] > best) { best = payouts[id]; tied = 1; }
      else if (payouts[id] === best) { tied++; }
    }
    if (mine > 0 && mine === best) score += 1 / tied;
  }
  return played ? score / played : 0;
}

// Calls one game function and reports the outcome as a JSON envelope:
//   {"ok": true, "result": <the function's JSON result>}
//   {"ok": false, "kind": "invalid_move", "message": ...}
//   {"ok": false, "kind": "error", "message": ..., "stack": ...}
// inputJson contains the function arguments (without ctx) and ctx.
function __invoke(name, inputJson, seed, frozenMillis) {
  __seedRandom(seed);
  __frozenMillis = frozenMillis;
  try {
    const fn = (typeof game !== "undefined" && game !== null) ? game[name] : undefined;
    if (typeof fn !== "function") {
      return JSON.stringify({ok: false, kind: "error",
        message: "game." + name + " is not defined", stack: ""});
    }
    const input = JSON.parse(inputJson);
    const ctx = input.ctx;
    ctx.random = __random;
    ctx.estimateWinChance = function (state, playerId, turn) {
      return __estimateWinChance(ctx, state, playerId, turn);
    };
    const args = input.args;
    args.push(ctx);
    const result = fn.apply(game, args);
    const text = JSON.stringify(result === undefined ? null : result);
    if (text === undefined) {
      return JSON.stringify({ok: false, kind: "error",
        message: "game." + name + " returned a value that is not JSON", stack: ""});
    }
    return JSON.stringify({ok: true, used_random: __usedRandom, result: JSON.parse(text)});
  } catch (e) {
    if (e instanceof InvalidMove) {
      return JSON.stringify({ok: false, kind: "invalid_move",
        message: String(e.message || e)});
    }
    return JSON.stringify({ok: false, kind: "error",
      message: String((e && e.message) || e),
      stack: String((e && e.stack) || "")});
  }
}


const GAME_FUNCTIONS = [
  "newMatch",
  "applyMove",
  "computerMove",
  "randomMove",
  "viewFor",
  "playerJoined",
  "playerLeft",
];

function isInt(value) {
  return typeof value === "number" && Number.isInteger(value);
}

function fail(kind, message) {
  const error = new Error(message);
  error.kind = kind;
  throw error;
}

function schemaValid(name, value) {
  const schema = __gameSchemas[name];
  if (schema === undefined) return true;
  return __schemaIsValid(schema, value, schema, 0);
}

// Mirrors GameLogic._validate_inputs: the shape of ctx, the argument count
// of the function, and that a player id names a player in ctx.players.
function validateInputs(fn, args, ctx) {
  const expected = fn === "newMatch" ? 0 : fn === "applyMove" ? 3 : 2;
  if (args.length !== expected) {
    fail("error", `game.${fn} expected ${expected} arguments, got ${args.length}`);
  }
  if (
    !ctx || typeof ctx !== "object" || Array.isArray(ctx) ||
    !Array.isArray(ctx.players) || !isInt(ctx.pot) || ctx.pot < 0 ||
    !isInt(ctx.move_count) || ctx.move_count < 0
  ) {
    fail("error", "invalid platform ctx");
  }
  const ids = new Set();
  for (const player of ctx.players) {
    if (
      !player || typeof player !== "object" ||
      typeof player.id !== "string" || !player.id ||
      (player.kind !== "human" && player.kind !== "computer")
    ) {
      fail("error", "invalid player in platform ctx");
    }
    ids.add(player.id);
  }
  if (fn === "newMatch") return;
  if (!schemaValid("state", args[0])) {
    fail("error", `game.${fn} received invalid state`);
  }
  const playerId = args[1];
  if (fn === "viewFor") {
    if (playerId !== null && typeof playerId !== "string") {
      fail("error", "game.viewFor playerId must be a string or null");
    }
  } else {
    if (typeof playerId !== "string" || !playerId) {
      fail("error", `game.${fn} playerId must be a non-empty string`);
    }
    if (!ids.has(playerId)) {
      fail("error", `game.${fn} playerId is not in ctx.players`);
    }
  }
  if (fn === "applyMove" && !schemaValid("move", args[2])) {
    fail("invalid_move", "invalid move: does not match the move schema");
  }
}

// Mirrors GameLogic._validate_result and _validate_schema_result, plus the
// playerLeft rules in GameLogic._call: a turn is null or a non-empty set of
// current players, payouts go only to humans and — when the match ends —
// add up to the pot, and a leaver's payout is within the pot.
function validateResult(fn, result, ctx, args) {
  const players = ctx.players || [];
  const playerIds = new Set(players.map((p) => p.id));
  const activeIds = new Set(
    players.filter((p) => p.active !== false).map((p) => p.id),
  );
  const humanIds = new Set(
    players.filter((p) => p.kind === "human" && p.active !== false).map((p) => p.id),
  );
  const pot = ctx.pot;
  if (fn !== "computerMove" && fn !== "randomMove" && fn !== "viewFor") {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      fail("error", `game.${fn} must return an object, got ${JSON.stringify(result)}`);
    }
    if (
      fn === "newMatch" || fn === "applyMove" ||
      fn === "playerJoined" || fn === "playerLeft"
    ) {
      if (!("state" in result) || !("turn" in result)) {
        fail("error", `game.${fn} must return state and turn`);
      }
      if ("payout" in result) {
        fail("error", `game.${fn} must use payouts, not payout`);
      }
    }
  }
  // Views and generated moves are game-defined values. Their own `turn`,
  // `payout`, or `payouts` fields belong to the view/move schema, not to the
  // result envelope returned by a state-changing function.
  if (
    fn !== "computerMove" && fn !== "randomMove" && fn !== "viewFor" &&
    result && typeof result === "object" && !Array.isArray(result)
  ) {
    if ("turn" in result && result.turn !== null) {
      const turn = result.turn;
      if (!Array.isArray(turn) || turn.length === 0) {
        fail("error", `game.${fn} returned an empty or non-list turn`);
      }
      if (
        turn.some((id) => typeof id !== "string") ||
        new Set(turn).size !== turn.length
      ) {
        fail("error", `game.${fn} returned invalid or duplicate turn ids`);
      }
      const unknown = turn.filter((id) => !activeIds.has(id));
      if (playerIds.size && unknown.length) {
        fail("error", `game.${fn} returned a turn naming non-players: ${unknown.join(", ")}`);
      }
    }
    const payouts = result.payouts;
    if (
      (fn === "applyMove" || fn === "playerLeft") &&
      result.turn === null && pot && payouts === undefined
    ) {
      fail("error", `game.${fn} ended without payouts for the pot`);
    }
    if (payouts !== undefined) {
      if (!payouts || typeof payouts !== "object" || Array.isArray(payouts)) {
        fail("error", `game.${fn} returned non-object payouts`);
      }
      for (const [playerId, amount] of Object.entries(payouts)) {
        if (!isInt(amount) || amount < 0) {
          fail("error", `game.${fn} paid a non-integer or negative amount to ${playerId}`);
        }
        if (playerIds.size && !humanIds.has(playerId)) {
          fail("error", `game.${fn} paid tokens to non-human ${playerId}`);
        }
      }
      const total = Object.values(payouts).reduce((a, b) => a + b, 0);
      if (result.turn === null && pot !== undefined && pot !== null) {
        if (total !== pot) {
          fail("error", `game.${fn} payouts add up to ${total}, not the pot of ${pot}`);
        }
      } else if (pot !== undefined && pot !== null && total > pot) {
        fail("error", `game.${fn} payouts exceed the pot`);
      }
    }
    const payout = result.payout;
    if (payout !== undefined) {
      if (!isInt(payout) || payout < 0) {
        fail("error", `game.${fn} returned an invalid payout ${JSON.stringify(payout)}`);
      }
      if (pot !== undefined && pot !== null && payout > pot) {
        fail("error", `game.${fn} paid a leaver ${payout}, more than the pot of ${pot}`);
      }
    }
  }
  let schemaName = null;
  let value;
  if (fn === "computerMove" || fn === "randomMove") {
    schemaName = "move";
    value = result;
  } else if (fn === "viewFor") {
    schemaName = "view";
    value = result;
  } else if (
    fn === "newMatch" || fn === "applyMove" ||
    fn === "playerJoined" || fn === "playerLeft"
  ) {
    if (result && typeof result === "object" && "state" in result) {
      schemaName = "state";
      value = result.state;
    }
  }
  if (schemaName !== null && !schemaValid(schemaName, value)) {
    fail("error", `game.${fn} returned invalid ${schemaName}`);
  }
  if (fn === "playerLeft" && result && typeof result === "object") {
    const leaver = args[1];
    if (result.turn !== null && result.turn !== undefined && result.turn.includes(leaver)) {
      fail("error", "game.playerLeft returned a turn for the departing player");
    }
    const remaining = players.filter(
      (p) => p.kind === "human" && p.active !== false && p.id !== leaver,
    );
    if (result.turn !== null && result.turn !== undefined && remaining.length < 2) {
      fail("error", "game.playerLeft must end the match when fewer than two humans remain");
    }
  }
}

// Mirrors GameLogic._legacy_leave_result: an old playerLeft that returns a
// scalar payout settles the match with the leaver paid that amount (or the
// whole pot when alone) and the rest split evenly among the other humans.
function legacyLeaveResult(result, leaverId, ctx) {
  const pot = ctx.pot || 0;
  const payout = result.payout || 0;
  const humans = ctx.players
    .filter((p) => p.kind === "human" && p.active !== false)
    .map((p) => p.id);
  const others = humans.filter((id) => id !== leaverId);
  const payouts = { [leaverId]: others.length ? payout : pot };
  if (others.length) {
    const remaining = pot - payout;
    const share = Math.floor(remaining / others.length);
    const extra = remaining % others.length;
    others.forEach((id, i) => {
      payouts[id] = share + (i < extra ? 1 : 0);
    });
  }
  return { state: result.state, turn: null, payouts };
}

onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === "load") {
    try {
      __gameSchemas = msg.schemas || {};
      globalThis.game = undefined;
      // new Function captures the game's `game` binding (const, let, var or
      // implicit global) and returns it; a plain eval would lose a const.
      const factory = new Function(
        `${msg.serverCode}\n;return typeof game !== "undefined" ? game : undefined;`,
      );
      const captured = factory();
      if (!captured || typeof captured !== "object") {
        throw new Error("the game's server code does not define a global `game` object");
      }
      globalThis.game = captured;
      const functions = {};
      for (const fn of GAME_FUNCTIONS) {
        functions[fn] = typeof globalThis.game[fn] === "function";
      }
      postMessage({ type: "loaded", ok: true, functions });
    } catch (e) {
      postMessage({ type: "loaded", ok: false, error: String((e && e.message) || e) });
    }
    return;
  }
  if (msg.type !== "call") return;
  try {
    validateInputs(msg.name, msg.args, msg.ctx);
    const inputJson = JSON.stringify({ args: msg.args, ctx: msg.ctx });
    const envelopeText = __invoke(msg.name, inputJson, (msg.seed || 0) >>> 0, msg.now || 0);
    const envelope = JSON.parse(envelopeText);
    if (!envelope.ok) {
      postMessage({
        type: "result",
        id: msg.id,
        ok: false,
        kind: envelope.kind || "error",
        message: envelope.message || "game call failed",
      });
      return;
    }
    let result = envelope.result;
    if (
      msg.name === "playerLeft" && result && typeof result === "object" &&
      "payout" in result
    ) {
      if ("payouts" in result) {
        throw new Error("game.playerLeft cannot return both payout and payouts");
      }
      if (!isInt(result.payout) || result.payout < 0) {
        throw new Error(`game.playerLeft returned an invalid payout ${JSON.stringify(result.payout)}`);
      }
      if (result.payout > (msg.ctx.pot || 0)) {
        throw new Error(`game.playerLeft paid a leaver ${result.payout}, more than the pot of ${msg.ctx.pot}`);
      }
      result = legacyLeaveResult(result, msg.args[1], msg.ctx);
    }
    validateResult(msg.name, result, msg.ctx, msg.args);
    postMessage({
      type: "result",
      id: msg.id,
      ok: true,
      result,
      usedRandom: !!envelope.used_random,
    });
  } catch (e) {
    postMessage({
      type: "result",
      id: msg.id,
      ok: false,
      kind: (e && e.kind) || "error",
      message: String((e && e.message) || e),
    });
  }
};
