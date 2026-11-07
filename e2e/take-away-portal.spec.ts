import fs from 'node:fs';
import path from 'node:path';
import {test, expect} from '@playwright/test';
import {createUser, importGame, loginAs, uniqueName, testCtx, caseImages} from './helpers';

test('Take Away plays to completion in real Portal matches', async ({browser, request}) => {
  test.setTimeout(120_000);
  const alice = await createUser(request, uniqueName('Take Away Alice'));
  const bob = await createUser(request, uniqueName('Take Away Bob'));
  const auth = (user: typeof alice) => ({'X-User-Id':user.id, 'X-User-Password':user.password});
  const client = fs.readFileSync(path.resolve(__dirname, '../games/take-away.html'), 'utf8');
  const server = fs.readFileSync(path.resolve(__dirname, '../games/take-away.server.js'), 'utf8');
  const tested = await request.post('/games/test', {headers:auth(alice), data:{
    server_code:server, allowed_player_counts:[2, 3], allows_leave_mid_match:false, allows_join_mid_match:false,
  }});
  expect(tested.ok()).toBeTruthy();
  const report = await tested.json();
  expect(report.passed).toBeTruthy();
  const gameId = await importGame(request, alice, {
    name: uniqueName('Take Away'),
    description: 'Take the last stone',
    allowedPlayerCounts: [2, 3],
    clientCode: client,
    serverCode: server,
    rules: 'Take 1, 2, or 3 stones on your turn. Whoever takes the last stone wins.',
    uiInstructions: 'A pile of stones and three take buttons. Use a calm blue theme, readable on phones.',
    tutorialText: 'Take 1, 2, or 3 stones. Whoever takes the last stone wins.',
    tutorialHtml:
      '<meta name="viewport" content="width=device-width">' +
      '<h1>How to play</h1><p>Take 1, 2, or 3 stones. Whoever takes the last stone wins.</p>',
    tutorialVocab: ['How to play', 'Take 1, 2, or 3 stones. Whoever takes the last stone wins.'],
    clientStrings: {
      title: 'Take Away',
      instructions: 'Take 1, 2, or 3 stones. Whoever takes the last stone wins.',
      waiting: 'Waiting for the match.',
      stones: 'Stones remaining',
      take: 'Take {count}',
      wins: '{name} wins!',
      your_turn: 'Your turn. {count} stones remain.',
      waiting_for: 'Waiting for {name}. {count} stones remain.',
      server_invalid_take: 'Choose one, two, or three stones that remain.',
      server_invalid_player: 'This player cannot move.',
    },
    schemas: report.game_schemas,
    cases: [
      {
        name: 'Initial move',
        description: 'Alice takes two stones from nine.',
        kind: 'initial',
        ctx: testCtx(1),
        state: { remaining: 9, winner: null },
        view_of_mover: { remaining: 9, winner: null },
        view_of_other: { remaining: 9, winner: null },
        player_id: 'u1',
        other_player_id: 'u2',
        move: { take: 2 },
        expected_state: { remaining: 7, winner: null },
        expected_turn: ['u2'],
        expected_view_of_mover: { remaining: 7, winner: null },
        expected_view_of_other: { remaining: 7, winner: null },
        images: caseImages('Initial move'),
      },
      {
        name: 'Intermediate move',
        description: 'Bob takes three stones from five.',
        kind: 'intermediate',
        ctx: testCtx(2),
        state: { remaining: 5, winner: null },
        view_of_mover: { remaining: 5, winner: null },
        view_of_other: { remaining: 5, winner: null },
        player_id: 'u2',
        other_player_id: 'u1',
        move: { take: 3 },
        expected_state: { remaining: 2, winner: null },
        expected_turn: ['u1'],
        expected_view_of_mover: { remaining: 2, winner: null },
        expected_view_of_other: { remaining: 2, winner: null },
        images: caseImages('Intermediate move'),
      },
      {
        name: 'Terminal move',
        description: 'Alice takes the last two stones and wins.',
        kind: 'terminal',
        ctx: testCtx(3),
        state: { remaining: 2, winner: null },
        view_of_mover: { remaining: 2, winner: null },
        view_of_other: { remaining: 2, winner: null },
        player_id: 'u1',
        other_player_id: 'u2',
        move: { take: 2 },
        expected_state: { remaining: 0, winner: 'u1' },
        expected_turn: null,
        expected_view_of_mover: { remaining: 0, winner: 'u1' },
        expected_view_of_other: { remaining: 0, winner: 'u1' },
        expected_payouts: { u1: 0, u2: 0 },
        images: caseImages('Terminal move'),
      },
    ],
  });

  const openMatch = async (computer: boolean) => {
    const created = await request.post('/matches', {headers:auth(alice), data:{
      game_id:gameId, num_computer_opponents:computer ? 1 : 0,
    }});
    expect(created.ok(), await created.text()).toBeTruthy();
    const match = await created.json();
    if (!computer)
      expect((await request.post(`/matches/${match.id}/join`, {headers:auth(bob)})).ok()).toBeTruthy();
    expect((await request.post(`/matches/${match.id}/start`, {headers:auth(alice), data:{}})).ok()).toBeTruthy();
    return match.id as string;
  };
  const openPlayer = async (user: typeof alice, matchId: string) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, user);
    await page.goto(`/static/portal.html#match=${matchId}`);
    return {context, page, frame:page.frameLocator('#game-box iframe')};
  };

  const soloId = await openMatch(true);
  const solo = await openPlayer(alice, soloId);
  for (let n = 0; n < 9; n++) {
    await expect.poll(async () => {
      const status = await solo.frame.locator('#status').textContent();
      return Boolean(status?.includes('wins!')) || await solo.frame.locator('button[data-take]:enabled').count() > 0;
    }, {timeout:15_000}).toBeTruthy();
    const status = await solo.frame.locator('#status').textContent();
    if (status?.includes('wins!')) break;
    await solo.frame.locator('button[data-take]:enabled').first().click({timeout:15_000});
    await expect(solo.frame.locator('#status')).not.toHaveText(status || '', {timeout:15_000});
  }
  await expect(solo.frame.locator('#status')).toContainText('wins!', {timeout:15_000});
  await solo.context.close();

  const matchId = await openMatch(false);
  const a = await openPlayer(alice, matchId);
  const b = await openPlayer(bob, matchId);
  for (let n = 0; n < 3; n++) {
    const player = n % 2 === 0 ? a : b;
    await player.frame.locator('button[data-take="3"]:enabled').click({timeout:15_000});
  }
  await expect(a.frame.locator('#status')).toContainText('wins!', {timeout:15_000});
  await expect(b.frame.locator('#status')).toContainText('wins!', {timeout:15_000});
  await a.context.close();
  await b.context.close();
});
