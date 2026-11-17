import {zoomDeclarativeBoard} from './declarative-camera';
import fs from 'node:fs';
import path from 'node:path';
import {test, expect} from '@playwright/test';

test('an existing Backgammon version gets fitted clickable dice without changing its pinned package', async ({page}, testInfo) => {
  const original = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/fixtures/declarative/backgammon-v1-ui.json'), 'utf8'));
  const rules = fs.readFileSync(path.resolve(__dirname, '../games/declarative/backgammon.server.js'), 'utf8');
  const body = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../games/declarative/backgammon.json'), 'utf8'));
  await page.goto('/static/declarative-test.html');
  await page.addScriptTag({url:'/static/declarative-presentation.js?v=2'});
  const repaired = await page.evaluate(async ({original, rules, view}) => {
    const w = window as any;
    const game = {id:'5f5293c3-2a3a-4eec-b631-9debf59be0ca', version:1, server_code:rules, declarative_ui:original};
    const before = JSON.stringify(game);
    const spec = await w.DeclarativePresentation.forGame(game);
    const box = document.createElement('div');
    box.id = 'legacy-backgammon';
    box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#102330';
    document.body.append(box);
    w.legacyMoves = [];
    w.legacyHost = w.DeclarativeUI.mount(box, spec, {onMove:(move:any) => w.legacyMoves.push(move)});
    await w.legacyHost.send({type:'state_changed', view, state:view, status:'ongoing',
      players:[{player_index:0,name:'Alice'}, {player_index:1,name:'Bob'}],
      my_player_index:view.cur, acting_for_player_index:view.cur, turn_of_player_indices:[view.cur], move_count:0});
    return {unchanged:before === JSON.stringify(game), viewport:spec.viewport};
  }, {original, rules, view:body.unit_tests.cases[0].view_of_mover});
  expect(repaired.unchanged).toBe(true);
  const host = page.locator('#legacy-backgammon');
  await expect(host.locator('[data-ui-id^="die_"]')).toHaveCount(2);
  await expect(host.locator('.declarative-controls button')).toHaveCount(0);
  const stage = host.locator('.declarative-stage');
  await expect(stage).toHaveAttribute('viewBox', `0 0 ${repaired.viewport.width} ${repaired.viewport.height}`);
  await zoomDeclarativeBoard(host.locator('.declarative-stage'),'out');
  expect(await stage.evaluate((node:SVGSVGElement) => node.viewBox.baseVal.width)).toBeGreaterThan(repaired.viewport.width);
  await zoomDeclarativeBoard(host.locator('.declarative-stage'),'reset');
  const die = host.locator('[data-ui-id="die_0"]');
  await expect(die).toHaveClass(/actionable/);
  await expect(die.locator('.declarative-piece-action-outline')).toBeVisible();
  await die.click();
  await expect.poll(() => page.evaluate(() => (window as any).legacyMoves)).toEqual([{action:'roll'}]);
  await host.screenshot({path:testInfo.outputPath('existing-backgammon-dice.png')});
});
