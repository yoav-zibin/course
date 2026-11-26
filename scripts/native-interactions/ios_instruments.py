"""Record a warm simulator process while XCTest replays the two checker drags."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler,HTTPServer
from pathlib import Path
import json,os,signal,subprocess,threading,time
import xml.etree.ElementTree as ET

def capture(output,device,inputs):
    logs=(output/'instruments.log').open('w',buffering=1)
    started=[];samples=[];trace=None;pid=None
    def start():
        nonlocal trace,pid
        entries=[json.loads(line) for line in inputs.read_text().splitlines()]
        pid=next(e['pid'] for e in reversed(entries) if 'width' in e)
        # Simulator apps are host processes. Fall back to the host target if
        # this Xcode release cannot sample by simulator UDID.
        for target,flags in [('simulator',['--device',device]),('host',[])]:
            path=output/(target+'-checker.trace');notification=f'fun.buildplay.trace.{os.getpid()}.{target}'
            notified=subprocess.Popen(['notifyutil','-1',notification],stdout=logs,stderr=logs)
            try:
                trace=subprocess.Popen(['xcrun','xctrace','record','--template','Time Profiler',*flags,'--attach',str(pid),
                    '--output',str(path),'--time-limit','90s','--no-prompt','--notify-tracing-started',notification],stdout=logs,stderr=logs)
                end=time.monotonic()+32
                while time.monotonic()<end and trace.poll() is None and notified.poll() is None:time.sleep(.1)
                if trace.poll() is None and notified.poll()==0:
                    started.append({'target':target,'pid':pid,'acknowledged_wall_ms':time.time()*1000,'path':path.name})
                    break
                print('No recording-start acknowledgement from '+target,file=logs)
                if trace.poll() is None:trace.send_signal(signal.SIGINT)
                try:trace.wait(12)
                except subprocess.TimeoutExpired:trace.kill();trace.wait()
                trace=None
            finally:
                if notified.poll() is None:notified.terminate()
                notified.wait()
        # Host samples independently include waiting stacks. Trigger each one
        # at the first UIKit release instead of measuring XCTest's idle wait.
        def sample_releases():
            seen=set();deadline=time.monotonic()+95
            while len(seen)<2 and time.monotonic()<deadline:
                for line in inputs.read_text().splitlines():
                    try:e=json.loads(line)
                    except ValueError:continue
                    if e.get('phase')!=3 or e['pid']!=pid or e['t'] in seen or e['t']<=touch_threshold:continue
                    seen.add(e['t']);name=f'checker-{len(seen)}.sample.txt'
                    p=subprocess.Popen(['/usr/bin/sample',str(pid),'1','1','-file',str(output/name)],stdout=logs,stderr=logs)
                    samples.append((p,{'file':name,'touch_wall_ms':e['wall'],'sample_requested_wall_ms':time.time()*1000}))
                time.sleep(.008)
        touch_threshold=max((e['t'] for e in entries if 't' in e),default=0)
        threading.Thread(target=sample_releases,daemon=True).start()
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
            if trace and trace.poll() is None:trace.send_signal(signal.SIGINT)
            if trace:
                try:trace.wait(100)
                except subprocess.TimeoutExpired:trace.terminate();trace.wait(15)
            for child,_ in samples:child.wait(timeout=30)
            (output/'instruments-session.json').write_text(json.dumps({'recordings':started,'host_samples':[m for _,m in samples]},indent=2))
            for meta in started:
                path=output/meta['path']
                if not path.exists():continue
                toc=output/'instruments-toc.xml'
                cmd=['xcrun','xctrace','export','--input',str(path)]
                status=subprocess.run([*cmd,'--toc','--output',str(toc)],stdout=logs,stderr=logs,timeout=90)
                if status.returncode==0:
                    schemas={n.get('schema') for n in ET.parse(toc).iter('table')}
                    for table in ('time-profile','os-signpost','os-signpost-interval','thread-state','potential-hangs'):
                        if table in schemas:
                            subprocess.run([*cmd,'--xpath',f'/trace-toc/run[1]/data/table[@schema="{table}"]',
                                '--output',str(output/(table+'.xml'))],stdout=logs,stderr=logs,timeout=120)
                subprocess.run(['ditto','-c','-k','--sequesterRsrc','--keepParent',str(path),str(output/'checker.trace.zip')],check=True)
            logs.close()
    return session()
