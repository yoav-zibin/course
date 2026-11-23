"use strict";
// Shared portable contract. Keep fixtures in tests/fixtures/declarative in parity.
function t(key, params, fallback) { return fallback.replace(/\{(\w+)\}/g, (m,k)=>params[k]??m); }
const num=(v,f=0)=>Number.isFinite(v)?v:f;
  function assetURI(asset) {
    const uri = asset?.uri;
    // Image requests are an outbound channel too: choosing an authored remote
    // asset based on a private card would disclose that card to its host.
    return typeof uri === "string" && /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/.test(uri) ? uri : null;
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
    let x=num(board.x)+num(cell.x), y=num(board.y)+num(cell.y);
    if (item.hand) {
      const {index,count,spacing,columns=count,row_spacing=0}=item.hand;
      const row=Math.floor(index/columns), rowSize=Math.min(columns,count-row*columns);
      x+=(index%columns-(rowSize-1)/2)*spacing;
      y+=row*row_spacing;
    }
    return {x,y,board};
  }
  function finiteJSON(value, depth=0) {
    if(depth>64)throw new Error(t("ui.declarative.error.ui_json_is_nested_too_deeply", {}, "UI JSON is nested too deeply"));
    if(typeof value==="number"&&!Number.isFinite(value))throw new Error(t("ui.declarative.error.ui_json_contains_a_non_finite_number", {}, "UI JSON contains a non-finite number"));
    if(value&&typeof value==="object")for(const item of Object.values(value))finiteJSON(item,depth+1);
  }
  function validateSpec(spec) {
    finiteJSON(spec);
    if(!spec || spec.format!=="buildplay-ui" || spec.version!==1)throw new Error(t("ui.declarative.error.unsupported_declarative_ui_format", {}, "Unsupported declarative UI format"));
    knownObject(spec,["format","version","viewport","boards","piece_types","assets","strings","motion","ui_code"]);
    knownObject(spec.viewport,["width","height","camera_enabled","camera_controls"],["width","height"]);
    const dimension=value=>typeof value==="number" && value>0 && value<=100000;
    const assetRef=id=>id===undefined || (isId(id) && Object.hasOwn(spec.assets??{},id));
    if(spec.motion!==undefined){
      knownObject(spec.motion,["move_ms","roll_ms","roll_settle_ms","turn_pause_ms","animate_own","scene_transitions","easing"]);
      for(const key of ["move_ms","roll_ms","roll_settle_ms","turn_pause_ms"])if(key in spec.motion&&(!Number.isInteger(spec.motion[key])||spec.motion[key]<0||spec.motion[key]>5000))throw new Error(t("ui.declarative.error.invalid_numeric_geometry", {}, "Invalid numeric geometry"));
      if("animate_own" in spec.motion&&typeof spec.motion.animate_own!=="boolean")throw new Error(t("ui.declarative.error.invalid_ui_flag", {}, "Invalid UI flag"));
      if("scene_transitions" in spec.motion&&typeof spec.motion.scene_transitions!=="boolean")throw new Error(t("ui.declarative.error.invalid_ui_flag", {}, "Invalid UI flag"));
      if("easing" in spec.motion&&!["ease-out","ease-in-out-quad"].includes(spec.motion.easing))throw new Error(t("ui.declarative.error.invalid_ui_object_fields", {}, "Invalid UI object fields"));
    }
    if(!dimension(spec.viewport.width) || !dimension(spec.viewport.height))throw new Error(t("ui.declarative.error.invalid_viewport", {}, "Invalid viewport"));
    if(Object.hasOwn(spec.viewport,"camera_enabled")&&typeof spec.viewport.camera_enabled!=="boolean")throw new Error(t("ui.declarative.error.invalid_viewport", {}, "Invalid viewport"));
    if(Object.hasOwn(spec.viewport,"camera_controls")&&typeof spec.viewport.camera_controls!=="boolean")throw new Error(t("ui.declarative.error.invalid_viewport", {}, "Invalid viewport"));
    if(!Array.isArray(spec.boards)||!spec.boards.length||spec.boards.length>32)throw new Error(t("ui.declarative.error.expected_1_32_boards", {}, "Expected 1–32 boards"));
    if(!spec.piece_types||typeof spec.piece_types!=="object"||Array.isArray(spec.piece_types))throw new Error(t("ui.declarative.error.expected_piece_types", {}, "Expected piece types"));
    const typeIds=Object.keys(spec.piece_types);
    if(!typeIds.length || typeIds.length>128 || !typeIds.every(isId)) throw new Error("Invalid piece type IDs");
    for(const type of Object.values(spec.piece_types)){
      knownObject(type,["shape","width","height","color","text_color","border_color","asset","back_asset","action_outline","font_size"],["shape"]);
      if((type.width!==undefined&&!dimension(type.width)) || (type.height!==undefined&&!dimension(type.height)) ||
         !assetRef(type.asset) || !assetRef(type.back_asset)) throw new Error("Invalid piece dimensions or artwork");
      if (!type || !["circle","rect","hex","card","dice","image","text","card_pile","counter","group"].includes(type.shape))
        throw new Error("Unknown piece type shape");
      if(type.action_outline!==undefined&&!["rect","ellipse","none"].includes(type.action_outline))throw new Error(t("ui.declarative.error.invalid_ui_object_fields", {}, "Invalid UI object fields"));
      if(type.font_size!==undefined&&(typeof type.font_size!=="number"||type.font_size<=0||type.font_size>100000))throw new Error(t("ui.declarative.error.invalid_positive_geometry", {}, "Invalid positive geometry"));
    }
    if(typeof spec.ui_code!=="string"||!spec.ui_code.length||Array.from(spec.ui_code).length>200000)throw new Error(t("ui.declarative.error.invalid_presentation_source", {}, "Invalid presentation source"));
    const boardIds=new Set();
    for(const board of spec.boards){
      if(!isId(board.id) || boardIds.has(board.id) || !["grid","hex","graph","track","free","zone"].includes(board.kind)) throw new Error("Invalid board ID or kind");
      boardIds.add(board.id);
      if(!assetRef(board.background_asset)) throw new Error("Unknown board artwork");
      if(!dimension(board.width)||!dimension(board.height))throw new Error(t("ui.declarative.error.invalid_board_dimensions", {}, "Invalid board dimensions"));
      if(board.kind==="grid"&&(!Number.isInteger(board.rows)||!Number.isInteger(board.columns)||board.rows<1||board.columns<1||board.rows*board.columns>2048))throw new Error(t("ui.declarative.error.a_grid_must_contain_1_2048_cells", {}, "A grid must contain 1–2048 cells"));
      if(board.cells&&(!Array.isArray(board.cells)||board.cells.length>2048))throw new Error(t("ui.declarative.error.too_many_explicit_cells", {}, "Too many explicit cells"));
      if (["hex","graph","track"].includes(board.kind) && !board.cells?.length) throw new Error("Board requires cells");
      const cells=new Set((board.cells??[]).map(cell=>cell.id));
      if(cells.size!==(board.cells?.length??0) || [...cells].some(id=>!isId(id))) throw new Error("Invalid or duplicate cell ID");
      if(board.links?.some(link=>!cells.has(link.from)||!cells.has(link.to))) throw new Error("Unknown linked cell");
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
    const fields={pieces:["id","type","board","position","text","aria_label","asset","rotation","scale","opacity","z","face","move_targets","selected","hidden","draggable","actions","animation","hand","parent","pivot","mirror_x","mirror_y","count","die_value"],targets:["id","board","position","label","aria_label","color","asset","hit_area","hit_shape","preview"],labels:["id","text","x","y","color","font_size"],controls:["id","label","kind","value","min","max","step","options","disabled"],paths:["id","points","color","width"]};
    const required={pieces:["id","type","board","position"],targets:["id","board","position"],labels:["id","text","x","y"],controls:["id","label","kind"],paths:["id","points"]};
    knownObject(item,fields[kind],required[kind]);
    for(const key of ["id","type","board","asset","parent"])if(key in item&&!isId(item[key]))throw new Error(t("ui.declarative.error.invalid_ui_identifier", {}, "Invalid UI identifier"));
    for(const key of ["text","label","aria_label"])if(key in item&&(typeof item[key]!=="string"||Array.from(item[key]).length>4000||key==="aria_label"&&!item[key].length))throw new Error(t("ui.declarative.error.invalid_display_text", {}, "Invalid display text"));
    if("color" in item&&!/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(item.color))throw new Error(t("ui.declarative.error.invalid_display_color", {}, "Invalid display color"));
    for(const key of ["selected","hidden","draggable","disabled","mirror_x","mirror_y"])if(key in item&&typeof item[key]!=="boolean")throw new Error(t("ui.declarative.error.invalid_ui_flag", {}, "Invalid UI flag"));
    for(const key of ["rotation","z","x","y","min","max"])if(key in item&&(typeof item[key]!=="number"||Math.abs(item[key])>100000))throw new Error(t("ui.declarative.error.invalid_numeric_geometry", {}, "Invalid numeric geometry"));
    for(const key of ["scale","font_size","width","step"])if(key in item&&(!(typeof item[key]==="number"&&item[key]>0)||item[key]>(key==="scale"?100:100000)))throw new Error(t("ui.declarative.error.invalid_positive_geometry", {}, "Invalid positive geometry"));
    if("opacity" in item&&(typeof item.opacity!=="number"||item.opacity<0||item.opacity>1))throw new Error(t("ui.declarative.error.invalid_opacity", {}, "Invalid opacity"));
    if("face" in item&&!["front","back"].includes(item.face))throw new Error(t("ui.declarative.error.invalid_piece_face", {}, "Invalid piece face"));
    if("position" in item){
      const at=item.position;knownObject(at,["cell","x","y"]);
      if("cell" in at){if(!isId(at.cell)||"x" in at||"y" in at)throw new Error(t("ui.declarative.error.invalid_cell_position", {}, "Invalid cell position"));}
      else checkPoint(at);
    }
    if (item.hand !== undefined) {
      const h=item.hand;
      knownObject(h,['index','count','spacing','columns','row_spacing'],['index','count','spacing']);
      if (item.parent || !Number.isInteger(h.count) || h.count<1 || h.count>2048 ||
          !Number.isInteger(h.index) || h.index<0 || h.index>=h.count ||
          ('columns' in h && (!Number.isInteger(h.columns) || h.columns<1 || h.columns>2048)) ||
          [h.spacing,h.row_spacing??0].some(n=>!Number.isFinite(n)||n<0||n>100000))
        throw new Error('Invalid hand slot');
    }
    if(item.pivot !== undefined) checkPoint(item.pivot);
    for (const [key, maximum] of [["count", 1000000], ["die_value", 6]]) {
      if (key in item && (!Number.isInteger(item[key]) || item[key] < 0 || item[key] > maximum))
        throw new Error("Invalid " + key);
    }
    if("move_targets" in item&&(!Array.isArray(item.move_targets)||item.move_targets.length>2048||item.move_targets.some(value=>!isId(value))||new Set(item.move_targets).size!==item.move_targets.length))throw new Error(t("ui.declarative.error.invalid_move_targets", {}, "Invalid move targets"));
    if("actions" in item&&(!Array.isArray(item.actions)||item.actions.some(action=>!["tap","move","rotate","flip","scale"].includes(action))||new Set(item.actions).size!==item.actions.length||item.actions.includes("move")&&!item.move_targets?.length))throw new Error(t("ui.declarative.error.invalid_move_targets", {}, "Invalid move targets"));
    if("animation" in item){
      knownObject(item.animation,["kind","key","duration_ms","delay_ms","z"],["kind","key"]);
      if(!["roll","move","notice","pulse"].includes(item.animation.kind))throw new Error(t("ui.declarative.error.invalid_ui_object_fields", {}, "Invalid UI object fields"));
      if(!isId(item.animation.key))throw new Error(t("ui.declarative.error.invalid_ui_identifier", {}, "Invalid UI identifier"));
      for(const key of ["duration_ms","delay_ms"])if(key in item.animation&&(!Number.isInteger(item.animation[key])||item.animation[key]<0||item.animation[key]>5000))throw new Error(t("ui.declarative.error.invalid_numeric_geometry", {}, "Invalid numeric geometry"));
      if('z' in item.animation&&(typeof item.animation.z!=='number'||Math.abs(item.animation.z)>1000000))throw new Error(t("ui.declarative.error.invalid_numeric_geometry", {}, "Invalid numeric geometry"));
    }
    if("hit_area" in item){
      knownObject(item.hit_area,["x","y","width","height"],["x","y","width","height"]);
      for(const key of ["x","y"])if(typeof item.hit_area[key]!=="number"||Math.abs(item.hit_area[key])>100000)throw new Error(t("ui.declarative.error.invalid_numeric_geometry", {}, "Invalid numeric geometry"));
      for(const key of ["width","height"])if(typeof item.hit_area[key]!=="number"||item.hit_area[key]<=0||item.hit_area[key]>100000)throw new Error(t("ui.declarative.error.invalid_positive_geometry", {}, "Invalid positive geometry"));
    }
    if("hit_shape" in item){
      // A line (capsule) or polygon tap zone relative to the target position.
      // It replaces the rectangle, so declaring both would be ambiguous.
      const shape=item.hit_shape,bad=()=>new Error(t("ui.declarative.error.invalid_ui_object_fields", {}, "Invalid UI object fields"));
      if("hit_area" in item)throw bad();
      if(shape&&shape.kind==="line"){
        knownObject(shape,["kind","from","to","width"],["kind","from","to","width"]);
        checkPoint(shape.from);checkPoint(shape.to);
        if(typeof shape.width!=="number"||shape.width<=0||shape.width>100000)throw new Error(t("ui.declarative.error.invalid_positive_geometry", {}, "Invalid positive geometry"));
      }else if(shape&&shape.kind==="polygon"){
        knownObject(shape,["kind","points"],["kind","points"]);
        if(!Array.isArray(shape.points)||shape.points.length<3||shape.points.length>32)throw new Error(t("ui.declarative.error.invalid_path_points", {}, "Invalid path points"));
        shape.points.forEach(checkPoint);
      }else throw bad();
    }
    if("preview" in item){
      // Ghost cells drawn while a destination is hovered, focused, dragged over
      // or armed by a first touch. Presentation only; the server still decides.
      if(!Array.isArray(item.preview)||!item.preview.length||item.preview.length>64)throw new Error(t("ui.declarative.error.invalid_target_preview", {}, "Invalid target preview"));
      for(const cell of item.preview){
        knownObject(cell,["position","color","asset","rotation","text"],["position"]);
        knownObject(cell.position,["cell","x","y"]);
        if("cell" in cell.position){if(!isId(cell.position.cell)||"x" in cell.position||"y" in cell.position)throw new Error(t("ui.declarative.error.invalid_cell_position", {}, "Invalid cell position"));}
        else checkPoint(cell.position);
        if("color" in cell&&!/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(cell.color))throw new Error(t("ui.declarative.error.invalid_display_color", {}, "Invalid display color"));
        if("asset" in cell&&!isId(cell.asset))throw new Error(t("ui.declarative.error.invalid_ui_identifier", {}, "Invalid UI identifier"));
        if("rotation" in cell&&(typeof cell.rotation!=="number"||Math.abs(cell.rotation)>100000))throw new Error(t("ui.declarative.error.invalid_numeric_geometry", {}, "Invalid numeric geometry"));
        if("text" in cell&&(typeof cell.text!=="string"||Array.from(cell.text).length>40))throw new Error(t("ui.declarative.error.invalid_display_text", {}, "Invalid display text"));
      }
    }
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
        for (const cell of key === "targets" ? item.preview || [] : []) {
          position(spec, {board:item.board, position:cell.position});
          if (cell.asset && !Object.hasOwn(spec.assets || {}, cell.asset)) throw new Error(t("ui.declarative.error.unknown_asset", {}, "Unknown asset"));
        }
      }
    }
    const targets = new Set((scene.targets || []).map(target => target.id));
    for (const piece of scene.pieces || []) for (const target of piece.move_targets || []) if (!targets.has(target)) throw new Error(t("ui.declarative.error.unknown_move_target", {}, "Unknown move target"));
    const byId = new Map((scene.pieces || []).map(piece => [piece.id, piece]));
    for (const piece of byId.values()) {
      if (spec.piece_types[piece.type].shape === 'card_pile' && piece.count === undefined)
        throw new Error("Card piles require a count");
      let child = piece, depth = 0;
      while (child.parent) {
        const parent = byId.get(child.parent);
        if (!parent || parent.board !== child.board || 'cell' in child.position || ++depth > 8)
          throw new Error("Invalid piece group");
        child = parent;
      }
    }
    return scene;
  }
  function visiblePieces(scene) {
    const all=new Map((scene.pieces||[]).map(p=>[p.id,p]));
    return new Map([...all].filter(([,piece])=>{
      while (!piece.hidden) {
        if (!piece.parent) return true;
        piece=all.get(piece.parent);
      }
      return false;
    }));
  }
  function validateMoveAnimations(spec, scene, animations) {
    if(animations===undefined||animations===null)return null;
    finiteJSON(animations);
    const fail=()=>{throw new Error('Invalid last move animations');};
    if(!Array.isArray(animations)||animations.length>128)fail();
    const pieces=visiblePieces(scene);
    const ends=new Map();
    let duration=0;
    const same=(a,b)=>Math.abs(a.x-b.x)<.000001&&Math.abs(a.y-b.y)<.000001;
    for(const animation of animations){
      knownObject(animation,['piece_id','path','duration_ms','z'],['piece_id','path']);
      if(!isId(animation.piece_id)||!pieces.has(animation.piece_id)||!Array.isArray(animation.path)||animation.path.length<2||animation.path.length>64)fail();
      if('duration_ms' in animation&&(!Number.isInteger(animation.duration_ms)||animation.duration_ms<0||animation.duration_ms>5000))fail();
      if('z' in animation&&(typeof animation.z!=='number'||Math.abs(animation.z)>1000000))fail();
      duration+=animation.duration_ms??spec.motion?.move_ms??1440;
      if(duration>30000)fail();
      if (pieces.get(animation.piece_id).parent) throw new Error('Use local timeline clips to animate group members');
      const points=animation.path.map(point=>{
        knownObject(point,['board','position'],['board','position']);
        if(!isId(point.board))fail();
        const at=point.position;knownObject(at,['cell','x','y']);
        if('cell' in at){if(!isId(at.cell)||'x' in at||'y' in at)fail();}
        else checkPoint(at);
        return position(spec,point);
      });
      if(ends.has(animation.piece_id)&&!same(ends.get(animation.piece_id),points[0]))fail();
      ends.set(animation.piece_id,points[points.length-1]);
    }
    for(const [id,end] of ends)if(!same(end,position(spec,pieces.get(id))))fail();
    return animations;
  }
  function validateSceneAnimations(spec, scene, animations) {
    if(animations===undefined)return [];
    finiteJSON(animations);
    const fail=()=>{throw new Error('Invalid scene animations');};
    if(!Array.isArray(animations)||animations.length>128)fail();
    const pieces=visiblePieces(scene);
    const seen=new Set();
    for(const animation of animations){
      knownObject(animation,['piece_id','key','from','duration_ms','delay_ms','z'],['piece_id','key','from']);
      if(!isId(animation.piece_id)||!isId(animation.key)||!pieces.has(animation.piece_id)||seen.has(animation.piece_id))fail();
      seen.add(animation.piece_id);
      for(const key of ['duration_ms','delay_ms'])if(key in animation&&(!Number.isInteger(animation[key])||animation[key]<0||animation[key]>5000))fail();
      if('z' in animation&&(typeof animation.z!=='number'||Math.abs(animation.z)>1000000))fail();
      const from=animation.from;
      knownObject(from,['board','position','rotation','scale','opacity']);
      if(!['position','rotation','scale','opacity'].some(key=>Object.hasOwn(from,key)))fail();
      if('board' in from&&(!isId(from.board)||!Object.hasOwn(from,'position')))fail();
      if('rotation' in from&&(typeof from.rotation!=='number'||Math.abs(from.rotation)>100000))fail();
      if('scale' in from&&(typeof from.scale!=='number'||from.scale<=0||from.scale>100))fail();
      if('opacity' in from&&(typeof from.opacity!=='number'||from.opacity<0||from.opacity>1))fail();
      if('position' in from){
        const at=from.position;
        if (pieces.get(animation.piece_id).parent && (from.board || at?.cell!==undefined)) fail();
        knownObject(at,['cell','x','y']);
        if('cell' in at){if(!isId(at.cell)||'x' in at||'y' in at)fail();}
        else checkPoint(at);
        position(spec,{board:from.board??pieces.get(animation.piece_id).board,position:at});
      }
    }
    return animations;
  }
  function validateTimeline(spec, scene, timeline) {
    knownObject(timeline, ['key', 'steps'], ['key', 'steps']);
    if (!isId(timeline.key) || !Array.isArray(timeline.steps) || !timeline.steps.length || timeline.steps.length > 128)
      throw new Error('Invalid timeline');
    const byId = visiblePieces(scene);
    const last = new Map();
    let duration = 0, count = 0;
    for (const step of timeline.steps) {
      if (!Array.isArray(step) || !step.length) throw new Error('Empty timeline step');
      const ids = new Set();
      let length = 0;
      for (const clip of step) {
        knownObject(clip, ['piece_id','from','to','exit','duration_ms','delay_ms','z'], ['piece_id']);
        const piece = byId.get(clip.piece_id);
        if (!isId(clip.piece_id) || ids.has(clip.piece_id) || !!piece === !!clip.exit ||
            ('exit' in clip && typeof clip.exit !== 'boolean')) throw new Error('Invalid timeline target');
        ids.add(clip.piece_id);
        last.set(clip.piece_id, clip);
        if (++count > 128) throw new Error('Too many timeline clips');
        const {piece_id, duration_ms, delay_ms, z} = clip;
        for (const pose of [clip.from, clip.to].filter(p => p !== undefined)) {
          if (pose.position && !piece && !pose.board) throw new Error('Exit positions require an explicit board');
          if (piece?.parent && (pose.board || pose.position?.cell !== undefined)) throw new Error('Child animations use local x/y');
        }
        // Reuse the transform, timing, z and board reference checks for explicit animations.
        const target = {id:piece_id, board:piece?.board??spec.boards[0].id};
        const entry = {piece_id, key:timeline.key};
        if (duration_ms !== undefined) entry.duration_ms = duration_ms;
        if (delay_ms !== undefined) entry.delay_ms = delay_ms;
        if (z !== undefined) entry.z = z;
        for (const from of [clip.from ?? {opacity:1}, ...(clip.to === undefined ? [] : [clip.to])])
          validateSceneAnimations(spec, {pieces:[target]}, [{...entry, from}]);
        length = Math.max(length, (delay_ms ?? 0) + (duration_ms ?? spec.motion?.move_ms ?? 1440));
      }
      duration += length;
    }
    if (duration > 30000) throw new Error('Timeline exceeds 30000ms');
    for (const clip of last.values())
      if (clip.to && !clip.exit) throw new Error('Last clip must end at its scene pose');
    return timeline;
  }

  // Older v1 packages treated every piece as tappable. An explicit empty list
  // lets new packages mark decoration precisely; destinations also declare move.
  function pieceActions(piece) {
    if(piece.hidden)return [];
    const actions=piece.actions===undefined?["tap"]:piece.actions;
    return ["tap","move","rotate","flip","scale"].filter(action=>actions.includes(action)||action==="move"&&piece.move_targets?.length);
  }
  function actionLabel(action) {
    if(action==="tap")return t("ui.declarative.hints.tap", {}, "Click");
    if(action==="move")return t("ui.declarative.hints.move", {}, "Move");
    if(action==="rotate")return t("ui.declarative.hints.rotate", {}, "Rotate");
    if(action==="flip")return t("ui.declarative.hints.flip", {}, "Flip");
    return t("ui.declarative.hints.scale", {}, "Resize");
  }
  // Tap zone of a target as an axis-aligned box in board-space units. A line or
  // polygon `hit_shape` is bounded by its points (plus half the line width).
  function targetBounds(spec, target) {
    const point=position(spec,target),board=point.board,shape=target.hit_shape;
    if(shape){
      const points=shape.kind==="line"?[shape.from,shape.to]:shape.points,pad=shape.kind==="line"?shape.width/2:0;
      const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
      const x=Math.min(...xs)-pad,y=Math.min(...ys)-pad;
      return {x:point.x+x,y:point.y+y,width:Math.max(...xs)+pad-x,height:Math.max(...ys)+pad-y};
    }
    const width=board.kind==="grid"?board.width/board.columns:44,height=board.kind==="grid"?board.height/board.rows:44;
    const hit=target.hit_area||{};
    return {x:point.x+num(hit.x,-width/2),y:point.y+num(hit.y,-height/2),
      width:num(hit.width,width),height:num(hit.height,height)};
  }
  function contentBounds(spec, scene = {}) {
    const boxes = [{x:0,y:0,width:spec.viewport.width,height:spec.viewport.height},
      ...spec.boards.map(board => ({x:num(board.x),y:num(board.y),width:board.width,height:board.height}))];
    // Hands and other playable pieces may live outside their board surface.
    // Include their rotated bodies and complete legal destinations. The
    // declared viewport also retains headings/instructions around the boards.
    for(const piece of scene.pieces || []) {
      if(piece.hidden)continue;
      const point=position(spec,piece),board=point.board,type=spec.piece_types[piece.type];
      const width=num(type.width,board.kind==="grid"?board.width/board.columns*.76:42),height=num(type.height,board.kind==="grid"?board.height/board.rows*.76:width);
      const angle=num(piece.rotation)*Math.PI/180,scale=num(piece.scale,1);
      const w=(Math.abs(Math.cos(angle))*width+Math.abs(Math.sin(angle))*height)*scale;
      const h=(Math.abs(Math.sin(angle))*width+Math.abs(Math.cos(angle))*height)*scale;
      boxes.push({x:point.x-w/2,y:point.y-h/2,width:w,height:h});
    }
    for(const target of scene.targets || [])boxes.push(targetBounds(spec,target));
    const x=Math.min(...boxes.map(box=>box.x)),y=Math.min(...boxes.map(box=>box.y));
    return {x,y,width:Math.max(...boxes.map(box=>box.x+box.width))-x,height:Math.max(...boxes.map(box=>box.y+box.height))-y};
  }
  function cameraLimits(bounds, zoom) {
    const width=bounds.width/zoom,height=bounds.height/zoom;
    // Leave room to bring edge pieces under a finger without letting the board
    // disappear. The margin stays proportional to the currently visible area.
    const marginX=width*.18,marginY=height*.18;
    const left=bounds.x+Math.min(0,(bounds.width-width)/2),top=bounds.y+Math.min(0,(bounds.height-height)/2);
    return {width,height,minX:left-marginX,maxX:Math.max(left,bounds.x+bounds.width-width)+marginX,
      minY:top-marginY,maxY:Math.max(top,bounds.y+bounds.height-height)+marginY};
  }

module.exports={validateTimeline,finiteJSON,validateSpec,validateScene,validateMoveAnimations,validateSceneAnimations,knownObject,assetURI,boardCell,position,pieceActions,contentBounds,targetBounds,cameraLimits};
