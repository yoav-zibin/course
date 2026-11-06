"use strict";

const $ = id => document.getElementById(id);
const devices = [
  ["Laptop", 1366, 768], ["Tablet", 768, 1024],
  ["Small phone", 320, 568], ["Phone", 390, 844], ["Large phone", 430, 932],
];
let run = null;
let replayToken = 0;
let switching = false;
let wakeReplay = null;
const randomRequests = new Map();
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
};
const copy = value => JSON.parse(JSON.stringify(value));
const user = () => {
  const account = Auth.current();
  if (!account) throw new Error("Sign in before using the test matrix.");
  return account;
};
const draftId = new URLSearchParams(location.search).get("draft");
if (draftId) $("load-draft").hidden = false;
async function loadDraft() {
  const owner = user();
  const draft = await apiRequest("GET", "/game-drafts/" + encodeURIComponent(draftId), {user:owner});
  if (user().id !== owner.id) throw new Error("The signed-in account changed before the draft loaded.");
  if (!draft.code || !draft.server_code || !draft.allowed_player_counts?.length)
    throw new Error("This draft does not yet contain a complete server-side game.");
  if (($("client-code").value || $("server-code").value) &&
      !confirm("Replace the code currently in the test matrix with this draft?")) return;
  $("client-code").value = draft.code;
  $("server-code").value = draft.server_code;
  $("counts").value = draft.allowed_player_counts.join(",");
  $("count").value = String(draft.allowed_player_counts[0]);
  status("Builder draft loaded. Start the matrix to test it.");
}
$("load-draft").addEventListener("click", () => loadDraft().catch(showError));
function sessionUser(current) {
  const account = user();
  if (account.id !== current.owner.id) throw new Error("The signed-in account changed. Switch back to save or continue this session.");
  return account;
}

// Runs in the same opaque sandbox as the game, never in the host page.
function clickProbe() {
  function parse(value) {
    const m = value.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null;
  }
  function luminance(rgb) {
    const c = rgb.slice(0, 3).map(v => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  }
  function measure(node, x, y) {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    let bg = null, uncertain = Number(style.opacity) !== 1;
    for (let current = node; current; current = current.parentElement) {
      const s = getComputedStyle(current), color = parse(s.backgroundColor);
      if (s.backgroundImage !== "none" || Number(s.opacity) !== 1) uncertain = true;
      if (color && color[3] === 1) { bg = color; break; }
      if (color && color[3] !== 0) uncertain = true;
    }
    const fg = parse(style.color);
    if (!bg) bg = [255, 255, 255, 1];
    let contrast = null;
    if (!uncertain && fg && fg[3] === 1) {
      const a = luminance(fg), b = luminance(bg);
      contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    }
    const size = parseFloat(style.fontSize), weight = parseInt(style.fontWeight, 10);
    return {width:rect.width, height:rect.height,
      contrast, minimumContrast:size >= 24 || (size >= 18.667 && weight >= 700) ? 3 : 4.5,
      tag:node.tagName, x, y};
  }
  document.addEventListener("click", event => {
    const node = event.target instanceof Element
      ? event.target.closest("button,a,input,select,textarea,[role=button],[tabindex]") || event.target : null;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const x = event.isTrusted ? event.clientX : rect.left + rect.width / 2;
    const y = event.isTrusted ? event.clientY : rect.top + rect.height / 2;
    parent.postMessage({type:"test_click", ...measure(node, x, y)}, "*");
  }, true);
  addEventListener("message", event => {
    if (event.source !== parent || event.data?.type !== "test_random_click" ||
        typeof event.data.id !== "string") return;
    const candidates = [...document.querySelectorAll("button,[role=button],input[type=button],input[type=submit]")]
      .filter(node => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return !node.disabled && node.getAttribute("aria-disabled") !== "true" &&
          style.display !== "none" && style.visibility === "visible" &&
          rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 &&
          rect.right <= innerWidth && rect.bottom <= innerHeight && (hit === node || node.contains(hit));
      });
    if (!candidates.length) {
      parent.postMessage({type:"test_random_result", id:event.data.id, error:"No visible enabled button is available."}, "*");
      return;
    }
    const node = candidates[Math.floor(Math.random() * candidates.length)];
    const rect = node.getBoundingClientRect();
    const metrics = measure(node, rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (metrics.width < 30 || metrics.height < 30 ||
        metrics.contrast === null || metrics.contrast < metrics.minimumContrast) {
      parent.postMessage({type:"test_random_result", id:event.data.id,
        error:metrics.contrast === null ? "Cannot determine contrast for a selected button." :
          `Selected button: ${metrics.width.toFixed(1)}×${metrics.height.toFixed(1)} pixels, contrast ${metrics.contrast.toFixed(2)}:1 (minimum ${metrics.minimumContrast}:1).`}, "*");
      return;
    }
    node.click();
    parent.postMessage({type:"test_random_result", id:event.data.id}, "*");
  });
}

function documentSource(code) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
  const head = /<head(?:\s[^>]*)?>/i.exec(code);
  const doctype = /^\s*<!doctype\s+html[^>]*>/i.exec(code);
  const index = head ? head.index + head[0].length : doctype ? doctype[0].length : 0;
  return code.slice(0, index) + csp + code.slice(index) + "<script>(" + clickProbe.toString() + ")()<" + "/script>";
}

