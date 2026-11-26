"""Run physical XCTest actions, record UIKit touch timestamps, video and optional process stacks."""
import argparse,json,platform,shutil,signal,subprocess,time
from pathlib import Path
from response_store import seed,verify
from startup_ios_video import sim

def run(app,fixtures,output,device,profile):
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
    scenarios,key,data=seed(fixtures)
    (project/'InteractionTests/response-cases.json').write_text(json.dumps({'library':str(library.resolve()),'scenarios':scenarios,'profile':profile}))
    subprocess.run(['xcodegen','generate'],cwd=project,check=True)
    sim('bootstatus',device,'-b')
    bundle='edu.columbia.gameportal.starter'
    sim('install',device,app)
    container=Path(sim('get_app_container',device,bundle,'data',capture_output=True,text=True).stdout.strip())
    stores=container/'Library/Application Support/BuildPlayShared';stores.mkdir(parents=True,exist_ok=True)
    store=stores/scenarios[0]['filename']
    store.write_text(json.dumps({'key':key,'value':json.dumps(data)}))
    inputs=container/'Library/Caches/response-input.jsonl'
    inputs.unlink(missing_ok=True)
    build=['xcodebuild','-project',project/'Interactions.xcodeproj','-scheme','Interactions','-configuration','Release',
           '-destination','platform=iOS Simulator,id='+device,'-derivedDataPath',project/'derived','-parallel-testing-enabled','NO']
    with (output/'build.log').open('w') as log:
        subprocess.run([*build,'build-for-testing'],stdout=log,stderr=subprocess.STDOUT,check=True)
    stacks=container/'Library/Caches/response-stacks.jsonl'
    stacks.unlink(missing_ok=True)
    with (output/'recorder.log').open('w') as log:
        movie=output/'responses.mov'
        rec=subprocess.Popen(['xcrun','simctl','io',device,'recordVideo','--codec=h264',movie],stdout=log,stderr=log)
        try:
            time.sleep(1)
            with (output/'responses.log').open('w') as testlog:
                status=subprocess.run([*build,'test-without-building','-only-testing:InteractionTests/ResponseTests','-resultBundlePath',output/'responses.xcresult'],stdout=testlog,stderr=subprocess.STDOUT).returncode
        finally:
            rec.send_signal(signal.SIGINT);rec.wait(timeout=45)
    if inputs.exists():shutil.copy2(inputs,output/'inputs.jsonl')
    if stacks.exists():shutil.copy2(stacks,output/'stacks.jsonl')
    results=verify(scenarios,json.loads(json.loads(store.read_text())['value']))
    (output/'verified.json').write_text(json.dumps(results,indent=2));(output/'scenarios.json').write_text(json.dumps(scenarios))
    if status or not inputs.exists() or not all(i['verified'] for i in results.values()):
        raise RuntimeError('Incomplete response audit; see responses.log, inputs.jsonl and verified.json')

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for k in ['app','fixtures','output']:p.add_argument(k,type=Path)
    p.add_argument('device');p.add_argument('--profile',action='store_true')
    a=p.parse_args();run(a.app,a.fixtures,a.output,a.device,a.profile)
