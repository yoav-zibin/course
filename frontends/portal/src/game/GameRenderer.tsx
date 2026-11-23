import {recordDiagnosticLog,recordDiagnosticEvent} from '../core/diagnostics';
import {copyText,playerText} from '../platform/i18n';
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Ellipse, Image as SvgImage, Line, Polygon, Polyline, Rect, SvgXml, Text as SvgText } from 'react-native-svg';
import G from './SceneGroup';
import type { Board, Control, GameSpec, Json, Piece, Point, PresentationResult, Scene, StateMessage, Target, UIEvent } from './types';
import { assetURI, boardCell, cameraLimits, contentBounds, finiteJSON, knownObject, pieceActions, position, validateMoveAnimations, validateScene, validateSceneAnimations, validateTimeline, validateSpec } from './validation';
import { animateUpdate, canMove, historyChanges, hitPiece, hitTarget, pieceName, pieceSize, presentationSteps, targetBox, targetShape, targetThickness, validNumber, validEvent } from './interactions';
import { runPresentation } from './runtime';
import { animateLastMove, moveTracks, trackPosition, type MoveTrack } from './moveAnimations';
import { animateSceneUpdate, sceneTracks, sceneTransform, type SceneTrack } from './sceneAnimations';
import {TabletopGraphic} from './TabletopGraphic';
import {compileTimeline,inferredGroupTracks, pathsTimeline, resolveScene} from './composition';
import {dragPosition} from './dragPosition';
import {pieceAnimation,STATIC_PIECE_Z_MAX} from './pieceAnimations';

export type GameRendererProps = {
  spec: unknown;
  message: StateMessage;
  presentationHistory?: {view:Json;move_count:number;last_move_player_index?:number|null}[];
  onMove: (move: Json) => unknown | Promise<unknown>;
  onError?: (error: Error) => void;
  contextKey?: string;
  deliveryKey?: number;
  onAnimationStateChange?: (busy:boolean)=>void;
  onScene?: (scene:Scene,message:StateMessage)=>void;
  showToolbar?: boolean;
  frameHeight?: number;
};

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const signs: Record<string, string> = {tap: '↖', move: '↔', rotate: '↻', flip: '⇋', scale: '↗'};
const labels: Record<string, string> = {tap: 'Select', move: 'Move', rotate: 'Rotate', flip: 'Flip', scale: 'Resize'};

function errorOf(value: unknown) { return value instanceof Error ? value : new Error(String(value)); }

export function GameRenderer(props: GameRendererProps) {
  const serialized = JSON.stringify(props.spec);
  const checked = useMemo(() => {
    try { return {spec: validateSpec(copy(props.spec))}; }
    catch (error) { return {error: errorOf(error)}; }
  }, [serialized]);
  useEffect(()=>{if(checked.error)recordDiagnosticLog('error','visible_game_error',checked.error);},[checked.error]);
  if (!checked.spec) return <Text accessibilityRole="alert" style={styles.error}>{playerText(checked.error?.message || copyText("Invalid game package"))}</Text>;
  return <Renderer {...props} key={`${props.contextKey || ''}:${serialized}:viewer:${props.message.my_player_index??'spectator'}`} spec={checked.spec} />;
}

type Camera = {zoom: number; x: number; y: number};
type Gesture = {
  first: Point; last: Point; camera: Camera; piece?: string; target?: string; moved: boolean;
  kind: 'press' | 'pan' | 'pinch'; distance?: number; anchor?: Point; touch: boolean;
  grab:Point;toolbarPiece:string|null;toolbarPreview:string|null;
};
type Display = {scene: Scene; previous: Scene; animate: boolean; serial: number; replay:boolean;ghosts:Piece[];inferGroups?:boolean;moves?:Map<string,MoveTrack>;tracks?:Map<string,SceneTrack>;started?:number};

