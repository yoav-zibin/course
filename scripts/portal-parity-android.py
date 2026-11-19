#!/usr/bin/env python3
"""Drive a disposable Android emulator with the common offline parity fixture.

Only initial fixture installation writes the app sandbox. Every game action
afterwards is a physical UI touch; state evidence is read from atomic files.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

ROOT=Path(__file__).resolve().parents[1]
SOURCE='600e8e35ab3d7338055e4f28eaa3d165be4bdba2'
PACKAGE='com.dapillah.gameportal.debug'
KEY='buildplay.shared.v1.visitor'
DATA=f'/data/user/0/{PACKAGE}/files/BuildPlayShared'
spec=importlib.util.spec_from_file_location('parity_native_smoke',ROOT/'frontends/portal/scripts/native-smoke.py')
smoke=importlib.util.module_from_spec(spec);spec.loader.exec_module(smoke)

class Audit(smoke.NativeSmoke):
    def __init__(self,args):
        os.environ['ANDROID_SERIAL']=args.serial
        super().__init__(PACKAGE,args.output,args.adb)
        self.common=json.loads(args.fixture.read_text())
        previous=self.output/'native-gameplay.json'
        if previous.exists():self.events=json.loads(previous.read_text()).get('events',[])
        if self.common['sourceSha']!=SOURCE:raise ValueError('This audit requires the exact600 source fixture')
        if self.command('shell','getprop','ro.kernel.qemu')!='1':raise ValueError('Refusing to audit a physical/personal device')
        avd=self.command('emu','avd','name').splitlines()[0]
        if not avd.startswith('buildplay-parity-600-'):raise ValueError('Refusing to seed an emulator outside this isolated audit')
        (self.output/'audit-metadata.json').write_text(json.dumps({'sourceSha':SOURCE,'fixtureSha256':hashlib.sha256(args.fixture.read_bytes()).hexdigest(),'package':PACKAGE,'serial':args.serial,'avd':avd,'physicalViewport':[self.width,self.height],'density':self.command('shell','wm','density'),'api':self.command('shell','getprop','ro.build.version.sdk'),'network':'radios disabled; local-only launch intent'},indent=2))
        self.game=None

    def saved(self):
        envelope=json.loads(self.command('shell','cat',f'{DATA}/{hashlib.sha256(KEY.encode()).hexdigest()}.json'))
        if envelope.get('key')!=KEY:raise ValueError('Wrong persistent storage envelope')
        return json.loads(envelope['value'])

    def seed(self):
        self.command('shell','am','force-stop',PACKAGE)
        owner=self.command('shell','stat','-c','%u:%g',f'/data/user/0/{PACKAGE}')
        if not re.fullmatch(r'\d+:\d+',owner):raise ValueError('App sandbox owner could not be resolved')
        self.command('shell','mkdir','-p',DATA)
        with tempfile.TemporaryDirectory(prefix='buildplay-parity-android-') as temporary:
            for key,value in self.common['storage'].items():
                if key!=KEY or not isinstance(value,str):raise ValueError('Only signed-out visitor fixture data is permitted')
                name=hashlib.sha256(key.encode()).hexdigest()+'.json'
                source=Path(temporary)/name;source.write_text(json.dumps({'key':key,'value':value},ensure_ascii=False))
                staging=f'/data/local/tmp/parity-{name}'
                self.command('push',str(source),staging)
                self.command('shell','cp',staging,f'{DATA}/{name}')
                self.command('shell','chown',owner,f'{DATA}/{name}')
                self.command('shell','chmod','600',f'{DATA}/{name}')
                self.command('shell','rm',staging)
        self.command('shell','chown',owner,DATA)
        self.command('shell','restorecon','-R',DATA)
        if self.saved()!=self.common['accountData']:raise ValueError('Initial fixture copy differs')
        self.events.append({'assertion':'initial-signed-out-fixture-seeded','source':SOURCE})
        self.launch();self.wait('Log in',timeout=60)

    def top(self):
        for _ in range(4):self.scroll(upwards=False)

    def pages(self):
        self.tap('Games');self.top();self.capture('page-catalog')
        self.tap('Matches');self.top();self.wait('Log in to see your matches');self.capture('page-matches')
        self.tap('On this device');self.top();self.wait('Practice with a computer');self.capture('page-local')
        self.tap('Preferences');self.top();self.wait('Navigation layout');self.capture('page-preferences')
        self.tap('Log in',scroll=False);self.wait('Welcome to BuildPlay');self.capture('page-account');self.tap('Close dialog',scroll=False)

    def open_game(self,slug):
        self.game=next(game for game in self.common['games'] if game['slug']==slug)
        if self.find(self.dump(),'Exit focus mode') is not None:self.tap('Exit focus mode',scroll=False)
        self.tap('On this device');self.top();self.tap(self.game['name'],contains=False)
        self.wait('Focus mode',timeout=60)
        package=self.common['accountData']['responses'][f"/games/{self.game['gameId']}/versions/{self.game['gameVersion']}"]
        self.fixture=package['declarative_ui']
        self.tap('Focus mode',scroll=False)
        self.fitted_canvas()

    def settled(self,scene):
        # Persisted computer moves precede the reducer/animation presentation.
        # Wait for that playback and then require the final legal target labels.
        time.sleep(3)
        expected={smoke.normalized(target.get('aria_label') or target.get('label') or '') for target in scene.get('targets',[]) }-{''}
        deadline=time.monotonic()+30
        previous=None
        while time.monotonic()<deadline:
            tree,canvas=self.fitted_canvas();labels={label for node in tree.iter('node') for label in self.labels(node)}
            observed=sorted((node.get('content-desc',''),node.get('bounds','')) for node in tree.iter('node') if node.get('class','').startswith('com.horcrux.svg.'))
            if expected<=labels and observed==previous:
                self.events.append({'assertion':'final-native-scene-settled','canvas':canvas,'expectedTargets':sorted(expected),'svgNodes':observed})
                return
            previous=observed;time.sleep(.7)
        raise RuntimeError('The final scene legal labels/hierarchy did not settle')

    def state(self,stage,expected):
        deadline=time.monotonic()+30;actual=None
        while time.monotonic()<deadline:
            data=self.saved();actual=data['local'].get(self.game['matchId'])
            if actual==expected:break
            time.sleep(.4)
        (self.output/f'{stage}-state.json').write_text(json.dumps({'sourceSha':SOURCE,'match':actual,'selectedId':data.get('selectedId')},indent=2))
        (self.output/f'{stage}-match.json').write_text(json.dumps(actual,indent=2))
        if actual!=expected:
            fields=sorted(key for key in set(actual or {})|set(expected) if (actual or {}).get(key)!=expected.get(key))
            raise RuntimeError(f'{stage} differs from common expected state: {fields}')
        self.events.append({'assertion':'persisted-match-equals-common','stage':stage,'moveCount':actual['move_count'],'turn':actual['turn_of_player_indices']})

    def action(self,action):
        tree,canvas=self.fitted_canvas()
        node=self.find(tree,action['label'])
        if node is None:node=self.wait(action['label'],timeout=25)
        rect=smoke.bounds(node)
        visible=smoke.intersection(rect,canvas,(0,0,self.width,self.height)) if rect else None
        if not visible:raise RuntimeError(f"Native action {action['label']} has no visible physical target")
        left,top,right,bottom=visible;x=(left+right)//2;y=(top+bottom)//2
        self.command('shell','input','tap',str(x),str(y))
        self.events.append({'action':'physical-native-touch','label':action['label'],'x':x,'y':y,'targetBounds':rect,'canvas':canvas})
        time.sleep(.6)

    def play(self,slug):
        self.open_game(slug)
        self.state(f'{slug}-initial',self.game['initial']);self.settled(self.game['initialScene']);self.capture(f'{slug}-initial')
        for step in self.game['steps']:
            for action in step['uiActions']:self.action(action)
            stage=f"{slug}-step{step['number']}"
            self.state(stage,step['expectedMatch']);self.settled(step['scene']);self.capture(stage)
        self.command('shell','am','force-stop',PACKAGE);self.launch();self.wait('Focus mode',timeout=60);self.tap('Focus mode',scroll=False)
        self.state(f'{slug}-restart',self.game['steps'][-1]['expectedMatch']);self.settled(self.game['steps'][-1]['scene']);self.capture(f'{slug}-restart')
        if self.saved().get('selectedId')!=self.game['matchId']:raise RuntimeError('Restart did not retain the selected match')
        self.events.append({'assertion':'restart-restores-computer-match','game':slug})

    def fresh(self):
        if self.find(self.dump(),'Exit focus mode') is not None:self.tap('Exit focus mode',scroll=False)
        self.tap('Games');self.top();self.tap('Tic-tac-toe');self.tap('Your seat against computers: Player 2');before=set(self.saved()['local']);self.tap('Practice with computers');self.wait('Focus mode',timeout=60)
        data=self.saved();new=set(data['local'])-before
        if len(new)!=1:raise RuntimeError('Practice button did not create one real match')
        match=data['local'][new.pop()]
        if [player['kind'] for player in match['players']]!=['computer','human'] or match['move_count']!=1 or match['turn_of_player_indices']!=[1]:raise RuntimeError('Practice did not let computer seat0 open before human seat1')
        self.tap('Focus mode',scroll=False);self.fixture=self.common['accountData']['responses']['/games/bundled-tictactoe/versions/1']['declarative_ui'];self.fitted_canvas();self.capture('fresh-practice')
        (self.output/'fresh-practice-state.json').write_text(json.dumps(match,indent=2))
        self.events.append({'assertion':'fresh-real-practice-button-computer-opens-human-seat1','matchId':match['id']})
        legal=match['state'].get('legal',[])
        if not legal:raise RuntimeError('Fresh human seat1 has no visible legal actions')
        self.action({'label':f"Cell {legal[0]['cell']+1}"})
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            next_match=self.saved()['local'][match['id']]
            if next_match['move_count']==3 and next_match['turn_of_player_indices']==[1]:break
            time.sleep(.4)
        else:raise RuntimeError('Fresh human action did not produce the next computer turn')
        self.settled({'targets':[{'label':f"Cell {move['cell']+1}"} for move in next_match['state']['legal']]})
        self.capture('fresh-practice-step1');(self.output/'fresh-practice-step1-match.json').write_text(json.dumps(next_match,indent=2))
        self.events.append({'assertion':'fresh-human-seat1-physical-move-and-computer-reply','moveCount':3,'actors':[move['player_index'] for move in next_match['moves']]})

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=['seed','pages','game','fresh','all']);parser.add_argument('--game',choices=['tictactoe','connect4','checkers'])
    parser.add_argument('--serial',default='emulator-5572');parser.add_argument('--adb',default=str(Path(os.environ.get('ANDROID_HOME','/home/yoav_zibin/.local/share/buildplay-mobile/android-sdk'))/'platform-tools/adb'))
    parser.add_argument('--fixture',type=Path,default=ROOT/'tests/fixtures/portal-parity/common.json');parser.add_argument('--output',type=Path,default=Path('/tmp/buildplay-parity-600/android'))
    args=parser.parse_args();audit=Audit(args)
    try:
        if args.mode in ('seed','all'):audit.seed()
        if args.mode in ('pages','all'):audit.pages()
        if args.mode=='game':audit.play(args.game)
        if args.mode=='all':
            for game in audit.common['games']:audit.play(game['slug'])
        if args.mode in ('fresh','all'):audit.fresh()
        audit.capture('audit-complete');print('Android parity audit passed:',args.mode,flush=True)
    except Exception as error:
        audit.events.append({'failure':str(error)});audit.capture('audit-failure');raise

if __name__=='__main__':main()
