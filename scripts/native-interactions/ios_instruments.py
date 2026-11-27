"""Record a warm simulator process while XCTest replays the two checker drags."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler,HTTPServer
from pathlib import Path
import json,os,signal,subprocess,threading,time
import xml.etree.ElementTree as ET
from response_profiles import apple_sample_stacks

def capture(output,device,inputs):
    logs=(output/'instruments.log').open('w',buffering=1)
    started=[];samples=[];trace=None;pid=None
    # Discovery starts the Instruments services while XCTest opens the board.
    warmup=subprocess.Popen(['xcrun','xctrace','list','devices'],stdout=logs,stderr=logs)
    def start():
        nonlocal trace,pid
        entries=[json.loads(line) for line in inputs.read_text().splitlines()]
        pid=next(e['pid'] for e in reversed(entries) if 'width' in e)
        # Sample all processes on the host Mac. Hosted simulator runtimes can
        # lack the os_log source required by the Time Profiler template.
        # The app PID from UIKit selects its own stacks in the recording.
        for target,flags in [('host',[]),('simulator',['--device',device])]:
            path=output/(target+'-checker.trace');notification=f'fun.buildplay.trace.{os.getpid()}.{target}'
            notified=subprocess.Popen(['notifyutil','-1',notification],stdout=logs,stderr=logs)
            try:
                print('Starting Time Profiler on '+target,flush=True,file=logs)
                trace=subprocess.Popen(['xcrun','xctrace','record','--template','Time Profiler',*flags,'--all-processes',
                    '--output',str(path),'--time-limit','100s','--no-prompt','--notify-tracing-started',notification],stdout=logs,stderr=logs)
                end=time.monotonic()+(65 if target=='host' else 35)
                while time.monotonic()<end and trace.poll() is None and notified.poll() is None:time.sleep(.1)
                if trace.poll() is None or path.exists():
                    mode='notification' if notified.poll()==0 else 'scheduled replay without notification'
                    started.append({'target':target,'pid':pid,'ready_by':mode,'ready_wall_ms':time.time()*1000,'path':path.name})
                    print('Starting gestures: '+mode,flush=True,file=logs)
                    break
                print(f'{target} recorder exited with {trace.returncode}',flush=True,file=logs)
                trace=None
            finally:
                if notified.poll() is None:notified.terminate()
                notified.wait()
        # Start the independent host process sample on finger-down. Startup of
        # the sampler itself can cost hundreds of milliseconds on a busy runner.
        def sample_contacts():
            seen=set();deadline=time.monotonic()+95
            while len(seen)<2 and time.monotonic()<deadline:
                for line in inputs.read_text().splitlines():
                    try:e=json.loads(line)
                    except ValueError:continue
                    if e.get('phase')!=0 or e['pid']!=pid or e['t'] in seen or e['t']<=touch_threshold:continue
                    seen.add(e['t']);name=f'checker-{len(seen)}.sample.txt'
                    p=subprocess.Popen(['/usr/bin/sample',str(pid),'2','1','-file',str(output/name)],stdout=logs,stderr=logs)
                    samples.append((p,{'file':name,'trigger':'down','duration_s':2,'touch_wall_ms':e['wall'],'sample_requested_wall_ms':time.time()*1000}))
                time.sleep(.008)
        touch_threshold=max((e['t'] for e in entries if 't' in e),default=0)
        threading.Thread(target=sample_contacts,daemon=True).start()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            if self.path!='/ready':return self.send_error(404)
            try:start()
            except Exception as e:
                print(str(e),file=logs);return self.send_error(500)
            self.send_response(200);self.send_header('Content-Length','0');self.end_headers()
    server=HTTPServer(('127.0.0.1',18766),Handler)
    @contextmanager
    def session():
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        try:yield server.server_address[1]
        finally:
            server.shutdown();server.server_close();worker.join()
            if warmup.poll() is None:warmup.terminate()
            warmup.wait()
            if trace and trace.poll() is None and started and started[0]['ready_by']=='notification':
                trace.send_signal(signal.SIGINT)
            if trace:
                try:trace.wait(timeout=145)
                except subprocess.TimeoutExpired:
                    print('Recorder exceeded its time limit',file=logs)
                    trace.kill();trace.wait()
            for child,meta in samples:
                try:child.wait(timeout=75)
                except subprocess.TimeoutExpired:
                    print('Host symbolication exceeded its time limit for '+meta['file'],file=logs)
                    child.terminate()
                    try:child.wait(timeout=5)
                    except subprocess.TimeoutExpired:child.kill();child.wait()
                report=output/meta['file']
                if report.is_file():
                    stacks=apple_sample_stacks(report.read_text(errors='replace'))
                    if stacks:
                        report.with_suffix('.folded').write_text(''.join(f'{path} {n}\n' for path,n in stacks.items()))
            for meta in started:
                path=output/meta['path']
                if not path.exists():
                    print('No trace was saved at '+str(path),file=logs);continue
                toc=output/'instruments-toc.xml'
                cmd=['xcrun','xctrace','export','--input',str(path)]
                try:
                    status=subprocess.run([*cmd,'--toc','--output',str(toc)],stdout=logs,stderr=logs,timeout=120)
                    if status.returncode or not toc.is_file():continue
                    schemas={n.get('schema') for n in ET.parse(toc).iter('table')}
                    meta['schemas']=sorted(x for x in schemas if x)
                    subprocess.run(['ditto','-c','-k','--sequesterRsrc','--keepParent',str(path),str(output/'checker.trace.zip')],check=True,timeout=120)
                    for table in ('time-profile','os-signpost','os-signpost-interval','thread-state','potential-hangs'):
                        if table in schemas:
                            subprocess.run([*cmd,'--xpath',f'/trace-toc/run[1]/data/table[@schema="{table}"]',
                                '--output',str(output/(table+'.xml'))],stdout=logs,stderr=logs,timeout=120)
                except (subprocess.SubprocessError,OSError,ET.ParseError) as error:
                    print('Trace export: '+str(error),file=logs)
            (output/'instruments-session.json').write_text(json.dumps({'recordings':started,'host_samples':[m for _,m in samples]},indent=2))
            logs.close()
    return session()
