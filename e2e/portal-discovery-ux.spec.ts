import {test, expect} from '@playwright/test';
import {createUser, loginAs, mockBatch, uniqueName} from './helpers';
import {contrast} from './contrast';

async function discoveryFixture(page: Parameters<typeof loginAs>[0], request: Parameters<typeof createUser>[0]) {
  const user = await createUser(request, uniqueName('Discovery visitor'));
  await loginAs(page, user);
  await mockBatch(page, request, {
    '/games': [
      {id: 'solo-puzzle', name: 'Quiet puzzle', description: 'Find the hidden pattern', version: 1, allowed_player_counts: [1], published: true},
      {id: 'party-game', name: 'Party cards', description: 'Cards with friends', version: 1, allowed_player_counts: [2, 3, 4], published: true},
    ],
  });
}

test('search and keyboard selection respect the player filter, and Browse all resets it', async ({page, request}) => {
  await discoveryFixture(page, request);
  await page.goto('/static/portal.html?skin=arcade#games');
  const solo = page.locator('[data-game-filter="solo"]');
  await solo.click();
  const search = page.locator('#game-search');
  await search.fill('cards');
  await expect(page.locator('#game-results')).toBeEmpty();
  await expect(page.locator('#library-empty')).toBeVisible();
  await search.press('Enter');
  await expect(page.locator('#game-detail-page')).toBeHidden();

  await search.fill('');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('Quiet puzzle');
  await page.locator('#browse-games').click();
  await expect(page.locator('[data-game-filter="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(solo).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(page.locator('#game-library')).toContainText('Party cards');
});

test('search displays translated game descriptions and the translated Random option', async ({page, request}) => {
  await discoveryFixture(page, request);
  await page.route('**/i18n/bundle/es', async route => {
    const response = await route.fetch();
    const bundle = await response.json();
    bundle.games['solo-puzzle'] = {name: 'Rompecabezas tranquilo', description: 'Encuentra el patrón oculto'};
    await route.fulfill({response, json: bundle});
  });
  await page.goto('/static/portal.html?skin=classic#games');
  await page.evaluate('I18n.choose("es")');
  const search = page.locator('#game-search');
  await search.fill('patrón');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('Encuentra el patrón oculto');
  await search.fill('aleatorio');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('Aleatorio');
  await expect(page.getByRole('option')).not.toContainText('Join an open match');
  await page.evaluate('I18n.choose("fr")');
  await search.fill('');
  await expect(page.getByRole('option').first()).toContainText('Aléatoire');
  await expect(page.getByRole('option').first()).not.toContainText('Aleatorio');
});

test('leaderboard tabs support arrow, Home, End and Tab navigation', async ({page, request}) => {
  await discoveryFixture(page, request);
  await page.goto('/static/portal.html?skin=arcade#leaderboards');
  const gems = page.getByRole('tab', {name: 'Gems'});
  const wins = page.getByRole('tab', {name: 'Wins'});
  await gems.focus();
  await gems.press('ArrowRight');
  await expect(wins).toBeFocused();
  await expect(wins).toHaveAttribute('aria-selected', 'true');
  await expect(gems).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#leaderboard-wins')).toBeVisible();
  await expect(page.locator('#leaderboard-tokens')).toBeHidden();
  await wins.press('Home');
  await expect(gems).toBeFocused();
  await gems.press('End');
  await expect(wins).toBeFocused();
  await wins.press('ArrowLeft');
  await expect(gems).toBeFocused();
  await gems.press('Tab');
  await expect(wins).not.toBeFocused();
});

for (const skin of ['sunset', 'meadow', 'isaac-ui', 'lobby', 'library', 'white']) {
  test(`${skin} keeps game proposal copy and its submission status readable`, async ({page, request}) => {
    await discoveryFixture(page, request);
    await page.goto(`/static/portal.html?skin=${skin}#games`);
    const copy = page.locator('.game-proposal > p').first();
    await expect(copy).toBeVisible();
    expect(await contrast(copy)).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page.locator('#browse-games'))).toBeGreaterThanOrEqual(4.5);
    // Exercise real form validation and submission, with only the response stubbed.
    await page.route('**/game-proposals', route => route.fulfill({status: 201, json: {id: 'proposal'}}));
    await page.locator('#proposal-name').fill('A new party game');
    await page.locator('#proposal-submit').click();
    await expect(page.locator('#proposal-status')).toContainText('Thank you');
    expect(await contrast(page.locator('#proposal-status'))).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator('#proposal-name')).toHaveValue('');
  });
}
