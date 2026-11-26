"""Run physical XCTest actions, record UIKit touch timestamps, video and optional process stacks."""
import argparse,json,platform,shutil,signal,subprocess,sys,time
from contextlib import nullcontext
from urllib.request import Request,urlopen
from pathlib import Path
from response_store import seed,verify
from ios_instruments import capture
from startup_ios_video import sim

def run(app,fixtures,output,device,profile,fresh=False,checker_pair=False,rapid=False,instruments=False):
    scripts=Path(__file__).resolve().parent
    output.mkdir(parents=True,exist_ok=True)
    project=output/'project'
    project.mkdir()
    shutil.copy2(scripts/'project.yml',project)
    shutil.copytree(scripts/'InteractionTests',project/'InteractionTests')
    library=project/'ResponseClock.dylib'
    sdk=subprocess.check_output(['xcrun','--sdk','iphonesimulator','--show-sdk-path'],text=True).strip()
    subprocess.run(['xcrun','clang','-isysroot',sdk,'-target',platform.machine()+'-apple-ios17.0-simulator','-dynamiclib',
        '-fobjc-arc','-framework','UIKit','-framework','QuartzCore','-framework','CoreGraphics','-framework','Foundation',scripts/'ResponseClock.m',scripts/'ResponseSamples.m','-o',library],check=True)
    subprocess.run(['codesign','-s','-','--force',library],check=True)
    scenarios,key,data=seed(fixtures,'backgammon-pass-midgame' if checker_pair else None)
    if instruments:
        case=scenarios[0];match=data['local'][case['match']]
        case['match']='benchmark-cloud-checkers-'+output.name
        match.update(id=case['match'],owner_user_id='benchmark-player',match_kind='pass_and_play',
                     cloud_revision=1,local_revision=1,synced_local_revision=1,cloud_pending=False)
        match['players'][0]['user_id']='benchmark-player'
        game=next(iter(data['responses'].values()))
        with urlopen(Request('http://localhost:18764/__seed',data=json.dumps({'game':game,'match':match}).encode(),method='POST'),timeout=10):pass
    (project/'InteractionTests/response-cases.json').write_text(json.dumps({'library':str(library.resolve()),'scenarios':scenarios,'profile':profile,'rapid':rapid,'instruments':instruments}))
    subprocess.run(['xcodegen','generate'],cwd=project,check=True)
    sim('bootstatus',device,'-b')
    bundle='edu.columbia.gameportal.starter'
    sim('install',device,app)
    container=Path(sim('get_app_container',device,bundle,'data',capture_output=True,text=True).stdout.strip())
    stores=container/'Library/Application Support/BuildPlayShared';stores.mkdir(parents=True,exist_ok=True)
    store=stores/scenarios[0]['filename']
    if not fresh and not instruments:store.write_text(json.dumps({'key':key,'value':json.dumps(data)}))
    inputs=container/'Library/Caches/response-input.jsonl'
    inputs.unlink(missing_ok=True)
    build=['xcodebuild','-project',project/'Interactions.xcodeproj','-scheme','Interactions','-configuration','Release',
           '-destination','platform=iOS Simulator,id='+device,'-derivedDataPath',project/'derived','-parallel-testing-enabled','NO']
    with (output/'build.log').open('w') as log:
        subprocess.run([*build,'build-for-testing'],stdout=log,stderr=subprocess.STDOUT,check=True)
    stacks=container/'Library/Caches/response-stacks.jsonl'
    stacks.unlink(missing_ok=True)
    suite='FreshGameResponseTests' if fresh else ('ResponseTests/testMidgamePair' if checker_pair else 'ResponseTests')
    with (output/'recorder.log').open('w') as log:
        movie=output/'responses.mov'
        rec=subprocess.Popen(['xcrun','simctl','io',device,'recordVideo','--codec=h264',movie],stdout=log,stderr=log)
        try:
            time.sleep(1)
            with (output/'responses.log').open('w') as testlog, (capture(output,device,inputs) if instruments else nullcontext()):
                status=subprocess.run([*build,'test-without-building','-only-testing:InteractionTests/'+suite,'-resultBundlePath',output/'responses.xcresult'],stdout=testlog,stderr=subprocess.STDOUT).returncode
        finally:
            rec.send_signal(signal.SIGINT);rec.wait(timeout=45)
    if inputs.exists():shutil.copy2(inputs,output/'inputs.jsonl')
    if stacks.exists():shutil.copy2(stacks,output/'stacks.jsonl')
    if fresh:
        matches={}
        for item in stores.glob('*.json'):
            envelope=json.loads(item.read_text())
            if envelope['key'].startswith('buildplay.shared.v1.'):
                matches.update(json.loads(envelope['value']).get('local',{}))
        results={'guest':{'verified':bool(matches)}}
        for slug,game_id in [('connect4','e299b14e-480d-44f3-8132-74282a46cebc'),('backgammon','5f5293c3-2a3a-4eec-b631-9debf59be0ca')]:
            for mode in ('pass_and_play','computer'):
                m=next((m for m in matches.values() if m['game_id']==game_id and m['match_kind']==mode),None)
                results[slug+'-'+mode]={'verified':m is not None,'mode':mode,'version':m and m['game_version']}
    elif instruments:
        signed={};stages=[]
        for item in stores.glob('*.json'):
            envelope=json.loads(item.read_text())
            if envelope['key']=='buildplay.test.checker-timing':stages=json.loads(envelope['value'])
            if envelope['key'].startswith('buildplay.shared.v1.') and envelope['key'].endswith('.benchmark-player'):
                signed=json.loads(envelope['value'])
        results=verify(scenarios,signed)
        (output/'checker-stages.json').write_text(json.dumps(stages,indent=2))
        with urlopen('http://localhost:18764/__saves') as f:remote=next((m for m in json.load(f) if m['id']==case['match']),{})
        with urlopen('http://localhost:18764/__requests') as f:requests=json.load(f)
        (output/'checker-cloud.json').write_text(json.dumps({'save':remote,'requests':requests,'delay_ms':200},indent=2))
        results[case['id']]['cloudMoveCount']=remote.get('move_count')
        results[case['id']]['verified'] &= bool(stages) and remote.get('move_count')==case['moveCount']+len(case['expectedMoves'])
    else:results=verify(scenarios,json.loads(json.loads(store.read_text())['value']))
    (output/'verified.json').write_text(json.dumps(results,indent=2));(output/'scenarios.json').write_text(json.dumps(scenarios))
    if rapid and inputs.exists():
        events=[json.loads(line) for line in inputs.read_text().splitlines()]
        contacts=[e for e in events if e.get('phase') in (0,3,4)]
        phases=[e['phase'] for e in contacts]
        gap=round(contacts[2]['t']-contacts[1]['t'],1) if phases==[0,3,0,3] else None
        (output/'rapid.json').write_text(json.dumps({'requested_gap_ms':60,'ui_release_to_next_down_ms':gap,'phases':phases},indent=2))
        if gap is None or not 0<=gap<=100:raise RuntimeError('UIKit did not deliver two drags within 100 ms; see rapid.json')
    if status or not inputs.exists() or not all(i['verified'] for i in results.values()):
        raise RuntimeError('Incomplete response audit; see responses.log, inputs.jsonl and verified.json')

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for k in ['app','fixtures','output']:p.add_argument(k,type=Path)
    p.add_argument('device');p.add_argument('--profile',action='store_true')
    p.add_argument('--checker-pair',action='store_true')
    p.add_argument('--rapid',action='store_true')
    p.add_argument('--fresh',type=Path,help='Cold-start fixture directory for signed-in game creation')
    p.add_argument('--instruments',type=Path,help='Fixture API directory for a signed-in Time Profiler replay')
    a=p.parse_args();server=None
    try:
        if a.fresh or a.instruments:
            server=subprocess.Popen([sys.executable,Path(__file__).with_name('startup_fixture.py'),a.fresh or a.instruments])
            for _ in range(50):
                try:
                    with urlopen('http://localhost:18764/__requests',timeout=2):break
                except OSError:time.sleep(.15)
            _,_,catalog=seed(a.fixtures)
            for g in catalog['responses'].values():
                with urlopen(Request('http://localhost:18764/__seed',data=json.dumps({'game':g}).encode(),method='POST'),timeout=5):pass
        run(a.app,a.fixtures,a.output,a.device,a.profile,bool(a.fresh),a.checker_pair or a.rapid or bool(a.instruments),a.rapid,bool(a.instruments))
    finally:
        if server:server.terminate();server.wait(timeout=10)
