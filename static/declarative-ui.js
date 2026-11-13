/* Platform-owned renderer. Game UI source only sees JSON inside an opaque,
 * network-disabled, terminable worker. Native hosts implement this scene contract
 * and execute the same gameUI.reduce function in QuickJS. */
(function (global) {
  "use strict";
  // Classic pages load I18n; the generated opaque compatibility host uses
  // English fallbacks. Game-owned presentation strings arrive in state_changed.
  function t(key, params, fallback) {
    if (typeof I18n !== "undefined") return I18n.t(key, params, fallback);
    return fallback.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
  }
  function engineError(message) {
    const messages = {
      "ui.declarative.error.randomness": t("ui.declarative.error.randomness", {}, "UI reducers cannot use randomness"),
      "ui.declarative.error.reduce_function": t("ui.declarative.error.reduce_function", {}, "Define gameUI.reduce(message, localState)"),
      "ui.declarative.error.response_limit": t("ui.declarative.error.response_limit", {}, "UI response exceeds 256000 bytes"),
      "ui.declarative.error.timeout": t("ui.declarative.error.timeout", {}, "UI reducer exceeded the browser time limit"),
      "ui.declarative.error.failed": t("ui.declarative.error.failed", {}, "UI reducer failed"),
    };
    return messages[message] || message;
  }
  const NS = "http://www.w3.org/2000/svg";
  const LIMIT = 256000;
  const clone = value => JSON.parse(JSON.stringify(value));
  const num = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  function svg(tag, attrs = {}, text) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function assetURI(asset) {
    const uri = asset?.uri;
    return typeof uri === "string" && (/^https:\/\//.test(uri) || /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/.test(uri)) ? uri : null;
  }
  function boardCell(board, cell) {
    const explicit = board.cells?.find(item => item.id === cell);
    if (explicit) return {x: num(explicit.x), y: num(explicit.y)};
    if (board.cells?.length) throw new Error(t("ui.declarative.error.unknown_cell", {id:cell}, "Unknown board cell: {id}"));
    if (board.kind === "grid" && /^(0|[1-9]\d*)$/.test(String(cell))) {
      const index = Number(cell), rows = board.rows, columns = board.columns;
      if (index < rows * columns) return {x: (index % columns + .5) * board.width / columns, y: (Math.floor(index / columns) + .5) * board.height / rows};
    }
    throw new Error(t("ui.declarative.error.unknown_cell", {id:cell}, "Unknown board cell: {id}"));
  }
  function position(spec, item) {
    const board = spec.boards.find(board => board.id === item.board);
    if (!board) throw new Error(t("ui.declarative.error.unknown_board", {id:item.board}, "Unknown board: {id}"));
    const at = item.position || {};
    const cell = at.cell !== undefined ? boardCell(board, at.cell) : at;
    return {x: num(board.x) + num(cell.x), y: num(board.y) + num(cell.y), board};
  }
  // A fresh worker for every reduction prevents hidden mutable globals from
  // becoming state. Only local_state returned as JSON survives a call.
  function reducerWorker() {
    self.onmessage = event => {
      const reply = self.postMessage.bind(self);
      try {
        const request = JSON.parse(event.data);
        for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "Worker", "SharedWorker", "setTimeout", "setInterval"]) {
          try { Object.defineProperty(self, name, {value: undefined, configurable: false, writable: false}); } catch (_) {}
        }
        Math.random = () => { throw new Error("ui.declarative.error.randomness"); };
        self.Date = undefined;
        const reducer = new Function('"use strict";\n' + request.code + '\n;return typeof gameUI === "undefined" ? undefined : gameUI;')();
        if (!reducer || typeof reducer.reduce !== "function") throw new Error("ui.declarative.error.reduce_function");
        const result = JSON.stringify(reducer.reduce(request.message, request.localState));
        if (!result || new TextEncoder().encode(result).length > 256000) throw new Error("ui.declarative.error.response_limit");
        reply(JSON.stringify({ok: true, result: JSON.parse(result)}));
      } catch (error) { reply(JSON.stringify({ok: false, error: String(error.message || error).slice(0, 500)})); }
    };
  }
  function engineHost(workerSource, token) {
    const jobs = new Map();
    addEventListener("message", event => {
      if (event.source !== parent || event.data?.token !== token) return;
      const request = event.data;
      const blob = new Blob([workerSource], {type: "text/javascript"});
      const uri = URL.createObjectURL(blob);
      const worker = new Worker(uri);
      URL.revokeObjectURL(uri);
      const finish = response => {
        clearTimeout(timer); worker.terminate(); jobs.delete(request.id);
        parent.postMessage({token, id: request.id, response}, "*");
      };
      const timer = setTimeout(() => finish(JSON.stringify({ok: false, error: "ui.declarative.error.timeout"})), 1200);
      jobs.set(request.id, worker);
      worker.onmessage = event => finish(event.data);
      worker.onerror = () => finish(JSON.stringify({ok: false, error: "ui.declarative.error.failed"}));
      worker.postMessage(request.payload);
    });
    parent.postMessage({token, ready: true}, "*");
  }
  function createEngine(container, onError) {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.title = t("ui.declarative.engine_title", {}, "Isolated game presentation engine");
    const token = Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
    const jobs = new Map();
    let sequence = 0, destroyed = false, open;
    const ready = new Promise(resolve => { open = resolve; });
    function receive(event) {
      if (event.source !== frame.contentWindow || event.data?.token !== token) return;
      if (event.data.ready) { open(); return; }
      const entry = jobs.get(event.data.id);
      if (!entry) return;
      jobs.delete(event.data.id); clearTimeout(entry.timer);
      try {
        if (typeof event.data.response !== "string" || new TextEncoder().encode(event.data.response).length > LIMIT + 2000) throw new Error(t("ui.declarative.error.invalid_ui_response", {}, "Invalid UI response"));
        const response = JSON.parse(event.data.response);
        if (!response.ok) throw new Error(engineError(response.error || "ui.declarative.error.failed"));
        entry.resolve(response.result);
      } catch (error) { entry.reject(error); }
    }
    global.addEventListener("message", receive);
    const script = '(' + engineHost.toString() + ')(' + JSON.stringify('(' + reducerWorker.toString() + ')()') + ',' + JSON.stringify(token) + ')';
    frame.srcdoc = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; worker-src blob:; connect-src \'none\'"><script>' + script.replace(/<\//g, "<\\/") + '<' + '/script>';
    container.appendChild(frame);
    return {
      async call(code, message, localState) {
        await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error(t("ui.declarative.error.ui_engine_did_not_start", {}, "UI engine did not start"))), 3000))]);
        if (destroyed) throw new Error(t("ui.declarative.error.ui_engine_stopped", {}, "UI engine stopped"));
        const id = ++sequence;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { jobs.delete(id); reject(new Error(t("ui.declarative.error.ui_engine_did_not_answer", {}, "UI engine did not answer"))); }, 2500);
          jobs.set(id, {resolve, reject, timer});
          frame.contentWindow.postMessage({token, id, payload: JSON.stringify({code, message, localState})}, "*");
        });
      },
      destroy() {
        destroyed = true; global.removeEventListener("message", receive); frame.remove();
        for (const entry of jobs.values()) { clearTimeout(entry.timer); entry.reject(new Error(t("ui.declarative.error.ui_engine_stopped", {}, "UI engine stopped"))); }
        jobs.clear();
      },
    };
  }
  function finiteJSON(value, depth=0) {
    if(depth>64)throw new Error(t("ui.declarative.error.ui_json_is_nested_too_deeply", {}, "UI JSON is nested too deeply"));
    if(typeof value==="number"&&!Number.isFinite(value))throw new Error(t("ui.declarative.error.ui_json_contains_a_non_finite_number", {}, "UI JSON contains a non-finite number"));
    if(value&&typeof value==="object")for(const item of Object.values(value))finiteJSON(item,depth+1);
  }
  function validateSpec(spec) {
    finiteJSON(spec);
    if(!spec || spec.format!=="buildplay-ui" || spec.version!==1)throw new Error(t("ui.declarative.error.unsupported_declarative_ui_format", {}, "Unsupported declarative UI format"));
    if(!spec.viewport || !(spec.viewport.width>0) || !(spec.viewport.height>0))throw new Error(t("ui.declarative.error.invalid_viewport", {}, "Invalid viewport"));
    if(!Array.isArray(spec.boards)||!spec.boards.length||spec.boards.length>32)throw new Error(t("ui.declarative.error.expected_1_32_boards", {}, "Expected 1–32 boards"));
    if(!spec.piece_types||typeof spec.piece_types!=="object"||Array.isArray(spec.piece_types))throw new Error(t("ui.declarative.error.expected_piece_types", {}, "Expected piece types"));
    if(typeof spec.ui_code!=="string"||spec.ui_code.length>200000)throw new Error(t("ui.declarative.error.invalid_presentation_source", {}, "Invalid presentation source"));
    for(const board of spec.boards){
      if(!(board.width>0)||!(board.height>0))throw new Error(t("ui.declarative.error.invalid_board_dimensions", {}, "Invalid board dimensions"));
      if(board.kind==="grid"&&(!Number.isInteger(board.rows)||!Number.isInteger(board.columns)||board.rows<1||board.columns<1||board.rows*board.columns>2048))throw new Error(t("ui.declarative.error.a_grid_must_contain_1_2048_cells", {}, "A grid must contain 1–2048 cells"));
      if(board.cells&&(!Array.isArray(board.cells)||board.cells.length>2048))throw new Error(t("ui.declarative.error.too_many_explicit_cells", {}, "Too many explicit cells"));
    }
    if(new TextEncoder().encode(JSON.stringify(spec)).length>350000)throw new Error(t("ui.declarative.error.declarative_package_exceeds_the_size_limit", {}, "Declarative package exceeds the size limit"));
    return spec;
  }
  function knownObject(value, allowed, required=[]) {
    if(!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key)) || required.some(key=>!Object.hasOwn(value,key)))throw new Error(t("ui.declarative.error.invalid_ui_object_fields", {}, "Invalid UI object fields"));
  }
  const isId=value=>typeof value==="string" && value.length<=80 && /^[A-Za-z0-9_.:-]+$/.test(value);
  function checkPoint(point) {
    knownObject(point,["x","y"],["x","y"]);
    if([point.x,point.y].some(value=>typeof value!=="number"||Math.abs(value)>100000))throw new Error(t("ui.declarative.error.invalid_point_geometry", {}, "Invalid point geometry"));
  }
  function checkElement(kind,item) {
    const fields={pieces:["id","type","board","position","text","asset","rotation","scale","opacity","z","face","move_targets","selected","hidden","draggable","actions"],targets:["id","board","position","label","color"],labels:["id","text","x","y","color","font_size"],controls:["id","label","kind","value","min","max","step","options","disabled"],paths:["id","points","color","width"]};
    const required={pieces:["id","type","board","position"],targets:["id","board","position"],labels:["id","text","x","y"],controls:["id","label","kind"],paths:["id","points"]};
    knownObject(item,fields[kind],required[kind]);
    for(const key of ["id","type","board","asset"])if(key in item&&!isId(item[key]))throw new Error(t("ui.declarative.error.invalid_ui_identifier", {}, "Invalid UI identifier"));
    for(const key of ["text","label"])if(key in item&&(typeof item[key]!=="string"||Array.from(item[key]).length>4000))throw new Error(t("ui.declarative.error.invalid_display_text", {}, "Invalid display text"));
    if("color" in item&&!/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(item.color))throw new Error(t("ui.declarative.error.invalid_display_color", {}, "Invalid display color"));
    for(const key of ["selected","hidden","draggable","disabled"])if(key in item&&typeof item[key]!=="boolean")throw new Error(t("ui.declarative.error.invalid_ui_flag", {}, "Invalid UI flag"));
    for(const key of ["rotation","z","x","y","min","max"])if(key in item&&(typeof item[key]!=="number"||Math.abs(item[key])>100000))throw new Error(t("ui.declarative.error.invalid_numeric_geometry", {}, "Invalid numeric geometry"));
    for(const key of ["scale","font_size","width","step"])if(key in item&&(!(typeof item[key]==="number"&&item[key]>0)||item[key]>(key==="scale"?100:100000)))throw new Error(t("ui.declarative.error.invalid_positive_geometry", {}, "Invalid positive geometry"));
    if("opacity" in item&&(typeof item.opacity!=="number"||item.opacity<0||item.opacity>1))throw new Error(t("ui.declarative.error.invalid_opacity", {}, "Invalid opacity"));
    if("face" in item&&!["front","back"].includes(item.face))throw new Error(t("ui.declarative.error.invalid_piece_face", {}, "Invalid piece face"));
    if("position" in item){
      const at=item.position;knownObject(at,["cell","x","y"]);
      if("cell" in at){if(!isId(at.cell)||"x" in at||"y" in at)throw new Error(t("ui.declarative.error.invalid_cell_position", {}, "Invalid cell position"));}
      else checkPoint(at);
    }
    if("move_targets" in item&&(!Array.isArray(item.move_targets)||item.move_targets.length>2048||item.move_targets.some(value=>!isId(value))||new Set(item.move_targets).size!==item.move_targets.length))throw new Error(t("ui.declarative.error.invalid_move_targets", {}, "Invalid move targets"));
    if("actions" in item&&(!Array.isArray(item.actions)||item.actions.some(action=>!["tap","move","rotate","scale"].includes(action))||new Set(item.actions).size!==item.actions.length||item.actions.includes("move")&&!item.move_targets?.length))throw new Error(t("ui.declarative.error.invalid_move_targets", {}, "Invalid move targets"));
    if(kind==="paths"){
      if(!Array.isArray(item.points)||item.points.length<2||item.points.length>4096)throw new Error(t("ui.declarative.error.invalid_path_points", {}, "Invalid path points"));
      item.points.forEach(checkPoint);
    }
    if(kind==="controls"){
      if(!["button","number","choice","text"].includes(item.kind))throw new Error(t("ui.declarative.error.unknown_control_kind", {}, "Unknown control kind"));
      if("value" in item&&item.value!==null&&!["string","number","boolean"].includes(typeof item.value))throw new Error(t("ui.declarative.error.invalid_control_value", {}, "Invalid control value"));
      if("min" in item&&"max" in item&&item.min>item.max)throw new Error(t("ui.declarative.error.control_minimum_exceeds_maximum", {}, "Control minimum exceeds maximum"));
      if("options" in item){
        if(!Array.isArray(item.options)||item.options.length>100)throw new Error(t("ui.declarative.error.invalid_control_options", {}, "Invalid control options"));
        for(const option of item.options){knownObject(option,["value","label"],["value","label"]);if(!["string","number","boolean"].includes(typeof option.value)||typeof option.label!=="string"||Array.from(option.label).length>4000)throw new Error(t("ui.declarative.error.invalid_control_option", {}, "Invalid control option"));}
      }
      if(item.kind==="choice"&&!item.options?.length)throw new Error(t("ui.declarative.error.choice_controls_need_options", {}, "Choice controls need options"));
    }
  }
  function validateScene(spec, scene) {
    finiteJSON(scene);
    knownObject(scene,["pieces","targets","labels","controls","paths"]);
    if (!scene || typeof scene !== "object" || Array.isArray(scene)) throw new Error(t("ui.declarative.error.ui_response_must_contain_a_scene", {}, "UI response must contain a scene"));
    const allIds = new Set();
    for (const [key, limit] of [["pieces", 2048], ["targets", 2048], ["controls", 128], ["labels", 128], ["paths", 128]]) {
      const items = Object.hasOwn(scene,key) ? scene[key] : [];
      if (!Array.isArray(items) || items.length > limit) throw new Error(t("ui.declarative.error.too_many", {kind:key}, "Too many {kind}"));
      const ids = new Set();
      for (const item of items) {
        checkElement(key,item);
        if (!item || typeof item.id !== "string" || ids.has(item.id)) throw new Error(t("ui.declarative.error.duplicate_id", {kind:key}, "Invalid or duplicate {kind} ID"));
        if(allIds.has(item.id))throw new Error(t("ui.declarative.error.scene_ids_must_be_unique_across_element_kinds", {}, "Scene IDs must be unique across element kinds"));
        ids.add(item.id);allIds.add(item.id);
        if (key === "pieces" || key === "targets") position(spec, item);
        if (key === "pieces" && !Object.hasOwn(spec.piece_types, item.type)) throw new Error(t("ui.declarative.error.unknown_piece_type", {}, "Unknown piece type"));
        if (item.asset && !Object.hasOwn(spec.assets || {}, item.asset)) throw new Error(t("ui.declarative.error.unknown_asset", {}, "Unknown asset"));
      }
    }
    const targets = new Set((scene.targets || []).map(target => target.id));
    for (const piece of scene.pieces || []) for (const target of piece.move_targets || []) if (!targets.has(target)) throw new Error(t("ui.declarative.error.unknown_move_target", {}, "Unknown move target"));
    return scene;
  }
  // Older v1 packages treated every piece as tappable. An explicit empty list
  // lets new packages mark decoration precisely; destinations also declare move.
  function pieceActions(piece) {
    if(piece.hidden)return [];
    const actions=piece.actions===undefined?["tap"]:piece.actions;
    return ["tap","move","rotate","scale"].filter(action=>actions.includes(action)||action==="move"&&piece.move_targets?.length);
  }
  function actionLabel(action) {
    if(action==="tap")return t("ui.declarative.hints.tap", {}, "Click");
    if(action==="move")return t("ui.declarative.hints.move", {}, "Move");
    if(action==="rotate")return t("ui.declarative.hints.rotate", {}, "Rotate");
    return t("ui.declarative.hints.scale", {}, "Resize");
  }
  function mount(container, rawSpec, callbacks = {}) {
    const spec = validateSpec(clone(rawSpec));
    container.replaceChildren();
    container.classList.add("declarative-game");
    const stage = svg("svg", {viewBox: `0 0 ${spec.viewport.width} ${spec.viewport.height}`, role: "group", "aria-label": t("ui.declarative.board_aria", {}, "Game board"), class: "declarative-stage"});
    const hintMessage=document.createElement("p");hintMessage.className="declarative-hint-message";hintMessage.setAttribute("role","status");hintMessage.setAttribute("aria-live","polite");hintMessage.hidden=true;
    const pieceTools=document.createElement("div");pieceTools.className="declarative-piece-actions";pieceTools.hidden=true;
    const controls = document.createElement("div"); controls.className = "declarative-controls";
    const cameraTools=document.createElement("div");cameraTools.className="declarative-zoom-controls";cameraTools.setAttribute("role","group");cameraTools.setAttribute("aria-label",t("ui.declarative.zoom.controls", {}, "Board zoom"));
    const zoomOut=document.createElement("button"),zoomIn=document.createElement("button"),zoomReset=document.createElement("button"),zoomLevel=document.createElement("output"),zoomHint=document.createElement("span");
    for(const [button,action,label,text] of [[zoomOut,"out",t("ui.declarative.zoom.out", {}, "Zoom out"),"−"],[zoomIn,"in",t("ui.declarative.zoom.in", {}, "Zoom in"),"+"],[zoomReset,"reset",t("ui.declarative.zoom.reset", {}, "Fit board"),null]]){button.type="button";button.dataset.cameraAction=action;button.setAttribute("aria-label",label);button.title=label;button.textContent=text||label;}
    zoomLevel.className="declarative-zoom-level";zoomHint.className="declarative-zoom-hint";zoomHint.textContent=t("ui.declarative.zoom.hint", {}, "Pinch to zoom. Drag the board to pan when zoomed.");
    cameraTools.append(zoomOut,zoomLevel,zoomIn,zoomReset,zoomHint);
    const errorBox = document.createElement("p"); errorBox.className = "declarative-error"; errorBox.setAttribute("role", "alert"); errorBox.hidden = true;
    container.append(hintMessage, cameraTools, stage, pieceTools, controls, errorBox);
    const engine = createEngine(container);
    let latest = null, localState = null, revision = 0, renderedRevision = -1, destroyed = false, moveSent = false, selected = null, dragging = null, nativeDragging = null, currentScene = null, suppressClick = false;
    let lastStateMoveCount = null, lastStateWasReplay = false;
    // The camera belongs to the host. It never reaches the reducer or make_move,
    // and survives complete scene snapshots, including replay and turn changes.
    const camera={x:0,y:0,zoom:1},touches=new Map();
    let cameraGesture=null,cameraClickUntil=0;
    const pieceAnimations=new Set();
    function applyCamera() {
      const width=spec.viewport.width/camera.zoom,height=spec.viewport.height/camera.zoom;
      camera.x=Math.max(0,Math.min(spec.viewport.width-width,num(camera.x)));
      camera.y=Math.max(0,Math.min(spec.viewport.height-height,num(camera.y)));
      stage.setAttribute("viewBox",`${camera.x} ${camera.y} ${width} ${height}`);
      stage.classList.toggle("zoomed",camera.zoom>1);
      zoomOut.disabled=camera.zoom<=1;zoomIn.disabled=camera.zoom>=4;zoomReset.disabled=camera.zoom===1;
      zoomLevel.textContent=t("ui.declarative.zoom.level", {percent:Math.round(camera.zoom*100)}, "Zoom: {percent}%");
    }
    function boardPoint(x,y) {
      const point=stage.createSVGPoint();point.x=x;point.y=y;
      const matrix=stage.getScreenCTM();
      return matrix?point.matrixTransform(matrix.inverse()):{x:camera.x,y:camera.y};
    }
    function zoomAt(zoom,x,y,anchor=boardPoint(x,y)) {
      if(!Number.isFinite(zoom))return;
      const current=boardPoint(x,y),fx=(current.x-camera.x)/(spec.viewport.width/camera.zoom),fy=(current.y-camera.y)/(spec.viewport.height/camera.zoom);
      camera.zoom=Math.max(1,Math.min(4,zoom));
      camera.x=anchor.x-fx*spec.viewport.width/camera.zoom;camera.y=anchor.y-fy*spec.viewport.height/camera.zoom;applyCamera();
    }
    function zoomBy(factor) {const bounds=stage.getBoundingClientRect();zoomAt(camera.zoom*factor,bounds.x+bounds.width/2,bounds.y+bounds.height/2);}
    zoomOut.addEventListener("click",()=>zoomBy(1/1.25));zoomIn.addEventListener("click",()=>zoomBy(1.25));
    zoomReset.addEventListener("click",()=>{camera.x=0;camera.y=0;camera.zoom=1;applyCamera();});
    function cameraClickBlocked(){return Boolean(cameraGesture)||Date.now()<cameraClickUntil;}
    function beginPinch() {
      const [a,b]=[...touches.entries()];if(!b)return;
      const x=(a[1].x+b[1].x)/2,y=(a[1].y+b[1].y)/2;
      cameraGesture={kind:"pinch",ids:[a[0],b[0]],distance:Math.max(1,Math.hypot(a[1].x-b[1].x,a[1].y-b[1].y)),zoom:camera.zoom,anchor:boardPoint(x,y)};
      dragging=null;nativeDragging=null;selected=null;cameraClickUntil=Date.now()+450;updateHints();
    }
    function cameraPointerDown(event) {
      const interactive=event.target.closest?.(".declarative-piece.actionable,.declarative-target[aria-disabled=false]");
      if(event.pointerType!=="touch"&&(event.button!==0||camera.zoom<=1||interactive))return;
      touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(touches.size>=2){beginPinch();event.preventDefault();event.stopPropagation();}
      else if(camera.zoom>1&&!interactive){
        cameraGesture={kind:"pan",id:event.pointerId,point:boardPoint(event.clientX,event.clientY)};
        stage.classList.add("camera-panning");event.preventDefault();event.stopPropagation();
      }
      // Capturing only camera fingers keeps ordinary piece/native dragging intact.
      if(cameraGesture)try{stage.setPointerCapture(event.pointerId);}catch(_){}
    }
    function cameraPointerMove(event) {
      if(!touches.has(event.pointerId))return;
      touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(!cameraGesture)return;
      event.preventDefault();
      if(cameraGesture.kind==="pinch"){
        const [a,b]=cameraGesture.ids.map(id=>touches.get(id));if(!a||!b)return;
        zoomAt(cameraGesture.zoom*Math.hypot(a.x-b.x,a.y-b.y)/cameraGesture.distance,(a.x+b.x)/2,(a.y+b.y)/2,cameraGesture.anchor);
      }else if(cameraGesture.id===event.pointerId){
        const point=boardPoint(event.clientX,event.clientY);camera.x+=cameraGesture.point.x-point.x;camera.y+=cameraGesture.point.y-point.y;applyCamera();
      }
    }
    function cameraPointerEnd(event) {
      if(!touches.has(event.pointerId))return false;
      touches.delete(event.pointerId);if(!cameraGesture)return false;
      event.preventDefault();dragging=null;nativeDragging=null;selected=null;cameraClickUntil=Date.now()+450;
      stage.classList.remove("camera-panning");
      if(touches.size>=2)beginPinch();
      else if(touches.size===1){const [id,point]=[...touches.entries()][0];cameraGesture={kind:"pan",id,point:boardPoint(point.x,point.y)};stage.classList.add("camera-panning");}
      else cameraGesture=null;
      updateHints();return true;
    }
    applyCamera();
    stage.addEventListener("pointerdown",cameraPointerDown,true);
    stage.addEventListener("click",event=>{if(cameraClickBlocked()){event.preventDefault();event.stopPropagation();}},true);
    global.addEventListener("pointermove",cameraPointerMove,{passive:false});
    function finishPointer(event) {
      if(cameraPointerEnd(event))return;
      if(!dragging||nativeDragging||event.pointerId!==dragging.pointerId)return;
      const drag=dragging;dragging=null;
      if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<5){updateHints();return;}
      suppressClick=true;setTimeout(()=>{suppressClick=false;},0);
      const target=document.elementFromPoint(event.clientX,event.clientY)?.closest(".declarative-target");
      if(target&&stage.contains(target)&&drag.targets.includes(target.dataset.uiId)&&canAct()){event.preventDefault();dispatch({type:"drop",id:drag.id,piece_id:drag.id,target_id:target.dataset.uiId});}
      selected=null;updateHints();
    }
    function cancelPointer(event){if(cameraPointerEnd(event))return;if(!dragging||nativeDragging||event.pointerId!==dragging.pointerId)return;dragging=null;selected=null;updateHints();}
    global.addEventListener("pointerup",finishPointer);
    global.addEventListener("pointercancel",cancelPointer);
    container.addEventListener("keydown",event=>{if(event.key==="Escape"){dragging=null;nativeDragging=null;selected=null;updateHints();}});
    let queue = Promise.resolve();
    function error(error) { if (destroyed) return; errorBox.textContent = error.message; errorBox.hidden = false; callbacks.onError?.(error); }
    function canAct() { return latest && renderedRevision===revision && latest.status === "ongoing" && latest.acting_for_player_index !== null && latest.acting_for_player_index !== undefined && !latest.replay && !moveSent; }
    function selectedPiece(){return currentScene?.pieces?.find(piece=>piece.id===selected&&!piece.hidden&&pieceActions(piece).length);}
    function pieceName(piece){return piece.face==="back"?t("ui.declarative.covered_piece", {}, "Covered piece"):piece.text||piece.id;}
    function updateHints() {
      const active=canAct(),piece=selectedPiece();
      if(!piece)selected=null;
      const destinations=active&&pieceActions(piece||{actions:[]}).includes("move")?new Set(piece.move_targets):null;
      stage.classList.toggle("show-action-hints",Boolean(active));
      stage.classList.toggle("show-drop-hints",Boolean(destinations));
      for(const node of stage.querySelectorAll(".declarative-piece")){
        const enabled=active&&Boolean(node.dataset.actions);
        node.classList.toggle("actionable",Boolean(enabled));
        node.classList.toggle("hint-selected",Boolean(active&&node.dataset.uiId===selected));
        if(node.getAttribute("role")==="button"){node.setAttribute("aria-disabled",String(!enabled));node.setAttribute("tabindex",enabled?"0":"-1");}
      }
      for(const node of stage.querySelectorAll(".declarative-target")){
        const allowed=active&&(!destinations||destinations.has(node.dataset.uiId));
        node.dataset.dropState=!active?"inactive":destinations?(allowed?"allowed":"unavailable"):"placement";
        node.setAttribute("aria-disabled",String(!allowed));node.setAttribute("tabindex",allowed?"0":"-1");
      }
      const hasAction=active&&Boolean(currentScene?.pieces?.some(piece=>pieceActions(piece).length)||currentScene?.targets?.length||currentScene?.controls?.some(control=>!control.disabled));
      hintMessage.hidden=!hasAction;
      hintMessage.textContent=destinations?t("ui.declarative.hints.choose_destination", {}, "Choose a highlighted destination"):t("ui.declarative.hints.legend", {}, "Highlights show what you can do next.");
      for(const wrapper of controls.querySelectorAll(".declarative-control")){
        const node=wrapper.querySelector("button,input,select");
        const control=currentScene?.controls?.find(item=>item.id===node?.dataset.uiId);
        if(node)node.disabled=!active||Boolean(control?.disabled);
        wrapper.classList.toggle("actionable",Boolean(node&&!node.disabled));
      }
      pieceTools.replaceChildren();
      const actions=active&&piece?pieceActions(piece):[];
      pieceTools.hidden=!actions.some(action=>action==="rotate"||action==="scale");
      if(!pieceTools.hidden){
        const caption=document.createElement("span");caption.textContent=t("ui.declarative.hints.selected_piece", {}, "Selected piece")+": "+pieceName(piece);pieceTools.append(caption);
        const addTool=(action,label,event)=>{const button=document.createElement("button");button.type="button";button.dataset.pieceAction=action;button.dataset.pieceId=piece.id;button.textContent=label;button.addEventListener("click",()=>{if(canAct()&&selectedPiece()?.id===piece.id)dispatch(event);});pieceTools.append(button);};
        if(actions.includes("rotate"))addTool("rotate",t("ui.declarative.hints.rotate_piece", {piece:pieceName(piece)}, "Rotate {piece}"),{type:"rotate",id:piece.id,delta:90});
        if(actions.includes("scale")){
          addTool("grow",t("ui.declarative.hints.grow_piece", {piece:pieceName(piece)}, "Enlarge {piece}"),{type:"scale",id:piece.id,factor:1.1});
          addTool("shrink",t("ui.declarative.hints.shrink_piece", {piece:pieceName(piece)}, "Shrink {piece}"),{type:"scale",id:piece.id,factor:1/1.1});
        }
      }
    }
    function dispatch(event) {
      if (!canAct()) return;
      const atRevision = revision;
      queue = queue.then(() => reduce({type: "ui_event", event, state_changed: latest}, atRevision)).catch(error);
    }
    function activate(node, id, label, fn, enabled=canAct) {
      node.setAttribute("role", "button"); node.setAttribute("tabindex", canAct() ? "0" : "-1");
      node.setAttribute("aria-label", String(label || id)); node.setAttribute("aria-disabled", String(!canAct()));
      node.dataset.uiId = id;
      node.addEventListener("click", () => { if (!suppressClick&&!cameraClickBlocked()&&enabled()) fn(); });
      node.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (enabled()) fn(); } });
    }
    function draw(scene,animate=false) {
      const previousPieces=new Map((currentScene?.pieces||[]).map(piece=>[piece.id,piece]));
      const previousTransforms=new Map();
      if(animate&&!global.matchMedia?.("(prefers-reduced-motion: reduce)").matches){
        const stageMatrix=stage.getCTM();
        if(stageMatrix)for(const node of stage.querySelectorAll(".declarative-piece")){
          const matrix=node.getCTM();if(matrix){const relative=stageMatrix.inverse().multiply(matrix);previousTransforms.set(node.dataset.uiId,`matrix(${relative.a},${relative.b},${relative.c},${relative.d},${relative.e},${relative.f})`);}
        }
      }
      for(const animation of pieceAnimations)animation.cancel();pieceAnimations.clear();
      currentScene=scene;
      stage.setAttribute("aria-label", t("ui.declarative.board_aria", {}, "Game board"));
      const activeId = document.activeElement?.dataset?.uiId;
      const activePieceAction = document.activeElement?.dataset?.pieceAction;
      stage.replaceChildren(); controls.replaceChildren();
      stage.setAttribute("aria-busy", String(moveSent));
      for (const board of spec.boards) {
        const layer = svg("g", {transform: `translate(${num(board.x)} ${num(board.y)})`});
        layer.append(svg("rect", {width: board.width, height: board.height, rx: board.kind === "zone" ? 12 : 2, fill: board.color || "#152b3a", stroke: board.line_color || "#4c6575"}));
        const background = assetURI(spec.assets?.[board.background_asset]);
        if (background) layer.append(svg("image", {href: background, width: board.width, height: board.height}));
        if (board.kind === "grid") {
          const cw = board.width / board.columns, ch = board.height / board.rows;
          for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.columns; c++) layer.append(svg("rect", {x: c*cw,y:r*ch,width:cw,height:ch,fill:(r+c)%2 ? board.alternate_color || board.color || "#1c394b" : board.color || "#24485d",stroke:board.line_color || "#476173", "stroke-width":1}));
        }
        for (const link of board.links || []) {
          const from = boardCell(board, link.from), to = boardCell(board, link.to);
          layer.append(svg("line", {x1:from.x,y1:from.y,x2:to.x,y2:to.y,stroke:board.line_color || "#91a7b7","stroke-width":3}));
        }
        for (const cell of board.cells || []) {
          if (board.kind === "hex") {
            const radius = Math.min(board.width / Math.max(2, num(board.columns, 7)), board.height / Math.max(2, num(board.rows, 7))) * .48;
            const points = Array.from({length:6},(_,i)=>`${cell.x+Math.cos((i*60+30)*Math.PI/180)*radius},${cell.y+Math.sin((i*60+30)*Math.PI/180)*radius}`).join(" ");
            layer.append(svg("polygon", {points, fill:cell.color || board.color || "#264d53",stroke:board.line_color || "#829e9c"}));
          } else layer.append(svg("circle", {cx:cell.x,cy:cell.y,r:12,fill:cell.color || "#476474",stroke:board.line_color || "#91a7b7"}));
          if (cell.label) layer.append(svg("text",{x:cell.x,y:cell.y,"text-anchor":"middle","dominant-baseline":"central",fill:"#fff","font-size":12},cell.label));
        }
        stage.append(layer);
      }
      for (const path of scene.paths || []) stage.append(svg("polyline",{points:(path.points || []).map(p=>`${num(p.x)},${num(p.y)}`).join(" "),fill:"none",stroke:path.color || "#d2ff5a","stroke-width":num(path.width,3)}));
      const targetLayer=svg("g");
      for (const target of scene.targets || []) {
        const point = position(spec,target), board=point.board;
        const width = board.kind === "grid" ? board.width/board.columns : 44;
        const height = board.kind === "grid" ? board.height/board.rows : 44;
        const node = svg("g",{class:"declarative-target",transform:`translate(${point.x} ${point.y})`});
        node.append(svg("rect",{class:"declarative-target-area",x:-width/2,y:-height/2,width,height,rx:5,fill:target.color || "#b8ef5b",stroke:"#c9ff63","stroke-width":2}));
        if (target.label) node.append(svg("text",{"text-anchor":"middle","dominant-baseline":"central",fill:"#d7f6ab","font-size":14},target.label));
        activate(node,target.id,target.label,()=> {
          const piece = selectedPiece();
          if(pieceActions(piece||{actions:[]}).includes("move")){
            if(piece.move_targets.includes(target.id)){dispatch({type:"drop",id:piece.id,piece_id:piece.id,target_id:target.id});selected=null;updateHints();}
          }else dispatch({type:"tap",id:target.id});
        },()=>canAct()&&node.dataset.dropState!=="unavailable");
        node.addEventListener("dragover",event=>{const piece=selectedPiece();if(canAct()&&piece?.move_targets?.includes(target.id))event.preventDefault();});
        node.addEventListener("drop",event=>{event.preventDefault();const piece=selectedPiece();if(canAct()&&nativeDragging===piece?.id&&piece?.move_targets?.includes(target.id))dispatch({type:"drop",id:piece.id,piece_id:piece.id,target_id:target.id});selected=null;dragging=null;nativeDragging=null;updateHints();});
        targetLayer.append(node);
      }
      for (const piece of [...(scene.pieces || [])].sort((a,b)=>num(a.z)-num(b.z))) {
        if (piece.hidden) continue;
        const type=spec.piece_types[piece.type], point=position(spec,piece),board=point.board;
        const width=num(type.width,board.kind==="grid" ? board.width/board.columns*.76 : 42),height=num(type.height,board.kind==="grid" ? board.height/board.rows*.76 : width);
        const actions=pieceActions(piece);
        const node=svg("g",{class:"declarative-piece"+(piece.selected?" selected":""),transform:`translate(${point.x} ${point.y}) rotate(${num(piece.rotation)}) scale(${num(piece.scale,1)})`});
        node.dataset.uiId=piece.id;node.dataset.actions=actions.join(" ");
        const body=svg("g",{opacity:num(piece.opacity,1)});node.append(body);
        if (type.shape==="circle") body.append(svg("ellipse",{rx:width/2,ry:height/2,fill:piece.color || type.color || "#d2ff5a",stroke:type.border_color || "#0d202c","stroke-width":2}));
        else if((type.shape!=="text"&&type.shape!=="image")||piece.face==="back")body.append(svg("rect",{x:-width/2,y:-height/2,width,height,rx:type.shape==="card"?7:4,fill:piece.face==="back"?"#324a88":piece.color || type.color || "#e4eced",stroke:type.border_color || "#1d3544","stroke-width":2}));
        const uri=assetURI(spec.assets?.[piece.face==="back" ? type.back_asset : piece.asset || type.asset]);
        if(uri)body.append(svg("image",{href:uri,x:-width/2,y:-height/2,width,height,preserveAspectRatio:"xMidYMid meet"}));
        const text=piece.face==="back"?"◆":piece.text;
        if(text!==undefined)body.append(svg("text",{"text-anchor":"middle","dominant-baseline":"central",fill:type.text_color || (type.shape==="text"?"#ecf4fa":"#122735"),"font-size":Math.min(width*.5,height*.6,40),"font-weight":700},text));
        if(piece.selected)node.append(svg("rect",{x:-width/2-3,y:-height/2-3,width:width+6,height:height+6,rx:5,fill:"none",stroke:"#fff","stroke-width":3}));
        if(actions.length){
          const summary=t("ui.declarative.hints.piece_actions", {piece:pieceName(piece),actions:actions.map(actionLabel).join(", ")}, "{piece}: {actions}");
          node.append(svg("title",{},summary));
          node.append(svg("rect",{class:"declarative-piece-action-outline",x:-width/2-4,y:-height/2-4,width:width+8,height:height+8,rx:8,fill:"none","vector-effect":"non-scaling-stroke"}));
          const badges=svg("g",{class:"declarative-action-badges",transform:`translate(${-width/2} ${-height/2-13})`,"aria-hidden":"true"});
          actions.forEach((action,index)=>{
            const badge=svg("g",{transform:`translate(${index*22} 0)`,"data-action-hint":action});
            badge.append(svg("rect",{x:0,y:-8,width:20,height:18,rx:5}));
            badge.append(svg("text",{x:10,y:1,"text-anchor":"middle","dominant-baseline":"central","font-size":14},({tap:"↖",move:"↔",rotate:"↻",scale:"↗"})[action]));
            badges.append(badge);
          });node.append(badges);
          activate(node,piece.id,summary,()=>{selected=piece.id;updateHints();if(actions.includes("tap"))dispatch({type:"tap",id:piece.id});});
        }else{node.setAttribute("role","img");node.setAttribute("aria-label",pieceName(piece));}
        if(actions.includes("move")){
          node.style.touchAction="none";
          node.addEventListener("pointerdown",event=>{if(canAct()){suppressClick=false;selected=piece.id;dragging={id:piece.id,pointerId:event.pointerId,x:event.clientX,y:event.clientY,targets:piece.move_targets || []};updateHints();}});
          node.setAttribute("draggable","true");node.addEventListener("dragstart",event=>{if(!canAct()){event.preventDefault();return;}selected=piece.id;nativeDragging=piece.id;updateHints();event.dataTransfer?.setData("text/plain",piece.id);});
          node.addEventListener("dragend",()=>{dragging=null;nativeDragging=null;selected=null;updateHints();});}
        stage.append(node);
        const previous=previousPieces.get(piece.id),from=previousTransforms.get(piece.id);
        if(previous&&from&&node.animate){
          const before=position(spec,previous);
          if(before.x!==point.x||before.y!==point.y||num(previous.rotation)!==num(piece.rotation)||num(previous.scale,1)!==num(piece.scale,1)){
            const animation=node.animate([{transform:from},{transform:`translate(${point.x}px, ${point.y}px) rotate(${num(piece.rotation)}deg) scale(${num(piece.scale,1)})`}],{duration:1440,easing:"ease-out"});
            pieceAnimations.add(animation);animation.onfinish=()=>pieceAnimations.delete(animation);
          }
        }
      }
      stage.append(targetLayer);
      for(const label of scene.labels || [])stage.append(svg("text",{x:num(label.x),y:num(label.y),fill:label.color || "#e4edf4","font-size":num(label.font_size,18),"dominant-baseline":"hanging"},label.text));
      for(const control of scene.controls || []) {
        const wrapper=document.createElement("label");wrapper.className="declarative-control";
        let node;
        if(control.kind==="button") {node=document.createElement("button");node.type="button";node.textContent=control.label;node.addEventListener("click",()=>dispatch({type:"tap",id:control.id}));}
        else {
          const caption=document.createElement("span");caption.textContent=control.label;wrapper.append(caption);
          node=document.createElement(control.kind==="choice"?"select":"input");
          if(control.kind==="choice")for(const option of control.options || []){const element=document.createElement("option");element.value=String(option.value);element.textContent=option.label;node.append(element);}
          else {node.type=control.kind==="number"?"number":"text";for(const key of ["min","max","step"])if(control[key]!==undefined)node[key]=String(control[key]);node.maxLength=2000;}
          node.value=control.value===undefined?"":String(control.value);
          if(control.kind==="choice"){
            const index=(control.options || []).findIndex(option=>Object.is(option.value,control.value));
            if(index>=0)node.selectedIndex=index;
          }
          node.addEventListener("change",()=>{
            const value=control.kind==="number"?Number(node.value):control.kind==="choice"?(control.options || [])[node.selectedIndex]?.value:node.value;
            dispatch({type:"change",id:control.id,value});
          });
        }
        node.dataset.uiId=control.id;node.disabled=Boolean(control.disabled)||!canAct();wrapper.classList.toggle("actionable",!node.disabled);wrapper.append(node);controls.append(wrapper);
      }
      updateHints();
      if(activeId)for(const node of container.querySelectorAll("[data-ui-id]"))if(node.dataset.uiId===activeId){node.focus({preventScroll:true});break;}
      if(activePieceAction)for(const node of pieceTools.querySelectorAll("[data-piece-action]"))if(node.dataset.pieceAction===activePieceAction){node.focus({preventScroll:true});break;}
    }
    async function reduce(message, atRevision, options = {}) {
      if(destroyed || atRevision!==revision || message.type==="ui_event"&&!canAct())return false;
      const result=await engine.call(spec.ui_code,message,localState);
      if(destroyed || atRevision!==revision)return false;
      knownObject(result,["scene","local_state","make_move"],["scene"]);
      finiteJSON(result);
      if(result.make_move!==undefined && (message.type!=="ui_event" || !canAct()))throw new Error(t("ui.declarative.error.only_a_current_player_ui_event_may_emit_make_move", {}, "Only a current player UI event may emit make_move"));
      const scene=validateScene(spec,result.scene);
      renderedRevision=atRevision;
      localState=result.local_state===undefined?null:clone(result.local_state);
      errorBox.hidden=true;
      if(result.make_move!==undefined && message.type==="ui_event" && canAct()) {moveSent=true;callbacks.onMove?.(clone(result.make_move));}
      const motionEnabled=message.type==="state_changed"&&options.animate!==false&&callbacks.animate===true&&!latest?.replay&&!global.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      // The actor belongs to the completed move, not the next turn. Missing
      // metadata snaps conservatively; an own move never animates captures either.
      const actor=message.last_move_player_index;
      const viewer=message.my_player_index;
      const knownOther=viewer===null||(Number.isInteger(viewer)&&viewer>=0&&viewer<10&&actor!==viewer);
      const animate=motionEnabled&&!lastStateWasReplay&&Number.isInteger(lastStateMoveCount)&&Number.isInteger(message.move_count)&&message.move_count>lastStateMoveCount&&Number.isInteger(actor)&&actor>=0&&actor<10&&knownOther;
      // Polls can arrive just after a move starts. Keep the existing elements
      // and their animation clocks when the authoritative scene is unchanged.
      if(motionEnabled&&currentScene&&JSON.stringify(scene)===JSON.stringify(currentScene)){
        stage.setAttribute("aria-busy",String(moveSent));updateHints();
      }else draw(scene,animate);
      if(message.type==="state_changed"){
        lastStateMoveCount=Number.isInteger(message.move_count)?message.move_count:null;
        lastStateWasReplay=Boolean(message.replay);
      }
      callbacks.onScene?.(clone(scene));
      return true;
    }
    callbacks.onReady?.();
    return {
      send(message, options = {}) {
        latest=clone(message);revision++;moveSent=false;selected=null;dragging=null;nativeDragging=null;updateHints();const atRevision=revision;
        queue=queue.then(()=>reduce(latest,atRevision,options)).catch(error);return queue;
      },
      destroy(){destroyed=true;revision++;touches.clear();cameraGesture=null;for(const animation of pieceAnimations)animation.cancel();pieceAnimations.clear();global.removeEventListener("pointermove",cameraPointerMove);global.removeEventListener("pointerup",finishPointer);global.removeEventListener("pointercancel",cancelPointer);engine.destroy();container.replaceChildren();container.classList.remove("declarative-game");},
      dispatch,
    };
  }
  function clientDocument(spec) {
    const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    const data=value=>JSON.stringify(canonical(value)).replace(/</g,"\\u003c");
    return '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<link rel="stylesheet" href="/static/declarative-ui.css?v=5"><div id="declarative-game"></div>' +
      '<script type="application/json" id="i18n-strings">'+data(spec.strings || {})+'<'+'/script>' +
      '<script type="application/json" id="declarative-spec">'+data(spec)+'<'+'/script>' +
      '<script src="/static/declarative-ui.js?v=5"><'+'/script><script>' +
      'const host=DeclarativeUI.mount(document.getElementById("declarative-game"),' +
      'JSON.parse(document.getElementById("declarative-spec").textContent),' +
      '{onMove:move=>parent.postMessage({type:"make_move",move},"*"),' +
      'onReady:()=>parent.postMessage({type:"game_ready"},"*")});' +
      'addEventListener("message",event=>{if(event.source===parent&&event.data?.type==="state_changed")host.send(event.data)});' +
      '<'+'/script>';
  }

  const api={mount,clientDocument,position,boardCell,validateScene,validateSpec,assetURI,pieceActions};
  global.DeclarativeUI=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
