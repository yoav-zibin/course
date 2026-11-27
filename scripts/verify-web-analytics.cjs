// Hosted smoke test. The real Google tag runs in each browser with only
// loopback networking. Inspect its outbound events without sending test data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const assets = process.argv[2];
const measurement = 'G-6CCXZQYVE7';
const account = 'ci-signed-in';

// Partytown serializes this hook into the worker. Playwright request routing
// interferes with WebKit service workers, so capture the HTTP traffic at its
// destination. Keep the Google tag, event payloads and controller unchanged.
function resolveUrl(url, location) {
  if (url.origin === location.origin) return url;
  if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') {
    return new URL('/vendor.js' + url.search, location.origin);
  }
  if ((url.hostname.endsWith('.google-analytics.com') || url.hostname === 'analytics.google.com') &&
      url.pathname.endsWith('/collect')) {
    return new URL('/collector' + url.pathname + url.search, location.origin);
  }
  return new URL('/discard', location.origin);
}

function captureEvents(hits, url, body) {
  for (const line of body.split('\n')) {
    const params = new URLSearchParams(url.search);
    for (const [key, value] of new URLSearchParams(line)) params.set(key, value);
    if (params.get('tid') === measurement) {
      hits.push({event: params.get('en'), account: params.get('uid'), screen: params.get('ep.screen_name')});
    }
  }
}

function serve(hits, paths) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const {pathname} = url;
    paths.push(pathname);
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<button>Move</button><script src="/static/analytics.js"></script>');
    } else if (pathname === '/vendor.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(fs.readFileSync(path.join(assets, 'google-tag.js')));
    } else if (pathname.startsWith('/collector/')) {
      let body = '';
      for await (const chunk of request) body += chunk;
      captureEvents(hits, url, body);
      response.writeHead(204).end();
    } else if (pathname === '/discard') {
      response.writeHead(204).end();
    } else {
      const file = path.join(assets, pathname);
      if (!pathname.startsWith('/static/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'text/javascript');
      let body = fs.readFileSync(file, 'utf8');
      if (pathname === '/static/analytics.js') {
        const gate = "location.hostname !== 'buildplay.fun'";
        const config = 'window.partytown = {';
        assert.ok(body.includes(gate) && body.includes(config));
        body = body.replace(gate, 'false').replace(config, config + 'resolveUrl: ' + resolveUrl.toString() + ',');
      }
      response.end(body);
    }
  });
}

async function observe(type) {
  const hits = [];
  const paths = [];
  const errors = [];
  const server = serve(hits, paths);
  const context = await type.launchPersistentContext('');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const setView = (id, screen) => page.evaluate(([id, screen]) => {
      window.BuildPlayAnalytics.setPortalView(id, screen);
    }, [id, screen]);
    async function waitForScreen(id, screen) {
      const deadline = Date.now() + 30000;
      while (!hits.some(hit => hit.event === 'portal_screen' && hit.account === id && hit.screen === screen)) {
        if (Date.now() >= deadline) {
          const browser = await page.evaluate(() => ({
            online: navigator.onLine,
            scripts: [...document.scripts].map(script => [script.type, script.src]),
          }));
          throw new Error(JSON.stringify({engine: type.name(), missing: screen, paths, hits, errors, browser}));
        }
        await page.waitForTimeout(100);
      }
    }
    await page.goto('http://127.0.0.1:' + server.address().port);
    assert.ok(!paths.includes('/vendor.js'));
    await setView(account, 'games');
    await waitForScreen(account, 'games');
    await setView(account, 'match');
    await waitForScreen(account, 'match');
    await page.evaluate(() => window.BuildPlayAnalytics.clearUser());
    assert.equal(await page.evaluate(id => window['ga-disable-' + id], measurement), true);
    await setView(null, 'account');
    await setView('ci-next-account', 'games');
    await waitForScreen('ci-next-account', 'games');
    assert.ok(!hits.some(hit => hit.event === 'portal_screen' && (!hit.account || hit.screen === 'account')));
    assert.equal(hits.filter(hit => hit.event === 'page_view' && hit.account === account).length, 1);
    assert.deepEqual(hits.filter(hit => hit.event === 'portal_screen').map(hit => hit.screen), ['games', 'match', 'games']);
    assert.equal(paths.filter(pathname => pathname === '/vendor.js').length, 1);
    const workerTag = await page.locator('script[src*="/vendor.js"],script[src*="googletagmanager.com/gtag/js"]').getAttribute('type');
    assert.ok(workerTag?.startsWith('text/partytown'), 'Google tag must execute in the worker');
    console.log(type.name(), hits);
  } finally {
    await context.close();
    server.close();
  }
}

(async () => {
  for (const type of [chromium, webkit]) await observe(type);
})().catch(error => { console.error(error); process.exitCode = 1; });
