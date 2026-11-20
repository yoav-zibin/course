export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Point = { x: number; y: number };
export type Position = Point | { cell: string };
export type Board = {
  id: string; kind: 'grid' | 'hex' | 'graph' | 'track' | 'free' | 'zone';
  x?: number; y?: number; width: number; height: number; rows?: number; columns?: number;
  color?: string; alternate_color?: string; line_color?: string; background_asset?: string;
  cells?: (Point & { id: string; label?: string; color?: string })[];
  links?: { from: string; to: string }[];
};
export type PieceType = {
  shape: 'circle' | 'rect' | 'card' | 'dice' | 'image' | 'text'; width?: number; height?: number;
  color?: string; border_color?: string; text_color?: string; font_size?: number;
  asset?: string; back_asset?: string; action_outline?: 'rect' | 'ellipse' | 'none';
};
export type Motion = {
  move_ms?: number; roll_ms?: number; roll_settle_ms?: number; turn_pause_ms?: number;
  animate_own?: boolean; easing?: 'ease-out' | 'ease-in-out-quad';
};
export type GameSpec = {
  format: 'buildplay-ui'; version: 1; viewport: { width: number; height: number; camera_enabled?: boolean };
  boards: Board[]; piece_types: Record<string, PieceType>; assets?: Record<string, { uri: string }>;
  strings?: Record<string, string>; ui_code: string; motion?: Motion;
};
export type PieceAction = 'tap' | 'move' | 'rotate' | 'flip' | 'scale';
export type Piece = {
  id: string; type: string; board: string; position: Position; text?: string; aria_label?: string;
  asset?: string; rotation?: number; scale?: number; opacity?: number; z?: number;
  face?: 'front' | 'back'; move_targets?: string[]; selected?: boolean; hidden?: boolean;
  draggable?: boolean; actions?: PieceAction[];
  animation?: { kind: 'roll' | 'move' | 'notice'; key: string; duration_ms?: number; delay_ms?: number };
};
export type Target = {
  id: string; board: string; position: Position; label?: string; aria_label?: string; color?: string;
  asset?: string; hit_area?: Point & { width: number; height: number };
  preview?: { position: Position; color?: string; asset?: string; rotation?: number; text?: string }[];
};
export type Control = {
  id: string; label: string; kind: 'button' | 'number' | 'choice' | 'text';
  value?: string | number | boolean | null; min?: number; max?: number; step?: number;
  disabled?: boolean; options?: { value: string | number | boolean; label: string }[];
};
export type Scene = {
  pieces?: Piece[]; targets?: Target[]; controls?: Control[];
  labels?: (Point & { id: string; text: string; color?: string; font_size?: number })[];
  paths?: { id: string; points: Point[]; color?: string; width?: number }[];
};
export type MoveAnimationPoint = { board: string; position: Position };
export type MoveAnimation = {
  piece_id: string; path: MoveAnimationPoint[]; duration_ms?: number;
};
export type StateMessage = {
  type: 'state_changed'; status: string; move_count?: number; my_player_index?: number | null;
  acting_for_player_index?: number | null; last_move_player_index?: number | null;
  view?: Json; state?: Json; replay?: Json; [key: string]: unknown;
};
export type UIEvent = {
  type: 'tap' | 'drop' | 'rotate' | 'flip' | 'scale' | 'change'; id: string;
  piece_id?: string; target_id?: string; delta?: number; factor?: number; value?: string | number | boolean;
};
export type PresentationResult = {
  scene: Scene; local_state?: Json; make_move?: Json;
  last_move_animations?: MoveAnimation[] | null;
};
