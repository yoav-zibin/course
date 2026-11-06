import { test, expect } from '@playwright/test';
import { createGame, createUser, loginAs, uniqueName } from './helpers';

test('a guest reports a player and sends feedback on the website; both show on the admin Feedback tab', async ({ browser, request }) => {
  const alice = await createUser(request, uniqueName('Alice'));
  const bob = await createUser(request, uniqueName('Bob'));
  const gameId = await createGame(request, bob, uniqueName('Duel'));
  const auth = (u: typeof alice) => ({ 'X-User-Id': u.id, 'X-User-Password': u.password });
  const match = await (await request.post('/matches', { headers: auth(bob), data: { game_id: gameId } })).json();
  expect((await request.post(`/matches/${match.id}/join`, { headers: auth(alice) })).ok()).toBeTruthy();
  expect((await request.post(`/matches/${match.id}/start`, { headers: auth(bob), data: {} })).ok()).toBeTruthy();

  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, alice);
  await page.goto(`/static/portal.html#match=${match.id}`);
  const toggle = page.locator('#match-controls-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();

  // Only the other player can be reported; never yourself. A report is always a problem.
  const reportBob = page.getByRole('button', { name: `Report player ${bob.display_name}` });
  await expect(reportBob).toBeVisible();
  await expect(page.locator('#seats .feedback-report')).toHaveCount(1);
  await reportBob.click();
  const dialog = page.getByRole('dialog', { name: "What's wrong?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#feedback-kind')).toHaveCount(0);
  await expect(dialog.locator('#feedback-send')).toBeDisabled();
  await dialog.locator('#feedback-text').fill('Their name is offensive');
  await expect(dialog.locator('#feedback-counter')).toHaveText('23 / 1000');
  await dialog.locator('#feedback-send').click();
  await expect(dialog.locator('#feedback-thanks')).toHaveText('Thanks for the feedback!');
  await dialog.locator('#feedback-done').click();
  await expect(dialog).toBeHidden();

  // "Send feedback" in the account menu is about the website, with a choice of kind. (From
  // the games page: on the match page the open menu is drawn behind the match controls.)
  await page.goto('/static/portal.html');
  await page.locator('#account-menu .auth-menu-button').click();
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  const website = page.getByRole('dialog', { name: 'Report a bug' });
  await expect(website).toBeVisible();
  await website.getByRole('radio', { name: 'Suggestion' }).check();
  await expect(page.getByRole('dialog', { name: 'Suggest something' })).toBeVisible();
  await page.locator('#feedback-text').fill('A dark mode, please');
  await page.locator('#feedback-send').click();
  await expect(page.locator('#feedback-thanks')).toHaveText('Thanks for the feedback!');
  await page.locator('#feedback-done').click();
  await context.close();

  // The admin's Feedback tab (the test server has no master password).
  const admin = await browser.newPage();
  await admin.goto('/admin#feedback');
  const tab = admin.frameLocator('#admin-frame, iframe').first();
  await expect(tab.locator('#feedback')).toContainText('Their name is offensive');
  await expect(tab.locator('#feedback')).toContainText('A dark mode, please');
  await expect(tab.locator('#feedback')).toContainText(alice.display_name);
  await expect(tab.locator('#most')).toContainText(bob.display_name);
  await tab.locator('#filter-kind').selectOption('suggestion');
  await expect(tab.locator('#feedback')).not.toContainText('Their name is offensive');
  await expect(tab.locator('#feedback')).toContainText('A dark mode, please');
  await admin.close();
});
