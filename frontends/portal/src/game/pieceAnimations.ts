import type {GameSpec,Piece} from './types';
import type {MoveTrack} from './moveAnimations';
import {trackLayer} from './moveAnimations';
import type {SceneTrack} from './sceneAnimations';
import {position} from './validation';

export const STATIC_PIECE_Z_MAX=100000;
export const DEFAULT_ANIMATION_Z=STATIC_PIECE_Z_MAX+1;

export type PieceAnimationOptions={
  animate:boolean;effect?:'enter'|'change'|'exit';inferMovement?:boolean;
  moveTrack?:MoveTrack;sceneTrack?:SceneTrack;pulseEnabled?:boolean;
  elapsed?:number;
};

// Share the playback decision between artwork and painter ordering, so a
// suppressed/repeated/reduced-motion event cannot leave a piece on top.
export function pieceAnimation(spec:GameSpec,piece:Piece,previous:Piece|undefined,
                               options:PieceAnimationOptions) {
  const {animate,effect,inferMovement=true,moveTrack,sceneTrack,pulseEnabled=false}=options;
  const next=position(spec,piece),before=previous?position(spec,previous):next;
  const newEffect=previous?.animation?.key!==piece.animation?.key;
  const moved=!!previous&&(before.x!==next.x||before.y!==next.y||
    (previous.rotation||0)!==(piece.rotation||0)||(previous.scale??1)!==(piece.scale??1));
  const popAnimation=pulseEnabled&&newEffect&&piece.animation?.kind==='pulse';
  const needsAnimation=popAnimation||animate&&(sceneTrack?sceneTrack.duration+sceneTrack.delay>0:
    !!moveTrack||!!effect||inferMovement&&moved||newEffect&&!!piece.animation&&piece.animation.kind!=='move');
  const duration=sceneTrack?.duration??moveTrack?.duration??(effect?(spec.motion?.move_ms??1440):
    piece.animation?.duration_ms??(piece.animation?.kind==='roll'?spec.motion?.roll_ms??650:
      piece.animation?.kind==='pulse'?560:spec.motion?.move_ms??1440));
  const delay=sceneTrack?.delay??(moveTrack||effect?0:piece.animation?.delay_ms??0);
  const elapsed=options.elapsed??0;
  const layers=sceneTrack?.layers;
  const movement=layers?trackLayer({segments:layers},elapsed):moveTrack?trackLayer(moveTrack,elapsed):undefined;
  const layerActive=Boolean(needsAnimation&&(movement?movement.active:elapsed>=delay&&elapsed<delay+duration));
  const layerTransition=!needsAnimation?Infinity:movement?movement.transition:
    elapsed<delay?delay:elapsed<delay+duration?delay+duration:Infinity;
  const z=sceneTrack?.z??movement?.z??piece.animation?.z??DEFAULT_ANIMATION_Z;
  return {next,before,newEffect,popAnimation,needsAnimation,duration,delay,z,layerActive,layerTransition};
}
