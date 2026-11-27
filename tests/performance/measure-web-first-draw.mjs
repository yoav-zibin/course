import {access, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const output = process.argv[2];
if (!output) throw new Error('Provide the output JSON path.');
const root = new URL('../../static/app/', import.meta.url);
const index = await readFile(new URL('index.html', root));
const samples = [];
const browser = await chromium.launch();

try {
  for (let trial = 0; trial < 5; trial++) {
    const context = await browser.newContext({
      viewport: {width: 393, height: 852},
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
    });
    try {
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://127.0.0.1:18764') return route.abort();
        if (url.pathname === '/portal') {
          return route.fulfill({contentType: 'text/html', body: index});
        }
        if (url.pathname.startsWith('/static/app/')) {
          const asset = new URL(url.pathname.slice('/static/app/'.length), root);
          if (!asset.href.startsWith(root.href)) return route.abort();
          const path = fileURLToPath(asset);
          await access(path);
          return route.fulfill({path});
        }
        const json = url.pathname === '/auth/config' ? {} : [];
        return route.fulfill({json});
      });
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:18764/portal');
      await page.getByText('Let’s play.', {exact: true}).waitFor();
      const paint = await page.waitForFunction(() =>
        performance.getEntriesByName('first-contentful-paint')[0]?.startTime);
      samples.push(await paint.jsonValue());
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

await writeFile(output, JSON.stringify(samples) + '\n');
console.log('Web first-contentful-paint samples (ms):', samples);