function createScenarios(count) {
  const result = [];
  for (const [device, w, h] of devices) {
    for (const [orientation, width, height] of [["portrait", Math.min(w,h), Math.max(w,h)], ["landscape", Math.max(w,h), Math.min(w,h)]]) {
      const modes = count === 1 ? [{mode:"solo", computers:0}] : [
        {mode:"computer", computers:count-1}, {mode:"pass", computers:0}, {mode:"multiplayer", computers:0},
        ...Array.from({length:Math.max(0,count-2)}, (_, i) => ({mode:"mixed", computers:i+1})),
      ];
      for (const {mode, computers} of modes) {
        const players = Array.from({length:count}, (_, index) => ({
          kind:index >= count - computers ? "computer" : "human",
          name:index >= count - computers ? `Computer ${index - (count - computers) + 1}` : `Player ${index + 1}`,
          max_loss:0,
        }));
        result.push({id:`${result.length}`, device, orientation, width, height, mode, computers,
          players, seed:crypto.getRandomValues(new Uint32Array(1))[0]});
      }
    }
  }
  return result;
}

function buildMatrix(recording, replaying) {
  const matrix = $("matrix");
  matrix.replaceChildren();
  matrix.classList.toggle("replaying", replaying);
  const states = new Map(), frames = new Map();
  for (const config of recording.scenarios) {
    const card = el("section", {class:"scenario"});
    const label = {solo:"Solo", computer:"One human vs computers", pass:"Pass-and-play", multiplayer:"Human multiplayer",
      mixed:`Mixed simulation (${config.computers} computer${config.computers === 1 ? "" : "s"}; not supported in Portal)`}[config.mode];
    const title = el("h2", {textContent:`${label} · ${config.device} · ${config.orientation} · ${config.width}×${config.height}`});
    const note = el("p", {textContent:"Waiting for a match."});
    const restart = el("button", {type:"button", textContent:"Restart match", disabled:replaying});
    const wrapper = el("div", {class:"frames"});
    const frameList = [];
    const frameCount = config.mode === "multiplayer" || config.mode === "mixed"
      ? config.players.filter(player => player.kind === "human").length : 1;
    for (let seat = 0; seat < frameCount; seat++) {
      const frame = el("iframe", {title:`${title.textContent} · player ${seat + 1}`});
      frame.setAttribute("sandbox", "allow-scripts");
      frame.style.width = config.width + "px";
      frame.style.height = config.height + "px";
      const ready = new Promise(resolve => frame.addEventListener("load", resolve, {once:true}));
      frame.srcdoc = documentSource(recording.client_code);
      const marker = el("span", {class:"click-marker", hidden:true});
      const item = {frame, ready, seat, marker};
      frameList.push(item);
      wrapper.append(el("div", {class:"viewport"}, el("strong", {textContent:config.mode === "multiplayer" || config.mode === "mixed" ? `Player ${seat + 1}` : "Shared screen"}), el("div", {class:"viewport-frame"}, frame, marker)));
    }
    const state = {config, card, title:title.textContent, note, restart, frames:frameList, reply:null, busy:false};
    restart.addEventListener("click", () => {
      if (!switching) resetScenario(state).catch(showError);
    });
    for (const item of frameList) frames.set(item.frame.contentWindow, {state, item});
    card.append(title, restart, note, wrapper);
    matrix.append(card);
    // contentWindow becomes available after insertion.
    for (const item of frameList) frames.set(item.frame.contentWindow, {state, item});
    states.set(config.id, state);
  }
  frames.delete(null);
  const selected = $("scenario-filter").value;
  $("scenario-filter").replaceChildren(el("option", {value:"", textContent:"All scenarios"}),
    ...[...states.values()].map(state => el("option", {value:state.config.id, textContent:state.title})));
  $("scenario-filter").value = states.has(selected) ? selected : "";
  return {states, frames};
}

