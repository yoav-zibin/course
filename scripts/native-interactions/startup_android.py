"""Measure cold native launch and Backgammon loading on the disposable Android fixture."""
import argparse
import json
from pathlib import Path
import re
import time
from urllib.request import Request, urlopen
from xml.etree import ElementTree

import numpy as np

from android import BOARD, Device, center


PACKAGE = 'fun.buildplay.debug'
SERVER = 'http://127.0.0.1:18764'
MAIN = PACKAGE+'/.MainActivity'
GAME_ID = '5f5293c3-2a3a-4eec-b631-9debf59be0ca'


def first_paint(times, frames, bounds):
    # Match the high-contrast edges of the final label or board. A splash
    # matching the page's background color must not count as usable content.
    left, top, right, bottom = bounds
    def crop(frame):
        return frame[top:bottom:2,left:right:2].astype(np.int16)
    target = crop(frames[-1])
    edges = np.max(abs(target[1:,1:]-target[:-1,1:]),axis=2)>26
    edges |= np.max(abs(target[1:,1:]-target[1:,:-1]),axis=2)>26
    if edges.sum()<18:
        raise RuntimeError('The final visual target has too few edges')
    expected = target[1:,1:][edges]
    def matches(frame):
        difference = np.max(abs(crop(frame)[1:,1:][edges]-expected),axis=1)
        return np.mean(difference<42)>.76
    if matches(frames[0]):
        raise RuntimeError('The target was already on screen before input')
    return round(float(next(t for t,f in zip(times,frames) if t>=0 and matches(f))),1)


def find_control(device, label, scroll=False, editable=False):
    for _ in range(10):
        device.adb('shell','uiautomator dump --compressed /sdcard/buildplay-startup.xml >/dev/null')
        nodes = ElementTree.fromstring(device.adb('shell','cat','/sdcard/buildplay-startup.xml')).iter('node')
        candidates = [n for n in nodes if label in (n.get('text'),n.get('content-desc'))]
        if editable:
            candidates = [n for n in candidates if n.get('editable')=='true' or n.get('focusable')=='true']
        candidates.sort(key=lambda n:n.get('clickable')!='true')
        for candidate in candidates:
            box=tuple(map(int,re.findall(r'-?\d+',candidate.get('bounds'))))
            if box[0]<box[2] and box[1]<box[3]:
                return box
        if scroll:
            device.adb('shell','cmd','input','swipe',225,686,225,264,330)
        time.sleep(.2)
    raise RuntimeError('Missing fixture control '+label)


def press(device, label, **options):
    device.adb('shell','cmd','input','tap',*center(find_control(device,label,**options)))


def run(device, scenario, dest):
    dest.mkdir(parents=True)
    device.adb('shell','pm','clear',PACKAGE)
    device.adb('shell','am','start','-a','android.intent.action.MAIN','-c','android.intent.category.HOME')
    time.sleep(.4)
    with urlopen(Request(SERVER+'/__reset',method='POST'), timeout=5):
        pass
    row = {}
    if scenario in ('home','match'):
        launch = 'am start -W -n '+MAIN
        if scenario=='match':
            launch += " -a android.intent.action.VIEW -d 'buildplay:///#match=benchmark-opening'"
        times,frames,_ = device.record_shell(dest,scenario,launch,seconds=7)
        activity = (dest/(scenario+'.txt')).read_text()
        if 'LaunchState: COLD' not in activity:
            raise RuntimeError(activity)
        row['first_activity_ms'] = int(re.search(r'TotalTime: (\d+)',activity)[1])
        if scenario=='home':
            row['home_visible_ms'] = first_paint(times,frames,device.bounds('Let’s play.'))
            row['catalog_visible_ms'] = first_paint(times,frames,device.bounds('Play Backgammon'))
        else:
            board = device.bounds(BOARD)
            row['board_visible_ms'] = first_paint(times,frames,board)
    else:
        device.adb('shell','am','start','-W','-n',MAIN)
        press(device,'Log in / continue as guest')
        press(device,'Guest')
        press(device,'Your name',editable=True)
        device.adb('shell','cmd','input','text','Benchmark')
        device.adb('shell','cmd','input','keyevent','KEYCODE_BACK')
        press(device,'Continue as guest')
        x,y = center(find_control(device,'Play Backgammon',scroll=True))
        times,frames,_ = device.record_shell(dest,'details',f'cmd input tap {x} {y}',seconds=4)
        row['game_details_visible_ms'] = first_paint(times,frames,device.bounds('How would you like to play?'))
        x,y = center(find_control(device,'Pass and play',scroll=True))
        times,frames,_ = device.record_shell(dest,'new',f'cmd input tap {x} {y}',seconds=6)
        row['board_visible_ms'] = first_paint(times,frames,device.bounds(BOARD))
        press(device,'Start game: Select')
        for _ in range(24):
            with urlopen(SERVER+'/__saves',timeout=5) as response:
                saves=json.load(response)
            if len(saves)==1 and saves[0]['game_id']==GAME_ID and saves[0]['move_count']==1 and saves[0]['opening']:
                break
            time.sleep(.25)
        else:
            raise RuntimeError('The new Backgammon board did not accept its first action')
    with urlopen(SERVER+'/__requests', timeout=5) as response:
        requests = json.load(response)
    paths = [r['path'] for r in requests]
    if scenario=='match' and not {'/matches/benchmark-opening',f'/games/{GAME_ID}/versions/10'}<=set(paths):
        raise RuntimeError('The match or its pinned package did not load over the fixture network')
    if scenario=='new' and ('/users' not in paths or f'/games/{GAME_ID}' not in paths):
        raise RuntimeError('The empty account or downloaded game was missing')
    (dest/'requests.json').write_text(json.dumps(requests,indent=2)+'\n')
    (dest/'metrics.json').write_text(json.dumps(row,indent=2)+'\n')
    print(scenario,row,flush=True)


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial',required=True)
    parser.add_argument('--scenario',choices=['home','match','new'],required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--samples',type=int,default=5)
    parser.add_argument('--reset-test-app',action='store_true',required=True,help='Erase the disposable fixture app before each sample')
    args = parser.parse_args()
    device = Device(args.serial)
    if device.adb('shell','getprop','ro.kernel.qemu')!='1':
        raise RuntimeError('Use a disposable emulator with the loopback fixture build')
    for index in range(1,args.samples+1):
        run(device,args.scenario,args.output/str(index))
