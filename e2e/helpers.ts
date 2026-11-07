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

/** The client string table embedded in the tic-tac-toe HTML (i18n-strings block). */
function clientStrings(): Record<string, string> {
  const m = TICTACTOE.match(/<script[^>]*id="i18n-strings"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('tictactoe.html has no i18n-strings block');
  return JSON.parse(m[1]);
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
function caseImages(prefix: string) {
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

function testCtx(seed: number) {
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

/** Publishes the real (server-side) tic-tac-toe game owned by [owner]. Returns its id.
 * Games are created only through POST /agent/games (there is no POST /games), so this
 * builds the full import payload: schemas + 3 unit-test cases + tutorial + images +
 * translations for all 7 non-English languages (prefixed with the locale tag, the same
 * trick the Python agent-import tests use). */
export async function createGame(request: APIRequestContext, owner: Account, name: string): Promise<string> {
  const rules =
    'Two players take turns placing X and O on a 3x3 board. ' +
    'The first to get three marks in a row wins. If the board fills with no winner, the match is a draw.';
  const ui =
    'A 3x3 grid of tappable cells and a status line. Use a calm blue theme, readable on phones.';
  const tutorialText = 'Take turns placing X and O. Get three in a row to win.';
  const tutorialHtml =
    '<meta name="viewport" content="width=device-width">' +
    '<h1>How to play</h1><p>Take turns placing X and O. Get three in a row to win.</p>';
  const tutorialVocab = ['How to play', tutorialText];
  const strings = clientStrings();
  const empty = ['', '', '', '', '', '', '', '', ''];
  const cases = [
    {
      name: 'Initial move',
      description: 'Alice places X in the center.',
      kind: 'initial',
      ctx: testCtx(1),
      state: { board: empty, winner: null, draw: false },
      view_of_mover: viewOf(empty),
      view_of_other: viewOf(empty),
      player_id: 'u1',
      other_player_id: 'u2',
      move: { cell: 4 },
      expected_state: { board: ['', '', '', '', 'X', '', '', '', ''], winner: null, draw: false },
      expected_turn: ['u2'],
      expected_view_of_mover: viewOf(['', '', '', '', 'X', '', '', '', '']),
      expected_view_of_other: viewOf(['', '', '', '', 'X', '', '', '', '']),
      images: caseImages('Initial move'),
    },
    {
      name: 'Intermediate move',
      description: 'Bob places O in the bottom-right corner.',
      kind: 'intermediate',
      ctx: testCtx(2),
      state: { board: ['X', 'X', '', '', 'O', '', '', '', ''], winner: null, draw: false },
      view_of_mover: viewOf(['X', 'X', '', '', 'O', '', '', '', '']),
      view_of_other: viewOf(['X', 'X', '', '', 'O', '', '', '', '']),
      player_id: 'u2',
      other_player_id: 'u1',
      move: { cell: 8 },
      expected_state: { board: ['X', 'X', '', '', 'O', '', '', '', 'O'], winner: null, draw: false },
      expected_turn: ['u1'],
      expected_view_of_mover: viewOf(['X', 'X', '', '', 'O', '', '', '', 'O']),
      expected_view_of_other: viewOf(['X', 'X', '', '', 'O', '', '', '', 'O']),
      images: caseImages('Intermediate move'),
    },
    {
      name: 'Terminal move',
      description: 'Alice completes the top row and wins.',
      kind: 'terminal',
      ctx: testCtx(3),
      state: { board: ['X', 'X', '', 'O', 'O', '', '', '', ''], winner: null, draw: false },
      view_of_mover: viewOf(['X', 'X', '', 'O', 'O', '', '', '', '']),
      view_of_other: viewOf(['X', 'X', '', 'O', 'O', '', '', '', '']),
      player_id: 'u1',
      other_player_id: 'u2',
      move: { cell: 2 },
      expected_state: { board: ['X', 'X', 'X', 'O', 'O', '', '', '', ''], winner: 0, draw: false },
      expected_turn: null,
      expected_view_of_mover: viewOf(['X', 'X', 'X', 'O', 'O', '', '', '', ''], 0),
      expected_view_of_other: viewOf(['X', 'X', 'X', 'O', 'O', '', '', '', ''], 0),
      expected_payouts: { u1: 0, u2: 0 },
      images: caseImages('Terminal move'),
    },
  ];
  const translations: Record<string, unknown> = {};
  for (const loc of ['es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar']) {
    const tag = `[${loc}] `;
    translations[loc] = {
      display_name: tag + name,
      short_description: tag + 'UI test game',
      game_logic_rules: tag + rules,
      game_ui_rules: tag + ui,
      tutorial_strings: Object.fromEntries(tutorialVocab.map((s) => [s, tag + s])),
      client_strings: Object.fromEntries(Object.entries(strings).map(([k, v]) => [k, tag + v])),
    };
  }
  const res = await request.post('/agent/games', {
    headers: { 'X-User-Id': owner.id, 'X-User-Password': owner.password },
    data: {
      name,
      description: 'UI test game',
      allowed_player_counts: [2],
      client_code: TICTACTOE,
      server_code: TICTACTOE_SERVER,
      rules,
      ui_instructions: ui,
      tutorial: { text: tutorialText, html: tutorialHtml },
      images: [
        { caption: 'Tic-tac-toe', svg: COVER_SVG },
        labelSvg('Board'),
        labelSvg('X wins'),
        labelSvg('Draw'),
      ],
      unit_tests: {
        state_schema: TICTACTOE_SCHEMAS.state,
        move_schema: TICTACTOE_SCHEMAS.move,
        view_schema: TICTACTOE_SCHEMAS.view,
        cases,
      },
      translations,
      game_addition_request_id_and_secret: `e2e-${Date.now()}-${Math.floor(Math.random() * 1e9)}-secret`,
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
