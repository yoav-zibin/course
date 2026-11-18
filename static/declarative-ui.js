/* Compatibility for stored platform-generated game documents. All board UI
 * comes from the shared React Native web build. No second renderer lives here. */
(function(global){
  "use strict";
  function mount(container,spec,callbacks={}){
    const frame=document.createElement("iframe");
    frame.title=global.I18n ? global.I18n.t("ui.common.game_frame",{},"Game") : "BuildPlay";frame.setAttribute("sandbox","allow-scripts");
    frame.style.cssText="display:block;border:0;width:100%;height:100%;min-height:420px";
    let ready=false,last=null,alive=true;
    const receive=event=>{
      if(!alive||event.source!==frame.contentWindow)return;
      if(event.data?.type==="game_ready"){ready=true;if(last)frame.contentWindow.postMessage(last,"*");callbacks.onReady?.();}
      else if(event.data?.type==="make_move"&&Object.hasOwn(event.data,"move"))callbacks.onMove?.(event.data.move);
      else if(event.data?.type==="game_scene"&&event.data.scene)callbacks.onScene?.(event.data.scene,event.data.message);
    };
    global.addEventListener("message",receive);
    const json=JSON.stringify(spec).replace(/</g,"\\u003c");
    frame.srcdoc='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script type="application/json" id="declarative-spec">'+json+'<'+'/script><script src="/static/app/compat.js"><'+'/script>';
    container.replaceChildren(frame);
    return {send:async message=>{last=message;if(ready)frame.contentWindow.postMessage(message,"*");return true;},whenIdle:()=>Promise.resolve(),destroy(){alive=false;global.removeEventListener("message",receive);frame.remove();}};
  }
  global.DeclarativeUI={mount};
})(window);
