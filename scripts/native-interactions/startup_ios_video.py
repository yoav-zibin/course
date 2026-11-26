"""Measure visible cold launches directly on the iPhone simulator's video clock."""
import argparse
import json
from pathlib import Path
import shutil
import signal
import subprocess
import time
from urllib.request import Request, urlopen

from PIL import Image

import av
import numpy as np


def sim(*args, **kwargs):
    return subprocess.run(['xcrun','simctl',*map(str,args)],check=True,**kwargs)


def api(path, method='GET'):
    for attempt in range(3):
        try:
            with urlopen(Request('http://127.0.0.1:18764'+path,method=method),timeout=12) as result:
                return json.load(result)
        except OSError:
            if attempt==2:raise
            time.sleep(.2)


def frames(path):
    with av.open(str(path)) as capture:
        for frame in capture.decode(video=0):
            small=frame.reformat(width=320,height=round(320*frame.height/frame.width),format='rgb24')
            yield float((frame.pts or 0)*frame.time_base)*1000,small.to_ndarray().astype(np.int16)


def opening_bounds(image):
    red,green,blue=image.transpose(2,0,1)
    y,x=np.nonzero((red>95)&(red>green+34)&(green>blue+18))
    if len(x)<red.size*.1:
        return None
    h,w=red.shape
    left,right=np.percentile(x,[2,98]).astype(int)
    top,bottom=np.percentile(y,[2,98]).astype(int)
    r,g,b=image[top:bottom,left:right].transpose(2,0,1)
    red_checkers=(r>150)&(g<95)&(r>g+95)&(b<100)
    ivory_checkers=(r>190)&(g>180)&(b>160)&(abs(r-g)<45)&(abs(g-b)<55)
    if red_checkers.mean()<.015 or ivory_checkers.mean()<.015:
        return None
    return left/w,top/h,right/w,bottom/h


