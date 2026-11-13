import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createGame, createUser, loginAs, mockBatch, uniqueName } from './helpers';

/** The portal requires a login; plant a real account in the browser. */
async function login(page: Page, request: Parameters<typeof createUser>[0]) {
  const user = await createUser(request, uniqueName('Portal visitor'));
  await loginAs(page, user);
}

test.describe('Portal', () => {
  test('loads with the right title and heading', async ({ page, request }) => {
    await login(page, request);
    await page.goto('/static/portal.html');
    await expect(page).toHaveTitle(/Games/);
    await expect(page.getByRole('heading', { name: 'BuildPlay.fun' })).toBeVisible();
  });

  test('sends logged-out visitors to the login page and back', async ({ page }) => {
    await page.goto('/static/portal.html');
    await expect(page).toHaveURL(/\/\?next=/);
    await expect(page.locator('#welcome-guest')).toBeVisible();
    await page.locator('#welcome-guest-name').fill(uniqueName('Portal guest'));
    await page.locator('#welcome-guest').click();
    await expect(page).toHaveURL(/\/static\/portal\.html$/);
    await expect(page.getByRole('heading', { name: 'BuildPlay.fun' })).toBeVisible();
  });

  test('the All games link leaves a game page however it was opened', async ({ page, request }) => {
    const user = await createUser(request, uniqueName('Detail visitor'));
    const game = await createGame(request, user, uniqueName('Detail noughts'));
    await loginAs(page, user);
    // Both link forms land on the game's page: #game= from shared quick
    // links, ?game= from the catalog's game cards.
    for (const url of [`/static/portal.html#game=${game}`, `/static/portal.html?game=${game}`]) {
      await page.goto(url);
      await expect(page.locator('#game-detail-page')).toBeVisible();
      await expect(page.locator('#selected-game-name')).toContainText('Detail noughts');
      await page.locator('.back-to-games').click();
      await expect(page.locator('#game-detail-page')).toBeHidden();
      await expect(page.locator('#game-search')).toBeVisible();
      await expect(page).not.toHaveURL(/game=/);
      await page.goBack();
      await expect(page.locator('#game-detail-page')).toBeVisible();
      await expect(page.locator('#selected-game-name')).toContainText('Detail noughts');
      await page.goForward();
      await expect(page.locator('#game-detail-page')).toBeHidden();
    }
  });

  test('stake labels follow the language and skin after switching either', async ({ page, request }) => {
    await login(page, request);
    await page.goto('/static/portal.html?skin=arcade');
    await page.evaluate("I18n.choose('es')");
    await expect(page.locator('#match-stake option[value="1"]')).toHaveText('1 gema');
    await expect(page.locator('#stake-help')).toContainText('+10 gemas');
    await expect(page.locator('#stake-preview')).toContainText('gemas');
    await page.locator('#account-menu .auth-menu-button').click();
    await page.selectOption('#portal-skin-picker', 'classic');
    await expect(page.locator('#match-stake option[value="1"]')).toHaveText('1 ficha');
    await expect(page.locator('#stake-help')).toContainText('+10 fichas');
    await page.evaluate("I18n.choose('fr')");
    await expect(page.locator('#match-stake option[value="1"]')).toHaveText('1 jeton');
    await page.selectOption('#portal-skin-picker', 'neon');
    await expect(page.locator('#match-stake option[value="1"]')).toHaveText('1 gemme');
    await expect(page.locator('#stake-help')).toContainText('+10 gemmes');
  });

  test('match groups start empty', async ({ page, request }) => {
    await login(page, request);
    await page.goto('/static/portal.html');
    for (const id of ['turn', 'ongoing', 'waiting', 'over']) {
      await expect(page.locator(`#count-${id}`)).toHaveText('0');
    }
  });

  test('shows an error-free page when the games API fails', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await login(page, request);
    await mockBatch(page, request, {
      '/games': { status: 500, body: { detail: 'boom' } },
    });
    await page.goto('/static/portal.html');
    await expect(page.getByRole('heading', { name: 'BuildPlay.fun' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('lists a mocked game in the library', async ({ page, request }) => {
    await login(page, request);
    await mockBatch(page, request, {
      '/games': [
        {
          id: 'g1', name: 'Mock Chess', version: 1, description: 'A mocked game',
          allowed_player_counts: [2], published: true, owner_user_id: 'u1',
        },
      ],
    });
    await page.goto('/static/portal.html');
    await page.getByRole('button', { name: 'Browse all games' }).click();
    await expect(page.getByText('Mock Chess').first()).toBeVisible();
  });
});
