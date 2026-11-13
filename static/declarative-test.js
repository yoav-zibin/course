(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const t = (key, params, fallback) => I18n.t(key, params, fallback);
  let host = null;
  const sample = {
    format: "buildplay-ui", version: 1, viewport: {width: 420, height: 460}, assets: {},
    boards: [{id: "board", kind: "grid", x: 30, y: 55, width: 360, height: 360, rows: 3, columns: 3}],
    piece_types: {mark: {shape: "circle", color: "#d2ff5a", width: 72, height: 72}}, strings: {heading:t("ui.declarative.sample_title", {}, "Tic-tac-toe · presentation example")},
    ui_code: 'const gameUI = { reduce(message, localState) { const m = message.type === "ui_event" ? message.state_changed : message; const board = m.view.board; const scene = {pieces:[], targets:[], labels:[{id:"heading",text:(m.strings||{}).heading||"",x:25,y:15,font_size:18}]}; board.forEach((mark,i) => { if(mark) scene.pieces.push({id:"piece-"+i,type:"mark",board:"board",position:{cell:String(i)},actions:[],text:mark}); else if(m.acting_for_player_index !== null) scene.targets.push({id:"cell-"+i,board:"board",position:{cell:String(i)},label:String(i+1)}); }); const result = {scene,local_state:null}; if(message.type === "ui_event" && message.event.type === "tap" && message.event.id.startsWith("cell-")) result.make_move={cell:Number(message.event.id.slice(5))}; return result; }};'
  };
  const initial = {type:"state_changed",state:{board:["X","","","","O","","","",""]},view:{board:["X","","","","O","","","",""]},players:[{player_index:0,player_id:"one",kind:"human",name:t("ui.declarative.player_one", {}, "Player 1")},{player_index:1,player_id:"two",kind:"human",name:t("ui.declarative.player_two", {}, "Player 2")}],turn_of_player_indices:[0],my_player_index:0,acting_for_player_index:0,status:"ongoing",move_count:2};
  initial.strings = sample.strings;
  function status(text, failed=false) { $("status").textContent=text;$("status").dataset.error=String(failed); }
  function preview() {
    try {
      const spec=JSON.parse($("spec").value), message=JSON.parse($("message").value);
      host?.destroy();
      host=DeclarativeUI.mount($("preview"),spec,{
        onMove(move){$("messages").textContent+=JSON.stringify({type:"make_move",move},null,2)+"\n";},
        onError(error){status(error.message,true);},
        onScene(scene){$("scene").textContent=JSON.stringify(scene,null,2);status(t("ui.declarative.scene_rendered", {}, "Scene rendered in the isolated presentation engine."));},
      });
      host.send(message);
    } catch(error){status(error.message,true);}
  }
  $("spec").value=JSON.stringify(sample,null,2);$("message").value=JSON.stringify(initial,null,2);
  $("render").addEventListener("click",preview);
  $("reset").addEventListener("click",()=>{$("messages").textContent="";preview();});
  $("validate").addEventListener("click",async()=>{
    try {
      status(t("ui.declarative.validating", {}, "Validating schema and reducer in QuickJS…"));
      const response=await fetch("/games/declarative/validate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({declarative_ui:JSON.parse($("spec").value),message:JSON.parse($("message").value),local_state:null})});
      const result=await response.json();if(!response.ok)throw new Error(typeof result.detail==="string"?result.detail:JSON.stringify(result.detail));
      $("scene").textContent=JSON.stringify(result.scene,null,2);status(t("ui.declarative.validated", {}, "QuickJS accepted the reducer result and all scene references."));
    }catch(error){status(error.message,true);}
  });
  $("package-file").addEventListener("change",async event=>{
    try {const file=event.target.files[0];if(!file)return;if(file.size>900000)throw new Error(t("ui.declarative.file_limit", {}, "JSON file exceeds 900000 bytes"));const value=JSON.parse(await file.text());$("spec").value=JSON.stringify(value.declarative_ui || value,null,2);preview();}
    catch(error){status(error.message,true);}
  });
  fetch("/games/declarative/examples").then(response=>response.json()).then(data=>{
    for(const example of data.examples || []){const option=document.createElement("option");option.value=example.url;option.textContent=example.name;$("example").append(option);}
  }).catch(()=>{});
  $("load-example").addEventListener("click",async()=>{
    try {
      const url=$("example").value;if(!url)return;const response=await fetch(url);if(!response.ok)throw new Error(t("ui.declarative.example_unavailable", {}, "Example unavailable"));
      const body=await response.json();$("spec").value=JSON.stringify(body.declarative_ui,null,2);
      const first=body.unit_tests.cases[0],ctx=first.ctx;
      const view=first.view_of_mover;
      $("message").value=JSON.stringify({type:"state_changed",state:view,view,players:ctx.players.map((player,i)=>({player_id:player.id,player_index:i,kind:player.kind,name:player.display_name})),turn_of_player_indices:[0],my_player_index:0,acting_for_player_index:0,status:"ongoing",move_count:0,strings:body.declarative_ui.strings},null,2);
      preview();
    }catch(error){status(error.message,true);}
  });
  document.addEventListener("i18n-changed",()=>preview());
  preview();
})();
