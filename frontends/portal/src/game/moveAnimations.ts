import type { GameSpec, MoveAnimation, Point, StateMessage } from './types';
import { position } from './validation';

export type MoveTrack = { segments: { from: Point; to: Point; start: number; end: number; z?:number }[]; duration: number };

// Only a consecutive accepted opponent update can play the path stored in its
// view. A reconnect/jump has no complete preceding position to animate from.
export function animateLastMove(previous: StateMessage | null, next: StateMessage): boolean {
  return !!previous && Number.isSafeInteger(previous.move_count) && next.move_count === previous.move_count! + 1
    && (previous.my_player_index ?? null) === (next.my_player_index ?? null)
    && !!previous.replay === !!next.replay && Number.isInteger(next.last_move_player_index)
    && next.last_move_player_index !== next.my_player_index;
}

export function moveTracks(spec: GameSpec, animations: MoveAnimation[]): Map<string, MoveTrack> {
  const tracks = new Map<string, MoveTrack>();
  let elapsed = 0;
  for (const animation of animations) {
    const duration = animation.duration_ms ?? spec.motion?.move_ms ?? 1440;
    const track:MoveTrack = tracks.get(animation.piece_id) ?? {segments: [], duration: 0};
    const points = animation.path.map(point => {const {x,y}=position(spec,point);return {x,y};});
    for (let index = 1; index < points.length; index++) track.segments.push({
      from: points[index - 1], to: points[index],
      start: elapsed + duration * (index - 1) / (points.length - 1),
      end: elapsed + duration * index / (points.length - 1),
      ...(animation.z!==undefined?{z:animation.z}:{}),
    });
    tracks.set(animation.piece_id, track);
    elapsed += duration;
  }
  for (const track of tracks.values()) track.duration = elapsed;
  return tracks;
}

export function trackLayer(track:MoveTrack,elapsed:number):{active:boolean;z?:number;transition:number} {
  const segment=track.segments.find(item=>elapsed>=item.start&&elapsed<item.end);
  let transition=Infinity;
  for(const item of track.segments){
    if(item.start>elapsed)transition=Math.min(transition,item.start);
    if(item.end>elapsed)transition=Math.min(transition,item.end);
  }
  return {active:!!segment,...(segment?.z!==undefined?{z:segment.z}:{}),transition};
}

export function trackPosition(track: MoveTrack, elapsed: number, easing?: 'ease-out' | 'ease-in-out-quad'): Point {
  for (const segment of track.segments) {
    if (elapsed < segment.start) return segment.from;
    if (elapsed < segment.end) {
      const phase = (elapsed - segment.start) / (segment.end - segment.start);
      const eased = easing === 'ease-in-out-quad'
        ? phase < .5 ? 2 * phase * phase : 1 - (-2 * phase + 2) ** 2 / 2
        : 1 - (1 - phase) ** 3;
      return {x: segment.from.x + (segment.to.x - segment.from.x) * eased,
        y: segment.from.y + (segment.to.y - segment.from.y) * eased};
    }
  }
  return track.segments[track.segments.length - 1].to;
}
