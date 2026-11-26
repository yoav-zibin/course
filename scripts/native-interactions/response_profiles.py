"""Collapse measured input intervals into FlameGraph stacks. All weights are in microseconds."""
import json
from collections import Counter
from pathlib import Path


def label(value):
    return str(value).replace(';',',').replace('\n',' ').strip()


def web_stacks(path,row,duration):
    trace=json.loads(Path(path).read_text());offset=row['profiler_epoch_offset_us']
    nodes={n['id']:n for n in trace['nodes']}
    parents={child:n['id'] for n in nodes.values() for child in n.get('children',[])}
    start=row['input_epoch_ms']*1000-offset;end=start+duration*1000
    result=Counter();t=trace['startTime'];stamps=[]
    for ident,dt in zip(trace['samples'],trace['timeDeltas']):
        t+=dt;stamps.append((t,ident))
    for i,(t,ident) in enumerate(stamps):
        after=stamps[i+1][0] if i+1<len(stamps) else trace['endTime']
        us=round(min(end,after)-max(start,t))
        if us<=0:continue
        stack=[]
        while ident in nodes:
            f=nodes[ident]['callFrame'];name=f['functionName'] or '(anonymous)'
            if f['url']:name+=' · '+f['url'].rsplit('/',1)[-1].split('?')[0][:18]+':'+str(f['lineNumber']+1)
            stack.append(label(name));ident=parents.get(ident)
        result[';'.join(reversed(stack))]+=us
    return result


def android_stacks(filename,window=None):
    # Import the NDK's matching Linux/macOS libsimpleperf_report via PYTHONPATH.
    from simpleperf_report_lib import ReportLib
    lib=ReportLib();lib.SetRecordFile(str(filename));lib.ShowIpForUnknownSymbol()
    def name(symbol):
        return label(Path(symbol.dso_name).name+' · '+symbol.symbol_name)
    result=Counter()
    try:
        while (s:=lib.GetNextSample()) is not None:
            if window and not window[0]<=s.time/1e6<=window[1]:continue
            frames=[name(lib.GetSymbolOfCurrentSample())];chain=lib.GetCallChainOfCurrentSample()
            frames.extend(name(chain.entries[i].symbol) for i in range(chain.nr))
            result[label(s.thread_comm)+';'+';'.join(reversed(frames))]+=max(1,round(s.period/1000))
    finally:lib.Close()
    return result


def ios_stacks(rows,down,duration):
    result=Counter();selected=[r for r in rows if down<=r['t']<=down+duration]
    stamps=sorted({r['t'] for r in selected})
    lengths={t:round(1000*(min(down+duration,stamps[i+1] if i+1<len(stamps) else t+10)-t)) for i,t in enumerate(stamps)}
    for r in selected:
        # Render one lane per sampled thread. Waiting threads account for time
        # on their own lane. Simultaneously running threads add independent time.
        thread=label(r['thread'])+(' · running' if r['running'] else ' · waiting')
        result[thread+';'+';'.join(label(f) for f in reversed(r['stack']))]+=max(1,lengths[r['t']])
    return result
