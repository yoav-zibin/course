import type {ReactElement, ReactNode} from 'react';
import type {BoardCamera, BoardRect} from './boardInputGeometry';
import type {GameSpec, Scene, Target} from './types';

export type BoardInputResult =
  | {kind:'tap';choice?:{kind:'target'|'piece';id:string};source:string|null;selected:string|null;touch:boolean}
  | {kind:'drop';piece:string;target?:string}
  | {kind:'clear'};

export type BoardInputProps = {
  spec:GameSpec;
  scene:Scene;
  order:ReadonlyMap<string,number>;
  revision:number;
  presentedRevision:number;
  moveCount?:number;
  active:boolean;
  selected:string|null;
  selectionRequired:boolean;
  width:number;
  height:number;
  fill:boolean;
  view:BoardRect;
  bounds:BoardRect;
  camera:BoardCamera;
  onResult:(result:BoardInputResult)=>void|Promise<boolean|void>;
  onCamera:(camera:BoardCamera)=>void;
  renderHeld:(id:string)=>ReactNode;
  renderPreview:(target:Target)=>ReactNode;
  renderDestination:(target:Target,accessible:boolean)=>ReactNode;
};

export type BoardInput = {
  heldId?:string;
  wrapCanvas?:(canvas:ReactElement)=>ReactElement;
  wrapPiece?:(piece:ReactElement,root:string)=>ReactElement;
  feedback?:ReactNode;
  destinationHints?:ReactNode;
  drawsSelectedTargets?:boolean;
};

export function useBoardInput(_props:BoardInputProps):BoardInput {
  return {};
}