function filterScenarios() {
  if (!run?.matrix) return;
  const selected = $("scenario-filter").value;
  for (const [id, state] of run.matrix.states) state.card.hidden = Boolean(selected && id !== selected);
  const ids = [...run.matrix.states.keys()];
  const index = ids.indexOf(selected);
  $("previous-scenario").disabled = index <= 0;
  $("next-scenario").disabled = ids.length === 0 || index === ids.length - 1;
  $("replay-selected").disabled = !selected;
}

function chooseScenario(delta) {
  if (!run?.matrix) return;
  const ids = [...run.matrix.states.keys()];
  const index = ids.indexOf($("scenario-filter").value);
  $("scenario-filter").value = ids[index + delta] ?? "";
  filterScenarios();
}

function showActiveScenario() {
  const state = run?.matrix?.states.get(run.activeScenario);
  if (!state) return;
  if ($("scenario-filter").value && $("scenario-filter").value !== state.config.id) {
    $("scenario-filter").value = state.config.id;
    filterScenarios();
  }
  state.card.scrollIntoView({block:"center", behavior:"auto"});
}

function showError(error) {
  if (run?.randomPlaying) run.randomError = error;
  status((run?.dirty ? "Unsaved recording: " : "") + (error.message || String(error)), true);
}

function noteClick(event) {
  const m = event.metrics;
  const problems = [];
  if (m.width < 30 || m.height < 30) problems.push(`target ${m.width.toFixed(1)}×${m.height.toFixed(1)} is below 30×30`);
  if (m.contrast === null) problems.push("contrast needs manual review (transparent or image background)");
  else if (m.contrast < m.minimumContrast) problems.push(`text contrast ${m.contrast.toFixed(2)}:1 is below ${m.minimumContrast}:1`);
  $("checks").textContent = problems.length ? "Click warning: " + problems.join("; ") : `Last clicked ${m.tag}: ${m.width.toFixed(1)}×${m.height.toFixed(1)}, text contrast ${m.contrast.toFixed(2)}:1. Check control boundaries separately.`;
}

function record(event) {
  if (!run || run.replaying) return;
  run.recording.events.push({...event, at:Math.round(performance.now() - run.started)});
  run.dirty++;
  clearTimeout(run.timer);
  run.timer = setTimeout(() => save().catch(showError), 500);
}

async function save() {
  const current = run;
  if (!current || current.replaying || !current.id) return;
  const owner = sessionUser(current);
  if (current.saving) { await current.saving; if (current.dirty) return save(); return; }
  if (!current.dirty) return;
  const version = current.dirty;
  const body = {revision:current.revision, recording:copy(current.recording)};
  current.saving = apiRequest("PUT", "/game-test-sessions/" + encodeURIComponent(current.id),
    {user:owner, body}).then(result => {
      current.revision = result.revision;
      current.dirty -= version;
      if (run === current) status(current.dirty ? "Saving recording…" : `Recording saved · ${current.id}`);
    }).catch(error => {
      if (run === current) status(`Recording not saved: ${error.message}. Use Save recording now to retry.`, true);
      throw error;
    }).finally(() => { current.saving = null; });
  await current.saving;
  if (current.dirty) await save();
}

function playerMessage(state, item) {
  const reply = state.reply, config = state.config;
  const players = reply.players.map((p, index) => ({player_index:index, player_id:p.id, kind:p.kind, name:p.name}));
  const turns = reply.turn === null ? null : reply.turn.map(id => players.findIndex(p => p.player_id === id)).filter(i => i >= 0);
  const seat = config.mode === "pass" ? (turns?.find(i => players[i].kind === "human") ?? 0) : item.seat;
  const acting = reply.status === "ongoing" && turns?.includes(seat) && players[seat]?.kind === "human" ? seat : null;
  const view = reply.views[players[seat]?.player_id] ?? null;
  const message = stateChangedMessage({state:view, view, players, turn:turns, status:reply.status,
    endReason:reply.status === "over" ? "finished" : null, moveCount:reply.move_count, mySeat:seat, actingFor:acting});
  message.token_pot = reply.pot;
  return message;
}

