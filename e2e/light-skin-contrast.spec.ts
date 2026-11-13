import {test, expect} from '@playwright/test';
import {createUser, loginAs, uniqueName} from './helpers';
import {contrast} from './contrast';


for (const skin of ['isaac-ui', 'lobby', 'library', 'white']) {
  test(`${skin} keeps discovery controls and game names readable`, async ({page, request}) => {
    await loginAs(page, await createUser(request, uniqueName('Light skin')));
    await page.goto(`/static/portal.html?skin=${skin}#games`);
    await expect(page.locator('html')).toHaveAttribute('data-skin', skin);
    await expect(page.locator('.library-card').first()).toBeVisible();
    const selectors = ['#browse-games', '.game-label', '.library-count',
      '.library-toolbar button[aria-pressed="false"]', '.library-toolbar button[aria-pressed="true"]',
      '.popular-game-title', '.popular-game-players', '.popular-game-open'];
    for (const selector of selectors) {
      const label = page.locator(selector).first();
      if (await label.isVisible()) expect(await contrast(label), `${skin}: ${selector}`).toBeGreaterThanOrEqual(4.5);
    }
    await page.locator('#browse-games').click();
    const option = page.locator('.game-option').first();
    await expect(option).toBeVisible();
    expect(await contrast(option), `${skin}: search result`).toBeGreaterThanOrEqual(4.5);
    await option.hover();
    expect(await contrast(option), `${skin}: hovered search result`).toBeGreaterThanOrEqual(4.5);
  });
}