def measure(movie, before, after, bounds):
    h,w=after.shape[:2]
    left,top,right,bottom=np.rint(np.array(bounds)*[w,h,w,h]).astype(int)
    rect=np.s_[max(0,top-1):min(h,bottom+1),max(0,left-1):min(w,right+1)]
    final=after[rect]
    edges=(np.max(abs(final[1:,1:]-final[:-1,1:]),axis=2)>25)|(np.max(abs(final[1:,1:]-final[1:,:-1]),axis=2)>25)
    if edges.sum()<20:
        raise ValueError('The final landmark lacks recognizable edges')
    expected=final[1:,1:][edges]
    area=np.s_[h//10:9*h//10:4,::4]
    samples=[]
    for stamp,image in frames(movie):
        changed=np.mean(np.max(abs(image[area]-before[area]),axis=2)>38)
        agreement=np.mean(np.max(abs(image[rect][1:,1:][edges]-expected),axis=1)<46)
        samples.append((stamp,float(changed),float(agreement)))
    # Count the first sustained appearance. XCTest can dismiss its app after
    # the host takes the reference screenshot, leaving a later teardown frame.
    start=None
    for i,(stamp,_,agreement) in enumerate(samples):
        if agreement<.80:
            start=None
        elif start is None:
            start=i
        elif stamp-samples[start][0]>=120:
            break
    if start is None:
        raise ValueError('The verified landmark did not stay visible for 120 ms')
    # A simulator recording can end on a single fully drawn frame, with no
    # duplicate frames emitted while the independently verified image is still.
    painted=start
    # The XCTest URL actuator returns to SpringBoard before opening the link.
    # Ignore any earlier runner-app launch shown in the recording.
    launcher=max(i for i in range(painted) if samples[i][1]<.03)
    transition=next(i for i in range(launcher+1,min(painted+1,len(samples)-1)) if samples[i][1]>.06 and samples[i+1][1]>.06)
    if painted==transition:
        raise ValueError('No distinct launch transition before the landmark')
    return {'visible_ms':round(samples[painted][0]-samples[transition][0],1),
            'transition_pts_ms':round(samples[transition][0],1),'landmark_pts_ms':round(samples[painted][0],1)}


def trial(app, bundle, device, directory, index, action, ocr, match_command):
    directory.mkdir(exist_ok=True,parents=True)
    prefix=directory/f'{index}-{action}'
    movie=prefix.with_suffix('.mov')
    before=Path(str(prefix)+'-launcher.png')
    after=Path(str(prefix)+'-content.png')
    subprocess.run(['xcrun','simctl','uninstall',device,bundle],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    sim('install',device,app)
    api('/__reset','POST')
    time.sleep(1.5)
    sim('io',device,'screenshot',before,capture_output=True)
    with prefix.with_suffix('.log').open('w') as log, Path(str(prefix)+'-launch.log').open('w') as launch_log:
        recorder=subprocess.Popen(['xcrun','simctl','io',device,'recordVideo','--codec=h264',str(movie)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        try:
            for line in recorder.stdout:
                log.write(line)
                if 'Recording started' in line:break
            if recorder.poll() is not None:raise RuntimeError('Simulator recorder did not start')
            time.sleep(.7)
            if action=='home':
                sim('launch',device,bundle)
                deadline=time.monotonic()+60
                while True:
                    sim('io',device,'screenshot',after,capture_output=True)
                    result=subprocess.run([ocr,after],capture_output=True,text=True)
                    if result.returncode==0:
                        bounds=list(map(float,result.stdout.split()))
                        break
                    if time.monotonic()>=deadline:raise RuntimeError('The home title never appeared')
                    time.sleep(.5)
                time.sleep(.5)
            else:
                # Keep recording through the actual XCTest launch, including a
                # slow runner startup. Its screenshot independently verifies the
                # wood and both checker colors before the test returns.
                subprocess.run([*match_command,'-resultBundlePath',prefix.with_suffix('.xcresult')],
                               stdout=launch_log,stderr=subprocess.STDOUT,check=True)
        finally:
            if recorder.poll() is None:recorder.send_signal(signal.SIGINT)
            output,_=recorder.communicate(timeout=60)
            log.write(output)
    if recorder.returncode not in (0,-signal.SIGINT,130) or not movie.exists():raise RuntimeError('Simulator recorder failed')
    if action=='match':
        # XCTest may leave the app after verifying the opening. Find its last
        # populated frame in the movie and retain that exact comparison image.
        reference=None
        for _,image in frames(movie):
            box=opening_bounds(image)
            if box is not None:reference,bounds=image,box
        if reference is None:raise RuntimeError('No populated Backgammon opening in the verified recording')
        Image.fromarray(reference.astype(np.uint8)).save(after)
    requests=api('/__requests')
    paths={item['path'] for item in requests}
    required={'/games/popular'} if action=='home' else {'/matches/benchmark-opening','/games/5f5293c3-2a3a-4eec-b631-9debf59be0ca/versions/10'}
    if not required<=paths:raise RuntimeError(f'Missing cold-start requests: {required-paths}')
    evidence={'bounds':list(bounds),'requests':requests}
    prefix.with_suffix('.json').write_text(json.dumps(evidence,indent=2)+'\n')
    output=measure(movie,next(frames(before))[1],next(frames(after))[1],bounds)
    prefix.with_suffix('.json').write_text(json.dumps({**output,**evidence},indent=2)+'\n')
    print(directory.name,index,action,output,flush=True)
    return output['visible_ms']


def match_launcher(scripts, results, device):
    project=results/'project'
    project.mkdir()
    shutil.copy2(scripts/'project.yml',project/'project.yml')
    shutil.copytree(scripts/'InteractionTests',project/'InteractionTests')
    subprocess.run(['xcodegen','generate'],cwd=project,check=True)
    build=['xcodebuild','-project',project/'Interactions.xcodeproj','-scheme','Interactions',
           '-configuration','Release','-destination','platform=iOS Simulator,id='+device,
           '-derivedDataPath',project/'derived','-parallel-testing-enabled','NO']
    with (project/'build.log').open('w') as log:subprocess.run([*build,'build-for-testing'],stdout=log,check=True)
    return [*build,'test-without-building','-only-testing:InteractionTests/StartupTests/testOpenMatchForVideo']


def run(apps, fixture, results, device, pairs):
    scripts=Path(__file__).resolve().parent
    results.mkdir(parents=True,exist_ok=True)
    ocr=results/'home-title'
    subprocess.run(['xcrun','swiftc',scripts/'HomeTitle.swift','-o',ocr],check=True)
    sim('bootstatus',device,'-b')
    match_command=match_launcher(scripts,results,device)
    builds={p.parent.name:p for p in apps.glob('*/BuildPlay.app')}
    names=['baseline','current'] if 'baseline' in builds else ['current']
    bundle=subprocess.check_output(['/usr/libexec/PlistBuddy','-c','Print CFBundleIdentifier',builds['current']/'Info.plist'],text=True).strip()
    samples={name:[] for name in names}
    server=subprocess.Popen(['python3',scripts/'startup_fixture.py',fixture])
    try:
        for _ in range(30):
            try:api('/__requests');break
            except OSError:time.sleep(.2)
        for index in range(1,pairs+1):
            for name in names if index%2 else reversed(names):
                row={}
                for action in ('home','match'):
                    row[action+'_ms']=trial(builds[name],bundle,device,results/name,index,action,ocr,match_command)
                samples[name].append(row)
                (results/name/'startup-video.json').write_text(json.dumps(samples[name],indent=2)+'\n')
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apps',type=Path)
    parser.add_argument('fixture',type=Path)
    parser.add_argument('results',type=Path)
    parser.add_argument('device')
    parser.add_argument('--pairs',type=int,choices=range(1,6),default=5)
    args=parser.parse_args()
    run(args.apps,args.fixture,args.results,args.device,args.pairs)
