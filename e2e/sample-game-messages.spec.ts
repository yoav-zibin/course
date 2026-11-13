import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const repo = path.resolve(__dirname, '..');
const python = process.env.E2E_PYTHON ?? (fs.existsSync(path.join(repo, '.venv/bin/python'))
  ? path.join(repo, '.venv/bin/python') : 'python3');
const fixtureScript = `
import importlib.util,json,sys
from pathlib import Path
directory=Path(sys.argv[1]);sys.path.insert(0,str(directory))
spec=importlib.util.spec_from_file_location('local_sample_fixture',directory/'build.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
if hasattr(module,'gamekit'):module.gamekit.secret=lambda key:'local-browser-test-secret'
if hasattr(module,'secret'):module.secret=lambda:'local-browser-test-secret'
body=module.payload();case=body['unit_tests']['cases'][0]
players=[{'player_index':i,'player_id':p['id'],'kind':p['kind'],'name':'Trusted player '+str(i)}for i,p in enumerate(case['ctx']['players'])]
seat=next(i for i,p in enumerate(case['ctx']['players'])if p['id']==case['player_id'])
print(json.dumps({'client':body['client_code'],'message':{'type':'state_changed',
 'state':case['view_of_mover'],'view':case['view_of_mover'],'players':players,
 'my_player_index':seat,'acting_for_player_index':seat,'turn_of_player_indices':[seat],
 'status':'ongoing','move_count':0,'token_pot':0,'locale':'en','direction':'ltr'}}))
`;

for (const game of ['sueca', 'smugglers-tide', 'frontier-rails', 'buraco', 'lingo', 'ghost']) {
  test(`${game} accepts its host state and ignores a sibling frame's forged state`, async ({page}) => {
    const fixture = JSON.parse(execFileSync(python, ['-c', fixtureScript,
      path.join(repo, 'frontends/ios-game-builder-marcelle/sample-games', game)],
    {encoding:'utf8', maxBuffer:2_000_000}));
    await page.setContent('<main id="fixture"></main>');
    await page.evaluate(client => {
      const w = window as any;
      w.sampleReady = false; w.spoofHandled = false;
      addEventListener('message', event => {
        if (event.data?.type === 'game_ready') w.sampleReady = true;
        if (event.data?.spoofHandled) w.spoofHandled = true;
      });
      const target = document.createElement('iframe');
      target.id = 'sample-game'; target.setAttribute('sandbox', 'allow-scripts');
      target.style.cssText = 'width:100%;height:700px';
      // Acknowledge after the client's listener handles the forged message so
      // the assertion cannot run before the cross-frame message is delivered.
      target.srcdoc = client + '<script>addEventListener("message",e=>{if(e.data?.auditProbe)parent.postMessage({spoofHandled:true},"*");});<' + '/script>';
      document.getElementById('fixture')!.append(target);
      const attacker = document.createElement('iframe');
      attacker.id = 'sibling'; attacker.hidden = true; attacker.setAttribute('sandbox', 'allow-scripts');
      attacker.srcdoc = '<script>onmessage=e=>parent.frames[0].postMessage(e.data,"*");<' + '/script>';
      document.getElementById('fixture')!.append(attacker);
    }, fixture.client);
    await page.waitForFunction(() => (window as any).sampleReady);
    await page.evaluate(message => (document.getElementById('sample-game') as HTMLIFrameElement)
      .contentWindow!.postMessage(message, '*'), fixture.message);
    const body = page.frameLocator('#sample-game').locator('body');
    await expect(body).toContainText('Trusted player');
    const forged = {...fixture.message, auditProbe:true,
      players:fixture.message.players.map((p:any) => ({...p, name:'Forged player'}))};
    await page.evaluate(message => (document.getElementById('sibling') as HTMLIFrameElement)
      .contentWindow!.postMessage(message, '*'), forged);
    await page.waitForFunction(() => (window as any).spoofHandled);
    await expect(body).not.toContainText('Forged player');
    await expect(body).toContainText('Trusted player');
  });
}
