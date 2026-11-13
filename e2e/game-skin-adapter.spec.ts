import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const portal = fs.readFileSync(path.resolve(__dirname, '../static/portal.js'), 'utf8');
const adapter = portal.slice(portal.indexOf('const PORTAL_SKINNED_GAME_IDS ='),
  portal.indexOf('async function onMakeMove('));
const context = vm.createContext({});
vm.runInContext(adapter, context);
// Both games use the same disc glyph for each player; owner colors carry
// essential board information, independent of the surrounding portal skin.
const client = `<html><head><style>
  body {background:#111;color:white}
  .cell {background:#263d52;color:white}
  .cell[data-owner="1"] {background:#a93d31;color:white}
  .cell[data-owner="2"] {background:#226fc1;color:white}
  .number {color:#e4edf9}
</style></head><body>
  <button class="cell" data-owner="1">●</button>
  <button class="cell" data-owner="2">●</button>
  <button class="cell" data-owner="0"><span class="number">3</span>·</button>
</body></html>`;

for (const [name, id] of [['Tsoro Yematatu', '41b88e29-3402-4a1c-920d-8429c7b880e5'],
  ['Teeko', 'dad2260d-cc40-47e0-be43-e51539df694f']]) {
  test(`${name} keeps player pieces distinct when its portal palette changes`, async ({page}) => {
    const code = vm.runInContext(`withPortalSkinAdapter(${JSON.stringify(id)}, ${JSON.stringify(client)})`, context);
    await page.setContent('<iframe id="game" sandbox="allow-scripts"></iframe>');
    await page.locator('#game').evaluate((element, source) => { (element as HTMLIFrameElement).srcdoc = source; }, code);
    const frame = page.frameLocator('#game');
    await expect(frame.locator('head style')).toHaveCount(2);
    for (const [scheme, background, text, raised, accent] of [
      ['light', '#ffffff', '#202124', '#f1f3f4', '#5f6368'],
      ['dark', '#0e1216', '#eef3f6', '#1c2631', '#58c4a8'],
    ]) {
      await page.evaluate(palette => (document.getElementById('game') as HTMLIFrameElement)
        .contentWindow!.postMessage({type:'state_changed', skin_palette:palette}, '*'),
      {scheme, background, text, raised, accent, panel:background, hover:raised,
        border:accent, muted:text, accentHover:accent, focus:accent});
      await expect(frame.locator('body')).toHaveCSS('color', text === '#202124' ? 'rgb(32, 33, 36)' : 'rgb(238, 243, 246)');
      await expect(frame.locator('[data-owner="1"]')).toHaveCSS('background-color', 'rgb(169, 61, 49)');
      await expect(frame.locator('[data-owner="2"]')).toHaveCSS('background-color', 'rgb(34, 111, 193)');
      await expect(frame.locator('[data-owner="0"]')).toHaveCSS('background-color', raised === '#f1f3f4' ? 'rgb(241, 243, 244)' : 'rgb(28, 38, 49)');
      await expect(frame.locator('[data-owner="0"] .number')).toHaveCSS('color', text === '#202124' ? 'rgb(32, 33, 36)' : 'rgb(238, 243, 246)');
    }
  });
}