async function displayReply(state, reply) {
  state.reply = reply;
  state.note.textContent = reply.error ? `Error: ${reply.error}` : `${reply.status} · ${reply.move_count} moves · turn: ${(reply.turn || []).join(", ") || "none"}`;
  state.note.className = reply.error ? "error" : "";
  if (!reply.players.every(p => Object.hasOwn(reply.views, p.id))) return;
  await Promise.all(state.frames.map(async item => {
    await item.ready;
    item.frame.contentWindow.postMessage(playerMessage(state, item), "*");
  }));
}

function requestBody(state) {
  return {server_code:run.recording.server_code, game_schemas:run.schemas,
    players:state.config.players, seed:state.config.seed};
}

async function resetScenario(state) {
  if (!run || run.replaying || state.busy) return;
  const current = run;
  const owner = sessionUser(current);
  state.busy = true;
  state.restart.disabled = true;
  try {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const reply = await apiRequest("POST", "/game-test-emulator/reset", {user:owner, body:{...requestBody(state), seed}});
    if (run !== current) return;
    state.config.seed = seed;
    record({type:"state", scenario:state.config.id, action:"reset", seed, reply});
    await displayReply(state, reply);
  } finally { state.busy = false; state.restart.disabled = Boolean(run?.randomPlaying); }
}

async function move(state, item, moveValue) {
  if (!run || run.replaying || state.busy || !state.reply ||
      !state.reply.players.every(p => Object.hasOwn(state.reply.views, p.id))) return;
  const current = run, message = playerMessage(state, item);
  const owner = sessionUser(current);
  if (message.acting_for_player_index === null) return;
  state.busy = true;
  try {
    const reply = await apiRequest("POST", "/game-test-emulator/act", {user:owner, body:{
      ...requestBody(state), state:state.reply.state, turn:state.reply.turn,
      move_count:state.reply.move_count, player_id:message.players[message.acting_for_player_index].player_id,
      move:moveValue,
    }});
    if (run !== current) return;
    if (reply.error && JSON.stringify(reply.state) === JSON.stringify(state.reply.state)) {
      reply.views = state.reply.views;
    }
    record({type:"state", scenario:state.config.id, action:"move", seat:message.acting_for_player_index, move:moveValue, reply});
    await displayReply(state, reply);
  } finally { state.busy = false; }
}

window.addEventListener("message", event => {
  if (!run || run.replaying || switching) return;
  const target = run.matrix.frames.get(event.source);
  if (!target || !event.data || typeof event.data !== "object") return;
  try { sessionUser(run); } catch (error) { showError(error); return; }
  if (event.data.type === "test_random_result") {
    const request = randomRequests.get(event.data.id);
    if (request && request.source === event.source) {
      randomRequests.delete(event.data.id);
      clearTimeout(request.timer);
      if (event.data.error) request.reject(new Error(String(event.data.error)));
      else request.resolve();
    }
  } else if (event.data.type === "make_move" && "move" in event.data) {
    move(target.state, target.item, event.data.move).catch(showError);
  } else if (event.data.type === "test_click") {
    const {width, height, contrast, minimumContrast, tag, x, y} = event.data;
    if (![width,height,minimumContrast,x,y].every(Number.isFinite) || !(contrast === null || Number.isFinite(contrast)) || typeof tag !== "string") return;
    const entry = {type:"click", scenario:target.state.config.id, seat:target.item.seat,
      metrics:{width,height,contrast,minimumContrast,tag:tag.slice(0,30),x,y}};
    record(entry);
    noteClick(entry);
  }
});

