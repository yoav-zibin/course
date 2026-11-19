import {copyText} from '../platform/i18n';
import type { GameSpec, Piece, Point, Scene, StateMessage, Target, UIEvent } from './types';
import { pieceActions, position } from './validation';

export function canMove(message: StateMessage | null, sent = false): boolean {
  return !!message && message.status === 'ongoing' && Number.isInteger(message.acting_for_player_index)
    && (message.acting_for_player_index as number) >= 0 && (message.acting_for_player_index as number) < 10
    && !message.replay && !sent;
}

export function pieceName(piece: Piece): string {
  return piece.face === 'back' ? copyText('Covered piece') : piece.aria_label || piece.text || piece.id;
}

export function pieceSize(spec: GameSpec, piece: Piece): { width: number; height: number } {
  const board = position(spec, piece).board, type = spec.piece_types[piece.type];
  const width = type.width ?? (board.kind === 'grid' ? board.width / board.columns! * .76 : 42);
  return {width, height: type.height ?? (board.kind === 'grid' ? board.height / board.rows! * .76 : width)};
}

export function targetBox(spec: GameSpec, target: Target) {
  const point = position(spec, target), board = point.board;
  const width = board.kind === 'grid' ? board.width / board.columns! : 44;
  const height = board.kind === 'grid' ? board.height / board.rows! : 44;
  return {x: point.x + (target.hit_area?.x ?? -width / 2), y: point.y + (target.hit_area?.y ?? -height / 2),
    width: target.hit_area?.width ?? width, height: target.hit_area?.height ?? height};
}

export function contains(box: Point & {width: number; height: number}, at: Point, margin = 0) {
  return at.x >= box.x - margin && at.x <= box.x + box.width + margin
    && at.y >= box.y - margin && at.y <= box.y + box.height + margin;
}

export function hitPiece(spec: GameSpec, scene: Scene, at: Point): Piece | undefined {
  return [...(scene.pieces || [])].sort((a,b)=>(b.z || 0)-(a.z || 0) || scene.pieces!.indexOf(b)-scene.pieces!.indexOf(a)).find(piece => {
    if (!pieceActions(piece).length) return false;
    const center = position(spec, piece), size = pieceSize(spec, piece);
    const angle = -(piece.rotation || 0) * Math.PI / 180, scale = piece.scale || 1;
    const dx = (at.x-center.x) / scale, dy = (at.y-center.y) / scale;
    const local = {x:dx*Math.cos(angle)-dy*Math.sin(angle), y:dx*Math.sin(angle)+dy*Math.cos(angle)};
    if (spec.piece_types[piece.type].shape === 'circle') return (local.x/(size.width/2))**2 + (local.y/(size.height/2))**2 <= 1;
    return Math.abs(local.x) <= size.width / 2 && Math.abs(local.y) <= size.height / 2;
  });
}

export function hitTarget(spec: GameSpec, scene: Scene, at: Point, piece?: Piece, margin = 0): Target | undefined {
  return [...(scene.targets || [])].filter(target => !piece || piece.move_targets?.includes(target.id))
    .filter(target => contains(targetBox(spec,target),at,margin))
    .sort((a,b)=>{
      const pa=position(spec,a),pb=position(spec,b);
      return Math.hypot(at.x-pa.x,at.y-pa.y)-Math.hypot(at.x-pb.x,at.y-pb.y);
    })[0];
}

export function validEvent(scene: Scene, event: UIEvent): boolean {
  const piece = scene.pieces?.find(item => item.id === event.id);
  if (piece) {
    const actions = pieceActions(piece);
    if (event.type === 'drop') return actions.includes('move') && event.piece_id === piece.id
      && !!piece.move_targets?.includes(event.target_id!) && !!scene.targets?.some(target=>target.id===event.target_id);
    if (event.type === 'rotate') return actions.includes('rotate') && Number.isFinite(event.delta) && event.delta !== 0 && Math.abs(event.delta!) <= 360;
    if (event.type === 'scale') return actions.includes('scale') && Number.isFinite(event.factor) && event.factor! > 0 && event.factor! <= 10;
    return actions.includes(event.type as 'tap' | 'flip');
  }
  if (event.type === 'tap' && scene.targets?.some(item=>item.id===event.id)) return true;
  const control = scene.controls?.find(item => item.id === event.id && !item.disabled);
  if (!control) return false;
  if (control.kind === 'button') return event.type === 'tap';
  if (event.type !== 'change') return false;
  if (control.kind === 'choice') return !!control.options?.some(option=>Object.is(option.value,event.value));
  if (control.kind === 'number') return typeof event.value === 'number' && Number.isFinite(event.value)
    && (control.min === undefined || event.value >= control.min) && (control.max === undefined || event.value <= control.max);
  return typeof event.value === 'string' && event.value.length <= 2000;
}

export function animateUpdate(previous: StateMessage | null, next: StateMessage, animateOwn = false): boolean {
  if (!previous || previous.move_count === undefined || next.move_count === undefined) return false;
  if ((previous.my_player_index??null)!==(next.my_player_index??null))return false;
  if (next.replay) return Math.abs(previous.move_count-next.move_count)===1;
  if (previous.replay)return false;
  if (next.move_count <= previous.move_count) return false;
  const before=(previous.view||previous.state) as Record<string,unknown> | null;
  const after=(next.view||next.state) as Record<string,unknown> | null;
  if(before?.round_winner!=null&&after?.round_winner===null)return false;
  const actor = next.last_move_player_index;
  return animateOwn || Number.isInteger(actor) && (next.my_player_index === null || actor !== next.my_player_index);
}

export function historyChanges(previous: Scene, next: Scene) {
  const before=new Map((previous.pieces||[]).filter(piece=>!piece.hidden).map(piece=>[piece.id,piece]));
  const visible=new Set((next.pieces||[]).filter(piece=>!piece.hidden).map(piece=>piece.id));
  const effects=new Map<string,'enter'|'change'>();
  for(const piece of next.pieces||[]){
    if(piece.hidden)continue;
    const old=before.get(piece.id);
    if(!old)effects.set(piece.id,'enter');
    else if(['type','asset','text','face','opacity'].some(key=>old[key as keyof Piece]!==piece[key as keyof Piece]))effects.set(piece.id,'change');
  }
  return {effects,removed:[...before.values()].filter(piece=>!visible.has(piece.id))};
}

export function presentationSteps(previous: StateMessage | null, next: StateMessage): StateMessage[] {
  if (!previous || previous.replay || next.replay || !Number.isSafeInteger(previous.move_count)
    || !Number.isSafeInteger(next.move_count) || next.move_count! <= previous.move_count! + 1
    || !Array.isArray(next.presentation_history)) return [];
  const observations = next.presentation_history as {view: unknown; move_count: number; last_move_player_index?: number | null}[];
  const ordered = observations.filter(item => item && Number.isSafeInteger(item.move_count)
    && item.move_count > previous.move_count! && item.move_count < next.move_count!)
    // A local turn can contain the human action plus up to 200 computer moves.
    .sort((a,b)=>a.move_count-b.move_count).slice(-200);
  if (ordered.length !== next.move_count!-previous.move_count!-1 || ordered.some((item,index)=>item.move_count!==previous.move_count!+index+1))return [];
  return ordered.map(item=>({...next,view:item.view as StateMessage['view'],state:item.view as StateMessage['state'],
    move_count:item.move_count,last_move_player_index:item.last_move_player_index,acting_for_player_index:null,status:'ongoing',
    presentation_history:observations.filter(observation=>observation.move_count<=item.move_count)}));
}
