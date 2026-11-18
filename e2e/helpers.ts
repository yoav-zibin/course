import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

export const DECLARATIVE_TICTACTOE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../games/declarative/tictactoe.json'), 'utf8'),
);

export interface Account { id: string; display_name: string; password: string }

// Public credentials for the disposable loopback server in start-server.py.
// Apply only to administrator workflows; player contexts stay unprivileged.
export const E2E_ADMIN_CREDENTIALS = {username: 'e2e-admin', password: 'e2e-test-master'};
export const E2E_ADMIN_HEADERS = {
  Authorization: `Basic ${Buffer.from(`${E2E_ADMIN_CREDENTIALS.username}:${E2E_ADMIN_CREDENTIALS.password}`).toString('base64')}`,
};

/** Creates a real guest user on the test server (the same call the Log in dialog makes). */
export async function createUser(request: APIRequestContext, name: string): Promise<Account> {
  const res = await request.post('/users', { data: { display_name: name } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

const COVER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">' +
  '<rect width="1600" height="900" fill="#eef2ff"/>' +
  '<rect x="100" y="100" width="1400" height="700" rx="40" fill="#8899ee"/></svg>';
function labelSvg(label: string) {
  return {
    caption: label,
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">' +
      '<rect width="400" height="400" fill="#eef2ff"/>' +
      `<text x="30" y="60" fill="#182140" font-size="28">${label}</text></svg>`,
  };
}
export function caseImages(prefix: string) {
  return ['Alice', 'spectator', 'Alice after', 'spectator after'].map((who) =>
    labelSvg(`${prefix}: ${who}`),
  );
}

function viewOf(board: string[], winner: number | null = null, draw = false) {
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  let line: number[] | null = null;
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) line = [a, b, c];
  }
  return { board, winner, draw, line };
}

export function testCtx(seed: number) {
  return {
    players: [
      { id: 'u1', kind: 'human', display_name: 'Alice', picture_url: '', max_loss: 0 },
      { id: 'u2', kind: 'human', display_name: 'Bob', picture_url: '', max_loss: 0 },
    ],
    pot: 0,
    move_count: 0,
    seed,
  };
}

export interface ImportGameOptions {
  name: string;
  description: string;
  allowedPlayerCounts: number[];
  allowsLeaveMidMatch?: boolean;
  allowsJoinMidMatch?: boolean;
  declarativeUI: Record<string, unknown>;
  serverCode: string;
  rules: string;
  uiInstructions: string;
  tutorialText: string;
  tutorialHtml: string;
  tutorialVocab: string[];
  clientStrings: Record<string, string>;
  schemas: { state: unknown; move: unknown; view: unknown };
  cases: unknown[];
}

/** Publishes a declarative game owned by [owner]. Builds the full import payload: schemas +
 * unit-test cases + tutorial + images + translations for all 7 non-English languages
 * (prefixed with the locale tag, the same trick the Python agent-import tests use). */
export async function importGame(
  request: APIRequestContext,
  owner: Account,
  opts: ImportGameOptions,
): Promise<string> {
  test.setTimeout(Math.max(test.info().timeout, 120_000));
  const translations: Record<string, unknown> = {};
  for (const loc of ['es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar']) {
    const tag = `[${loc}] `;
    translations[loc] = {
      display_name: tag + opts.name,
      short_description: tag + opts.description,
      game_logic_rules: tag + opts.rules,
      game_ui_rules: tag + opts.uiInstructions,
      tutorial_strings: Object.fromEntries(opts.tutorialVocab.map((s) => [s, tag + s])),
      client_strings: Object.fromEntries(Object.entries(opts.clientStrings).map(([k, v]) => [k, tag + v])),
    };
  }
  const data = {
    name: opts.name,
    description: opts.description,
    allowed_player_counts: opts.allowedPlayerCounts,
    allows_leave_mid_match: opts.allowsLeaveMidMatch ?? false,
    allows_join_mid_match: opts.allowsJoinMidMatch ?? false,
    declarative_ui: opts.declarativeUI,
    server_code: opts.serverCode,
    rules: opts.rules,
    ui_instructions: opts.uiInstructions,
    tutorial: { text: opts.tutorialText, html: opts.tutorialHtml },
    images: [
      { caption: opts.name, svg: COVER_SVG },
      labelSvg('Board'),
      labelSvg('A win'),
      labelSvg('A draw'),
    ],
    unit_tests: {
      state_schema: opts.schemas.state,
      move_schema: opts.schemas.move,
      view_schema: opts.schemas.view,
      cases: opts.cases,
    },
    translations,
    game_addition_request_id_and_secret: `e2e-${Date.now()}-${Math.floor(Math.random() * 1e9)}-secret`,
  };
  // The server validates at most two uploads at once and answers 429 "Validation
  // capacity is busy" with a Retry-After; parallel workers hit that, so wait and retry.
  let res = await request.post('/games/declarative', {
    headers: { 'X-User-Id': owner.id, 'X-User-Password': owner.password },
    data,
  });
  for (let attempt = 0; res.status() === 429 && attempt < 20; attempt++) {
    const seconds = Number(res.headers()['retry-after']) || 2;
    await new Promise((resolve) => setTimeout(resolve, Math.min(seconds, 3) * 1000 * (0.5 + Math.random())));
    res = await request.post('/games/declarative', {
      headers: { 'X-User-Id': owner.id, 'X-User-Password': owner.password },
      data,
    });
  }
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id;
}

/** Publishes a real declarative tic-tac-toe game through the normal validators. */
export async function createGame(request: APIRequestContext, owner: Account, name: string): Promise<string> {
  // Complete declaration validation may queue behind another browser worker.
  test.setTimeout(Math.max(test.info().timeout, 120_000));
  const payload = structuredClone(DECLARATIVE_TICTACTOE);
  payload.name = name;
  payload.description = 'UI test game';
  payload.game_addition_request_id_and_secret = uniqueName('declarative-ui-test-secret');
  const headers = { 'X-User-Id': owner.id, 'X-User-Password': owner.password };
  let response = await request.post('/games/declarative', {headers, data:payload, timeout:210000});
  for (let attempt=0; response.status()===429 && attempt<20; attempt++) {
    await new Promise(resolve=>setTimeout(resolve, 1000 + Math.random()*1500));
    response = await request.post('/games/declarative', {headers, data:payload, timeout:210000});
  }
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).id;
}

