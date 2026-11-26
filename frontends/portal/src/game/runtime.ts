import { evaluate } from './executor';
import { decodeResult, presentationSource, rulesSource } from './runtimeSource';
import { preparePresentationResponse } from './preparePresentationResponse';
import type { GameSpec, Json, PresentationResult } from './types';

export async function runPresentation(code: string, message: unknown, localState: Json = null): Promise<PresentationResult> {
  return decodeResult(await evaluate(presentationSource(code, message, localState)));
}

export async function runPreparedPresentation(spec: GameSpec, message: unknown, localState: Json, isCurrent: () => boolean) {
  const text = await evaluate(presentationSource(spec.ui_code, message, localState));
  if (!isCurrent()) return;
  try { return await preparePresentationResponse(spec, text); }
  catch (error) { if (isCurrent()) throw error; }
}

export async function executeGame(game: {server_code: string; game_schemas?: unknown}, name: string,
  args: unknown[], ctx: unknown, seed: number | string, now: number): Promise<Json> {
  const value = JSON.parse(await evaluate(rulesSource(game, name, args, ctx, seed, now)));
  if (!value || value.ok !== true) throw new Error(value?.message || 'Local game rules failed');
  return value.result;
}