function Renderer({spec, message, presentationHistory, onMove, onError, deliveryKey,onAnimationStateChange,onScene,showToolbar=true,frameHeight}: GameRendererProps & {spec: GameSpec}) {
  const [display, setDisplay] = useState<Display>({scene: {}, previous: {}, animate: false, serial: 0,replay:false,ghosts:[]});
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [drag, setDragState] = useState<{id: string; at: Point; target?: string} | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const setDrag = (value: typeof drag) => { dragRef.current=value;setDragState(value); };
  const [camera, setCamera] = useState<Camera>({zoom: 1, x: 0, y: 0});
  const [width, setWidth] = useState(400);
  const [canvasHeight, setCanvasHeight] = useState(300);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [,setPaintTick]=useState(0);
  const [,setGestureTick]=useState(0);
  const dimensions = useWindowDimensions();
  const callbacks = useRef({onMove,onError,onAnimationStateChange,onScene}); callbacks.current = {onMove,onError,onAnimationStateChange,onScene};
  const alive = useRef(true), revision = useRef(0), renderedRevision = useRef(-1), sent = useRef(false);
  const local = useRef<Json>(null), latest = useRef<StateMessage | null>(null), lastPaint = useRef<StateMessage | null>(null);
  const sceneRef = useRef<Scene>({}), queue = useRef(Promise.resolve());
  const lastResponse = useRef<PresentationResult | null>(null);
  const lastTimelineKey = useRef<string | undefined>(undefined);
  const animationKeys = useRef(new Map<string,string>());
  const paintOrder=useRef(new Map<string,number>());
  const selectedRef = useRef<string | null>(null), previewRef = useRef<string | null>(null);
  const gesture = useRef<Gesture | null>(null), lastGesture = useRef(0), motionUntil = useRef(0);
  const endGesture=()=>{gesture.current=null;setGestureTick(value=>value+1);};
  const [motionBusy,setMotionBusy]=useState(false), motionTimer=useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvas = useRef<React.ComponentRef<typeof View>>(null), surface=useRef<React.ComponentRef<typeof View>>(null), origin = useRef({x:0,y:0});
  const fittedGeometry=useRef('');
  const bounds = useMemo(()=>contentBounds(spec,display.scene),[spec,display.scene]);
  const widthFittedHeight=width*bounds.height/bounds.width;
  // A measured frame fits the board below its controls in the actual safe-area
  // space. Do not enlarge a dense overview into a scrolling or clipped canvas;
  // the player can intentionally zoom in for larger pieces and destinations.
  const framed=frameHeight!==undefined&&frameHeight>0;
  const height=framed?canvasHeight:Math.max(1,Math.min(widthFittedHeight,dimensions.height));
  const limits = cameraLimits(bounds,camera.zoom);
  const view = {x: bounds.x + (bounds.width-limits.width)/2 + camera.x,
    y: bounds.y + (bounds.height-limits.height)/2 + camera.y, width:limits.width,height:limits.height};
  const current = useRef({camera,view,width,height,bounds,display,selected,preview,reducedMotion,framed,frameHeight,windowHeight:dimensions.height});
  current.current={camera,view,width,height,bounds,display,selected,preview,reducedMotion,framed,frameHeight,windowHeight:dimensions.height};
  const active = canMove(latest.current,sent.current) && renderedRevision.current === revision.current && !busy && !motionBusy;
  const select = (id: string | null) => {selectedRef.current=id;setSelected(id);};
  const showPreview = (id: string | null) => {previewRef.current=id;setPreview(id);};

  useLayoutEffect(()=>{fitGeometry();},[width,frameHeight,dimensions.width,dimensions.height]);

  const report = useCallback((reason: unknown) => {
    if (!alive.current) return;
    const failure = errorOf(reason); recordDiagnosticLog('error','visible_game_error',failure); setError(failure.message); callbacks.current.onError?.(failure);
  }, []);

  useEffect(()=>{
    alive.current=true;
    AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(alive.current)setReducedMotion(value);}).catch(()=>{});
    const subscription=AccessibilityInfo.addEventListener('reduceMotionChanged',setReducedMotion);
    return ()=>{alive.current=false;revision.current++;subscription.remove();if(motionTimer.current)clearTimeout(motionTimer.current);callbacks.current.onAnimationStateChange?.(false);};
  },[]);

  useEffect(()=>{
    if(!reducedMotion)return;
    motionUntil.current=0;
    if(motionTimer.current)clearTimeout(motionTimer.current);
    setMotionBusy(false);setDisplay(old=>({...old,animate:false,ghosts:[]}));
    callbacks.current.onAnimationStateChange?.(false);
  },[reducedMotion]);

  useEffect(()=>{
    if(Platform.OS!=='web')return;
    // Piece controls and account dialogs live outside the SVG canvas. Escape
    // must cancel a held piece there too, without taking over the dialog key.
    const cancel=(event:KeyboardEvent)=>{if(event.key==='Escape'){endGesture();setDrag(null);select(null);showPreview(null);}};
    window.addEventListener('keydown',cancel,true);
    return()=>window.removeEventListener('keydown',cancel,true);
  },[]);

  const apply = useCallback(async (input: unknown, atRevision: number, stateChange: boolean) => {
    const result = await runPresentation(spec.ui_code,input,local.current);
    if (!alive.current || atRevision !== revision.current) return;
    knownObject(result,['scene','local_state','make_move','last_move_animations','animations','timeline'],['scene']); finiteJSON(result);
    const raw = validateScene(spec,result.scene);
    const next = resolveScene(spec,raw);
    const incomingMoves = validateMoveAnimations(spec,raw,result.last_move_animations);
    const requested = validateSceneAnimations(spec,raw,result.animations);
    if (result.timeline !== undefined) {
      validateTimeline(spec,raw,result.timeline);
      if (result.animations !== undefined) throw new Error('Return timeline or animations');
    }
    if (result.make_move !== undefined && (stateChange || !canMove(latest.current,sent.current))) throw new Error(copyText("Only a current player interaction may submit a move"));
    const previous=lastResponse.current;
    const message=latest.current!;
    const historyStep=stateChange && !!message.replay && !!lastPaint.current?.replay &&
      Math.abs((message.move_count??NaN)-(lastPaint.current.move_count??NaN))===1;
    const reverse=historyStep && message.move_count!<lastPaint.current!.move_count!;
    const authored=reverse && previous ? previous : result;
    const groupScene=authored.scene.pieces?.some(p=>p.parent || p.pivot);
    const changed = JSON.stringify(next)!==JSON.stringify(sceneRef.current);
    const animations=reverse ? authored.last_move_animations??null : incomingMoves;
    const incomingTracks=result.animations===undefined ? undefined : sceneTracks(spec,next,requested,animationKeys.current);
    let explicit=authored.animations!==undefined;
    let tracks=reverse ? undefined : incomingTracks;
    let timeline=authored.timeline;
    if (!timeline && authored.animations && (groupScene || historyStep)) {
      timeline={key:'transforms',steps:[historyStep ? authored.animations : authored.animations.filter(a=>tracks?.has(a.piece_id))]};
    } else if (!timeline && !authored.animations && authored.last_move_animations && (groupScene || historyStep)) {
      timeline=pathsTimeline(authored.last_move_animations,spec.motion?.move_ms??1440);
    }
    let timelineGhosts:Piece[]=[];
    let timelineDuration:number|undefined;
    let animate = explicit
      ? !!tracks?.size && (stateChange?animateSceneUpdate(lastPaint.current,message):!!lastPaint.current&&canMove(message,sent.current))
      : stateChange && (animations===null?animateUpdate(lastPaint.current,message):animateLastMove(lastPaint.current,message));
    if (timeline) {
      const plan=compileTimeline(spec,reverse?raw:previous?.scene??{},reverse?previous!.scene:raw,timeline,reverse);
      const fresh=authored.timeline ? lastTimelineKey.current!==authored.timeline.key :
        authored.animations ? !!tracks?.size : true;
      const eligible=authored.last_move_animations && !authored.timeline && !authored.animations
        ? animateLastMove(lastPaint.current,message)
        : stateChange ? animateSceneUpdate(lastPaint.current,message) : !!lastPaint.current && canMove(message,sent.current);
      animate=!!plan.tracks.size && (historyStep || (fresh && eligible));
      tracks=plan.tracks;
      explicit=true;
      timelineGhosts=plan.ghosts;
      timelineDuration=plan.duration;
    }
    if (result.timeline) lastTimelineKey.current=result.timeline.key;
    animate=animate && !current.current.reducedMotion;
    local.current = result.local_state === undefined ? null : copy(result.local_state);
    renderedRevision.current=atRevision;
    lastResponse.current=result;
    const inferGroups=Boolean(animate && !explicit && animations===null && groupScene && previous);
    if (inferGroups) tracks=inferredGroupTracks(spec,previous!.scene,raw);
    if (changed || animate && (tracks?.size || animations?.length)) {
      const before=sceneRef.current;
      sceneRef.current=next;
      const replay=animate&&!explicit&&animations===null&&(Boolean(latest.current?.replay)||spec.motion?.scene_transitions===true);
      const moves=explicit||animations===null?undefined:moveTracks(spec,animations);
      const started=Date.now();
      setDisplay(old=>({scene:next,previous:before,animate,serial:old.serial+1,replay,ghosts:animate && timeline ? timelineGhosts : replay?historyChanges(before,next).removed:[],moves,tracks,inferGroups,started}));
      if(animate){
        const movement=explicit?0:animations===null?spec.motion?.move_ms??1440:Math.max(0,...[...moves!.values()].map(track=>track.duration));
        const duration=timelineDuration ?? (explicit?Math.max(0,...[...tracks!.values()].map(track=>track.duration+track.delay)):
          Math.max(movement,...(next.pieces||[]).filter(p=>animations===null||p.animation?.kind!=='move').map(p=>(p.animation?.duration_ms??(p.animation?.kind==='roll'?spec.motion?.roll_ms??650:0))+(p.animation?.delay_ms||0)))+(spec.motion?.roll_settle_ms??0)+(spec.motion?.turn_pause_ms??0));
        motionUntil.current=Date.now()+duration;setMotionBusy(true);callbacks.current.onAnimationStateChange?.(true);
        if(motionTimer.current)clearTimeout(motionTimer.current);
        motionTimer.current=setTimeout(()=>{if(alive.current){setMotionBusy(false);setDisplay(old=>({...old,animate:false,ghosts:[],tracks:undefined,moves:undefined}));callbacks.current.onAnimationStateChange?.(false);}},duration);
      }else{motionUntil.current=0;setMotionBusy(false);if(motionTimer.current)clearTimeout(motionTimer.current);callbacks.current.onAnimationStateChange?.(false);}
    } else setDisplay(old=>({...old}));
    if(stateChange)lastPaint.current=copy(latest.current!);
    setReady(true);setBusy(false);setError('');
    callbacks.current.onScene?.(copy(raw),copy(latest.current!));
    if (result.make_move !== undefined) {
      sent.current=true;setBusy(true);
      try { recordDiagnosticEvent('game_move');await callbacks.current.onMove(copy(result.make_move)); }
      catch (reason) { if(atRevision===revision.current){sent.current=false;setBusy(false);} report(reason); }
    }
  },[spec,report]);

  const messageJSON = JSON.stringify(message);
  const historyJSON = JSON.stringify(presentationHistory??null);
  const lastHistoryJSON=useRef(historyJSON);
  useEffect(()=>{
    // Compatibility hosts can redeliver an identical snapshot while a finger
    // is down. Re-arm rejected submissions normally, but do not cancel a held
    // piece when neither authority nor history has changed.
    if(gesture.current&&!sent.current&&messageJSON===JSON.stringify(latest.current)&&historyJSON===lastHistoryJSON.current)return;
    lastHistoryJSON.current=historyJSON;
    const incoming=copy(message);
    const waitForMotion=async()=>{
      while(alive.current&&motionUntil.current>Date.now())
        await new Promise(resolve=>setTimeout(resolve,Math.min(motionUntil.current-Date.now(),10000)));
    };
    // History can arrive after the current authoritative board is playable.
    // Refresh its presentation without briefly disabling controls or cancelling
    // a held piece. A rejected submission must still use the normal re-arm path.
    const authorityJSON=(value:StateMessage)=>JSON.stringify({...value,presentation_history:undefined});
    if(!sent.current&&latest.current&&authorityJSON(incoming)===authorityJSON(latest.current)){
      const atRevision=revision.current;
      queue.current=queue.current.catch(()=>{}).then(async()=>{
        await waitForMotion();
        if(!alive.current||atRevision!==revision.current||sent.current)return;
        latest.current=incoming;await apply(incoming,atRevision,true);
      }).catch(report);
      return;
    }
    latest.current=incoming;
    revision.current++;const atRevision=revision.current;
    sent.current=false;select(null);showPreview(null);gesture.current=null;setDrag(null);
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      await waitForMotion();
      if(!alive.current||atRevision!==revision.current)return;
      const steps=presentationSteps(lastPaint.current,presentationHistory?{...incoming,presentation_history:copy(presentationHistory)}:incoming);
      for(const step of steps){
        if(!alive.current||atRevision!==revision.current)return;
        latest.current=step;await apply(step,atRevision,true);await waitForMotion();
      }
      if(!alive.current||atRevision!==revision.current)return;
      latest.current=incoming;await apply(incoming,atRevision,true);
    }).catch(report);
  },[messageJSON,historyJSON,deliveryKey,apply,report]);

  const dispatch = useCallback((event: UIEvent) => {
    if(!alive.current || Date.now()<motionUntil.current || !canMove(latest.current,sent.current) || renderedRevision.current!==revision.current || !validEvent(sceneRef.current,event))return;
    const atRevision=revision.current;
    const input={type:'ui_event',event:copy(event),state_changed:copy(latest.current)};
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      if(atRevision!==revision.current||Date.now()<motionUntil.current||!canMove(latest.current,sent.current)||!validEvent(sceneRef.current,event))return;
      await apply(input,atRevision,false);
    }).catch(report);
  },[apply,report]);

  function fitGeometry() {
    const c=current.current;
    const rect=(surface.current as unknown as {getBoundingClientRect?:()=>{width:number;height:number}})?.getBoundingClientRect?.();
    const key=`${rect?.width||c.width}:${c.framed?rect?.height||c.frameHeight:Platform.OS==='web'?window.innerHeight:c.windowHeight}:${c.framed}`;
    if(fittedGeometry.current===key)return;
    fittedGeometry.current=key;
    // Compare the physical frame, not delayed layout notifications. A stale
    // notification after rotation must not cancel the first new tap or drag.
    c.camera={zoom:1,x:0,y:0};c.view={x:c.bounds.x,y:c.bounds.y,width:c.bounds.width,height:c.bounds.height};
    setCamera(c.camera);gesture.current=null;setDrag(null);select(null);showPreview(null);
  }
  function boardPoint(at: Point): Point {
    // Layout notifications can lag a rotation by a frame. Hit testing must use
    // the same physical rectangle as the SVG the player is touching right now.
    const c=current.current;
    const rect=(canvas.current as unknown as {getBoundingClientRect?:()=>{width:number;height:number}})?.getBoundingClientRect?.();
    if(rect?.width&&rect.height){c.width=rect.width;c.height=rect.height;}
    const scale=Math.min(c.width/c.view.width,c.height/c.view.height);
    return {x:c.view.x+(at.x-(c.width-c.view.width*scale)/2)/scale,
      y:c.view.y+(at.y-(c.height-c.view.height*scale)/2)/scale};
  }
  function measureOrigin() {
    fitGeometry();
    // Fabric and RN Web both provide a synchronous viewport rectangle. Waiting
    // for measureInWindow here would use the previous position on the first tap
    // after the surrounding match page scrolls.
    const rect=(canvas.current as unknown as {getBoundingClientRect?:()=>{x:number;y:number}})?.getBoundingClientRect?.();
    if(rect){origin.current={x:rect.x+(Platform.OS==='web'?window.scrollX:0),y:rect.y+(Platform.OS==='web'?window.scrollY:0)};return;}
    canvas.current?.measureInWindow((x,y)=>{origin.current={x,y};});
  }
  function setSafeCamera(next: Camera) {
    if(spec.viewport.camera_enabled===false)return;
    const zoom=clamp(next.zoom,.25,6);
    if(zoom<=1){setCamera({zoom,x:0,y:0});return;}
    const box=current.current.bounds,l=cameraLimits(box,zoom);
    setCamera({zoom,x:clamp(next.x,l.minX-box.x-(box.width-l.width)/2,l.maxX-box.x-(box.width-l.width)/2),
      y:clamp(next.y,l.minY-box.y-(box.height-l.height)/2,l.maxY-box.y-(box.height-l.height)/2)});
  }
  function zoomTo(zoom: number, at?: Point) {
    if(spec.viewport.camera_enabled===false)return;
    const c=current.current, point=at||{x:c.width/2,y:c.height/2}, anchor=boardPoint(point), nextZoom=clamp(zoom,.25,6);
    const nextLimits=cameraLimits(c.bounds,nextZoom), scale=Math.min(c.width/nextLimits.width,c.height/nextLimits.height);
    const x=anchor.x-(point.x-(c.width-nextLimits.width*scale)/2)/scale;
    const y=anchor.y-(point.y-(c.height-nextLimits.height*scale)/2)/scale;
    setSafeCamera({zoom:nextZoom,x:x-c.bounds.x-(c.bounds.width-nextLimits.width)/2,y:y-c.bounds.y-(c.bounds.height-nextLimits.height)/2});
  }
  function transform(event: UIEvent) { const piece=sceneRef.current.pieces?.find(p=>p.id===selectedRef.current);if(piece)dispatch({...event,id:piece.id}); }

  function activatePiece(piece: Piece) {
    piece = sceneRef.current.pieces?.find(p=>p.id===piece.parent) ?? piece;
    if(!canMove(latest.current,sent.current)||!pieceActions(piece).length)return;
    select(piece.id);showPreview(null);
    if(pieceActions(piece).includes('tap'))dispatch({type:'tap',id:piece.id});
  }
  function activateTarget(target: Target,touch=false) {
    if(!canMove(latest.current,sent.current))return;
    const piece=sceneRef.current.pieces?.find(p=>p.id===selectedRef.current);
    if(piece&&pieceActions(piece).includes('move')&&!piece.move_targets?.includes(target.id))return;
    if(touch&&target.preview?.length&&previewRef.current!==target.id){showPreview(target.id);return;}
    showPreview(null);
    if(piece?.move_targets?.includes(target.id)){dispatch({type:'drop',id:piece.id,piece_id:piece.id,target_id:target.id});select(null);}
    else dispatch({type:'tap',id:target.id});
  }

  const actions = useRef({boardPoint,setSafeCamera,zoomTo,activatePiece,activateTarget,dispatch,transform,select,showPreview});
  actions.current={boardPoint,setSafeCamera,zoomTo,activatePiece,activateTarget,dispatch,transform,select,showPreview};
  const claimGesture=(event:GestureResponderEvent)=>{
    measureOrigin();
    const e=event.nativeEvent,c=current.current;
    if((e.touches?.length||0)>1||c.camera.zoom>1)return true;
    const point=actions.current.boardPoint({x:e.pageX-origin.current.x,y:e.pageY-origin.current.y}),scene=sceneRef.current;
    const chosen=scene.pieces?.find(piece=>piece.id===selectedRef.current);
    // At the fitted view, empty board space belongs to the containing native
    // scroll view. A piece/destination still owns its complete drag gesture.
    return Date.now()>=motionUntil.current&&renderedRevision.current===revision.current&&
      canMove(latest.current,sent.current)&&Boolean(hitPiece(spec,scene,point,paintOrder.current)||hitTarget(spec,scene,point,chosen));
  };
  const responders = useMemo(()=>PanResponder.create({
    // Native SVG's own touchable group would otherwise claim the responder
    // before the board can distinguish a drag from a two-finger camera gesture.
    onStartShouldSetPanResponderCapture:claimGesture,
    onStartShouldSetPanResponder:claimGesture,
    onMoveShouldSetPanResponder:event=>(event.nativeEvent.touches?.length||0)>1||current.current.camera.zoom>1,
    onPanResponderTerminationRequest:()=>false,
    onPanResponderGrant:event=>{
      measureOrigin();
      const e=event.nativeEvent, at={x:e.pageX-origin.current.x,y:e.pageY-origin.current.y};
      const point=actions.current.boardPoint(at), scene=sceneRef.current;
      const mayMove=canMove(latest.current,sent.current)&&Date.now()>=motionUntil.current&&renderedRevision.current===revision.current;
      const piece=mayMove?hitPiece(spec,scene,point,paintOrder.current):undefined;
      const selectedPiece=scene.pieces?.find(p=>p.id===selectedRef.current);
      const target=mayMove?hitTarget(spec,scene,point,selectedPiece):undefined;
      if(Platform.OS==='web'){
        // Focus before RN Web grants the board its responder. Letting the
        // browser focus a destination afterward would blur the keyboard-focused
        // canvas and terminate this pointer gesture before release. This also
        // applies to panning over an inactive piece; focus grants no move rights.
        const node=event.target as unknown as {closest?:(selector:string)=>{focus?:()=>void}|null};
        node?.closest?.('[role="button"]')?.focus?.();
      }
      const c=current.current,scale=Math.min(c.width/c.view.width,c.height/c.view.height);
      const center=piece?position(spec,piece):point;
      const native=e as unknown as {pointerType?:string;type?:string};
      gesture.current={kind:'press',first:at,last:at,camera:current.current.camera,piece:piece?.id,target:target?.id,moved:false,
        grab:{x:(center.x-point.x)*scale,y:(center.y-point.y)*scale},
        toolbarPiece:selectedRef.current,toolbarPreview:previewRef.current,
        touch:Platform.OS!=='web'||native.pointerType==='touch'||native.type?.startsWith('touch')===true};
      // A legal destination may contain another movable piece. Preserve the
      // source for a tap there; a subsequent drag can still pick up that piece.
      const selectedDestination=target&&selectedPiece?.move_targets?.includes(target.id);
      if(piece?.move_targets?.length&&!selectedDestination)actions.current.select(piece.id);
    },
    onPanResponderStart:event=>{
      const touches=event.nativeEvent.touches||[],g=gesture.current;
      if(touches.length<2||!g||g.kind==='pinch')return;
      const a={x:touches[0].pageX-origin.current.x,y:touches[0].pageY-origin.current.y};
      const b={x:touches[1].pageX-origin.current.x,y:touches[1].pageY-origin.current.y};
      g.kind='pinch';g.distance=Math.hypot(a.x-b.x,a.y-b.y);g.camera=current.current.camera;
      g.anchor=actions.current.boardPoint({x:(a.x+b.x)/2,y:(a.y+b.y)/2});g.moved=true;
      setDrag(null);actions.current.select(null);actions.current.showPreview(null);
    },
    onPanResponderMove:event=>{
      const g=gesture.current;if(!g)return;
      const touches=event.nativeEvent.touches||[];
      const at={x:event.nativeEvent.pageX-origin.current.x,y:event.nativeEvent.pageY-origin.current.y};
      if(touches.length>=2){
        setDrag(null);actions.current.select(null);actions.current.showPreview(null);
        const a={x:touches[0].pageX-origin.current.x,y:touches[0].pageY-origin.current.y};
        const b={x:touches[1].pageX-origin.current.x,y:touches[1].pageY-origin.current.y};
        const center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.hypot(a.x-b.x,a.y-b.y);
        if(g.kind!=='pinch'){g.kind='pinch';g.distance=distance;g.camera=current.current.camera;g.anchor=actions.current.boardPoint(center);}
        if(spec.viewport.camera_enabled!==false){
          const c=current.current,zoom=clamp(g.camera.zoom*distance/Math.max(1,g.distance!),.25,6),l=cameraLimits(c.bounds,zoom);
          const scale=Math.min(c.width/l.width,c.height/l.height);
          actions.current.setSafeCamera({zoom,x:g.anchor!.x-(center.x-(c.width-l.width*scale)/2)/scale-c.bounds.x-(c.bounds.width-l.width)/2,
            y:g.anchor!.y-(center.y-(c.height-l.height*scale)/2)/scale-c.bounds.y-(c.bounds.height-l.height)/2});
        }
        g.moved=true;return;
      }
      if(g.kind==='pinch')return;
      const dx=at.x-g.first.x,dy=at.y-g.first.y;
      if(Math.hypot(dx,dy)>7)g.moved=true;
      g.last=at;
      const piece=sceneRef.current.pieces?.find(p=>p.id===g.piece);
      if(piece?.move_targets?.length&&g.moved&&canMove(latest.current,sent.current)){
        if(selectedRef.current!==piece.id)actions.current.select(piece.id);
        const c=current.current,scale=Math.min(c.width/c.view.width,c.height/c.view.height),size=pieceSize(spec,piece);
        const lifted=dragPosition(at,g.grab,{width:size.width*scale,height:size.height*scale},c,g.touch);
        const point=actions.current.boardPoint(lifted),target=hitTarget(spec,sceneRef.current,point,piece,16/scale);
        setDrag({id:piece.id,at:target?position(spec,target):point,target:target?.id});actions.current.showPreview(target?.id||null);
      }else if(g.moved&&!g.piece&&(!g.target||
        spec.viewport.camera_controls===true&&current.current.camera.zoom>1)){
        g.kind='pan';
        const c=current.current,scale=Math.min(c.width/c.view.width,c.height/c.view.height);
        actions.current.setSafeCamera({...g.camera,x:g.camera.x-dx/scale,y:g.camera.y-dy/scale});
      }
    },
    onPanResponderRelease:event=>{
      const g=gesture.current;endGesture();lastGesture.current=Date.now();
      if(!g){setDrag(null);return;}
      const at={x:event.nativeEvent.pageX-origin.current.x,y:event.nativeEvent.pageY-origin.current.y};
      if(g.kind==='pinch'||g.kind==='pan'){setDrag(null);return;}
      const scene=sceneRef.current,point=actions.current.boardPoint(at),piece=scene.pieces?.find(p=>p.id===g.piece);
      if(g.moved){
        const held=current.current;
        const released=at.x>=0&&at.x<=held.width&&at.y>=0&&at.y<=held.height;
        // Use the actual lifted artwork's legal destination, never a finger's
        // overlapping adjacent point. Leaving the board always cancels.
        const heldPiece=dragRef.current;
        if(released&&heldPiece?.target&&piece)actions.current.dispatch({type:'drop',id:piece.id,piece_id:piece.id,target_id:heldPiece.target});
        setDrag(null);
        actions.current.select(null);actions.current.showPreview(null);return;
      }
      const chosen=scene.pieces?.find(p=>p.id===selectedRef.current);
      const target=hitTarget(spec,scene,point,chosen);
      // A placement's declared artwork can itself be clicked, and selected
      // pieces always use the matching legal destination.
      if(target&&target.id===g.target&&(!piece||chosen?.move_targets?.includes(target.id)))actions.current.activateTarget(target,g.touch);
      else if(piece&&hitPiece(spec,scene,point,paintOrder.current)?.id===piece.id)actions.current.activatePiece(piece);
      else if(target&&target.id===g.target)actions.current.activateTarget(target,g.touch);
    },
    onPanResponderTerminate:()=>{endGesture();setDrag(null);actions.current.select(null);actions.current.showPreview(null);},
  }),[spec]);

  const selectedPiece=display.scene.pieces?.find(piece=>piece.id===selected);
  const selectedActions=selectedPiece?pieceActions(selectedPiece):[];
  const replayEffects=display.replay?historyChanges(display.previous,display.scene).effects:new Map<string,'enter'|'change'>();
  const previewTarget=display.scene.targets?.find(target=>target.id===preview);
  // Selecting a drag source must not introduce a footer and resize the canvas
  // underneath the pointer. Keep the pre-gesture controls until release.
  const toolsPiece=gesture.current?display.scene.pieces?.find(piece=>piece.id===gesture.current!.toolbarPiece):selectedPiece;
  const toolsActions=toolsPiece?pieceActions(toolsPiece):[];
  const toolsPreview=gesture.current?display.scene.targets?.find(target=>target.id===gesture.current!.toolbarPreview):previewTarget;
  const now=Date.now();
  const drawables=[
    ...(!reducedMotion?display.ghosts:[]).map(piece=>({piece,ghost:true})),
    ...(display.scene.pieces??[]).filter(piece=>!piece.hidden).map(piece=>({piece,ghost:false})),
  ];
  const paint=drawables.map(({piece,ghost})=>{
    const previous=ghost?piece:display.previous.pieces?.find(old=>old.id===piece.id);
    const options={animate:display.animate&&!reducedMotion&&(display.inferGroups||display.tracks===undefined||display.tracks.has(piece.id)),
      effect:ghost?'exit' as const:replayEffects.get(piece.id),inferMovement:display.inferGroups||display.moves===undefined&&display.tracks===undefined,
      moveTrack:display.moves?.get(piece.id),sceneTrack:display.tracks?.get(piece.id),pulseEnabled:!reducedMotion};
    const motion=pieceAnimation(spec,piece,previous,{...options,elapsed:now-(display.started??now)});
    return {piece,ghost,previous,options,z:motion.layerActive?motion.z:piece.z??0,
      end:Number.isFinite(motion.layerTransition)?(display.started??now)+motion.layerTransition:Infinity};
  }).sort((a,b)=>a.z-b.z||(a.piece.z??0)-(b.piece.z??0));
  paintOrder.current=new Map(paint.filter(item=>!item.ghost).map((item,index)=>[item.piece.id,index]));
  const paintEnd=Math.min(Infinity,...paint.map(item=>item.end));
  useEffect(()=>{
    if(!Number.isFinite(paintEnd))return;
    const timer=setTimeout(()=>setPaintTick(value=>value+1),Math.max(1,paintEnd-Date.now()+1));
    return()=>clearTimeout(timer);
  },[paintEnd]);
  const renderPiece=(item:typeof paint[number])=><PieceGraphic key={`${item.ghost?'ghost':'piece'}:${item.piece.id}`} piece={item.piece} previous={item.previous}
    spec={spec} {...item.options} serial={display.serial} enabled={active&&!item.ghost} selected={item.piece.selected||(item.piece.parent??item.piece.id)===selected}
    started={display.started} concealed={(item.piece.parent??item.piece.id)===drag?.id} onPress={()=>activatePiece(item.piece)}/>;
  function draggedPosition(piece:Piece): Point {
    const root=display.scene.pieces!.find(p=>p.id===drag!.id)!;
    const center=position(spec,root), at=position(spec,piece);
    return {x:drag!.at.x+at.x-center.x-(at.board.x??0),y:drag!.at.y+at.y-center.y-(at.board.y??0)};
  }
  const keyboard=(event: {key:string;shiftKey?:boolean;preventDefault():void;target?:{tagName?:string}})=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(event.target?.tagName||''))return;
    const key=event.key.toLowerCase();
    if(key==='escape'){endGesture();setDrag(null);select(null);showPreview(null);return;}
    if(key==='r'&&selectedActions.includes('rotate')){event.preventDefault();transform({type:'rotate',id:'',delta:event.shiftKey?-90:90});}
    else if(key==='f'&&selectedActions.includes('flip')){event.preventDefault();transform({type:'flip',id:''});}
    else if(spec.viewport.camera_enabled!==false){
      if(key==='+'||key==='='){event.preventDefault();zoomTo(camera.zoom*1.25);}
      else if(key==='-'){event.preventDefault();zoomTo(camera.zoom/1.25);}
      else if(key==='0'||key==='home'){event.preventDefault();setCamera({zoom:1,x:0,y:0});}
      else if(key.startsWith('arrow')){event.preventDefault();setSafeCamera({...camera,x:camera.x+(key==='arrowleft'?-view.width*.1:key==='arrowright'?view.width*.1:0),y:camera.y+(key==='arrowup'?-view.height*.1:key==='arrowdown'?view.height*.1:0)});}
    }
  };
  const webProps: Record<string, unknown>=Platform.OS==='web'?{onKeyDown:keyboard,onWheel:(event:{deltaY:number;clientX:number;clientY:number;ctrlKey:boolean;metaKey:boolean;preventDefault():void})=>{
    if(spec.viewport.camera_enabled===false||!event.ctrlKey&&!event.metaKey)return;
    event.preventDefault();measureOrigin();zoomTo(camera.zoom*(event.deltaY<0?1.15:1/1.15),{x:event.clientX-origin.current.x,y:event.clientY-origin.current.y});
  }}:{};

  const canvasWebStyle=Platform.OS==='web'&&(framed||camera.zoom>1)?{...styles.canvas,touchAction:'none'}:undefined;
  return <View ref={surface} style={[styles.container,framed&&{height:frameHeight,minHeight:0}]}>
    {showToolbar&&<View style={styles.toolbar}>
      <Text style={styles.status} accessibilityLiveRegion="polite">{message.replay?copyText("Reviewing match"):busy?copyText("Sending move…"):message.status!=='ongoing'?copyText("Game finished"):active?copyText("Your turn"):copyText("Waiting for a move")}</Text>
      {spec.viewport.camera_controls===true&&spec.viewport.camera_enabled!==false&&<View style={styles.row}>
        <Tool label={copyText("Zoom out")} text="−" disabled={camera.zoom<=.25} onPress={()=>zoomTo(camera.zoom/1.5)}/>
        <Tool label={copyText("Reset board view")} text="1:1" onPress={()=>setSafeCamera({zoom:1,x:0,y:0})}/>
        <Tool label={copyText("Zoom in")} text="+" disabled={camera.zoom>=6} onPress={()=>zoomTo(camera.zoom*1.5)}/>
      </View>}
    </View>}
    {!ready&&<ActivityIndicator accessibilityLabel={copyText("Loading game board")} color="#91d7c4" style={styles.loading}/>}
    {!!error&&<Text accessibilityRole="alert" style={styles.error}>{playerText(error)}</Text>}
    {!!display.scene.controls?.length&&<View style={styles.controls}>{display.scene.controls.map(control=><SceneControl key={control.id} control={control} enabled={active&&!control.disabled} dispatch={dispatch}/>)}</View>}
    <View ref={canvas} collapsable={false} focusable style={[styles.canvas,framed?{flex:1,minHeight:0}:{height},canvasWebStyle]} {...webProps} {...responders.panHandlers}
      onLayout={event=>{setWidth(event.nativeEvent.layout.width);setCanvasHeight(event.nativeEvent.layout.height);measureOrigin();}}
      accessibilityLabel={copyText("Game board. Use pieces and highlighted destinations.")}>
      <Svg width="100%" height="100%" style={{direction:'ltr'}} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}>
        {[
        ...spec.boards.map(board=><BoardGraphic key={`board:${board.id}`} board={board} spec={spec}/>),
        ...(display.scene.paths||[]).map(path=><Polyline key={`path:${path.id}`} points={path.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={path.color||'#d2ff5a'} strokeWidth={path.width||3}/>),
        ...paint.filter(item=>item.z<=STATIC_PIECE_Z_MAX).map(renderPiece),
        ...(previewTarget?.preview||[]).map((cell,index)=>{
          const target=previewTarget!;
          const point=position(spec,{board:target.board,position:cell.position}),size=targetBox(spec,{...target,position:cell.position,hit_area:undefined,hit_shape:undefined});
          return <G key={`preview-${index}`} transform={`translate(${point.x} ${point.y}) rotate(${cell.rotation||0})`} opacity={.7} pointerEvents="none">
            <Rect x={-size.width/2+1} y={-size.height/2+1} width={size.width-2} height={size.height-2} fill={cell.color||target.color||'#b8ef5b'} rx={4}/>
            <Asset spec={spec} id={cell.asset} x={-size.width/2} y={-size.height/2} width={size.width} height={size.height}/>
            {!!cell.text&&<SvgText textAnchor="middle" alignmentBaseline="central" fontSize={Math.min(size.width,size.height)*.42} fill="#102330">{playerText(cell.text)}</SvgText>}
          </G>;
        }),
        ...(display.scene.targets||[]).map(target=><TargetGraphic key={`target:${target.id}`} target={target} spec={spec}
          enabled={active&&(!selectedPiece?.move_targets?.length||selectedPiece.move_targets.includes(target.id))}
          selected={preview===target.id||drag?.target===target.id} onPress={()=>activateTarget(target,Platform.OS!=='web')}/>),
        ...(display.scene.labels||[]).map(label=><SvgText key={`label:${label.id}`} x={label.x} y={label.y} textAnchor="start" fill={label.color||'#e4edf4'} fontSize={label.font_size||18} alignmentBaseline="hanging">{playerText(label.text)}</SvgText>),
        ...paint.filter(item=>item.z>STATIC_PIECE_Z_MAX).map(renderPiece),
        ...(drag?display.scene.pieces?.filter(piece=>!piece.hidden && (piece.parent??piece.id)===drag.id)||[]:[]).map(piece=><PieceGraphic key={`drag:${piece.id}`} piece={{...piece,hand:undefined,position:draggedPosition(piece)}} spec={spec} animate={false} serial={display.serial} enabled={false} selected={true} dragged/>),
        ]}
      </Svg>
    </View>
    {Boolean(toolsPiece||toolsPreview?.preview?.length)&&<View style={styles.tools}>
      {toolsPiece&&<Text style={styles.selectedLabel} accessibilityLiveRegion="polite">{playerText(pieceName(toolsPiece))}{toolsPiece.move_targets?.length?copyText(" · choose a highlighted destination"):''}</Text>}
      <View style={styles.row}>
        {toolsActions.includes('rotate')&&<><Tool label={copyText("Rotate counterclockwise")} text="↺" disabled={!active} onPress={()=>transform({type:'rotate',id:'',delta:-90})}/><Tool label={copyText("Rotate clockwise")} text="↻" disabled={!active} onPress={()=>transform({type:'rotate',id:'',delta:90})}/></>}
        {toolsActions.includes('flip')&&<Tool label={copyText("Flip piece")} text="⇋" disabled={!active} onPress={()=>transform({type:'flip',id:''})}/>}
        {toolsActions.includes('scale')&&<><Tool label={copyText("Make piece smaller")} text="↙" disabled={!active} onPress={()=>transform({type:'scale',id:'',factor:1/1.1})}/><Tool label={copyText("Make piece larger")} text="↗" disabled={!active} onPress={()=>transform({type:'scale',id:'',factor:1.1})}/></>}
        {toolsPiece&&<Tool label={copyText("Cancel selection")} text={copyText("Cancel")} onPress={()=>{select(null);showPreview(null);setDrag(null);}}/>}
      </View>
      {toolsPreview?.preview?.length? <Text accessibilityLiveRegion="polite" style={styles.preview}>{copyText("Preview:")} {playerText(toolsPreview.aria_label||toolsPreview.label||copyText('placement'))}{copyText(". Tap the destination again to confirm.")}</Text>:null}
    </View>}
  </View>;
}

