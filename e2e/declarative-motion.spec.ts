import {test, expect} from '@playwright/test';
import {createUser, loginAs, uniqueName} from './helpers';

declare const frame: any;
declare const state: any;
declare function syncGame(): Promise<void>;

const spec = {
  format: 'buildplay-ui', version: 1,
  viewport: {width: 400, height: 300},
  motion: {move_ms: 1000, animate_own: true, easing: 'ease-in-out-quad'},
  boards: [{id: 'table', kind: 'zone', width: 400, height: 300}],
  piece_types: {token: {shape: 'rect', width: 60, height: 30, color: '#ffb347'}},
  ui_code: `const gameUI={reduce(m){return {scene:{pieces:[
    {id:'token',type:'token',board:'table',position:{x:100,y:150},
     rotation:m.view.angle||0,text:m.view.name||'',actions:[]}
  ]}};}};`,
};

for (const [angle, fallback] of [[90, false], [180, false], [180, true]] as const) test(`quadratic movement preserves a rotating piece's size at ${angle} degrees${fallback ? ' without linear() support' : ''}`, async ({page}) => {
  await page.goto('/static/declarative-test.html');
  const determinant = await page.evaluate(async ({spec, angle, fallback}) => {
    if (fallback) {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = ((...args:string[]) => args[0] === 'animation-timing-function' && args[1]?.startsWith('linear(')
        ? false : (supports as any)(...args)) as typeof CSS.supports;
    }
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#102330';
    document.body.append(box);
    const host = (window as any).DeclarativeUI.mount(box, spec);
    const message = {type:'state_changed', status:'ongoing', my_player_index:0,
      acting_for_player_index:0, last_move_player_index:0, move_count:0, view:{angle:0}};
    await host.send(message);
    await host.send({...message, move_count:1, view:{angle}});
    const node = box.querySelector('.declarative-piece')!;
    const animation = node.getAnimations()[0];
    if (!animation) throw new Error('The rotation did not animate');
    animation.pause();
    animation.currentTime = 500;
    await new Promise(requestAnimationFrame);
    const matrix = new DOMMatrix(getComputedStyle(node).transform);
    const area = matrix.a * matrix.d - matrix.b * matrix.c;
    host.destroy();
    return area;
  }, {spec, angle, fallback});
  expect(determinant).toBeCloseTo(1, 3);
});

test('switching games renders the new board while old animation history is delayed', async ({page, request}) => {
  await loginAs(page, await createUser(request, uniqueName('Motion navigation')));
  await page.addInitScript(() => localStorage.setItem('game-platform.locale.v1', JSON.stringify('en')));
  await page.goto('/static/portal.html');
  await page.waitForFunction(() => typeof state !== 'undefined' && !state.refreshing);
  await page.evaluate(async spec => {
    // Keep background polling from replacing the controlled navigation state.
    Object.defineProperty(document, 'hidden', {value:true, configurable:true});
    const players = [{id:'synthetic-player', player_index:0, kind:'human', user_id:null}];
    state.match = {id:'old-motion-match', game_id:'motion-fixture', game_version:1,
      players, state:{angle:0, name:'Old board'}, move_count:0,
      status:'ongoing', turn_of_player_indices:[0], last_move_player_index:0};
    state.selectedId = state.match.id;
    frame.load(spec);
    state.loaded = `${state.match.id}@motion-fixture@1`;
    state.lastSent = null;
    await syncGame();
  }, spec);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const historyPath = '/matches/old-motion-match/moves';
  const isHistory = (address:string) => {
    const url = new URL(address);
    return url.pathname === historyPath || url.pathname === '/batch' &&
      JSON.parse(url.searchParams.get('requests') || '[]').some((item:any) => item.path === historyPath);
  };
  await page.route('**/*', async route => {
    if (!isHistory(route.request().url())) return route.continue();
    await gate;
    const url = new URL(route.request().url());
    const body = url.pathname === '/batch'
      ? JSON.parse(url.searchParams.get('requests')!).map(() => ({status:200, body:[]})) : [];
    await route.fulfill({json:body});
  });
  try {
    const requested = page.waitForRequest(request => isHistory(request.url()));
    await page.evaluate(() => {
      state.match = {...state.match, state:{angle:90, name:'Old update'}, move_count:2};
      (window as any).oldMotionSync = syncGame();
    });
    await requested;
    await page.evaluate(spec => {
      state.match = {...state.match, id:'new-motion-match', state:{angle:0, name:'New board'}, move_count:0};
      state.selectedId = state.match.id;
      frame.load(spec);
      state.loaded = `${state.match.id}@motion-fixture@1`;
      state.lastSent = null;
      void syncGame();
    }, spec);
    // The new host must not wait for an obsolete request's 20-second timeout.
    await expect(page.locator('#game-box .declarative-piece')).toHaveText('New board', {timeout:3000});
  } finally {
    release();
    await page.unrouteAll({behavior:'wait'});
  }
  await page.evaluate(() => (window as any).oldMotionSync);
  await expect(page.locator('#game-box .declarative-piece')).toHaveText('New board');
});
