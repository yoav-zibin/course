import type {GameRendererProps} from './GameRenderer';
import type {Scene, StateMessage} from './types';
import {pieceActions} from './validation';

export const BACKGAMMON_GAME_ID='5f5293c3-2a3a-4eec-b631-9debf59be0ca';
export const fillsBackgammonLandscape=(width:number,height:number)=>width>height&&height<600;

const hiddenLabels = new Set([
  'title', 'bar_label', 'off_label', 'white_label', 'black_label', 'moves_remaining',
  ...[0, 1].flatMap(seat => ['name', 'pip', 'off', 'score'].map(label => `${label}_${seat}`)),
]);
const hiddenPieces = new Set(['status_0', 'status_1', 'swatch_0', 'swatch_1']);
const boardTools = new Set(['help', 'hint', 'undo']);

function presentScene(scene: Scene, message: StateMessage): Scene {
  const view = (message.view ?? message.state) as {
    opening?: boolean; winner?: number | null; round_winner?: number | null; cube?: {offer?: number | null};
  } | null | undefined;
  const showTurnPrompt = view?.opening || view?.winner != null || view?.round_winner != null || view?.cube?.offer != null;
  const canTapCube = scene.pieces?.some(piece => piece.id === 'cube' && !piece.hidden && pieceActions(piece).includes('tap'));
  const labels = scene.labels?.flatMap(label => {
    if (hiddenLabels.has(label.id) || (label.id === 'turn' && !showTurnPrompt)) return [];
    // Keep instructions for special game states near the controls, inside the wood frame.
    if (label.id === 'turn') return [{...label, x: 118, y: 260}];
    if (label.id === 'opening_status') return [{...label, x: 118, y: 279}];
    if (label.id === 'hint_move') return [{...label, x: 66, y: 350}];
    return [label];
  });
  const pieces = scene.pieces?.flatMap(piece => {
    if (hiddenPieces.has(piece.id) || (piece.id === 'double' && canTapCube)) return [];
    if (boardTools.has(piece.id) && 'y' in piece.position && piece.position.y < -18) {
      return [{...piece, position: {...piece.position, y: -18}}];
    }
    return [piece];
  });
  return {...scene, labels, pieces};
}

export const backgammonMatchPresentation: GameRendererProps['boardPresentation'] = {
  visibleBoard: board => board.id !== 'felt',
  presentScene,
  motion: {roll_settle_ms: 0, turn_pause_ms: 0},
};
