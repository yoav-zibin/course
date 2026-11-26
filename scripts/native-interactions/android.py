#!/usr/bin/env python3
"""Measure visible responses in a disposable Android emulator. Requires adb, av and numpy."""
import argparse
import json
from pathlib import Path
import re
import struct
import subprocess
import time
from xml.etree import ElementTree

import av
import numpy as np

BOARD = 'Game board. Use pieces and highlighted destinations.'
REPORT = 'Report a bug or request a feature'


class Device:
    def __init__(self, serial):
        self.command = ['adb', '-s', serial]

    def adb(self, *args):
        return subprocess.check_output([*self.command, *map(str, args)], timeout=45).decode().strip()

    def bounds(self, label):
        for _ in range(4):
            self.adb('shell', 'uiautomator dump --compressed /sdcard/buildplay-benchmark.xml >/dev/null')
            root = ElementTree.fromstring(self.adb('shell', 'cat', '/sdcard/buildplay-benchmark.xml'))
            for node in root.iter('node'):
                if label in (node.get('content-desc'), node.get('text')):
                    return tuple(map(int, re.findall(r'-?\d+', node.get('bounds'))))
            time.sleep(.3)
        raise RuntimeError(f'Missing on screen: {label}')

    def tap(self, label):
        x, y = center(self.bounds(label))
        self.adb('shell', 'cmd', 'input', 'tap', x, y)

    def record(self, directory, action, command):
        remote = '/sdcard/buildplay-benchmark.mp4'
        video = directory / (action + '.mp4')
        self.adb('shell', 'rm', '-f', remote)
        with subprocess.Popen([*self.command, 'shell', 'screenrecord', '--time-limit', '3', remote]) as recorder:
            time.sleep(.75)
            start, end = map(int, self.adb('shell', f'date +%s%N; cmd input {command}; date +%s%N').split())
            if recorder.wait(timeout=12):
                raise RuntimeError('Screen recording failed')
        self.adb('pull', remote, video)
        raw = video.read_bytes()
        # AOSP Winscope V2 records the monotonic timestamp of each displayed frame
        # and the realtime offset needed to compare with on-device input times.
        marker = raw.index(b'#VV1NSC0PET1ME2#') + 16
        version, offset, count = struct.unpack_from('<IqI', raw, marker)
        if version != 2:
            raise RuntimeError('Unsupported screenrecord timing metadata')
        times = np.frombuffer(raw, '<i8', count, marker + 16) + offset
        with av.open(str(video)) as container:
            frames = [f.to_ndarray(format='rgb24') for f in container.decode(video=0)]
        if len(frames) != count or not np.all(np.diff(times) >= 0) or times[0] >= start:
            raise RuntimeError('Input and recording could not be aligned')
        (directory / (action + '.json')).write_text(json.dumps({'input_ns': [start, end], 'frames_ns': times.tolist()}))
        return (times-start)/1e6, frames, (end-start)/1e6


def center(box):
    return (box[0]+box[2])//2, (box[1]+box[3])//2


def roi(frame, box):
    x, y, right, bottom = box
    return frame[y:bottom:2, x:right:2].astype(np.int16)


def visible_latency(times, frames, box):
    before, after = roi(frames[0], box), roi(frames[-1], box)
    # Restrict to pixels that visibly differ in the stable destination state.
    changed = np.max(np.abs(after-before), axis=2) > 35
    if changed.sum() < 60:
        raise RuntimeError('No substantial visible response')
    span = np.abs(after[changed]-before[changed]).mean()
    return next(t for t, f in zip(times, frames) if t >= 0 and
                np.abs(roi(f, box)[changed]-after[changed]).mean() < span*.5)


def drag_metrics(times, frames, box, duration):
    previous = roi(frames[0], box)
    changes = []
    for t, frame in zip(times, frames):
        if t < 0 or t > duration:
            continue
        current = roi(frame, box)
        if (np.max(np.abs(current-previous), axis=2) > 26).sum() >= 20:
            changes.append(t)
            previous = current
    if len(changes) < 3:
        raise RuntimeError('Too few distinct displayed board states during the swipe')
    # Includes pauses between the first and last visible board updates, including target snapping.
    return {'drag_first_change_ms': changes[0], 'drag_frame_gap_p95_ms': np.percentile(np.diff(changes), 95),
            'drag_distinct_frames': len(changes), 'drag_max_gap_ms': max(np.diff(changes))}


