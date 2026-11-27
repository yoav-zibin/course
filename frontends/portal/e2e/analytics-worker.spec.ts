import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';

// Exercise the production controller on loopback without sending any traffic to Google.
const controller = readFileSync(path.join(__dirname, '../../../static/analytics.js'), 'utf8')
  .replace("location.hostname !== 'buildplay.fun'", 'false');
const tag = 'https://www.googletagmanager.com/gtag/js?id=G-6CCXZQYVE7';
const fixture = '<button onclick="this.textContent=\'Moved\'">Move</button><script src="/static/analytics.js?v=5"></script>';

test.beforeEach(async ({page, baseURL}) => {
  if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) throw new Error('Requires a loopback origin');
  await page.route('**/analytics-fixture', route => route.fulfill({contentType:'text/html', body:fixture}));
  await page.route('**/static/analytics.js?v=5', route => route.fulfill({contentType:'text/javascript', body:controller}));
});

test('input works while the Google tag is loading and while it occupies its worker', async ({page, context, baseURL}) => {
  const tagRequests: string[] = [];
  let commands: any[] = [];
  let busy: {start: number, end: number} | undefined;
  await context.route('**/analytics-probe-end', async route => {
    const result = route.request().postDataJSON();
    commands = result.commands;
    busy = {start: result.start, end: result.end};
    await route.fulfill({status:200, body:'ok'});
  });
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await context.route(tag, async route => {
    tagRequests.push(route.request().resourceType());
    await hold;
    await route.fulfill({contentType:'text/javascript', headers:{'Access-Control-Allow-Origin':'*'}, body:`
      const commands = window.dataLayer.map(a => Array.from(a));
      const start = Date.now();
      while (Date.now() - start < 1500) {}
      fetch(${JSON.stringify(baseURL + '/analytics-probe-end')}, {
        method:'POST', body:JSON.stringify({start, end:Date.now(), commands})
      });
    `});
  });
  await page.goto('/analytics-fixture');
  const button = page.getByRole('button');
  await page.evaluate(() => (window as any).BuildPlayAnalytics.setUser('fixture-account'));
  await expect.poll(() => tagRequests).toEqual(['fetch']);
  await button.click();
  await expect(button).toHaveText('Moved');
  const moved = await page.evaluateHandle(() => {
    const times: number[] = [];
    const target = document.querySelector('button')!;
    target.textContent = 'Again';
    target.addEventListener('click', () => {
      if (target.textContent === 'Moved') times.push(Date.now());
    });
    return times;
  });
  const box = (await button.boundingBox())!;
  release();
  // Use the clocks of the click handler and the running tag. CI can deliver
  // network notifications to Playwright after the worker has already finished.
  await expect.poll(async () => {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return busy;
  }, {intervals: [25, 50, 50], timeout: 10000}).toBeDefined();
  const clickTimes = await moved.jsonValue();
  expect(clickTimes.some(time => time >= busy!.start && time < busy!.end)).toBe(true);
  await expect(button).toHaveText('Moved');
  expect(await page.evaluate(() => typeof (window as any).gtag)).toBe('undefined');
  expect(commands).toContainEqual(['config','G-6CCXZQYVE7',{user_id:'fixture-account',page_location:baseURL+'/analytics-fixture'}]);
  await page.evaluate(() => (window as any).BuildPlayAnalytics.setUser(null));
  expect(await page.evaluate(() => (window as any)['ga-disable-G-6CCXZQYVE7'])).toBe(true);
});

test('portal navigation reports signed-in screens without duplicating GA4 history pageviews', async ({page, context, baseURL}) => {
  const events: Array<[string,string,string]> = [];
  await context.route('**/page-probe', async route => {
    events.push(JSON.parse(route.request().postData()!));
    await route.fulfill({body:'ok'});
  });
  await context.route(tag, route => route.fulfill({
    contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:`
      function record(command) {
        if (command[0] === 'event') {
          const event = command[2];
          fetch(${JSON.stringify(baseURL + '/page-probe')}, {method:'POST',body:JSON.stringify([command[1],event.page_title,event.page_location])});
        }
      }
      window.dataLayer.forEach(record);
      const push = window.dataLayer.push;
      window.dataLayer.push = function(command){ record(command); return push.call(this,command); };
    `,
  }));
  await page.goto('/analytics-fixture#match=private-match-id');
  const view = (id:string|null,screen:string) => page.evaluate(([user,name]) => {
    (window as any).BuildPlayAnalytics.setPortalView(user,name);
  }, [id,screen]);
  await view('fixture-account','games');
  await expect.poll(() => events).toEqual([['portal_screen','games',baseURL+'/portal/games']]);
  await view('fixture-account','games');
  await view('fixture-account','match');
  await expect.poll(() => events).toEqual([['portal_screen','games',baseURL+'/portal/games'],['portal_screen','match',baseURL+'/portal/match']]);
  await view(null,'account');
  expect(await page.evaluate(() => (window as any)['ga-disable-G-6CCXZQYVE7'])).toBe(true);
});

test('a blocked worker or a signed-out visit never loads a main-thread Google tag', async ({page, context}) => {
  let requested = false;
  await context.route(tag, route => { requested = true; return route.abort(); });
  await page.addInitScript(() => {
    navigator.serviceWorker.register = async () => { (window as any).__analyticsRegistrationDenied = true; throw new Error('Storage denied'); };
  });
  await page.goto('/analytics-fixture');
  expect(await page.locator('script[src*="partytown"]').count()).toBe(0);
  await page.evaluate(() => (window as any).BuildPlayAnalytics.setUser('fixture-account'));
  await expect.poll(() => page.evaluate(() => (window as any).__analyticsRegistrationDenied)).toBe(true);
  await page.getByRole('button').click();
  await expect(page.getByRole('button')).toHaveText('Moved');
  expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0);
  expect(requested).toBe(false);
});

test('account changes while the worker is starting use the latest identity and respect opt-out', async ({page, context, baseURL}) => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/analytics-worker/partytown.js', async route => { await hold; await route.continue(); });
  const identities: Array<string|null> = [];
  await context.route('**/identity-probe', async route => {
    identities.push(JSON.parse(route.request().postData()!));
    await route.fulfill({body:'ok'});
  });
  await context.route(tag, route => route.fulfill({
    contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:`
      function record(command) {
        if (command[0] === 'config') fetch(${JSON.stringify(baseURL + '/identity-probe')}, {method:'POST',body:JSON.stringify(command[2].user_id)});
      }
      window.dataLayer.forEach(record);
      const push=window.dataLayer.push;
      window.dataLayer.push=function(command){record(command);return push.call(this,command);};
    `,
  }));
  await page.goto('/analytics-fixture');
  const starting = page.waitForRequest('**/analytics-worker/partytown.js');
  await page.evaluate(() => (window as any).BuildPlayAnalytics.setUser('first'));
  await starting;
  await page.evaluate(() => (window as any).BuildPlayAnalytics.setUser('second'));
  release();
  await expect.poll(() => identities).toEqual(['second']);
  await page.evaluate(() => (window as any).BuildPlayAnalytics.clearUser());
  await expect.poll(() => identities).toEqual(['second',null]);
  await page.addInitScript(() => { (window as any)['ga-disable-G-6CCXZQYVE7'] = true; });
  await page.reload();
  await page.evaluate(() => (window as any).BuildPlayAnalytics.setUser('opted-out'));
  await page.evaluate(() => new Promise(resolve => requestIdleCallback(resolve)));
  expect(await page.locator('script[src*="partytown"]').count()).toBe(0);
});
