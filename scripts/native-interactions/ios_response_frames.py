"""Align UIKit touches with the clock stripe in the simulator recording."""
import argparse,json,re
from collections import defaultdict
from pathlib import Path
import av
import numpy as np
from response_frames import response

def frames(movie,width,height):
    with av.open(movie) as source:
        for frame in source.decode(video=0):
            yield float(frame.pts*frame.time_base)*1000,frame.reformat(width=width,height=height,format='rgb24').to_ndarray()

def stripe(im,screen):
    h,w=im.shape[:2]
    def rgb(x):return im[round(70*h/screen[1]),round(x*w/screen[0])].astype(int)
    left,right=rgb(6),rgb(107)
    if left[0]<145 or left[1]>100 or left[2]<145 or right[0]>105 or min(right[1:])<145:return None
    return sum(1<<i for i in range(24) if rgb(11+i*4).mean()>127)

def measure(directory):
    movie=directory/'responses.mov'
    states=[json.loads(l) for l in (directory/'inputs.jsonl').read_text().splitlines()]
    screen=next((s['width'],s['height']) for s in states if 'width' in s)
    touches=[s for s in states if s.get('phase')==0]
    if not touches:raise ValueError('UIKit recorded no touch-downs')
    w,h=[round(n) for n in screen]
    last=None;anchors=[];reference=touches[0]['t']
    for pts,im in frames(movie,w,h):
        word=stripe(im,screen)
        if word is not None and word!=last:
            native=word+2**24*round((reference-word)/2**24)
            anchors.append((pts,native))
        last=word
    if len(anchors)<3:raise ValueError('Simulator clock stripe missing from film')
    anchors=np.array(anchors);offsets=anchors[:,1]-anchors[:,0]
    global_offset=np.median(offsets)
    log=(directory/'responses.log').read_text()
    actions=defaultdict(dict)
    for case,name,phase,ms in re.findall(r'RESPONSE_ACTION ([\w-]+) ([\w-]+) (begin|end) ([\d.]+)',log):
        actions[(case,name)][phase]=float(ms)
    windows=[];proof=json.loads((directory/'verified.json').read_text())
    result={k:{'proof':v,'actions':[]} for k,v in proof.items()}
    for (case,name),bounds in actions.items():
        begin=bounds['begin'];end=bounds.get('end',begin+8000)
        touch=next((s for s in touches if begin-5<=s['wall']<=end),None)
        row={'action':name};result[case]['actions'].append(row)
        if not touch:
            row['error']='No UIKit down event in the XCTest action';continue
        near=abs(anchors[:,1]-touch['t'])<4000
        offsets_used=offsets[near] if near.sum()>=4 else offsets
        median=float(np.median(offsets_used));residual=float(np.percentile(abs(offsets_used-median),95))
        row.update(input_wall_ms=touch['wall'],point=[touch['x'],touch['y']],anchor_count=len(offsets_used),
                   clock_residual_p95_ms=round(residual,1))
        up=next((s for s in states if s.get('phase') in (3,4) and s['t']>=touch['t'] and s['pid']==touch['pid']),None)
        if up:row['hold_ms']=round(up['t']-touch['t'],1)
        windows.append((touch['t']-median,row,[],[]))
    for pts,im in frames(movie,max(1,w//2),max(1,h//2)):
        for start,row,times,pictures in windows:
            if start-1200<=pts<=start+2300:
                times.append(pts);pictures.append(im)
    for start,row,times,pictures in windows:
        try:row.update(response(times,pictures,start,row['point'],screen))
        except ValueError as e:row['error']=str(e)
    (directory/'clock-alignment.json').write_text(json.dumps({'clockAnchors':len(anchors),'medianOffsetMs':global_offset,
        'p95ResidualMs':float(np.percentile(abs(offsets-global_offset),95))},indent=2))
    (directory/'responses.json').write_text(json.dumps(result,indent=2))
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory',type=Path)
    measure(p.parse_args().directory)
