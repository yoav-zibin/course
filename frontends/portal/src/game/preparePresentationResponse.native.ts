import {createWorkletRuntime,runOnRuntimeAsync} from 'react-native-worklets';
import {preparePresentation} from './preparePresentation';
import {decodeResult} from './runtimeSource';
import type {GameSpec,Scene} from './types';

let worker: ReturnType<typeof createWorkletRuntime> | undefined;
const validationSpecs = new WeakMap<GameSpec,string>();

export function preparePresentationRuntime() {
  return worker ??= createWorkletRuntime({name:'Game presentation',enableEventLoop:false});
}

function resolveResponse(specJSON: string, text: string) {
  'worklet';
  const result = decodeResult(text);
  const resolved = preparePresentation(JSON.parse(specJSON),result);
  return resolved === result.scene ? undefined : JSON.stringify(resolved);
}

export async function preparePresentationResponse(spec: GameSpec, text: string) {
  let specJSON = validationSpecs.get(spec);
  if (specJSON === undefined) {
    // Validation checks asset IDs; the worker does not need the image data.
    const {boards, piece_types, assets, motion} = spec;
    specJSON = JSON.stringify({boards,piece_types,motion,assets:Object.fromEntries(Object.keys(assets??{}).map(id=>[id,true]))});
    validationSpecs.set(spec,specJSON);
  }
  // Keep arbitrary game output as JSON text across the Worklets boundary.
  const resolvedJSON = await runOnRuntimeAsync(preparePresentationRuntime(),resolveResponse,specJSON,text);
  const result = decodeResult(text);
  return {result,resolved:resolvedJSON === undefined ? result.scene : JSON.parse(resolvedJSON) as Scene};
}
