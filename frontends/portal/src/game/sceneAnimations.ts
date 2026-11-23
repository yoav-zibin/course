import type { GameSpec, Piece, Point, Scene, SceneAnimation, StateMessage } from './types';
import { position } from './validation';

type Transform = Point & {rotation:number;scale:number;opacity:number};
export type SceneTrack = {from:Transform;to:Transform;duration:number;delay:number;z?:number;layers?:{start:number;end:number;z?:number}[];sample?:(phase:number)=>Transform};

// Explicit animations also cover accepted own moves, while reloads and jumps
// settle immediately. Local UI interactions are checked by the host separately.
export function animateSceneUpdate(previous:StateMessage|null,next:StateMessage):boolean {
  return !!previous && Number.isSafeInteger(previous.move_count) && next.move_count===previous.move_count!+1
    && (previous.my_player_index??null)===(next.my_player_index??null)
    && !!previous.replay===!!next.replay;
}

function transform(spec:GameSpec,piece:Piece):Transform {
  const {x,y}=position(spec,piece);
  return {x,y,rotation:piece.rotation??0,scale:piece.scale??1,opacity:piece.opacity??1};
}

// Consume keys even when playback is suppressed. A repeated authoritative view
// must not replay its last animation on the next local interaction.
export function sceneTracks(spec:GameSpec,scene:Scene,animations:SceneAnimation[],keys:Map<string,string>):Map<string,SceneTrack> {
  const pieces=new Map((scene.pieces??[]).filter(piece=>!piece.hidden).map(piece=>[piece.id,piece]));
  for(const id of keys.keys())if(!pieces.has(id))keys.delete(id);
  const tracks=new Map<string,SceneTrack>();
  for(const animation of animations){
    const fresh=keys.get(animation.piece_id)!==animation.key;
    keys.set(animation.piece_id,animation.key);
    if(!fresh)continue;
    const piece=pieces.get(animation.piece_id)!;
    const to=transform(spec,piece),from={...to};
    if(animation.from.position){
      const {x,y}=position(spec,{board:animation.from.board??piece.board,position:animation.from.position});
      from.x=x;from.y=y;
    }
    for(const key of ['rotation','scale','opacity'] as const)
      if(animation.from[key]!==undefined)from[key]=animation.from[key];
    tracks.set(piece.id,{from,to,duration:animation.duration_ms??spec.motion?.move_ms??1440,delay:animation.delay_ms??0,
      ...(animation.z!==undefined?{z:animation.z}:{})});
  }
  return tracks;
}

export function sceneTransform(track:SceneTrack,phase:number):Transform {
  const from=track.from,to=track.to;
  return {x:from.x+(to.x-from.x)*phase,y:from.y+(to.y-from.y)*phase,
    rotation:from.rotation+(to.rotation-from.rotation)*phase,
    scale:from.scale+(to.scale-from.scale)*phase,opacity:from.opacity+(to.opacity-from.opacity)*phase};
}