function randomClick(item) {
  const id = crypto.randomUUID(), source = item.frame.contentWindow;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      randomRequests.delete(id);
      reject(new Error("The game did not respond to the random-click request."));
    }, 5000);
    randomRequests.set(id, {source, resolve, reject, timer});
    source.postMessage({type:"test_random_click", id}, "*");
  });
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function playRandomMatches() {
  const current = run;
  if (!current || current.replaying || current.randomPlaying || switching) return;
  sessionUser(current);
  current.randomPlaying = true;
  current.randomStop = false;
  current.randomError = null;
  $("random-status").className = "";
  $("random-play").disabled = true;
  $("stop-random").disabled = false;
  $("start").disabled = true;
  $("replay").disabled = true;
  $("end").disabled = true;
  $("matrix").classList.add("automated");
  for (const state of current.matrix.states.values()) state.restart.disabled = true;
  let completed = 0;
  try {
    for (const state of current.matrix.states.values()) {
      for (let match = 1; match <= 3; match++) {
        $("random-status").textContent = `Random play: ${completed} matches completed; ${state.config.device} ${state.config.orientation}, ${state.config.mode}, match ${match}/3.`;
        if (current.randomStop) throw new Error("Random play stopped by user.");
        await resetScenario(state);
        if (state.reply.error) throw new Error(state.reply.error);
        let unchanged = 0;
        for (let clicks = 0; state.reply.status !== "over"; clicks++) {
          if (current.randomStop) throw new Error("Random play stopped by user.");
          if (current.randomError) throw current.randomError;
          if (clicks >= 200) throw new Error("Match did not finish within 200 clicks.");
          const item = state.frames.find(frame => playerMessage(state, frame).acting_for_player_index !== null);
          if (!item) throw new Error("No human screen can act on the current turn.");
          const before = state.reply.move_count;
          await randomClick(item);
          const deadline = performance.now() + 3000;
          do {
            if (current.randomStop) throw new Error("Random play stopped by user.");
            if (current.randomError) throw current.randomError;
            if (!state.busy && (state.reply.move_count !== before || state.reply.error)) break;
            await delay(50);
          } while (performance.now() < deadline);
          if (state.reply.error) throw new Error(state.reply.error);
          if (state.busy) throw new Error("The move did not complete in time.");
          unchanged = state.reply.move_count === before ? unchanged + 1 : 0;
          if (unchanged >= 8) throw new Error("Eight clicks made no move; this game needs manual testing.");
        }
        completed++;
        record({type:"random_match", scenario:state.config.id, match, result:"completed"});
        $("random-status").textContent = `Random play: ${completed} matches completed.`;
      }
    }
    await save();
    $("random-status").textContent = `Random play complete: ${completed} matches finished and recorded. Review click and contrast warnings.`;
  } catch (error) {
    record({type:"random_failure", completed, message:String(error.message || error).slice(0, 1000)});
    $("random-status").textContent = `Random play incomplete after ${completed} matches: ${error.message || error}`;
    $("random-status").className = "error";
    try { await save(); } catch (saveError) { showError(saveError); }
  } finally {
    current.randomPlaying = false;
    $("matrix").classList.remove("automated");
    for (const state of current.matrix.states.values()) state.restart.disabled = false;
    $("random-play").disabled = false;
    $("stop-random").disabled = true;
    $("start").disabled = false;
    $("replay").disabled = false;
    $("end").disabled = false;
  }
}

async function start() {
  if (run && !run.replaying) await save();
  const owner = user(), client = $("client-code").value, server = $("server-code").value;
  const counts = $("counts").value.split(",").map(x => Number(x.trim()));
  const count = Number($("count").value);
  if (!client.trim() || !server.trim()) throw new Error("Enter both client HTML and server JavaScript.");
  if (!counts.length || counts.some(n => !Number.isInteger(n) || n < 1 || n > 10) || new Set(counts).size !== counts.length || !counts.includes(count)) throw new Error("Enter unique supported counts from 1 to 10 and choose one of them.");
  status("Testing server logic and generating schemas…");
  const report = await apiRequest("POST", "/games/test", {user:owner, body:{server_code:server,
    allowed_player_counts:counts, allows_leave_mid_match:false, allows_join_mid_match:false}});
  if (!report.passed || !report.game_schemas) throw new Error("Server tests failed: " + (report.failures?.[0]?.message || "No schemas generated."));
  if (user().id !== owner.id) throw new Error("The signed-in account changed before the session started.");
  const recording = {client_code:client, server_code:server, scenarios:createScenarios(count), events:[]};
  const saved = await apiRequest("POST", "/game-test-sessions", {user:owner, body:{revision:0, recording}});
  replayToken++;
  const current = {owner, recording, schemas:report.game_schemas, id:saved.id, revision:saved.revision,
    started:performance.now(), dirty:0, saving:null, timer:null, replaying:false};
  run = current;
  current.matrix = buildMatrix(recording, false);
  filterScenarios();
  $("save").disabled = false;
  $("download").disabled = false;
  $("end").disabled = false;
  $("random-status").textContent = "";
  $("random-status").className = "";
  status(`Recording ${saved.id}: starting ${recording.scenarios.length} scenarios…`);
  for (const state of current.matrix.states.values()) {
    if (run !== current) return;
    await resetScenario(state);
  }
  await save();
  await refresh();
  $("recordings").value = saved.id;
  current.ready = true;
}