function Tool({label,text,onPress,disabled=false}:{label:string;text:string;onPress:()=>void;disabled?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={playerText(label)} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[styles.tool,disabled&&styles.disabled,pressed&&styles.pressed]}><Text style={styles.toolText}>{playerText(text)}</Text></Pressable>;
}

const Asset = memo(function Asset({spec,id,x,y,width,height}:{spec:GameSpec;id?:string;x:number;y:number;width:number;height:number}) {
  const uri=assetURI(id?spec.assets?.[id]:undefined);
  const xml=useMemo(()=>{
    if(!uri?.startsWith('data:image/svg+xml;base64,'))return null;
    try {
      const source=decodeURIComponent(Array.from(atob(uri.split(',')[1])).map(c=>`%${c.charCodeAt(0).toString(16).padStart(2,'0')}`).join(''));
      if(source.length>120000||/<(?:script|foreignObject|iframe|object|embed|style)\b|\son\w+\s*=|(?:href\s*=\s*["']\s*(?!#)|url\(\s*(?!#))|<!ENTITY/i.test(source))return null;
      return source;
    }catch{return null;}
  },[uri]);
  if(!uri)return null;
  // Native nested SVG viewports draw at (0, 0), ignoring the root's x/y props.
  // Translate a parent group so centered piece artwork shares its hit geometry
  // on iOS, Android and web, including negative half-width/height offsets.
  if(uri.startsWith('data:image/svg+xml;base64,'))return xml?<G transform={`translate(${x} ${y})`}><SvgXml xml={xml} x={0} y={0} width={width} height={height}/></G>:null;
  return <SvgImage href={{uri}} x={x} y={y} width={width} height={height} preserveAspectRatio="xMidYMid meet"/>;
});

const BoardGraphic=memo(function BoardGraphic({board,spec}:{board:Board;spec:GameSpec}) {
  const cells=[];
  if(board.kind==='grid')for(let row=0;row<board.rows!;row++)for(let column=0;column<board.columns!;column++)cells.push(<Rect key={`${row}:${column}`} x={column*board.width/board.columns!} y={row*board.height/board.rows!} width={board.width/board.columns!} height={board.height/board.rows!} fill={(row+column)%2?board.alternate_color||board.color||'#1c394b':board.color||'#24485d'} stroke={board.line_color||'#476173'} strokeWidth={1}/>);
  return <G transform={`translate(${board.x||0} ${board.y||0})`} pointerEvents="none">
    <Rect width={board.width} height={board.height} rx={board.kind==='zone'?12:2} fill={board.color||'#152b3a'} stroke={board.line_color||'#4c6575'}/>
    <Asset spec={spec} id={board.background_asset} x={0} y={0} width={board.width} height={board.height}/>{cells}
    {board.links?.map((link,index)=>{const from=boardCell(board,link.from),to=boardCell(board,link.to);return <Line key={`link-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={board.line_color||'#91a7b7'} strokeWidth={3}/>;})}
    {board.cells?.map(cell=>{
      const radius=Math.min(board.width/Math.max(2,board.columns||7),board.height/Math.max(2,board.rows||7))*.48;
      return <G key={cell.id}>
        {board.kind==='hex'?<Polygon points={Array.from({length:6},(_,i)=>`${cell.x+Math.cos((i*60+30)*Math.PI/180)*radius},${cell.y+Math.sin((i*60+30)*Math.PI/180)*radius}`).join(' ')} fill={cell.color||board.color||'#264d53'} stroke={board.line_color||'#829e9c'}/>:<Circle cx={cell.x} cy={cell.y} r={12} fill={cell.color||'#476474'} stroke={board.line_color||'#91a7b7'}/>}
        {!!cell.label&&<SvgText x={cell.x} y={cell.y} textAnchor="middle" alignmentBaseline="central" fill="#ffffff" stroke="#102330" strokeWidth={.3} fontSize={12}>{playerText(cell.label)}</SvgText>}
      </G>;
    })}
  </G>;
});

const PieceGraphic=memo(function PieceGraphic({piece,previous,spec,animate,serial,enabled,selected,onPress,effect,inferMovement=true,moveTrack,sceneTrack,started,pulseEnabled=false,concealed=false,dragged=false}:{piece:Piece;previous?:Piece;spec:GameSpec;animate:boolean;serial:number;enabled:boolean;selected?:boolean;onPress?:()=>void;effect?:'enter'|'change'|'exit';inferMovement?:boolean;moveTrack?:MoveTrack;sceneTrack?:SceneTrack;started?:number;pulseEnabled?:boolean;concealed?:boolean;dragged?:boolean}) {
  const [frameState,setFrameState]=useState({serial:-1,phase:1});
  const {newEffect,next,before,popAnimation,needsAnimation,duration,delay}=pieceAnimation(spec,piece,previous,
    {animate,effect,inferMovement,moveTrack,sceneTrack,pulseEnabled});
  const type=spec.piece_types[piece.type],size=pieceSize(spec,piece);
  useEffect(()=>{
    if(!needsAnimation)return;
    let cancelled=false,frame=0;const start=(started??Date.now())+delay;
    const tick=()=>{if(cancelled)return;const t=clamp((Date.now()-start)/Math.max(1,duration),0,1);setFrameState({serial,phase:t});if(t<1)frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);return()=>{cancelled=true;cancelAnimationFrame(frame);};
  },[serial,needsAnimation,duration,delay,started]);
  const p=!needsAnimation?1:frameState.serial===serial?frameState.phase:0,eased=spec.motion?.easing==='ease-in-out-quad'?(p<.5?2*p*p:1-(-2*p+2)**2/2):1-(1-p)**3;
  const authored=animate&&sceneTrack?(sceneTrack.sample ? sceneTrack.sample(p) : sceneTransform(sceneTrack,eased)):undefined;
  const at=authored??(animate&&moveTrack?trackPosition(moveTrack,p*duration,spec.motion?.easing):inferMovement?{x:before.x+(next.x-before.x)*eased,y:before.y+(next.y-before.y)*eased}:next);
  const x=at.x,y=at.y;
  const rotation=authored?.rotation??(inferMovement?(previous?.rotation||0)+((piece.rotation||0)-(previous?.rotation||0))*eased:piece.rotation||0);
  const scale=authored?.scale??(inferMovement?(previous?.scale??1)+((piece.scale??1)-(previous?.scale??1))*eased:piece.scale??1);
  const pulseScale=popAnimation&&needsAnimation?(p<.48?.46+.72*p/.48:1.18-.18*(p-.48)/.52):1;
  const actions=pieceActions(piece),outline=selected?'#b8ff67':enabled&&actions.length?'#79d5ff':'transparent';
  const roll=!sceneTrack&&animate&&newEffect&&piece.animation?.kind==='roll'?(1-p)*360:0;
  const notice=!sceneTrack&&piece.animation?.kind==='notice'?(animate&&newEffect&&p>.02&&p<.96?1:0):1;
  const fade=sceneTrack?1:effect==='enter'?p:effect==='change'?.25+.75*p:effect==='exit'?(p<.65?1-p/.65*.2:.8*(1-(p-.65)/.35)):1;
  const accessibleName=`${playerText(pieceName(piece))}${enabled&&actions.length?`: ${actions.map(a=>copyText(labels[a])).join(', ')}`:''}`;
  const accessibility:Record<string,unknown>=effect==='exit'||concealed||dragged?{accessible:false,accessibilityElementsHidden:true,importantForAccessibility:'no-hide-descendants','aria-hidden':true,testID:effect==='exit'?'history-ghost':dragged?'dragged-piece':'held-piece-origin',pointerEvents:'none'}:{accessible:true,accessibilityLabel:accessibleName,accessibilityRole:actions.length?'button':'image',
    accessibilityState:{disabled:!enabled,selected:!!selected},onPress:enabled&&actions.length?onPress:undefined};
  // Keep the original SVG subtree mounted while dragging. Browser touch
  // sequences retain their initial target; removing it severs subsequent
  // touchMove/touchEnd delivery even though mouse dragging still appears fine.
  const touchStyle:Record<string,unknown>=Platform.OS==='web'&&actions.includes('move')?{style:{touchAction:'none',userSelect:'none',WebkitUserSelect:'none'}}:{};
  if(type.shape==='group'&&!actions.length)return null;
  const shared = piece.face==='back' || ['card','card_pile','dice','counter'].includes(type.shape);
  const customFace = piece.face==='back' ? type.back_asset : piece.asset??type.asset;
  return <G transform={`translate(${x} ${y}) rotate(${rotation+roll}) scale(${piece.mirror_x||piece.mirror_y ? `${scale*pulseScale*(piece.mirror_x?-1:1)} ${scale*pulseScale*(piece.mirror_y?-1:1)}` : scale*pulseScale})`} opacity={concealed?0:(authored?.opacity??piece.opacity??1)*notice*fade} {...accessibility} {...touchStyle}>
    {shared ? <TabletopGraphic piece={piece} type={type} width={size.width} height={size.height}
      artwork={customFace && <Asset spec={spec} id={customFace} x={-size.width/2} y={-size.height/2} width={size.width} height={size.height}/>}/> :
     type.shape==='group' ? null : type.shape==='circle'?<Ellipse rx={size.width/2} ry={size.height/2} fill={type.color||'#d2ff5a'} stroke={type.border_color||'#0d202c'} strokeWidth={2}/>:type.shape==='hex'?<Polygon points={Array.from({length:6},(_,i)=>`${Math.cos((i*60+30)*Math.PI/180)*size.width/2},${Math.sin((i*60+30)*Math.PI/180)*size.height/2}`).join(' ')} fill={type.color||'#d2ff5a'} stroke={type.border_color||'#0d202c'} strokeWidth={2}/>:type.shape==='rect'?<Rect x={-size.width/2} y={-size.height/2} width={size.width} height={size.height} rx={4} fill={type.color||'#e4eced'} stroke={type.border_color||'#1d3544'} strokeWidth={2}/>:null}
    {!shared && <Asset spec={spec} id={piece.asset??type.asset} x={-size.width/2} y={-size.height/2} width={size.width} height={size.height}/>}
    {!shared&&piece.text!==undefined&&<SvgText textAnchor="middle" alignmentBaseline="central" fill={type.text_color||(type.shape==='text'?'#ecf4fa':'#122735')} fontSize={type.font_size??Math.min(size.width*.5,size.height*.6,40)} fontWeight="700">{playerText(piece.text||'')}</SvgText>}
    {type.action_outline!=='none'&&(type.action_outline==='ellipse'?<Ellipse rx={size.width/2+4} ry={size.height/2+4} fill="none" stroke={outline} strokeWidth={selected?4:2}/>:<Rect x={-size.width/2-4} y={-size.height/2-4} width={size.width+8} height={size.height+8} rx={8} fill="none" stroke={outline} strokeWidth={selected?4:2}/>)}
    {enabled&&actions.length>0&&<G transform={`translate(${-size.width/2} ${-size.height/2-13})`} pointerEvents="none">{actions.map((action,index)=><G key={action} transform={`translate(${index*22} 0)`}><Rect x={0} y={-9} width={20} height={18} rx={5} fill="#122b3a" stroke="#75ceee"/><SvgText x={10} y={0} textAnchor="middle" alignmentBaseline="central" fill="#ffffff" fontSize={14}>{signs[action]}</SvgText></G>)}</G>}
  </G>;
});

const TargetGraphic=memo(function TargetGraphic({target,spec,enabled,selected,onPress}:{target:Target;spec:GameSpec;enabled:boolean;selected:boolean;onPress:()=>void}) {
  const point=position(spec,target),box=targetBox(spec,target),art=!!target.asset,board=point.board,shape=targetShape(spec,target);
  // Keep the accessible group's geometry in scene coordinates. Android SVG
  // virtual-node bounds misplace a translated group under a scaled viewBox;
  // its reported Cell 1 rectangle can otherwise physically hit Cell 4.
  return <G opacity={enabled?selected?1:.72:.18}
    accessible accessibilityRole="button" accessibilityLabel={playerText(target.aria_label||target.label||copyText("Destination {v0}",{v0:target.id}))} accessibilityState={{disabled:!enabled,selected}}
    onPress={enabled?onPress:undefined}>
    {shape?<>
      {shape.kind==='line'
        ?<Line x1={shape.from.x} y1={shape.from.y} x2={shape.to.x} y2={shape.to.y} strokeLinecap="round" strokeWidth={shape.width} stroke={art?'transparent':target.color||'#b8ef5b'}/>
        :<Polygon points={shape.points.map(p=>`${p.x},${p.y}`).join(' ')} strokeLinejoin="round" fill={art?'transparent':target.color||'#b8ef5b'} stroke={selected?'#ffffff':'#c9ff63'} strokeWidth={selected?4:2}/>}
      {selected&&shape.kind==='line'&&<Line x1={shape.from.x} y1={shape.from.y} x2={shape.to.x} y2={shape.to.y} strokeLinecap="round" strokeWidth={shape.width+8} stroke="#ffffff" opacity={.5}/>}
      <Asset spec={spec} id={target.asset} x={box.x} y={box.y} width={box.width} height={box.height}/>
      {!!target.label&&!art&&<SvgText x={point.x} y={point.y} textAnchor="middle" alignmentBaseline="central" fill="#102330" fontSize={14}>{playerText(target.label)}</SvgText>}
    </>:board.kind==='graph'?<>
      <Rect x={box.x} y={box.y} width={box.width} height={box.height} fill="transparent" stroke="none"/>
      <Circle cx={point.x} cy={point.y} r={14} fill={art?'transparent':target.color||'#b8ef5b'} fillOpacity={art?1:.32} stroke={selected?'#ffffff':'#c9ff63'} strokeWidth={selected?3:2}/>
      {!art&&<Circle cx={point.x} cy={point.y} r={5} fill="#f4ffe4"/>}
      <Asset spec={spec} id={target.asset} x={box.x} y={box.y} width={box.width} height={box.height}/>
      {!!target.label&&!art&&<SvgText x={point.x} y={point.y} textAnchor="middle" alignmentBaseline="central" fill="#102330" fontSize={14}>{playerText(target.label)}</SvgText>}
    </>:<>
      <Rect x={box.x} y={box.y} width={box.width} height={box.height} rx={5} fill={art?'transparent':target.color||'#b8ef5b'} stroke={selected?'#ffffff':'#c9ff63'} strokeWidth={selected?4:2}/>
      <Asset spec={spec} id={target.asset} x={box.x} y={box.y} width={box.width} height={box.height}/>
      {!!target.label&&!art&&<SvgText x={point.x} y={point.y} textAnchor="middle" alignmentBaseline="central" fill="#102330" fontSize={14}>{playerText(target.label)}</SvgText>}
    </>}
  </G>;
});

function SceneControl({control,enabled,dispatch}:{control:Control;enabled:boolean;dispatch:(event:UIEvent)=>void}) {
  const [draft,setDraft]=useState(String(control.value??'')),last=useRef<unknown>(control.value);
  useEffect(()=>{setDraft(String(control.value??''));last.current=control.value;},[control.value]);
  const submit=()=>{
    const value=control.kind==='number'?Number(draft):draft;
    if(control.kind==='number'&&(!draft.trim()||!validNumber(control,value))){setDraft(String(last.current??''));return;}
    if(Object.is(last.current,value))return;
    last.current=value;dispatch({type:'change',id:control.id,value});
  };
  if(control.kind==='button')return <Tool label={control.label} text={control.label} disabled={!enabled} onPress={()=>dispatch({type:'tap',id:control.id})}/>;
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{playerText(control.label)}</Text>
    {control.kind==='choice'?<ScrollView horizontal contentContainerStyle={styles.row}>{control.options?.map((option,index)=><Pressable key={index} accessibilityRole="radio" accessibilityState={{checked:Object.is(option.value,control.value),disabled:!enabled}} disabled={!enabled}
      onPress={()=>dispatch({type:'change',id:control.id,value:option.value})} style={[styles.tool,Object.is(option.value,control.value)&&styles.chosen,!enabled&&styles.disabled]}><Text style={styles.toolText}>{Object.is(option.value,control.value)?'✓ ':''}{playerText(option.label)}</Text></Pressable>)}</ScrollView>:
      <TextInput accessibilityLabel={playerText(control.label)} editable={enabled} value={draft} maxLength={control.kind==='number'?undefined:8000} keyboardType={control.kind==='number'?'numeric':'default'} onChangeText={value=>setDraft(control.kind==='text'?Array.from(value).slice(0,4000).join(''):value)} onEndEditing={submit} onSubmitEditing={submit} style={[styles.input,!enabled&&styles.disabled]}/>}
  </View>;
}

const styles=StyleSheet.create({
  container:{width:'100%',minWidth:0,gap:8},toolbar:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'},row:{flexDirection:'row',alignItems:'center',gap:6,flexWrap:'wrap'},
  status:{color:'#b7ced9',fontSize:13},canvas:{width:'100%',backgroundColor:'#0a1924',overflow:'hidden'},
  loading:{padding:20},error:{color:'#ffc8b9',backgroundColor:'#4a2527',padding:12,borderRadius:8},
  tool:{minWidth:44,minHeight:44,maxWidth:'100%',flexShrink:1,paddingHorizontal:12,paddingVertical:11,borderRadius:10,borderWidth:1,borderColor:'#355469',backgroundColor:'#172f40',alignItems:'center',justifyContent:'center'},
  toolText:{color:'#eff8fc',fontSize:14,fontWeight:'600',flexShrink:1,minWidth:0,maxWidth:'100%'},disabled:{opacity:.4},pressed:{backgroundColor:'#2a5365'},chosen:{borderColor:'#a7e6ba',backgroundColor:'#225247'},
  tools:{gap:7},selectedLabel:{color:'#b9e4ce',fontSize:13},preview:{color:'#d0eab2',fontSize:13,minHeight:20},controls:{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',alignItems:'center',gap:10,minWidth:0,maxWidth:'100%'},
  field:{gap:5,minWidth:130,maxWidth:'100%',flexGrow:1},fieldLabel:{color:'#cbdce5',fontSize:13},input:{borderWidth:1,borderColor:'#365165',backgroundColor:'#102635',borderRadius:9,minHeight:44,color:'#ffffff',paddingHorizontal:12},
});
