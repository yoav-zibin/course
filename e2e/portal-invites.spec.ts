import { test, expect } from '@playwright/test';
import { createGame, createUser, loginAs, openMatchControls, uniqueName } from './helpers';

declare const Auth: any;
declare const I18n: any;

test('a persistent private invite survives polling and reload, and a new guest joins and plays', async ({ page, browser, request }, testInfo) => {
  const owner = await createUser(request, uniqueName('Private host'));
  const game = await createGame(request, uniqueName('Private friends duel'));
  await loginAs(page, owner);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async (link: string) => { (window as any).copiedInvite = link; } },
  }));
  let invitations = 0;
  page.on('request', req => { if (req.method() === 'POST' && /\/matches\/[^/]+\/invites$/.test(new URL(req.url()).pathname)) invitations++; });
  await page.goto(`/static/portal.html?skin=classic#game=${game}`);
  await page.locator('#create-private').click();
  const input = page.locator('#lobby-invite-link');
  await expect(input).toHaveValue(/#invite=/);
  const link = await input.inputValue();
  await input.focus();
  await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(4, 12));
  for (let i = 0; i < 3; i++) await page.evaluate('refresh()');
  await expect(input).toBeFocused();
  expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([4, 12]);
  await page.evaluate(async () => { await I18n.choose('ar'); });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(link);
  expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([4, 12]);
  await page.evaluate(async () => { await I18n.choose('en'); });
  expect(invitations).toBe(1);
  await page.reload();
  await expect(input).toHaveValue(link);
  expect(invitations).toBe(1);
  await page.locator('#lobby-invite-copy').click();
  await expect(page.locator('#lobby-invite-status')).toHaveText('Link copied. Send it to a friend.');
  expect(await page.evaluate(() => (window as any).copiedInvite)).toBe(link);
  await testInfo.attach('private-lobby-invite', { body: await page.screenshot(), contentType: 'image/png' });

  const friendContext = await browser.newContext(testInfo.project.use);
  try {
    const friend = await friendContext.newPage();
    await friend.goto(link);
    await expect(friend.locator('#welcome-guest-name')).toBeVisible();
    await friend.locator('#welcome-guest-name').fill(uniqueName('Invited friend'));
    await friend.locator('#welcome-guest').click();
    const invitation = friend.getByRole('dialog');
    await expect(invitation).toContainText(owner.display_name);
    await invitation.getByRole('button', { name: 'Join match', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeEnabled();
    await expect(page.locator('#lobby-invite-panel')).toBeHidden();
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async () => { throw new Error('Clipboard permission denied'); } },
    }));
    await page.locator('.invite-action').click();
    const share = page.getByRole('dialog', { name: 'Share match', exact: true });
    await expect(share.locator('#portal-share-link')).toHaveValue(/#match=/);
    await expect(share).toContainText('Only players in this private match can open this link.');
    await share.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
    await page.locator('#game-box [data-ui-id=cell_0]').click();
    await expect(friend.locator('#game-box [data-ui-id=piece_0]')).toHaveText('X');
    expect(invitations).toBe(1);
  } finally { await friendContext.close(); }
});

test('clipboard denial opens a readable share dialog and returns focus after polling', async ({ page, request }) => {
  const owner = await createUser(request, uniqueName('Share host'));
  const game = await createGame(request, uniqueName('Shared computer duel'));
  const headers = { 'X-User-Id': owner.id, 'X-User-Password': owner.password };
  const match = await (await request.post('/matches', { headers, data: { game_id: game, num_computer_opponents: 1 } })).json();
  expect((await request.post(`/matches/${match.id}/start`, { headers, data: {} })).ok()).toBeTruthy();
  await loginAs(page, owner);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { throw new Error('Clipboard permission denied'); } },
  }));
  await page.goto(`/static/portal.html#match=${match.id}`);
  await openMatchControls(page);
  await page.locator('.invite-action').click();
  const dialog = page.getByRole('dialog', { name: 'Share match', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#portal-share-link')).toHaveValue(new RegExp(`match=${match.id}`));
  await expect(dialog.locator('.portal-share-open')).toHaveAttribute('href', new RegExp(`match=${match.id}`));
  await expect(dialog.locator('#portal-share-link')).toBeFocused();
  await page.evaluate('refresh()');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.invite-action')).toBeFocused();
});