/** Pretends the browser already logged in as [user], as the site itself stores it. */
export async function loginAs(page: Page, user: Account) {
  const stored = { ...user, linked: [], picture_url: '' };
  await page.addInitScript((u) => {
    if (window !== window.top) return;
    localStorage.setItem('game-platform.accounts.v1', JSON.stringify([u]));
    localStorage.setItem('game-platform.current-account.v1', u.id);
  }, stored);
}

/** Reveal match navigation without taking space from an immersive board. */
export async function showMatchMenu(page: Page) {
  const menu = page.locator('#match-menu-toggle');
  await expect(menu).toBeVisible();
  if (await menu.getAttribute('aria-expanded') !== 'true')
    await menu.click();
}

/** Open the deliberate navigation disclosure before its Controls panel. */
export async function openMatchControls(page: Page) {
  const toggle = page.locator('#match-controls-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') {
    await showMatchMenu(page);
    await toggle.click();
  }
  await expect(page.locator('#match-tools')).toBeVisible();
}

export const uniqueName = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

/** Mocks GET endpoints for a portal page now that reads go through /batch.
 * Intercepts /batch calls and answers each sub-request from [mocks], keyed by
 * the request path without its query string. A mock is a response body (200),
 * a {status, body} object, or a function (path) => body | {status, body} for
 * query-dependent answers. Sub-requests not in [mocks] are fetched from the
 * real server with the batch call's own auth headers, so a test can mock one
 * endpoint while the rest behave normally. */
export async function mockBatch(
  page: Page,
  request: APIRequestContext,
  mocks: Record<string, unknown>,
) {
  await page.route('**/batch?*', async (route) => {
    const url = new URL(route.request().url());
    const items = JSON.parse(url.searchParams.get('requests') || '[]') as {
      path: string;
    }[];
    const headers = route.request().headers();
    const auth: Record<string, string> = {};
    for (const name of ['x-user-id', 'x-user-password', 'x-campaign-code']) {
      if (headers[name]) auth[name] = headers[name];
    }
    const results: { status: number; body: unknown }[] = new Array(items.length);
    const forwards: Promise<void>[] = [];
    for (let i = 0; i < items.length; i++) {
      const path = items[i].path;
      const pathname = path.split('?')[0];
      const mock = mocks[pathname];
      if (mock !== undefined) {
        const value =
          typeof mock === 'function' ? (mock as (p: string) => unknown)(path) : mock;
        if (value && typeof value === 'object' && 'body' in (value as Record<string, unknown>)) {
          const m = value as { status?: number; body: unknown };
          results[i] = { status: m.status ?? 200, body: m.body };
        } else {
          results[i] = { status: 200, body: value };
        }
      } else {
        // Forward to the real server. Unmocked sub-requests run in parallel so
        // a batch does not stall on them one by one. If the test already tore
        // the page down (a poll in flight when the test ends), answer 500
        // instead of throwing out of the route handler.
        forwards.push(
          (async () => {
            try {
              const res = await request.get(path, { headers: auth });
              const text = await res.text();
              let body: unknown = null;
              try {
                body = text ? JSON.parse(text) : null;
              } catch {
                body = text;
              }
              results[i] = { status: res.status(), body };
            } catch {
              results[i] = { status: 500, body: { detail: 'mock teardown' } };
            }
          })(),
        );
      }
    }
    await Promise.all(forwards);
    await route.fulfill({ json: results });
  });
}
