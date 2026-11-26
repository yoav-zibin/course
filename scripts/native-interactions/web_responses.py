"""Measure trusted browser input against its compositor frames and collect optional V8 stacks."""
import argparse,asyncio,base64,io,json,time
from pathlib import Path
from urllib.parse import quote
import numpy as np
from PIL import Image
from playwright.async_api import async_playwright
from response_frames import destination,response,spent_die_latency
from response_store import verify

VIEW={'width':402,'height':874}
CANVAS='Game board. Use pieces and highlighted destinations.'
def pixels(png):
    with Image.open(io.BytesIO(png)) as image:return np.array(image.convert('RGB').resize((201,437)))

async def run_case(browser,origin,fixtures,case,folder,profile):
    ctx=await browser.new_context(viewport=VIEW,is_mobile=True,has_touch=True,device_scale_factor=1,service_workers='block')
    folder.mkdir(parents=True,exist_ok=True)
    payload=json.loads(json.loads((fixtures/case['id']/case['filename']).read_text())['value'])
    match=payload['local'][case['match']]
    login=await (await ctx.request.post(origin+'/users',data={'display_name':'Benchmark'})).json()
    owner=login['user_id']
    account={'id':owner,'display_name':'Benchmark','password':login['password']}
    match.update(owner_user_id=owner,cloud_revision=1,local_revision=1,synced_local_revision=1)
    match['players'][0]['user_id']=owner
    game=next(iter(payload['responses'].values()))
    await ctx.request.post(origin+'/__seed',data={'game':game,'match':match})
    key='buildplay.shared.v1.'+quote(origin,safe='')+'.'+owner
    entries={key:json.dumps(payload),'game-platform.accounts.v1':json.dumps([account]),'game-platform.current-account.v1':owner}
    await ctx.add_init_script(script="if(window===top&&!localStorage.getItem('response-seeded')){for(const [k,v] of Object.entries("+json.dumps(entries)+"))localStorage.setItem(k,v);localStorage.setItem('response-seeded','1')}")
    page=await ctx.new_page()
    page.set_default_timeout(9000)
    session=await ctx.new_cdp_session(page)
    await session.send('Performance.enable')
    if profile:
        await session.send('Profiler.enable');await session.send('Profiler.setSamplingInterval',{'interval':500})
    output={'actions':[]}
    try:
        await page.goto(origin+'/portal#match='+case['match'])
        canvas=page.get_by_label(CANVAS,exact=True)
        await canvas.locator('svg').first.wait_for()
        await page.wait_for_timeout(750)
        await page.evaluate("""() => {window.responseTouches=[];window.responseEntries=[];
          for(const kind of ['pointerdown','pointerup','pointermove'])addEventListener(kind,e=>{
            if(e.isTrusted)responseTouches.push({kind,t:performance.timeOrigin+e.timeStamp,x:e.clientX,y:e.clientY});
          },{capture:true,passive:true});
          const o=new PerformanceObserver(list=>responseEntries.push(...list.getEntries().map(e=>({name:e.name,t:e.startTime,
            duration:e.duration,start:e.processingStart,end:e.processingEnd,id:e.interactionId}))));
          o.observe({type:'event',durationThreshold:16});}""")
        active=None
        acks=[]
        def frame(evt):
            acks.append(asyncio.create_task(session.send('Page.screencastFrameAck',{'sessionId':evt['sessionId']})))
            if active is not None:active.append((evt['metadata']['timestamp']*1000,base64.b64decode(evt['data'])))
        session.on('Page.screencastFrame',frame)
        await session.send('Page.startScreencast',{'format':'png','everyNthFrame':1})
        def control(label):
            if label in ('match-menu-button','bug-report-button'):return page.get_by_test_id(label).last
            if label=='Bug or feature request':return page.get_by_role('textbox',name=label)
            return page.get_by_role('button',name=label,exact=True).last
        async def at(point):
            return await canvas.locator('svg').first.evaluate('(svg,p)=>{const t=new DOMPoint(p.x,p.y).matrixTransform(svg.getScreenCTM());return [t.x,t.y]}',point)
        for action in case['actions']:
            if 'at' in action:
                p=await at(action['at'])
            else:
                target=control(action['label']);await target.scroll_into_view_if_needed()
                box=await target.bounding_box();p=[box['x']+box['width']/2,box['y']+box['height']/2]
            end=None
            if 'to' in action:
                end=await at(action['to']);scale=await canvas.locator('svg').first.evaluate('s=>s.getScreenCTM().d')
                end[1]+=min(54,action['lift']*scale*.6+22,(await canvas.bounding_box())['height']/3)
            await page.wait_for_timeout(400)
            before=await page.screenshot()
            boundary=await page.evaluate('({length:responseTouches.length,t:Date.now()})')
            active=[]
            if profile:
                await session.send('Profiler.start')
                metrics=await session.send('Performance.getMetrics');tick=next(m['value'] for m in metrics['metrics'] if m['name']=='Timestamp')
                epoch=await page.evaluate('performance.timeOrigin+performance.now()')
            def pts(x,y):return [{'x':float(x),'y':float(y),'radiusX':2,'radiusY':2,'force':1}]
            await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':pts(*p)})
            if end:
                for i in range(1,23):
                    await asyncio.sleep(.019)
                    await session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':pts(*[p[k]+(end[k]-p[k])*i/22 for k in (0,1)])})
            else:await asyncio.sleep(.055)
            await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            await page.wait_for_timeout(850)
            if 'until' in action:await control(action['until']).wait_for()
            if 'absent' in action:await control(action['absent']).wait_for(state='hidden')
            if action['id']=='open-report':
                await page.get_by_label('Screenshot captured before opening this report',exact=True).first.wait_for()
            if profile:
                prof=(await session.send('Profiler.stop'))['profile']
                (folder/(action['id']+'.cpuprofile')).write_text(json.dumps(prof))
            reported=await page.evaluate('n=>responseTouches.slice(n)',boundary['length'])
            down=next(e['t'] for e in reported if e['kind']=='pointerdown')
            events,active=active,None
            times=[boundary['t']-1]+[t for t,_ in events]
            imgs=[pixels(before)]+[pixels(img) for _,img in events]
            row=response(times,imgs,down,p,[VIEW['width'],VIEW['height']])
            if 'spentDie' in action:
                up=next(e['t'] for e in reported if e['kind']=='pointerup')
                row['release_to_spent_die_ms']=spent_die_latency(times,imgs,down,up,await at(action['spentDie']),[VIEW['width'],VIEW['height']])
                row['hold_ms']=round(up-down,1)
            if action['id'] in ('open-menu','close-menu','open-report','dismiss-report'):
                row['dialog_landmark_ms']=destination(times,imgs,down)
            row.update(action=action['id'],input_epoch_ms=down,events=reported,frames_ms=[round(t-down,2) for t in times])
            if profile:row['profiler_epoch_offset_us']=round(epoch*1000-tick*1e6)
            (folder/(action['id']+'-before.png')).write_bytes(before)
            if row.get('frame_ms') is not None:
                evidence=min(events,key=lambda f:abs(f[0]-row['frame_ms']))[1]
                (folder/(action['id']+'-response.png')).write_bytes(evidence)
            output['actions'].append(row);print(case['id'],action['id'],row['first_ms'],flush=True)
        await page.wait_for_timeout(1400)
        await session.send('Page.stopScreencast');await asyncio.gather(*acks)
        persisted=await page.evaluate('k=>JSON.parse(localStorage.getItem(k))',key)
        output['proof']=verify([case],persisted)[case['id']]
        output['eventTimings']=await page.evaluate('responseEntries')
    except Exception as error:
        output['error']=str(error)
        print(case['id'],str(error),flush=True)
        (folder/'last.png').write_bytes(await page.screenshot())
        (folder/'accessibility.txt').write_text(await page.locator('body').aria_snapshot())
    finally:
        (folder/'results.json').write_text(json.dumps(output,indent=2))
        await ctx.close()
    return output

async def run(args):
    cases=json.loads((args.fixtures/'scenarios.json').read_text())
    async with async_playwright() as play:
        browser=await play.chromium.launch()
        output={}
        for case in cases:
            if args.case and case['id'] not in args.case:continue
            output[case['id']]=await run_case(browser,args.origin,args.fixtures,case,args.results/case['id'],args.profile)
        await browser.close()
    (args.results/'responses.json').write_text(json.dumps(output,indent=2))
    if not all(v.get('proof',{}).get('verified') for v in output.values()):raise RuntimeError('Some browser scenarios did not verify')
if __name__=='__main__':
    args=argparse.ArgumentParser();args.add_argument('origin');args.add_argument('fixtures',type=Path);args.add_argument('results',type=Path)
    args.add_argument('--profile',action='store_true');args.add_argument('--case',action='append');asyncio.run(run(args.parse_args()))
