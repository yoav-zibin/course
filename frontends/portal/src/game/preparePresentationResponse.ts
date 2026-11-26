import {preparePresentation} from './preparePresentation';
import {decodeResult} from './runtimeSource';
import type {GameSpec} from './types';

export function preparePresentationRuntime() { /* Web validates in its existing runtime. */ }

export async function preparePresentationResponse(spec: GameSpec, text: string) {
  const result = decodeResult(text);
  return {result, resolved: preparePresentation(spec,result)};
}
