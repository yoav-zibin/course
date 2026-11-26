"""Physical input, AOSP frame timestamps, verified moves and optional Simpleperf stacks."""
import argparse,json,re,subprocess,time
from pathlib import Path
from xml.etree import ElementTree
import numpy as np
from android import Device,BOARD,center
from response_frames import response
from response_store import verify

def control(d,label):
    for i in range(5):
        d.adb('shell','uiautomator dump --compressed /sdcard/buildplay-response.xml >/dev/null')
        tree=ElementTree.fromstring(d.adb('shell','cat','/sdcard/buildplay-response.xml'))
        for n in tree.iter('node'):
            if label in (n.get('content-desc'),n.get('text'),(n.get('resource-id') or '').split('/')[-1]):
                return tuple(map(int,re.findall(r'-?\d+',n.get('bounds'))))
        time.sleep(.3)
    raise RuntimeError('Missing '+label)

def run(args):
    d=Device(args.serial);pkg=args.package
    if d.adb('shell','getprop','ro.kernel.qemu')!='1':raise RuntimeError('Requires a disposable emulator')
    d.adb('root');d.adb('wait-for-device');d.adb('shell','am','force-stop',pkg)
    dims=tuple(map(int,re.findall(r'\d+',d.adb('shell','wm','size').splitlines()[-1])))
    density=int(re.findall(r'\d+',d.adb('shell','wm','density').splitlines()[-1])[-1])/160
    directory='/data/user/0/'+pkg+'/files/BuildPlayShared'
    uid=d.adb('shell','stat','-c','%u:%g','/data/user/0/'+pkg)
    cases=json.loads((args.fixtures/'scenarios.json').read_text())
    args.results.mkdir(parents=True,exist_ok=True)
    all_rows={}
    for case in cases:
        rows=[];folder=args.results/case['id'];folder.mkdir()
        try:
            d.adb('shell','am','force-stop',pkg)
            d.adb('logcat','-c')
            path=directory+'/'+case['filename']
            d.adb('shell','mkdir','-p',directory)
            d.adb('push',args.fixtures/case['id']/case['filename'],path)
            d.adb('shell','chown',uid,directory,path);d.adb('shell','restorecon','-R',directory)
            d.adb('shell','am','start','-W','-n',pkg+'/.MainActivity','--ez','buildplayLocalUiTest','true')
            frame=control(d,BOARD)
            time.sleep(1.3)
            left,top,right,bottom=frame;b=case['bounds'];sc=min((right-left)/b['width'],(bottom-top)/b['height'])
            def project(p):return (round((left+right)/2+(p['x']-b['x']-b['width']/2)*sc),
                                    round((bottom+top)/2+(p['y']-b['y']-b['height']/2)*sc))
            for action in case['actions']:
                p=project(action['at']) if 'at' in action else center(control(d,action['label']))
                if 'to' in action:
                    x,y=project(action['to']);y+=round(min(54*density,action['lift']*sc*.6+22*density,(bottom-top)/3))
                    command=f'swipe {p[0]} {p[1]} {x} {y} 530'
                else:command=f'tap {p[0]} {p[1]}'
                time.sleep(.4)
                if args.profile:
                    pid=d.adb('shell','pidof',pkg);remote='/data/local/tmp/buildplay-samples.data'
                    d.adb('shell','rm','-f',remote)
                    sp=subprocess.Popen([*d.command,'shell','simpleperf','record','-e','cpu-clock','-f','400','--call-graph','dwarf,8192',
                        '-p',pid,'--duration','2','-o',remote],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
                    time.sleep(.28);d.adb('shell','cmd','input',*command.split())
                    _,err=sp.communicate(timeout=12)
                    if sp.returncode:raise RuntimeError('simpleperf: '+err.decode()[-500:])
                    d.adb('pull',remote,folder/(action['id']+'.perf.data'))
                else:
                    times,frames,bracket=d.record(folder,action['id'],command)
                    small=[f[::2,::2] for f in frames]
                    row=response(times,small,0,p,dims)
                    rows.append({'action':action['id'],'point':p,'injection_ms':round(bracket,1),**row})
                    print(case['id'],action['id'],row['first_ms'],flush=True)
                if 'until' in action:control(d,action['until'])
            time.sleep(1.8)
            data=json.loads(json.loads(d.adb('shell','cat',path))['value'])
            proof=verify([case],data)[case['id']]
            (folder/'verified.json').write_text(json.dumps(proof,indent=2))
            all_rows[case['id']]={'actions':rows,'proof':proof}
        except Exception as e:
            all_rows[case['id']]={'actions':rows,'error':str(e)}
            print(case['id'],str(e),flush=True)
            with (folder/'crash.log').open('w') as log:
                for cmd in (('logcat','-b','crash','-d'),('logcat','-d','-s','AndroidRuntime:E','ReactNativeJS:E','libc:F','DEBUG:E'),
                            ('shell','dumpsys','activity','exit-info',pkg)):
                    subprocess.run([*d.command,*cmd],stdout=log,stderr=subprocess.STDOUT,timeout=12)
            try:(folder/'last.xml').write_text(d.adb('shell','cat','/sdcard/buildplay-response.xml'))
            except Exception:pass
        (args.results/'responses.json').write_text(json.dumps(all_rows,indent=2))
    if not all(r.get('proof',{}).get('verified') for r in all_rows.values()):raise RuntimeError('Some scenarios did not verify')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('fixtures',type=Path);p.add_argument('results',type=Path)
    p.add_argument('--serial',required=True);p.add_argument('--package',default='fun.buildplay.debug');p.add_argument('--profile',action='store_true');run(p.parse_args())
