"""Serve the native startup benchmark's public game and empty account on loopback."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import secrets
import time
from urllib.parse import urlsplit


def serve(fixture, port, delay_ms, web_build=None):
    pose = json.loads((fixture/'pose.json').read_text())
    data = json.loads(json.loads((fixture/pose['filename']).read_text())['value'])
    game = dict(next(iter(data['responses'].values())), description='A game for two players.')
    card = {k:game[k] for k in ('id','name','description','version','allowed_player_counts','renderer_type')}
    game_path = '/games/'+game['id']
    match = {k:v for k,v in data['local'][pose['id']].items() if k not in
             ('localMode','logicState','initialState','initialTurn','moves','practiceSeed','awaitingHandoff')}
    match.update(id='benchmark-opening', match_kind='multiplayer')
    match_path = '/matches/'+match['id']
    account = {'id':'benchmark-player','display_name':'Benchmark','linked':[],'locale':'en'}
    password = secrets.token_urlsafe(18)
    arrivals = []
    saves = {}
    startup = []
    extra_games = {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, value, status=200):
            payload = json.dumps(value, separators=(',',':')).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(payload)))
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def handle_request(self):
            path = urlsplit(self.path).path
            if web_build and self.command=='GET' and (path=='/portal' or path.startswith('/static/app/')):
                relative='index.html' if path=='/portal' else path[len('/static/app/'):]
                asset=(web_build/relative).resolve()
                if not asset.is_relative_to(web_build) or not asset.is_file():
                    return self.send_error(404)
                payload=asset.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', mimetypes.guess_type(asset.name)[0] or 'application/octet-stream')
                self.send_header('Content-Length',str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            if path=='/__seed' and self.command=='POST':
                seed=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                g=seed['game']
                extra_games['/games/'+g['id']]=g
                extra_games['/games/'+g['id']+'/versions/'+str(g['version'])]=g
                if 'match' in seed:
                    m=seed['match']
                    saves['/matches/'+m['id']]={**m,'single_player_state':m,'cloud_revision':1}
                return self.reply({})
            if path=='/__startup':
                if self.command=='POST':
                    startup.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                return self.reply(list(startup))
            if path=='/__requests':
                return self.reply(list(arrivals))
            if path=='/__saves':
                return self.reply([{'id':m['id'],'game_id':m['game_id'],'move_count':m['move_count'],
                                    'opening':m['state'].get('opening',False)} for m in saves.values()])
            if path=='/__reset' and self.command=='POST':
                arrivals.clear()
                startup.clear()
                saves.clear()
                return self.reply({})
            arrivals.append({'method':self.command,'path':path,'at':time.time()})
            time.sleep(delay_ms/1000)
            if self.command=='POST':
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}')
                if path=='/users':
                    return self.reply({**account,'user_id':account['id'],'password':password},201)
                if path=='/matches/single-player-sync':
                    saved = body['match']
                    cloud = {**saved,'single_player_state':saved,'cloud_revision':body.get('expected_revision',0)+1}
                    saves['/matches/'+saved['id']] = cloud
                    return self.reply(cloud)
                return self.reply({})
            values = {'/storage/capabilities':{'pagination':True},'/auth/config':{},
                      '/i18n/locales':{'locales':[{'code':'en','name':'English','direction':'ltr'}]},
                      '/i18n/bundle/en':{'messages':{},'direction':'ltr'},
                      '/games':[card],'/games/popular':[card],'/v2/games':{'items':[card],'next_cursor':None},
                      game_path:game,game_path+'/versions/'+str(game['version']):game,match_path:match,match_path+'/game':game,
                      '/v2'+match_path+'/history':{'items':[],'total':match['move_count']},match_path+'/moves':[],
                      '/users/'+account['id']:account,'/users':[account],'/matches':[],
                      '/users/me/recent-games':[],'/users/me/saved-games':[]}
            if path in extra_games: return self.reply(extra_games[path])
            if path in ('/games','/v2/games','/games/popular') and extra_games:
                unique={g['id']:g for g in [game,*extra_games.values()]}
                cards=[{k:g[k] for k in card} for g in unique.values()]
                return self.reply({'items':cards,'next_cursor':None} if path=='/v2/games' else cards)
            if path in values:
                return self.reply(values[path])
            if path in saves:
                return self.reply(saves[path])
            if path.startswith('/v2/') or 'notifications' in path:
                return self.reply({'items':[],'next_cursor':None,'unread_count':0})
            return self.reply({'detail':'Unknown fixture route'},404)

        do_GET = do_POST = handle_request

    ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixture',type=Path)
    parser.add_argument('--port',type=int,default=18764)
    parser.add_argument('--delay-ms',type=int,default=200)
    parser.add_argument('--web-build',type=Path,help='Serve an exported Portal at /portal for browser comparisons')
    args = parser.parse_args()
    serve(args.fixture,args.port,args.delay_ms,args.web_build.resolve() if args.web_build else None)
