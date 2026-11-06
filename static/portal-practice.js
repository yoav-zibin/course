"use strict";
// Same deterministic v2 contract as game_logic.py. A parity test guards this copy.
const PRACTICE_PRELUDE = String.raw`
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
`;

// Runs inside a Worker in an opaque-origin sandbox. Never evaluate game code in
// the portal: it must not have access to account credentials, storage or network.
function practiceWorker(prelude) {
  self.onmessage = ({data}) => {
    try {
      const schemas = "const __gameSchemas = " + JSON.stringify(data.game_schemas) + ";\n";
      const invoke = new Function(schemas + prelude + "\n" + data.code + "\nreturn __invoke;")();
      self.postMessage(JSON.parse(invoke(data.name,
        JSON.stringify({args:data.args,ctx:data.ctx}), data.seed, data.now)));
    } catch (error) {
      self.postMessage({ok:false, message:String(error.message || error)});
    }
  };
}

class PortalPractice {
  static call(game, name, args, match) {
    if (!game.game_schemas) return Promise.reject(new Error(I18n.t("ui.practice.schemas_unavailable", {}, "Game schemas are unavailable for local practice.")));
    const payload = {code:game.server_code, game_schemas:game.game_schemas, name, args,
      ctx:{players:match.players.map(p=>({id:p.id,kind:p.kind,
        display_name:p.name || `Player ${p.player_index+1}`,picture_url:"",max_loss:0})),
        pot:0,move_count:match.move_count},
      seed:((match.practiceSeed || 0)+match.move_count)>>>0,
      now:Date.parse(match.created_at)};
    return new Promise((resolve,reject)=>{
      const frame=document.createElement("iframe");
      frame.hidden=true;
      frame.setAttribute("sandbox","allow-scripts");
      frame.setAttribute("title",I18n.t("ui.practice.rules_title", {}, "Local practice rules"));
      const workerSource=`(${practiceWorker.toString()})(${JSON.stringify(PRACTICE_PRELUDE)})`;
      // JSON encoding plus '<' escaping prevents game source from ending srcdoc's script.
      const script=`const worker=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}],{type:"text/javascript"})));window.onmessage=e=>{if(e.source===parent)worker.postMessage(e.data);};worker.onmessage=e=>parent.postMessage(e.data,"*");worker.onerror=()=>parent.postMessage({ok:false,message:"Local game failed to run"},"*");`;
      frame.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'"><script>${script.replace(/</g,"\u003c")}<`+"/script>";
      let timer;
      const finish=(error,result)=>{
        clearTimeout(timer);window.removeEventListener("message",receive);frame.remove();
        error ? reject(error) : resolve(result);
      };
      const receive=event=>{
        if(event.source!==frame.contentWindow)return;
        const reply=event.data;
        if(!reply || typeof reply.ok!=="boolean")return;
        finish(reply.ok ? null : new Error(reply.message || I18n.t("ui.practice.failed", {}, "Local game failed")),reply.result);
      };
      window.addEventListener("message",receive);
      frame.onload=()=>frame.contentWindow.postMessage(payload,"*");
      // Terminating the iframe also terminates a Worker stuck in game code.
      timer=setTimeout(()=>finish(new Error(I18n.t("ui.practice.timeout", {}, "Local game took too long. Your last saved position is unchanged."))),3000);
      document.body.append(frame);
    });
  }
}
if(typeof module!=="undefined")module.exports={PortalPractice,PRACTICE_PRELUDE,practiceWorker};
