"""Serve the ordinary portal with ten examples in a disposable local store.

Every game is added through the normal HTTP submission endpoint, including all
validation. This takes about two minutes. No existing data file, production
configuration, cloud database or external translator is opened.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import secrets
from pathlib import Path

import uvicorn
from fastapi.testclient import TestClient

from game_platform.api import create_app
from game_platform.service import GamePlatform
from game_platform.store import InMemoryStore

KINDS = ('tictactoe','connect4','reversi','nim','mancala','gomoku','hex','domineering','memory','pig')


def make_demo_app(*, report_path: Path | None = None):
    platform = GamePlatform(store=InMemoryStore(), computer_move_delay_seconds=0)
    app = create_app(platform, debug_tools=True, master_password=secrets.token_urlsafe(32))
    report = {'environment':'disposable loopback in-memory store', 'submission_endpoint':'POST /games/declarative', 'games':[]}
    with TestClient(app) as client:
        for kind in KINDS:
            package=json.loads((Path(__file__).resolve().parents[1]/'games'/'declarative'/(kind+'.json')).read_text())
            source={key:value for key,value in package.items() if key!='game_addition_request_id_and_secret'}
            source_hash=hashlib.sha256(json.dumps(source,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            package['game_addition_request_id_and_secret']=secrets.token_urlsafe(32)
            response=client.post('/games/declarative',json=package)
            if response.status_code != 201:
                raise RuntimeError(f'{kind} submission failed ({response.status_code}): {response.text[:6000]}')
            game=response.json()
            report['games'].append({'kind':kind,'id':game['id'],'version':game['version'],'submission_status':201,'package_sha256_without_secret':source_hash})
            print(f'Validated and submitted {kind}',flush=True)
    if report_path:
        report_path.write_text(json.dumps(report,indent=2)+'\n')
    return app


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8134)
    parser.add_argument('--report',type=Path,help='Write non-secret submission evidence JSON')
    args=parser.parse_args()
    app=make_demo_app(report_path=args.report)
    print(f'Open http://127.0.0.1:{args.port}/portal and create a guest account to play.',flush=True)
    uvicorn.run(app,host='127.0.0.1',port=args.port,log_level='warning')


if __name__=='__main__':main()
