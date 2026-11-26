import {resolveScene} from './composition';
import type {GameSpec, PresentationResult, Scene} from './types';
import {finiteJSON, knownObject, validateMoveAnimations, validateScene, validateSceneAnimations, validateTimeline} from './validation';

export function preparePresentation(spec: GameSpec, result: PresentationResult): Scene {
  'worklet';
  knownObject(result,['scene','local_state','make_move','last_move_animations','animations','timeline'],['scene']);
  finiteJSON(result);
  const raw = validateScene(spec,result.scene);
  const resolved = resolveScene(spec,raw);
  validateMoveAnimations(spec,raw,result.last_move_animations);
  validateSceneAnimations(spec,raw,result.animations);
  if (result.timeline !== undefined) {
    validateTimeline(spec,raw,result.timeline);
    if (result.animations !== undefined) throw new Error('Return timeline or animations');
  }
  return resolved;
}