def benchmark(args):
    device = Device(args.serial)
    if device.adb('shell', 'getprop', 'ro.kernel.qemu') != '1':
        raise RuntimeError('Use a disposable emulator')
    device.adb('root')
    device.adb('wait-for-device')
    pose = json.loads((args.fixture / 'pose.json').read_text())
    directory = '/data/user/0/' + args.package + '/files/BuildPlayShared'
    dest = directory + '/' + pose['filename']
    if device.adb('shell', f'test -f {dest} && echo yes || echo no') == 'yes':
        existing = json.loads(json.loads(device.adb('shell', 'cat', dest))['value'])
        if set(existing.get('local', {})) != {pose['id']}:
            raise RuntimeError('The emulator already has unrelated visitor data')
    device.adb('push', args.fixture / pose['filename'], '/data/local/tmp/buildplay-benchmark.json')
    uid = device.adb('shell', 'stat', '-c', '%u:%g', '/data/user/0/' + args.package)
    args.output.mkdir(parents=True, exist_ok=True)
    for sample in range(args.samples):
        result = args.output / str(sample+1)
        result.mkdir()
        device.adb('shell', 'am', 'force-stop', args.package)
        device.adb('shell', 'mkdir', '-p', directory)
        device.adb('shell', 'cp', '/data/local/tmp/buildplay-benchmark.json', dest)
        device.adb('shell', 'chown', uid, directory, dest)
        device.adb('shell', 'restorecon', '-R', directory)
        device.adb('shell', 'am', 'start', '-W', '-n', args.package+'/.MainActivity', '--ez', 'buildplayLocalUiTest', 'true')
        board = device.bounds(BOARD)
        device.bounds(pose['checker'])
        left, top, right, bottom = board
        bounds = pose['bounds']
        scale = min((right-left)/bounds['width'], (bottom-top)/bounds['height'])
        def project(point):
            return (round((left+right)/2 + (point['x']-bounds['x']-bounds['width']/2)*scale),
                    round((top+bottom)/2 + (point['y']-bounds['y']-bounds['height']/2)*scale))
        src = project(pose['source'])
        target = project(pose['destination'])
        # Physical pixels per logical unit in Android's gesture coordinates.
        density = int(re.findall(r'(\d+)', device.adb('shell', 'wm', 'density'))[-1])/160
        lift = round(min(54*density, pose['height']*scale*.6+22*density, (bottom-top)/3))
        row = {}
        for name, label, position in [('report', 'Close dialog', center(device.bounds(REPORT))),
                                      ('select', 'Cancel selection', src)]:
            times, frames, bracket = device.record(result, name, f'tap {position[0]} {position[1]}')
            row[name+'_visible_ms'] = visible_latency(times, frames, board)
            row[name+'_input_bracket_ms'] = bracket
            device.bounds('Screenshot captured before opening this report' if name=='report' else pose['target'])
            device.tap(label)
            time.sleep(.7)
        times, frames, duration = device.record(result, 'drag', f'swipe {src[0]} {src[1]} {target[0]} {target[1]+lift} 850')
        row.update(drag_metrics(times, frames, board, duration))
        match = json.loads(json.loads(device.adb('shell', 'cat', dest))['value'])['local'][pose['id']]
        if (match['move_count'] != pose['moveCount']+1 or match['logicState']['cnt'] != pose['expectedCounts']
                or match['logicState']['owner'] != pose['expectedOwners']):
            raise RuntimeError('Drag did not commit the expected legal move')
        row = {k:round(float(v), 1) for k,v in row.items()}
        (result/'metrics.json').write_text(json.dumps(row, indent=2)+'\n')
        print(sample+1, json.dumps(row), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', required=True)
    parser.add_argument('--package', default='fun.buildplay.debug', type=lambda s:s if re.fullmatch(r'[a-zA-Z][\w.]+',s) else parser.error('Invalid package'))
    parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=5)
    benchmark(parser.parse_args())
