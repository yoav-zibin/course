import {test, expect, type Locator} from '@playwright/test';
import {createUser, createGame, loginAs, uniqueName} from './helpers';
import {contrast} from './contrast';


async function settledContrast(locator: Locator) {
  await locator.evaluate(async element => {
    // Theme discovery and hover can animate both the ink and its backdrop.
    // Measure their settled colors without disabling real UI animations.
    for (;;) {
      const pending = new Set<Animation>();
      for (let node: Element | null = element; node; node = node.parentElement) {
        for (const animation of node.getAnimations()) {
          if ((animation.playState === 'running' || animation.pending) &&
              Number.isFinite(animation.effect?.getComputedTiming().endTime)) pending.add(animation);
        }
      }
      if (!pending.size) break;
      await Promise.all([...pending].map(animation => animation.finished.catch(() => {})));
    }
  });
  return contrast(locator);
}


for (const skin of ['isaac-ui', 'lobby', 'library', 'white']) {
  test(`${skin} keeps discovery controls and game names readable`, async ({page, request}) => {
    const user = await createUser(request, uniqueName('Light skin'));
    await createGame(request, user, uniqueName('Contrast game'));
    await loginAs(page, user);
    await page.goto(`/static/portal.html?skin=${skin}#games`);
    await expect(page.locator('#portal-skin-picker option[value="' + skin + '"]')).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('data-skin', skin);
    await expect(page.locator('.library-card').first()).toBeVisible();
    const selectors = ['#browse-games', '.game-label', '.library-count',
      '.library-toolbar button[aria-pressed="false"]', '.library-toolbar button[aria-pressed="true"]',
      '.popular-game-title', '.popular-game-players', '.popular-game-open'];
    for (const selector of selectors) {
      const label = page.locator(selector).first();
      if (await label.isVisible()) expect(await settledContrast(label), `${skin}: ${selector}`).toBeGreaterThanOrEqual(4.5);
    }
    await page.locator('#browse-games').click();
    const option = page.locator('.game-option').first();
    await expect(option).toBeVisible();
    expect(await settledContrast(option), `${skin}: search result`).toBeGreaterThanOrEqual(4.5);
    await option.hover();
    expect(await settledContrast(option), `${skin}: hovered search result`).toBeGreaterThanOrEqual(4.5);
  });
}
