"""Serve the real Portal with ten disposable, local-only game fixtures.

No production config/store, network submission or publishing endpoint is used.
The fixtures exercise the actual GameCard / cover_url rendering contract.
Run: python tools/preview_card_catalog.py --port 8174
"""
from pathlib import Path
import sys,tempfile,argparse,json,datetime as dt
from dataclasses import replace
if __package__ in (None,''):
    _alias=tempfile.TemporaryDirectory(prefix='card-catalog-')
    (Path(_alias.name)/'game_platform').symlink_to(Path(__file__).resolve().parents[1],target_is_directory=True)
    sys.path.insert(0,_alias.name)
from game_platform.api import create_app
from game_platform.store import InMemoryStore
from game_platform.service import GamePlatform
from game_platform.models import Game
from game_platform.agent_import import GameImport
from game_platform.tools.preview_card_tables import KINDS,DIRECTORY
import uvicorn

def make_app():
    store=InMemoryStore();now=dt.datetime.now(dt.timezone.utc)
    # Sequential local revisions invalidate previously cached review packages.
    for kind in KINDS:
        data=json.loads((DIRECTORY/(kind+'.json')).read_text());body=GameImport.model_validate(data)
        metadata={k:v for k,v in data.items() if k not in ('server_code','client_code','game_addition_request_id_and_secret')}
        game=Game(id='local-card-table-'+kind,version=1,name=body.name,description=body.description,
                            rules=body.game_rules(),all_state_public=body.all_state_public,code=body.client_code,
                            server_code=body.server_code,game_schemas=body.game_schemas(),import_package=metadata,
                            created_at=now,updated_at=now)
        store.add_game_version(game)
        for revision in (2,3):
            store.add_game_version(replace(game,version=revision))
    return create_app(GamePlatform(store=store,computer_move_delay_seconds=0))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--port',type=int,default=8174);args=parser.parse_args()
    uvicorn.run(make_app(),host='127.0.0.1',port=args.port,log_level='warning')
