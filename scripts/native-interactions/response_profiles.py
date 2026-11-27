"""Collapse input profiles into FlameGraph stacks. Host sample reports use observation counts."""
import json
import re
from collections import Counter,defaultdict
from pathlib import Path


def label(value):
    return str(value).replace(';',',').replace('\n',' ').strip()


def apple_sample_stacks(report):
    """Collapse Apple's inclusive per-thread sample tree to exclusive stack counts."""
    _, _, tree = report.partition('Call graph:')
    stacks = Counter()
    branch = []
    def close_frame():
        _, name, count, children = branch.pop()
        if count > children:
            path = [parent[1] for parent in branch] + [name]
            stacks[';'.join(path)] += count - children
        if branch:
            branch[-1][3] += count

    for line in tree.splitlines():
        if line.startswith(('Total number in stack', 'Sort by top of stack', 'Binary Images:')):
            break
        row = re.match(r'^([\s+!:|]*)([\d,]+) (.+)$', line)
        if not row:
            continue
        depth = len(row[1])
        while branch and branch[-1][0] >= depth:
            close_frame()
        # The first row of each tree gives the sampled thread. ASLR addresses
        # are unnecessary after symbolication and vary between app launches.
        name = label(re.sub(r'\s+\[0x[0-9a-fA-F]+\].*$', '', row[3]))
        if not branch and not name.startswith('Thread_'):
            continue
        branch.append([depth, name, int(row[2].replace(',', '')), 0])
    while branch:
        close_frame()
    return stacks


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
    lanes=defaultdict(set)
    for row in selected:
        lanes[row.get('thread_id',row['thread'])].add(row['t'])
    # The sampler aims for 10 ms. A busy simulator can leave much longer
    # gaps. A stack snapshot cannot identify what ran during those gaps.
    lengths={}
    for lane,times in lanes.items():
        stamps=sorted(times)
        for t,next_t in zip(stamps,stamps[1:]+[down+duration]):
            lengths[lane,t]=round(1000*(min(down+duration,t+10,next_t)-t))
    for r in selected:
        # Render one lane per sampled thread. Waiting threads account for time
        # on their own lane. Simultaneously running threads add independent time.
        thread=label(r['thread'])+(' · running' if r['running'] else ' · waiting')
        result[thread+';'+';'.join(label(f) for f in reversed(r['stack']))]+=max(1,lengths[r.get('thread_id',r['thread']),r['t']])
    return result
