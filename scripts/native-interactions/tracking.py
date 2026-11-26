#!/usr/bin/env python3
"""Recover actual checker motion from a portrait simctl recording and XCTest geometry."""
import json
from pathlib import Path
import re
import sys

import av
import numpy as np


def checker_segments(frames, x, start, end, diameter):
    # The opening's ivory checker moves down its own column into the opposite row.
    # Beyond the stack there are no stationary ivory pieces in this strip.
    top, bottom = round(start+diameter*.8), round(end)
    center, radius = round(x), max(2,round(diameter*.18))
    segments, forward = [], []
    def finish():
        if len(forward) >= 2 and forward[-1][1]-forward[0][1] > diameter*.4:
            travel = forward[-1][1]-forward[0][1]
            gaps = np.diff([point[0] for point in forward])
            segments.append({'first_frame_ms':round(float(forward[0][0]),1), 'travel':round(float(travel),1),
                             'distinct_positions':len(forward), 'p95_gap_ms':round(float(np.percentile(gaps,95)),1),
                             'max_gap_ms':round(float(max(gaps)),1), 'full_sweep':len(forward)>=4 and travel>(end-start)*.36})
        forward.clear()

    for t, pixels in frames:
        r,g,b = np.moveaxis(pixels[top:bottom,center-radius:center+radius+1].astype(np.int16),2,0)
        ivory = (r>170) & (g>165) & (b>135) & (np.abs(r-g)<26) & (np.abs(g-b)<38)
        rows = np.flatnonzero(ivory.sum(axis=1)>=radius)
        # A checker is a small contiguous patch. Exclude launch screens, dialogs and text.
        if len(rows)<3 or rows[-1]-rows[0]>diameter*1.55:
            finish()
            continue
        y=float(np.median(rows))
        if forward and (y<forward[-1][1]-4 or t-forward[-1][0]>450):
            finish()
        if not forward or y>=forward[-1][1]+1:
            forward.append((t,y))
    finish()
    return segments


def full_sweeps(segments):
    return [{key:s[key] for key in ('distinct_positions','p95_gap_ms','max_gap_ms')} for s in segments if s['full_sweep']]


def measure(video, screen, x, start, end, diameter):
    width, height = map(round, screen)
    with av.open(str(video)) as capture:
        frames = ((float(f.pts*f.time_base)*1000, f.reformat(width=width,height=height,format='rgb24').to_ndarray())
                  for f in capture.decode(video=0))
        return checker_segments(frames, x, start, end, diameter)


def match_drags(log, segments):
    # XCTest includes one warm-up gesture before the measured iterations. The
    # recording and test have different clock origins. Match their relative timing
    # before attributing partial movement to an individual gesture.
    presses = [float(s)*1000 for s in re.findall(r't =\s*([\d.]+)s Press .*?then drag to',log)]
    if len(presses)<2 or len(presses)!=len(segments):
        return []
    offsets = [segment['first_frame_ms']-press for segment,press in zip(segments,presses)]
    if max(offsets)-min(offsets) >= min(np.diff(presses))/2:
        return []
    return segments


if __name__ == '__main__':
    video, log, output = map(Path,sys.argv[1:])
    test_log = log.read_text()
    values = re.search(r'TRACK_GEOMETRY ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)',test_log)
    if not values:
        raise SystemExit('Missing XCTest board projection')
    width,height,x,start,end,diameter = map(float,values.groups())
    segments = measure(video,(width,height),x,start,end,diameter)
    sweeps = full_sweeps(segments)
    output.write_text(json.dumps({'sweeps':sweeps,'gestures':match_drags(test_log,segments)},indent=2)+'\n')
    print('Tracked',len(sweeps),'checker sweeps')
    if len(sweeps)<5:
        raise SystemExit('Could not verify five full visible drags')
