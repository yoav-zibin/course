import fs from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const TICTACTOE = fs.readFileSync(path.resolve(__dirname, '../games/tictactoe.html'), 'utf8');
export const TICTACTOE_SERVER = fs.readFileSync(path.resolve(__dirname, '../games/tictactoe.server.js'), 'utf8');
export const TICTACTOE_SCHEMAS = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../games/tictactoe.schema.json'), 'utf8'),
);

export interface Account { id: string; display_name: string; password: string }

/** Creates a real guest user on the test server (the same call the Log in dialog makes). */
export async function createUser(request: APIRequestContext, name: string): Promise<Account> {
  const res = await request.post('/users', { data: { display_name: name } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

/** Publishes the real (server-side) tic-tac-toe game owned by [owner]. Returns its id. */
export async function createGame(request: APIRequestContext, owner: Account, name: string): Promise<string> {
  const res = await request.post('/games', {
    headers: { 'X-User-Id': owner.id, 'X-User-Password': owner.password },
    data: {
      name, description: 'UI test game', allowed_player_counts: [2],
      code: TICTACTOE, server_code: TICTACTOE_SERVER, game_schemas: TICTACTOE_SCHEMAS,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id;
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
