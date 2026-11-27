"""Add simulator-only timing probes to an isolated historical or current JS checkout."""
from pathlib import Path
import argparse

def prepare(portal,hold_account_ms=0):
    scripts=Path(__file__).resolve().parent
    probe=(scripts/'checker-trace.js').read_text().replace('__BENCHMARK_ACCOUNT_HOLD_MS__',str(hold_account_ms))
    (portal/'benchmark-checkers.js').write_text(probe)
    entry=portal/'index.ts'
    entry.write_text("import './benchmark-checkers';\n"+entry.read_text())
    diagnostics=portal/'src/core/diagnostics.ts'
    old=diagnostics.read_text()
    signature='export function recordDiagnosticEvent(name: string, metadata?: Entry) {'
    if old.count(signature)!=1:raise ValueError('Unexpected diagnostic entry point')
    diagnostics.write_text(old.replace(signature,signature+'(globalThis as any).__bpCheckerTrace?.event(name,metadata);'))
    for file,name,label in [('executor.ts','evaluate','Native QuickJS round trip'),
                            ('runtime.ts','runPreparedPresentation','Prepare game presentation')]:
        path=portal/'src/game'/file;text=path.read_text()
        definition='export async function '+name+'('
        if text.count(definition)!=1:raise ValueError('Unexpected game entry point '+name)
        inner='benchmarked'+name[0].upper()+name[1:]
        text=text.replace(definition,'async function '+inner+'(')
        path.write_text(text+f"""
export async function {name}(...args: Parameters<typeof {inner}>) {{
  const timer=(globalThis as any).__bpCheckerTrace;
  const id=timer?.begin('{label}');
  try {{return await {inner}(...args);}} finally {{if(timer)timer.end(id);}}
}}
""")

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('portal',type=Path)
    parser.add_argument('--hold-account-ms',type=int,choices=[0,1500],default=0)
    args=parser.parse_args()
    prepare(args.portal,args.hold_account_ms)
