import type { Board, GameSpec, MoveAnimation, Piece, PieceAction, Point, Scene, SceneAnimation, Target, Timeline } from './types';
export function targetBounds(spec: GameSpec, target: Target): Point & {width:number;height:number};
export function finiteJSON(value: unknown, depth?: number): void;
export function knownObject(value: unknown, allowed: string[], required?: string[]): void;
export function validateSpec(spec: unknown): GameSpec;
export function validateScene(spec: GameSpec, scene: unknown): Scene;
export function validateMoveAnimations(spec: GameSpec, scene: Scene, animations: unknown): MoveAnimation[] | null;
export function validateSceneAnimations(spec: GameSpec, scene: Scene, animations: unknown): SceneAnimation[];
export function assetURI(asset?: {uri: string}): string | null;
export function boardCell(board: Board, cell: string): Point;
export function position(spec: GameSpec, item: {board: string; position: unknown; hand?: Piece['hand']}): Point & {board: Board};
export function pieceActions(piece: Partial<Piece>): PieceAction[];
export function contentBounds(spec: GameSpec, scene?: Scene): Point & {width:number;height:number};
export function cameraLimits(bounds: Point & {width:number;height:number}, zoom: number): {width:number;height:number;minX:number;maxX:number;minY:number;maxY:number};

export function validateTimeline(spec: GameSpec, scene: Scene, timeline: unknown): Timeline;
