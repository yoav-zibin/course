import {recordDiagnosticEvent} from './diagnostics';

/** Keep the latest position, and summarize JS timing once per gesture. */
export function createDragFrames<T>(
  surface: 'floating_controls' | 'game_piece',
  clock = () => performance.now(),
  request = (callback: () => void) => requestAnimationFrame(callback),
  cancel = (id: number) => cancelAnimationFrame(id),
) {
  let frame: number | null = null;
  let pending: {value: T; draw: (value: T) => void; queuedAt: number} | null = null;
  let trace: {start: number; inputs: number; frames: number; last: number | null;
              slowFrames: number; maxGap: number; maxWait: number; maxWork: number} | null = null;

  function beginUpdate(now: number) {
    trace ??= {start: now, inputs: 0, frames: 0, last: null, slowFrames: 0, maxGap: 0, maxWait: 0, maxWork: 0};
    trace.inputs++;
  }

  function draw() {
    frame = null;
    const next = pending;
    pending = null;
    if (next) drawPosition(next.value, next.draw, next.queuedAt);
  }

  function drawPosition(value: T, update: (value: T) => void, queuedAt: number) {
    const timing = trace;
    if (!timing) return;
    const now = clock(), gap = timing.last === null ? 0 : now - timing.last;
    timing.frames++;
    timing.last = now;
    if (gap >= 34) timing.slowFrames++;
    timing.maxGap = Math.max(timing.maxGap, gap);
    timing.maxWait = Math.max(timing.maxWait, now - queuedAt);
    update(value);
    timing.maxWork = Math.max(timing.maxWork, clock() - now);
  }

  return {
    move(value: T, update: (value: T) => void) {
      const now = clock();
      beginUpdate(now);
      pending = {value, draw: update, queuedAt: pending?.queuedAt ?? now};
      if (frame === null) frame = request(draw);
    },
    moveImmediately(value: T, update: (value: T) => void) {
      const now = clock();
      beginUpdate(now);
      drawPosition(value, update, now);
    },
    finish(outcome: 'released' | 'cancelled') {
      if (frame !== null) cancel(frame);
      frame = null;
      pending = null;
      const timing = trace;
      trace = null;
      if (!timing) return;
      recordDiagnosticEvent('drag_performance', {
        surface, outcome, input_events: timing.inputs, js_updates: timing.frames, gaps_over_34ms: timing.slowFrames,
        duration_ms: Math.round(clock() - timing.start), max_js_gap_ms: Math.round(timing.maxGap),
        max_schedule_wait_ms: Math.round(timing.maxWait), max_update_work_ms: Math.round(timing.maxWork),
      });
    },
  };
}