test('an invite failure waits for explicit Retry and denied clipboard keeps the link selectable', async ({ page, request }) => {
  const owner = await createUser(request, uniqueName('Retry host'));
  const game = await createGame(request, uniqueName('Invite retry duel'));
  const headers = { 'X-User-Id': owner.id, 'X-User-Password': owner.password };
  const match = await (await request.post('/matches', { headers, data: { game_id: game, private: true } })).json();
  await loginAs(page, owner);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { throw new Error('Clipboard permission denied'); } },
  }));
  let attempts = 0;
  await page.route(`**/matches/${match.id}/invites`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, json: { detail: 'Temporary invite failure' } });
    else await route.continue();
  });
  await page.goto(`/static/portal.html#match=${match.id}`);
  await expect(page.locator('#lobby-invite-copy')).toHaveText('Retry');
  await expect(page.locator('#lobby-invite-status')).toHaveText('Could not create an invite link. Try again.');
  for (let i = 0; i < 3; i++) await page.evaluate('refresh()');
  expect(attempts).toBe(1);
  await page.locator('#lobby-invite-copy').click();
  await expect(page.locator('#lobby-invite-link')).toHaveValue(/#invite=/);
  expect(attempts).toBe(2);
  await page.locator('#lobby-invite-copy').click();
  const input = page.locator('#lobby-invite-link');
  await expect(input).toBeFocused();
  await expect(page.locator('#lobby-invite-status')).toHaveText('Copy this link and send it to a friend.');
  expect(await input.evaluate((node: HTMLInputElement) => node.selectionEnd)).toBe((await input.inputValue()).length);
  expect(attempts).toBe(2);
});

test('a delayed invitation from a previous account cannot replace the current account link', async ({ page, request }) => {
  const first = await createUser(request, uniqueName('First host'));
  const second = await createUser(request, uniqueName('Second host'));
  const game = await createGame(request, uniqueName('Account invite duel'));
  const create = async (user: typeof first) => (await request.post('/matches', {
    headers: { 'X-User-Id': user.id, 'X-User-Password': user.password }, data: { game_id: game, private: true },
  })).json();
  const a = await create(first), b = await create(second);
  await page.addInitScript(({ first, second }) => {
    localStorage.setItem('game-platform.accounts.v1', JSON.stringify([first, second].map(user => ({ ...user, linked: [], picture_url: '' }))));
    localStorage.setItem('game-platform.current-account.v1', first.id);
  }, { first, second });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route(`**/matches/${a.id}/invites`, async route => {
    requested = true;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await page.goto(`/static/portal.html#match=${a.id}`);
    await expect.poll(() => requested).toBe(true);
    await page.evaluate(({ user, match }) => { Auth.setCurrent(user); location.hash = `match=${match}`; }, { user: second.id, match: b.id });
    await expect(page.locator('#lobby-invite-link')).toHaveValue(/#invite=/);
    const current = await page.locator('#lobby-invite-link').inputValue();
    release();
    await page.evaluate('refresh()');
    await expect(page.locator('#lobby-invite-link')).toHaveValue(current);
    const token = new URLSearchParams(new URL(current).hash.slice(1)).get('invite');
    const view = await (await request.get(`/invites/${token}`)).json();
    expect(view.created_by_user_id).toBe(second.id);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('retrying an ongoing private table invite selects the recovered link for manual copying', async ({ page }) => {
  // Tables that allow joining after play starts use the share dialog rather
  // than the waiting-lobby panel. Exercise real browser focus with only the
  // invitation component and a deterministic transient API failure.
  await page.route('**/invite-recovery-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<button id="share">Invite friends</button><button id="lobby-invite-copy" hidden></button>',
  }));
  await page.goto('/invite-recovery-fixture#match=ongoing-private-table');
  await page.evaluate(() => { (window as any).I18n = { t: (_key: string, _params: unknown, fallback: string) => fallback }; });
  await page.addScriptTag({ url: '/static/portal-invites.js' });
  await page.evaluate(() => {
    const invites = (window as any).PortalInvites;
    const user = { id: 'fixture-host' };
    const match = { id: 'ongoing-private-table', private: true, status: 'ongoing' };
    const options = { user, participant: true, canInvite: true };
    let attempts = 0;
    invites.init({ currentUser: () => user, request: async () => {
      if (++attempts === 1) throw new Error('Temporary invite failure');
      return { url: `${location.origin}/portal#invite=recovered-private-token` };
    } });
    invites.update(match, options);
    document.getElementById('share')!.onclick = () => invites.copy(match, options);
  });
  await page.getByRole('button', { name: 'Invite friends', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share match', exact: true });
  await expect(dialog.locator('#portal-share-link')).toBeHidden();
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  const input = dialog.locator('#portal-share-link');
  await expect(input).toHaveValue(/#invite=recovered-private-token$/);
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]))
    .toEqual([0, (await input.inputValue()).length]);
});
