import React,{useCallback,useLayoutEffect,useMemo,useRef,useState} from 'react';
import Animated,{useAnimatedProps,useSharedValue,withDelay,withTiming,type SharedValue} from 'react-native-reanimated';
import {GestureDetector,GestureStateManager,PointerType,useManualGesture} from 'react-native-gesture-handler';
import {scheduleOnRN,scheduleOnUI} from 'react-native-worklets';
import {StyleSheet,View} from 'react-native';
import Svg,{G,Path,type GProps} from 'react-native-svg';
import {recordDiagnosticEvent} from '../core/diagnostics';
import {boardHit,boardInputGeometry,projectCanvas,projectPiece,scenePoint,tapChoice,type BoardCamera,type BoardRect,type InputTarget,type Projection} from './boardInputGeometry';
import type {BoardInput,BoardInputProps,BoardInputResult} from './BoardInput';
import type {Point} from './types';

const AnimatedGroup=Animated.createAnimatedComponent(G);
const AnimatedPath=Animated.createAnimatedComponent(Path);
const identity={matrix:[1,0,0,1,0,0]} as Partial<GProps>;

type Trace={start:number;last:number;inputs:number;maxGap:number;slowGaps:number};
type Gesture={
  epoch:number; token:number; first:Point; canvas:Projection; camera:BoardCamera;
  hit:ReturnType<typeof boardHit>; source:string|null; selected:string|null; grab:Point; touch:boolean; moved:boolean;
  claimsTouch:boolean; pinch?:{distance:number;anchor:Point}; trace?:Trace;
};
type Drag={id:string; token:number; x:number; y:number};
type Origin=Drag & {hidden:boolean};
type Feedback={piece?:string; target?:InputTarget; scale:number};

function translation(x:number,y:number) {
  'worklet';
  return x||y?{matrix:[1,0,0,1,x,y]} as Partial<GProps>:identity;
}

function MovingPiece({root,origin,feedback,glow,children}:{
  root:string;origin:SharedValue<Origin|null>;
  feedback:SharedValue<Feedback|null>;glow:SharedValue<number>;children:React.ReactNode;
}) {
  const animatedProps=useAnimatedProps(()=>{
    const held=origin.value;
    if(held?.id===root)return {...translation(held.x,held.y),opacity:held.hidden?0:1};
    return {...identity,opacity:feedback.value?.piece===root?1-.28*glow.value:1};
  });
  return <AnimatedGroup animatedProps={animatedProps}>{children}</AnimatedGroup>;
}

function HeldArtwork({token,drag,origin,children}:{
  token:number;drag:SharedValue<Drag|null>;origin:SharedValue<Origin|null>;children:React.ReactNode;
}) {
  useLayoutEffect(()=>{
    scheduleOnUI(()=>{
      'worklet';
      const held=drag.value;
      if(held?.token===token)origin.value={...held,x:0,y:0,hidden:true};
    });
  },[drag,origin,token]);
  const animatedProps=useAnimatedProps(()=>{
    const held=drag.value;
    return held?.token===token?{...translation(held.x,held.y),opacity:1}:{...identity,opacity:0};
  });
  return <AnimatedGroup animatedProps={animatedProps}>{children}</AnimatedGroup>;
}

function TargetFeedback({feedback,glow}:{feedback:SharedValue<Feedback|null>;glow:SharedValue<number>}) {
  const animatedProps=useAnimatedProps(()=>{
    const mark=feedback.value,target=mark?.target;
    return {d:target?.path??'',opacity:target?glow.value:0,
      strokeWidth:(target?.lineWidth??0)+3/(mark?.scale??1)};
  });
  return <AnimatedPath animatedProps={animatedProps} pointerEvents="none" fill="#d5ff87" fillOpacity={.25}
    stroke="#eaffae" strokeLinecap="round" strokeLinejoin="round"/>;
}

function DragPreview({id,feedback,children}:{
  id:string;feedback:SharedValue<Feedback|null>;children:React.ReactNode;
}) {
  const animatedProps=useAnimatedProps(()=>({opacity:feedback.value?.target?.id===id?1:0}));
  return <AnimatedGroup animatedProps={animatedProps}>{children}</AnimatedGroup>;
}

