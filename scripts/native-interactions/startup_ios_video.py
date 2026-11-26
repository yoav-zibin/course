"""Measure visible cold launches directly on the iPhone simulator's video clock."""
import argparse
import json
from pathlib import Path
import platform
import plistlib
import shutil
import signal
import subprocess
import time
from urllib.request import Request, urlopen

from PIL import Image

import av
import numpy as np

from startup_frames import opening_bounds

SENDER = 'fun.buildplay.benchmark.linksender'


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


def measure(movie, before, after, bounds, include_first_frame=False):
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
    references=[before[area]]
    for stamp,image in frames(movie):
        # Installing can switch SpringBoard pages between the screenshot and
        # recordVideo. The first recorded frame also precedes app activation.
        if include_first_frame and not samples:references.append(image[area])
        changed=min(np.mean(np.max(abs(image[area]-reference),axis=2)>38) for reference in references)
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
    launch_frames=[i for i in range(painted) if samples[i][1]<.03]
    if not launch_frames:raise ValueError('No recorded launcher frame before the landmark')
    launcher=launch_frames[-1]
    # A fast launch may reach the content in the very first changed frame.
    transition=next((i for i in range(launcher+1,painted) if samples[i][1]>.06 and samples[i+1][1]>.06),painted)
    return {'visible_ms':round(samples[painted][0]-samples[transition][0],1),
            'transition_pts_ms':round(samples[transition][0],1),'landmark_pts_ms':round(samples[painted][0],1)}


def trial(app, bundle, device, directory, index, action, ocr, match_command, sender_stamp=None):
    directory.mkdir(exist_ok=True,parents=True)
    prefix=directory/f'{index}-{action}'
    movie=prefix.with_suffix('.mov')
    before=Path(str(prefix)+'-launcher.png')
    after=Path(str(prefix)+'-content.png')
    subprocess.run(['xcrun','simctl','uninstall',device,bundle],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    sim('install',device,app)
    api('/__reset','POST')
    time.sleep(1.5)
    if not sender_stamp:sim('io',device,'screenshot',before,capture_output=True)
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
            elif sender_stamp:
                sender_stamp.unlink(missing_ok=True)
                sim('launch','--terminate-running-process',device,SENDER,stdout=launch_log,stderr=subprocess.STDOUT)
                deadline=time.monotonic()+100
                while time.monotonic()<deadline:
                    sim('io',device,'screenshot',after,capture_output=True)
                    if sender_stamp.exists() and opening_bounds(next(frames(after))[1]) is not None:
                        time.sleep(.5)
                        break
                    time.sleep(.7)
                else:raise RuntimeError('An ordinary URL open did not display the populated board')
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
        reference=sender_frame=first_marker=last_marker=None
        for stamp,image in frames(movie):
            if sender_stamp:
                r,g,b=image[::8,::8].transpose(2,0,1)
                if first_marker is None and ((r>180)&(g>180)&(b<50)).mean()>.9:first_marker=stamp
                if ((r>180)&(g<50)&(b>180)).mean()>.9:
                    if last_marker is None:last_marker=stamp
                    sender_frame=image
            box=opening_bounds(image)
            if box is not None:reference,bounds=image,box
        if reference is None:raise RuntimeError('No populated Backgammon opening in the verified recording')
        Image.fromarray(reference.astype(np.uint8)).save(after)
        if sender_stamp:
            if sender_frame is None or first_marker is None:raise RuntimeError('Missing the link sender markers in the recording')
            Image.fromarray(sender_frame.astype(np.uint8)).save(before)
    requests=api('/__requests')
    paths={item['path'] for item in requests}
    required={'/games/popular'} if action=='home' else {'/matches/benchmark-opening','/games/5f5293c3-2a3a-4eec-b631-9debf59be0ca/versions/10'}
    if not required<=paths:raise RuntimeError(f'Missing cold-start requests: {required-paths}')
    evidence={'bounds':list(bounds),'requests':requests}
    if sender_stamp:
        timing=json.loads(sender_stamp.read_text())
        evidence['link_sent_epoch_ms']=timing['sent_epoch_ms']
        evidence['link_sent_pts_ms']=last_marker+timing['after_marker_ms']
        evidence['marker_interval_error_ms']=round(last_marker-first_marker-timing['marker_interval_ms'],1)
    prefix.with_suffix('.json').write_text(json.dumps(evidence,indent=2)+'\n')
    output=measure(movie,next(frames(before))[1],next(frames(after))[1],bounds,include_first_frame=not sender_stamp)
    if sender_stamp:
        output['open_url_to_board_ms']=round(output['landmark_pts_ms']-evidence['link_sent_pts_ms'],1)
        if output['open_url_to_board_ms']<=0:raise ValueError('The opening board predates the sender request')
    prefix.with_suffix('.json').write_text(json.dumps({**output,**evidence},indent=2)+'\n')
    print(directory.name,index,action,output,flush=True)
    return output.get('open_url_to_board_ms',output['visible_ms'])


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


def install_sender(scripts, results, device):
    app=results/'LinkSender.app'
    app.mkdir()
    scene={'UISceneDelegateClassName':'LinkSceneDelegate','UISceneConfigurationName':'Link'}
    info={'CFBundleExecutable':'LinkSender','CFBundleIdentifier':SENDER,'CFBundleName':'LinkSender',
          'CFBundlePackageType':'APPL','CFBundleShortVersionString':'1.0','CFBundleVersion':'1',
          'MinimumOSVersion':'17.0','LSRequiresIPhoneOS':True,'UIDeviceFamily':[1,2],'UILaunchScreen':{},
          'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False,
              'UISceneConfigurations':{'UIWindowSceneSessionRoleApplication':[scene]}}}
    (app/'Info.plist').write_bytes(plistlib.dumps(info))
    sdk=subprocess.check_output(['xcrun','--sdk','iphonesimulator','--show-sdk-path'],text=True).strip()
    subprocess.run(['xcrun','--sdk','iphonesimulator','swiftc','-sdk',sdk,'-target',
                    platform.machine()+'-apple-ios17.0-simulator','-parse-as-library','-O',
                    scripts/'LinkSender.swift','-o',app/'LinkSender'],check=True)
    subprocess.run(['codesign','--force','--sign','-',app],check=True)
    sim('install',device,app)
    container=sim('get_app_container',device,SENDER,'data',capture_output=True,text=True).stdout.strip()
    return Path(container)/'Library/Caches/link-sent.json'


def run(apps, fixture, results, device, pairs, sender=False):
    scripts=Path(__file__).resolve().parent
    results.mkdir(parents=True,exist_ok=True)
    ocr=results/'home-title'
    sim('bootstatus',device,'-b')
    sender_stamp=install_sender(scripts,results,device) if sender else None
    match_command=None
    if not sender:
        subprocess.run(['xcrun','swiftc',scripts/'HomeTitle.swift','-o',ocr],check=True)
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
                for action in (('match',) if sender else ('home','match')):
                    row[action+'_ms']=trial(builds[name],bundle,device,results/name,index,action,ocr,match_command,sender_stamp)
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
    parser.add_argument('--sender',action='store_true',help='Open the match from a normal foreground UIKit app')
    args=parser.parse_args()
    run(args.apps,args.fixture,args.results,args.device,args.pairs,args.sender)
