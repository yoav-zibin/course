#!/usr/bin/env python3
"""Export the six-move native Connect Four fixture and track its yellow reserve disc."""
import hashlib
import json
from pathlib import Path
import runpy
import sys

import numpy as np


def write_fixture(directory):
    root = Path(__file__).resolve().parents[2]
    seed = runpy.run_path(str(root / 'frontends/portal/scripts/seed-ios-connect4-fixture.py'))
    data, proof = seed['fixture_snapshot']()
    key = proof['storage_key']
    filename = hashlib.sha256(key.encode()).hexdigest() + '.json'
    game = next(iter(data['responses'].values()))
    viewport = game['declarative_ui']['viewport']
    # The active yellow disc in this reviewed fixture starts in the reserve strip.
    pose = {'game':'connect4', 'id':proof['match_id'], 'moveCount':proof['move_count'], 'filename':filename,
            'checker':'Player 1 reserve disc: Move', 'source':{'x':49, 'y':50}, 'destination':{'x':325, 'y':50},
            'bounds':{'x':0, 'y':0, 'width':viewport['width'], 'height':viewport['height']}}
    directory.mkdir(parents=True, exist_ok=True)
    (directory/filename).write_text(json.dumps({'key':key, 'value':json.dumps(data)}))
    (directory/'pose.json').write_text(json.dumps(pose, indent=2)+'\n')


def reserve_motion(times, frames, board, source, end, scale):
    x, y = source
    left, _, right, _ = board
    advances = []
    for t, frame in zip(times, frames):
        if t < 0:
            continue
        r, g, b = np.moveaxis(frame[max(0, round(y-110*scale)):y+3, left:right], 2, 0)
        columns = np.nonzero((r>185) & (g>133) & (b<125))[1]
        if len(columns) <= 15:
            continue
        position = float(np.median(columns)) + left
        if position>x+4 and (not advances or position>=advances[-1][1]+1):
            advances.append((t, position))
    if len(advances)<3 or advances[-1][1]<x+(end[0]-x)*.75:
        raise RuntimeError('The yellow reserve disc did not make a full visible drag')
    gaps = np.diff([t for t, _ in advances])
    return {'drag_first_ms':round(float(advances[0][0]),1), 'drag_distinct_frames':len(advances),
            'drag_frame_gap_p95_ms':round(float(np.percentile(gaps,95)),1), 'drag_max_gap_ms':round(float(max(gaps)),1)}


if __name__ == '__main__':
    write_fixture(Path(sys.argv[1]))
