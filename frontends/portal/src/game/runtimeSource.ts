import { PRACTICE_PRELUDE } from './practicePrelude';
import type { Json, PresentationResult } from './types';

export const MAX_SOURCE = 1_500_000;
export const MAX_RESULT = 900_000;

function json(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || encoded.length > MAX_SOURCE) throw new Error('Game input exceeds its size limit');
  return encoded;
}

// This source is executed only inside the isolated native QuickJS VM or the
// opaque browser worker, never in the application's JavaScript runtime.
export function presentationSource(code: string, message: unknown, localState: Json): string {
  if (code.length > 200_000) throw new Error('Presentation source exceeds its size limit');
  return `Math.random=()=>{throw new Error('Presentation cannot use randomness')};Date=undefined;\n${code}\n;JSON.stringify(gameUI.reduce(${json(message)},${json(localState)}))`;
}

export function rulesSource(game: {server_code: string; game_schemas?: unknown}, name: string,
  args: unknown[], ctx: unknown, seed: number | string, now: number): string {
  if (game.server_code.length > 700_000) throw new Error('Rules source exceeds its size limit');
  const input = JSON.stringify({args, ctx});
  return `const __gameSchemas=${json(game.game_schemas || {})};\n${PRACTICE_PRELUDE}\n${game.server_code}\n;__invoke(${json(name)},${json(input)},${json(seed)},${json(now)})`;
}

export function decodeResult(result: string): PresentationResult {
  if (typeof result !== 'string' || result.length > 256_000) throw new Error('Presentation response exceeds its size limit');
  return JSON.parse(result);
}