async function refresh() {
  const owner = user(), rows = [];
  let cursor = null;
  do {
    const response = await apiRequest("GET", "/game-test-sessions" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""), {user:owner});
    if (Auth.current()?.id !== owner.id) return;
    rows.push(...response.items); cursor = response.next_cursor;
  } while (cursor);
  const previous = $("recordings").value;
  $("recordings").replaceChildren(el("option", {value:"", textContent:"Select a recording"}),
    ...rows.map(row => el("option", {value:row.id, textContent:`${row.updated_at} · ${row.id}`})));
  $("recordings").value = rows.some(row => row.id === previous) ? previous : "";
}

async function replay() {
  if (run && !run.replaying) await save();
  const id = $("recordings").value;
  if (!id) throw new Error("Select a recording.");
  const owner = user(), saved = await apiRequest("GET", "/game-test-sessions/" + encodeURIComponent(id), {user:owner});
  const selected = $("replay-selected").checked ? $("scenario-filter").value : "";
  const token = ++replayToken, recording = saved.recording;
  run = {owner, recording, replaying:true, paused:false, activeScenario:null, matrix:buildMatrix(recording, true)};
  filterScenarios();
  $("save").disabled = true;
  $("download").disabled = true;
  $("end").disabled = true;
  $("random-play").disabled = true;
  $("stop-replay").disabled = false;
  $("pause-replay").disabled = false;
  $("pause-replay").textContent = "Pause";
  $("jump-active").disabled = true;
  status("Replaying recorded state changes; frames are read-only.");
  let last = 0, lastIndex = -1;
  for (const [index, event] of recording.events.entries()) {
    if (selected && event.scenario !== selected) continue;
    if (token !== replayToken) return;
    const gap = selected && index !== lastIndex + 1 ? 0 : Math.max(0, event.at - last);
    await waitForReplay(gap, token);
    if (token !== replayToken) return;
    last = event.at;
    lastIndex = index;
    const state = run.matrix.states.get(event.scenario);
    if (state && (event.type === "state" || event.type === "click")) {
      if (run.activeScenario !== event.scenario) {
        run.matrix.states.get(run.activeScenario)?.card.classList.remove("active-scenario");
        run.activeScenario = event.scenario;
        state.card.classList.add("active-scenario");
        $("jump-active").disabled = false;
        if ($("follow-replay").checked && !$("scenario-filter").value) showActiveScenario();
      }
      $("replay-progress").textContent = `${(event.at / 1000).toFixed(1)}s · event ${index + 1}/${recording.events.length} · ${state.title}`;
    }
    if (event.type === "click") {
      noteClick(event);
      const item = run.matrix.states.get(event.scenario)?.frames[event.seat];
      if (item && Number.isFinite(event.metrics.x) && Number.isFinite(event.metrics.y)) {
        item.marker.hidden = false;
        item.marker.style.left = `${event.metrics.x + 1}px`;
        item.marker.style.top = `${event.metrics.y + 1}px`;
        setTimeout(() => { item.marker.hidden = true; }, 500);
      }
    }
    else if (event.type === "state") {
      const state = run.matrix.states.get(event.scenario);
      if (state) await displayReply(state, event.reply);
    }
  }
  $("pause-replay").disabled = true;
  status("Replay complete.");
}

async function waitForReplay(milliseconds, token) {
  let remaining = milliseconds;
  do {
    if (token !== replayToken) return;
    if (run.paused) {
      await new Promise(resolve => { wakeReplay = () => { wakeReplay = null; resolve(); }; });
      continue;
    }
    if (remaining <= 0) return;
    const speed = Number($("speed").value), started = performance.now();
    await new Promise(resolve => {
      const timer = setTimeout(() => { wakeReplay = null; resolve(); }, remaining / speed);
      wakeReplay = () => { clearTimeout(timer); wakeReplay = null; resolve(); };
    });
    remaining -= (performance.now() - started) * speed;
  } while (remaining > 0 || run.paused);
}

