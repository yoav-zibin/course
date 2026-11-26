import type {AnimationClip, GameSpec, Piece, Point, Scene, SceneAnimation, Timeline} from './types';
import type {SceneTrack} from './sceneAnimations';
import {position} from './validation';

type Pose = Point & {rotation:number; scale:number; opacity:number};
type Segment = {start:number; end:number; from:Pose; to:Pose; z?:number};
const indexPieces = (scene:Scene) => {
  'worklet';
  return new Map(scene.pieces?.map(p => [p.id,p]));
};

function resting(spec:GameSpec, p:Piece):Pose {
  'worklet';
  const {x,y} = p.parent ? p.position as Point : position(spec,p);
  return {x,y,rotation:p.rotation ?? 0,scale:p.scale ?? 1,opacity:p.opacity ?? 1};
}

function override(spec:GameSpec, p:Piece, pieces:Map<string,Piece>, base:Pose, fields?:SceneAnimation['from']):Pose {
  if (!fields) return base;
  let at:Point|undefined;
  if (fields.position) {
    if (p.parent && !fields.board) at = fields.position as Point;
    else {
      at = position(spec,{board:fields.board ?? p.board,position:fields.position});
      if (p.parent) {
        const parent = world(hierarchy(pieces.get(p.parent)!,pieces), part => resting(spec,part));
        const angle = -parent.rotation * Math.PI / 180;
        const dx = (at.x-parent.x)/parent.scale, dy = (at.y-parent.y)/parent.scale;
        at = {x:(dx*Math.cos(angle)-dy*Math.sin(angle))*(parent.mirror_x?-1:1),
          y:(dx*Math.sin(angle)+dy*Math.cos(angle))*(parent.mirror_y?-1:1)};
      }
    }
  }
  return {x:at?.x ?? base.x, y:at?.y ?? base.y, rotation:fields.rotation ?? base.rotation,
    scale:fields.scale ?? base.scale, opacity:fields.opacity ?? base.opacity};
}

function offset(pose:Pose, point:Point, mirrorX:boolean, mirrorY:boolean):Point {
  'worklet';
  const angle = pose.rotation * Math.PI / 180;
  const x = point.x * pose.scale * (mirrorX ? -1 : 1);
  const y = point.y * pose.scale * (mirrorY ? -1 : 1);
  return {x:Math.cos(angle)*x - Math.sin(angle)*y, y:Math.sin(angle)*x + Math.cos(angle)*y};
}

function hierarchy(piece:Piece, pieces:Map<string,Piece>):Piece[] {
  'worklet';
  const chain = [piece];
  while (piece.parent) {
    piece = pieces.get(piece.parent)!;
    chain.unshift(piece);
  }
  return chain;
}

// A piece's position locates its pivot. Child coordinates start at the
// centre of its parent's artwork. Reflection reverses the handedness of a turn.
function world(chain:Piece[], local:(p:Piece)=>Pose) {
  'worklet';
  let pose:Pose = {x:0,y:0,rotation:0,scale:1,opacity:1};
  let mirrorX=false, mirrorY=false;
  for (const p of chain) {
    const child = local(p), delta = offset(pose,child,mirrorX,mirrorY);
    pose = {x:pose.x+delta.x, y:pose.y+delta.y, scale:pose.scale*child.scale,
      rotation:pose.rotation+(mirrorX!==mirrorY ? -child.rotation : child.rotation),
      opacity:pose.opacity*child.opacity};
    mirrorX = mirrorX !== !!p.mirror_x;
    mirrorY = mirrorY !== !!p.mirror_y;
    if (p.pivot) {
      const pivot = offset(pose,p.pivot,mirrorX,mirrorY);
      pose.x -= pivot.x;
      pose.y -= pivot.y;
    }
  }
  return {...pose,mirror_x:mirrorX,mirror_y:mirrorY};
}

export function resolveScene(spec:GameSpec, scene:Scene):Scene {
  'worklet';
  if (!scene.pieces?.some(p => p.parent || p.pivot)) return scene;
  const byId=indexPieces(scene);
  return {...scene,pieces:scene.pieces.map(p => {
    const chain=hierarchy(p,byId), root=chain[0];
    const pose=world(chain,part => resting(spec,part));
    const board=spec.boards.find(b => b.id===p.board)!;
    return {...p, hand:undefined, position:{x:pose.x-(board.x??0),y:pose.y-(board.y??0)}, rotation:pose.rotation,
      scale:pose.scale,opacity:pose.opacity, mirror_x:pose.mirror_x,mirror_y:pose.mirror_y,
      hidden:chain.some(part=>part.hidden), selected:root.selected || p.selected,
      ...(p.parent ? {parent:root.id,actions:root.actions,move_targets:root.move_targets}: {})};
  })};
}

function sample(segments:Segment[], time:number, easing:GameSpec['motion']):Pose {
  let pose=segments[0].from;
  for (const segment of segments) {
    if (time < segment.start) break;
    pose=segment.to;
    if (time >= segment.end) continue;
    const t=(time-segment.start)/(segment.end-segment.start);
    const phase=easing?.easing==='ease-in-out-quad' ? (t<.5 ? 2*t*t : 1-2*(1-t)**2) : 1-(1-t)**3;
    const mix=(key:keyof Pose) => segment.from[key]+(segment.to[key]-segment.from[key])*phase;
    return {x:mix('x'),y:mix('y'),rotation:mix('rotation'),scale:mix('scale'),opacity:mix('opacity')};
  }
  return pose;
}