function pinchGeometry(a:Point,b:Point) {
  'worklet';
  return {center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.hypot(a.x-b.x,a.y-b.y)};
}

function pinchCamera(gesture:Gesture,bounds:BoardRect,a:Point,b:Point):BoardCamera {
  'worklet';
  const {center,distance}=pinchGeometry(a,b),pinch=gesture.pinch!;
  const zoom=Math.max(.25,Math.min(6,gesture.camera.zoom*distance/Math.max(1,pinch.distance)));
  const width=bounds.width/zoom,height=bounds.height/zoom;
  const fitted=projectCanvas(gesture.canvas.width,gesture.canvas.height,{x:0,y:0,width,height},gesture.canvas.fill);
  const point=scenePoint(fitted,center);
  return {zoom,x:pinch.anchor.x-point.x-bounds.x-(bounds.width-width)/2,
    y:pinch.anchor.y-point.y-bounds.y-(bounds.height-height)/2};
}

export function useBoardInput(props:BoardInputProps):BoardInput {
  const {spec,scene,order,revision,active,selected,selectionRequired,width,height,view,bounds,camera,fill}=props;
  const latest=useRef(props);
  latest.current=props;
  const play=useMemo(()=>({geometry:boardInputGeometry(spec,scene,order),selectionRequired}),
    [spec,scene,order,selectionRequired]);
  const snapshot=useSharedValue({epoch:0,play,active,selected});
  const frame=useSharedValue({width,height,view,bounds,camera,fill});
  const gesture=useSharedValue<Gesture|null>(null);
  const sequence=useSharedValue(0);
  const drag=useSharedValue<Drag|null>(null);
  const feedback=useSharedValue<Feedback|null>(null);
  const glow=useSharedValue(0);
  const origin=useSharedValue<Origin|null>(null);
  const [lifted,setLifted]=useState<{id:string;token:number;epoch:number}|null>(null);
  const epoch=useRef(0);

  const surface=useMemo(()=>({width,height,view,bounds,camera,fill}),
    [width,height,view.x,view.y,view.width,view.height,bounds,camera,fill]);
  const lastSurface=useRef<{surface:typeof surface;play:typeof play;revision:number}|null>(null);
  useLayoutEffect(()=>{
    const nextEpoch=++epoch.current,previous=lastSurface.current;
    const reset=previous?.surface!==surface||previous.play!==play||previous.revision!==revision;
    lastSurface.current={surface,play,revision};
    scheduleOnUI(()=>{
      'worklet';
      frame.value=surface;
      snapshot.value={epoch:nextEpoch,play,active,selected};
      // Preserve a completed tap's brief flash during JavaScript validation.
      if(reset||gesture.value){
        drag.value=null;
        origin.value=null;
        feedback.value=null;
        glow.value=0;
      }
    });
  },[surface,play,revision,active,selected,frame,snapshot,gesture,drag,origin,feedback,glow]);

  const mounted=useRef(true);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);

  const reportLift=useCallback((id:string,token:number,atEpoch:number)=>{
    if(mounted.current&&epoch.current===atEpoch)setLifted({id,token,epoch:atEpoch});
  },[]);
  const finish=useCallback((atEpoch:number,token:number,result:BoardInputResult|undefined,
      trace:Trace|undefined,ended:number)=>{
    if(!mounted.current)return;
    setLifted(old=>old?.token===token?null:old);
    if(trace)recordDiagnosticEvent('drag_performance',{
      surface:'game_piece',execution:'native_ui',outcome:result?.kind==='drop'?'released':'cancelled',
      input_events:trace.inputs,duration_ms:ended-trace.start,max_ui_update_gap_ms:trace.maxGap,
      ui_gaps_over_34ms:trace.slowGaps,js_release_delay_ms:Math.max(0,Date.now()-ended),
    });
    if(epoch.current===atEpoch&&result)latest.current.onResult(result);
  },[]);
  const updateCamera=useCallback((next:BoardCamera,atWidth:number,atHeight:number)=>{
    if(mounted.current&&latest.current.width===atWidth&&latest.current.height===atHeight)
      latest.current.onCamera(next);
  },[]);

  function cancel(){
    'worklet';
    const held=gesture.value;
    if(!held)return;
    gesture.value=null;
    drag.value=null;
    origin.value=null;
    feedback.value=null;
    glow.value=0;
    if(held?.claimsTouch)scheduleOnRN(finish,held.epoch,held.token,{kind:'clear'},held.trace,Date.now());
  }

  const cameraEnabled=spec.viewport.camera_enabled!==false;
  const cameraControls=spec.viewport.camera_controls===true;
  const manual=useManualGesture({
    runOnJS:false,shouldCancelWhenOutside:false,cancelsTouchesInView:true,cancelsJSResponder:true,
    onTouchesDown:event=>{
      'worklet';
      const area=frame.value,current=gesture.value,model=snapshot.value;
      const canvas=current?.canvas??projectCanvas(area.width,area.height,area.view,area.fill);
      if(event.allTouches.length>=2){
        if(current?.pinch)return;
        const {center,distance}=pinchGeometry(event.allTouches[0],event.allTouches[1]);
        if(current?.claimsTouch)scheduleOnRN(finish,current.epoch,current.token,{kind:'clear'},current.trace,Date.now());
        else scheduleOnRN(finish,model.epoch,sequence.value,{kind:'clear'},undefined,Date.now());
        drag.value=null;origin.value=null;feedback.value=null;glow.value=0;
        gesture.value={epoch:model.epoch,token:++sequence.value,first:center,canvas,camera:area.camera,
          hit:{piece:undefined,target:undefined},source:null,selected:null,grab:{x:0,y:0},touch:true,moved:true,claimsTouch:true,
          pinch:{distance,anchor:scenePoint(projectCanvas(area.width,area.height,area.view,area.fill),center)}};
        GestureStateManager.activate(event.handlerTag);
        return;
      }
      if(current)return;
      const first=event.changedTouches[0];
      if(!first||!(canvas.scale>0))return;
      const point=scenePoint(canvas,first);
      const hit=model.active?boardHit(model.play.geometry,point,model.selected,model.play.selectionRequired):
        {piece:undefined,target:undefined};
      const {piece,target}=hit;
      const selectedDestination=!!target&&model.selected!==null&&
        !!model.play.geometry.pieces[model.selected]?.targets.some(item=>item.id===target.id);
      const source=piece?.targets.length&&!selectedDestination?piece.id:model.selected;
      const claimsTouch=!!(piece||target||area.camera.zoom>1);
      gesture.value={epoch:model.epoch,token:++sequence.value,first:{x:first.x,y:first.y},canvas,
        camera:area.camera,hit,source,selected:model.selected,touch:event.pointerType!==PointerType.MOUSE,moved:false,claimsTouch,
        grab:piece?{x:(piece.center.x-point.x)*canvas.scaleX,y:(piece.center.y-point.y)*canvas.scaleY}:{x:0,y:0}};
      feedback.value=target&&(selectedDestination||!piece)?{target,scale:canvas.scale}:
        piece?{piece:piece.id,scale:canvas.scale}:null;
      glow.value=1;
      if(claimsTouch)GestureStateManager.activate(event.handlerTag);
    },
    onTouchesMove:event=>{
      'worklet';
      const held=gesture.value;
      if(!held?.claimsTouch)return;
      const {canvas,camera:initialCamera}=held,area=frame.value;
      if(held.pinch){
        if(cameraEnabled&&event.allTouches.length>=2)
          scheduleOnRN(updateCamera,pinchCamera(held,area.bounds,event.allTouches[0],event.allTouches[1]),canvas.width,canvas.height);
        return;
      }
      const at=event.allTouches[0];
      if(!at)return;
      const dx=at.x-held.first.x,dy=at.y-held.first.y;
      if(!held.moved&&Math.hypot(dx,dy)<=7)return;
      const pans=!held.hit.piece&&(!held.hit.target||cameraControls&&initialCamera.zoom>1);
      if(held.epoch!==snapshot.value.epoch&&!pans)return;
      const piece=held.hit.piece;
      if(piece?.targets.length){
        const now=Date.now(),trace=held.trace,gap=trace?now-trace.last:0;
        gesture.value={...held,moved:true,trace:{start:trace?.start??now,last:now,inputs:(trace?.inputs??0)+1,
          maxGap:Math.max(trace?.maxGap??0,gap),slowGaps:(trace?.slowGaps??0)+(gap>=34?1:0)}};
        const next=projectPiece(canvas,at,held.grab,piece,held.touch);
        const position={id:piece.id,token:held.token,x:next.x,y:next.y};
        drag.value=position;
        // Start moving the original artwork immediately. Once the lifted copy
        // mounts, only the small overlay redraws as the finger moves.
        if(!origin.value?.hidden)origin.value={...position,hidden:false};
        if(feedback.value?.target?.id!==next.target?.id||!trace)
          feedback.value=next.target?{target:next.target,scale:canvas.scale}:null;
        if(!trace)scheduleOnRN(reportLift,piece.id,held.token,held.epoch);
      }else{
        if(!held.moved){gesture.value={...held,moved:true};feedback.value=null;}
        if(cameraEnabled&&pans)
          scheduleOnRN(updateCamera,{...initialCamera,x:initialCamera.x-dx/canvas.scaleX,y:initialCamera.y-dy/canvas.scaleY},canvas.width,canvas.height);
      }
    },
    onTouchesUp:event=>{
      'worklet';
      if(event.numberOfTouches>0)return;
      const held=gesture.value,model=snapshot.value,at=event.changedTouches[0];
      if(!held?.claimsTouch){
        gesture.value=null;
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      let result:BoardInputResult|undefined;
      if(!held.pinch&&at&&held.epoch===model.epoch&&model.active){
        const {canvas,hit,source}=held;
        const moved=held.moved||Math.hypot(at.x-held.first.x,at.y-held.first.y)>7;
        if(moved&&hit.piece?.targets.length){
          const target=at.x>=0&&at.x<=canvas.width&&at.y>=0&&at.y<=canvas.height?
            projectPiece(canvas,at,held.grab,hit.piece,held.touch).target:undefined;
          result={kind:'drop',piece:hit.piece.id,target:target?.id};
        }else if(!moved){
          const last=boardHit(model.play.geometry,scenePoint(canvas,at),source,model.play.selectionRequired);
          result={kind:'tap',choice:tapChoice(hit,last,source),source,selected:held.selected,touch:held.touch};
        }
      }
      gesture.value=null;
      drag.value=null;
      origin.value=null;
      if(result?.kind==='tap'&&result.choice)glow.value=withDelay(80,withTiming(0,{duration:100}));
      else{feedback.value=null;glow.value=0;}
      scheduleOnRN(finish,held.epoch,held.token,result,held.trace,Date.now());
      GestureStateManager.deactivate(event.handlerTag);
    },
    onTouchesCancel:cancel,
    onFinalize:cancel,
  });

  const wrapPiece=useCallback<NonNullable<BoardInput['wrapPiece']>>((piece,root)=>
    <MovingPiece key={piece.key} root={root} origin={origin} feedback={feedback} glow={glow}>{piece}</MovingPiece>,
    [origin,feedback,glow]);
  const held=active&&lifted?.epoch===epoch.current?lifted:null;
  const destinations=held?play.geometry.pieces[held.id]?.targets:undefined;
  return {
    heldId:held?.id,
    wrapCanvas:canvas=><GestureDetector gesture={manual}>{canvas}</GestureDetector>,
    wrapPiece,
    feedback:<View style={StyleSheet.absoluteFill} pointerEvents="none"
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" preserveAspectRatio={fill?"none":undefined} style={{direction:'ltr'}} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}>
        {destinations&&scene.targets?.filter(target=>target.preview?.length&&destinations.some(d=>d.id===target.id)).map(target=>
          <DragPreview key={target.id} id={target.id} feedback={feedback}>{props.renderPreview(target)}</DragPreview>)}
        <TargetFeedback feedback={feedback} glow={glow}/>
        {held&&<HeldArtwork token={held.token} drag={drag} origin={origin}>{props.renderHeld(held.id)}</HeldArtwork>}
      </Svg>
    </View>,
  };
}