async function switchRun(action) {
  if (switching) return;
  if (run && !run.replaying && [...run.matrix.states.values()].some(state => state.busy)) {
    status("Wait for the current move or restart to finish before switching sessions.", true);
    return;
  }
  switching = true;
  $("start").disabled = true;
  $("replay").disabled = true;
  $("random-play").disabled = true;
  try { await action(); } catch (error) { showError(error); }
  finally {
    switching = false;
    $("start").disabled = false;
    $("replay").disabled = false;
    $("random-play").disabled = !run?.ready || run.replaying;
    $("stop-replay").disabled = true;
    $("pause-replay").disabled = true;
  }
}
$("start").addEventListener("click", () => switchRun(start));
$("random-play").addEventListener("click", () => playRandomMatches().catch(showError));
$("stop-random").addEventListener("click", () => { if (run) run.randomStop = true; });
$("save").addEventListener("click", () => save().catch(showError));
$("download").addEventListener("click", () => {
  if (!run || run.replaying) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(run.recording)], {type:"application/json"}));
  const link = el("a", {href:url, download:"game-test-recording.json"});
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("end").addEventListener("click", () => {
  if (!run || run.replaying || switching) return;
  if (run.saving || [...run.matrix.states.values()].some(state => state.busy)) {
    status("Wait for the current save or move to finish.", true);
    return;
  }
  if (run.dirty && !confirm("Unsaved events will be lost from the server. Download a backup first if needed. End this session?")) return;
  clearTimeout(run.timer);
  run = null;
  $("matrix").replaceChildren();
  $("save").disabled = true;
  $("download").disabled = true;
  $("end").disabled = true;
  $("random-play").disabled = true;
  $("scenario-filter").replaceChildren(el("option", {value:"", textContent:"All scenarios"}));
  $("previous-scenario").disabled = true;
  $("next-scenario").disabled = true;
  $("replay-selected").disabled = true;
  $("jump-active").disabled = true;
  $("replay-progress").textContent = "Choose a recording and press Replay.";
  status("Session ended. Previously saved events remain on the server.");
});
$("refresh").addEventListener("click", () => refresh().catch(showError));
$("replay").addEventListener("click", () => switchRun(replay));
$("pause-replay").addEventListener("click", () => {
  if (!run?.replaying) return;
  run.paused = !run.paused;
  $("pause-replay").textContent = run.paused ? "Resume" : "Pause";
  status(run.paused ? "Replay paused." : "Replaying recorded state changes; frames are read-only.");
  wakeReplay?.();
});
$("speed").addEventListener("change", () => wakeReplay?.());
$("stop-replay").addEventListener("click", () => { replayToken++; wakeReplay?.(); status("Replay stopped."); });
$("scenario-filter").addEventListener("change", filterScenarios);
$("previous-scenario").addEventListener("click", () => chooseScenario(-1));
$("next-scenario").addEventListener("click", () => chooseScenario(1));
$("jump-active").addEventListener("click", showActiveScenario);
$("delete").addEventListener("click", async () => {
  try {
    const id = $("recordings").value;
    if (!id) throw new Error("Select a recording.");
    if (run?.id === id && !run.replaying) throw new Error("Cannot delete the active recording. Start a different session first.");
    await apiRequest("DELETE", "/game-test-sessions/" + encodeURIComponent(id), {user:user()});
    await refresh();
    status("Recording deleted.");
  } catch (error) { showError(error); }
});
window.addEventListener("beforeunload", event => {
  if (run && !run.replaying && (run.dirty || run.saving)) { event.preventDefault(); event.returnValue = ""; }
});
function renderAccountMenu() {
  Auth.renderMenu($("account-menu"));
}
document.addEventListener("i18n-changed", renderAccountMenu);
document.addEventListener("auth-changed", () => {
  renderAccountMenu();
  $("recordings").replaceChildren(el("option", {value:"", textContent:"Select a recording"}));
  if (Auth.current()) refresh().catch(showError);
});
renderAccountMenu();
if (Auth.current()) refresh().catch(showError);