// The two scenes are in recorded (forward) order even while stepping back.
// Exit artwork comes exclusively from the preceding viewer-filtered scene.
export function compileTimeline(spec:GameSpec, before:Scene, after:Scene, timeline:Timeline, reverse=false) {
  const old=indexPieces(before), final=indexPieces(after);
  const exits=new Set(timeline.steps.flat().filter(clip=>clip.exit).map(clip=>clip.piece_id));
  const segments=new Map<string,Segment[]>();
  let duration=0;
  for (const step of timeline.steps) {
    let stepEnd=duration;
    for (const clip of step) {
      const start=duration+(clip.delay_ms??0),end=start+(clip.duration_ms??spec.motion?.move_ms??1440);
      stepEnd=Math.max(stepEnd,end);
      const parts=clip.exit ? old : final;
      const piece=parts.get(clip.piece_id);
      if (!piece || piece.hidden) continue;
      const rest=resting(spec,piece), list=segments.get(piece.id)??[];
      const from=override(spec,piece,parts,list.at(-1)?.to??rest,clip.from);
      const to=override(spec,piece,parts,clip.exit ? {...rest,opacity:0} : rest,clip.to);
      list.push({from,to,start,end,z:clip.z});
      segments.set(piece.id,list);
    }
    duration=stepEnd;
  }
  const tracks=new Map<string,SceneTrack>(), ghosts:Piece[]=[];
  const visibleDestination=indexPieces(resolveScene(spec,reverse ? before : after));
  const forwardScene=indexPieces(resolveScene(spec,after)), startScene=indexPieces(resolveScene(spec,before));
  const add=(piece:Piece, parts:Map<string,Piece>, artwork?:Piece) => {
    if (!artwork || artwork.hidden) return;
    const chain=hierarchy(piece,parts);
    const relevant=chain.flatMap(p=>segments.get(p.id)??[]);
    if (!relevant.length) return;
    const rest=resting(spec,artwork.parent ? {...artwork,parent:undefined} : artwork);
    const start=Math.min(...relevant.map(s=>s.start)), end=Math.max(...relevant.map(s=>s.end));
    const delay=reverse ? duration-end : start, length=end-start;
    const poseAt=(fraction:number) => {
      let time=reverse ? end-fraction*length : start+fraction*length;
      if (length===0 && fraction===(reverse ? 1 : 0)) time-=1e-6;
      const pose=world(chain,p=>{
        const track=segments.get(p.id);
        return track ? sample(track,time,spec.motion) : resting(spec,p);
      });
      if (time>=end && chain.some(p=>exits.has(p.id))) pose.opacity=0;
      return pose;
    };
    // A child clip takes precedence over a simultaneous inherited layer.
    const layers=relevant.map(segment=>({start:reverse?duration-segment.end:segment.start,
      end:reverse?duration-segment.start:segment.end,z:segment.z})).reverse();
    tracks.set(piece.id,{from:rest,to:rest,delay,duration:length,layers,sample:poseAt});
    if (!visibleDestination.get(piece.id) || visibleDestination.get(piece.id)?.hidden) ghosts.push(artwork);
  };
  for (const p of final.values()) add(p,final,forwardScene.get(p.id));
  for (const p of old.values()) {
    if (!forwardScene.get(p.id) || forwardScene.get(p.id)?.hidden) {
      if (hierarchy(p,old).some(part=>exits.has(part.id))) add(p,old,startScene.get(p.id));
    }
  }
  return {tracks,ghosts,duration};
}

// Interpolate the parent in local space so each attached piece follows the arc.
export function inferredGroupTracks(spec:GameSpec, before:Scene, after:Scene) {
  const old=indexPieces(before), clips:AnimationClip[]=[];
  const parents=new Set(after.pieces?.map(p=>p.parent));
  for (const piece of after.pieces??[]) {
    const previous=old.get(piece.id);
    if (!parents.has(piece.id) && !piece.parent && !piece.pivot) continue;
    if (!previous || previous.hidden || piece.hidden || previous.parent!==piece.parent) continue;
    const start=resting(spec,previous), end=resting(spec,piece);
    if (start.x===end.x && start.y===end.y && start.rotation===end.rotation &&
        start.scale===end.scale && start.opacity===end.opacity) continue;
    const from:SceneAnimation['from']={rotation:start.rotation,scale:start.scale,opacity:start.opacity};
    if (piece.parent) from.position={x:start.x,y:start.y};
    else {
      const board=spec.boards.find(b=>b.id===piece.board)!;
      from.position={x:start.x-(board.x??0),y:start.y-(board.y??0)};
    }
    clips.push({piece_id:piece.id,from});
  }
  return compileTimeline(spec,before,after,{key:'inferred',steps:[clips]}).tracks;
}

export function pathsTimeline(paths:NonNullable<import('./types').PresentationResult['last_move_animations']>, moveMs:number):Timeline {
  const steps:AnimationClip[][]=[];
  for (const item of paths) {
    const duration=item.duration_ms??moveMs;
    for (let i=1;i<item.path.length;i++) {
      steps.push([{piece_id:item.piece_id,from:item.path[i-1],to:item.path[i],
        duration_ms:duration/(item.path.length-1),z:item.z}]);
    }
  }
  return {key:'paths',steps};
}
