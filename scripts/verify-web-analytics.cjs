// Manual hosted smoke test. The real Google tag runs with network isolation.
// Inspect the requests GA would send and keep test identities off the service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium, webkit} = require(require.resolve('playwright', {paths: [path.join(__dirname, '../frontends/portal')]}));
const assets = process.argv[2];
const measurement = 'G-6CCXZQYVE7';
const account = 'ci-signed-in';

const server = http.createServer((request, response) => {
  const {pathname} = new URL(request.url, 'http://localhost');
  if (pathname === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<button>Move</button><script src="/static/analytics.js"></script>');
    return;
  }
  const file = path.join(assets, pathname);
  if (!pathname.startsWith('/static/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'text/javascript');
  let body = fs.readFileSync(file, 'utf8');
  if (pathname === '/static/analytics.js') {
    // Serve on a trusted loopback origin so the isolated browsers can start a service worker.
    const gate = "location.hostname !== 'buildplay.fun'";
    assert.ok(body.includes(gate));
    body = body.replace(gate, 'false');
  }
  response.end(body);
});

async function observe(type, origin) {
  const browser = await type.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const hits = [];
    const loads = [];
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin) return route.continue();
      if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') {
        loads.push(request.resourceType());
        return route.fulfill({path: path.join(assets, 'google-tag.js'), contentType: 'text/javascript',
          headers: {'Access-Control-Allow-Origin': '*'}});
      }
      if (url.hostname.endsWith('.google-analytics.com') && url.pathname.endsWith('/collect')) {
        for (const line of (request.postData() || '').split('\n')) {
          const params = new URLSearchParams(url.search);
          for (const [key, value] of new URLSearchParams(line)) params.set(key, value);
          if (params.get('tid') === measurement) hits.push({
            event: params.get('en'), account: params.get('uid'), screen: params.get('ep.screen_name'),
            title: params.get('dt'), eventParameters: [...params.keys()].filter(key => key.startsWith('ep.')),
          });
        }
      }
      return route.fulfill({status: 204, headers: {'Access-Control-Allow-Origin': '*'}});
    });
    const view = screen => page.evaluate(([id, name]) => window.BuildPlayAnalytics.setPortalView(id, name), [account, screen]);
    async function waitForScreen(screen) {
      const deadline = Date.now() + 30000;
      const forAccount = (event, name) => hits.some(hit => hit.event === event && hit.account === account && (!name || hit.screen === name));
      while (!forAccount('page_view') || !forAccount('portal_screen', screen)) {
        if (Date.now() >= deadline) throw new Error(type.name() + ' missing ' + screen + ': ' + JSON.stringify(hits));
        await page.waitForTimeout(100);
      }
    }
    await page.goto(origin);
    await view('games');
    await waitForScreen('games');
    await view('match');
    await waitForScreen('match');
    await page.evaluate(() => window.BuildPlayAnalytics.clearUser());
    assert.equal(await page.evaluate(id => window['ga-disable-' + id], measurement), true);
    assert.deepEqual(loads, ['fetch']);
    assert.equal(hits.filter(hit => hit.event === 'page_view' && hit.account === account).length, 1);
    console.log(type.name(), hits.filter(hit => ['page_view', 'portal_screen'].includes(hit.event)));
  } finally {
    await browser.close();
  }
}

server.listen(0, '127.0.0.1', async () => {
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const type of [chromium, webkit]) await observe(type, origin);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
