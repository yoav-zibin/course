import { test, expect, type Locator } from '@playwright/test';
import { createUser, loginAs, uniqueName } from './helpers';

async function expectMenuInViewport(menu: Locator) {
  await expect.poll(() => menu.evaluate(panel => {
    const bounds = panel.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth + 1
      && bounds.top >= 0 && bounds.bottom <= document.documentElement.clientHeight + 1;
  })).toBe(true);
}

test('profile menu covers game controls', async ({ page, request }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAs(page, await createUser(request, uniqueName('Menu')));
  await page.goto('/static/portal.html');
  const toggle = page.locator('#account-menu .auth-menu-button');
  const menu = page.locator('#account-menu .auth-menu-panel');
  // The first profile response adds the wallet/avatar and can wrap the header.
  await expect(page.locator('#token-wallet')).toBeVisible();
  await expect(toggle.locator('img')).toBeVisible();
  await toggle.click();
  await expect(menu).toBeVisible();
  await expectMenuInViewport(menu);

  // Keep the real portal hierarchy and production control styles. Position a
  // representative carousel beneath the menu so every viewport tests overlap.
  await menu.evaluate(panel => {
    const bounds = panel.getBoundingClientRect();
    const left = Math.max(bounds.left + 20, 20);
    const carousel = document.createElement('div');
    carousel.id = 'stacking-carousel';
    carousel.className = 'popular-games-carousel';
    carousel.style.cssText = `position:absolute;left:0;top:0;width:${Math.min(180, bounds.right - left - 20)}px;height:210px`;
    carousel.innerHTML = `
      <div class="popular-game-card-wrap" style="height:100%">
        <button class="popular-game-card" type="button">
          <span class="popular-game-rank">1</span>
          <span class="popular-game-art" style="--art-hue:220">Game</span>
          <span class="popular-game-copy"><span class="popular-game-title">Tic-tac-toe</span></span>
        </button>
        <button class="game-quick-play primary" type="button">▶ Play</button>
      </div>
      <button class="popular-games-scroll-button is-next" type="button" aria-label="Next fixture game">›</button>`;
    document.querySelector('.portal-main')!.append(carousel);
    const origin = carousel.getBoundingClientRect();
    carousel.style.left = `${left - origin.left}px`;
    const header = document.querySelector('.topbar')!.getBoundingClientRect();
    carousel.style.top = `${Math.max(bounds.top + 24, header.bottom + 16) - origin.top}px`;
  });

  const controls = ['.popular-game-rank', '.game-quick-play', '.popular-games-scroll-button'];
  for (const selector of controls) {
    const control = page.locator(`#stacking-carousel ${selector}`);
    const hit = await control.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const panel = document.querySelector('.auth-menu-panel')!;
      const bounds = panel.getBoundingClientRect();
      return {
        overlapsMenu: x > bounds.left && x < bounds.right && y > bounds.top && y < bounds.bottom,
        menuReceivesPointer: panel.contains(document.elementFromPoint(x, y)),
      };
    });
    expect(hit.overlapsMenu, `${selector} must overlap the open menu`).toBe(true);
    expect(hit.menuReceivesPointer, `${selector} must stay behind the menu`).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('profile-menu.png') });

  await toggle.click();
  await expect(menu).toBeHidden();
  // The same controls become reachable again when the menu is dismissed.
  for (const selector of controls) {
    expect(await page.locator(`#stacking-carousel ${selector}`).evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), `${selector} must remain reachable after closing the menu`).toBe(true);
  }
});

test('an open account menu follows viewport changes and keeps its last control reachable', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAs(page, await createUser(request, uniqueName('Menu resize')));
  await page.goto('/static/portal.html');
  await expect(page.locator('#token-wallet')).toBeVisible();
  const menu = page.locator('#account-menu .auth-menu-panel');
  await page.locator('#account-menu .auth-menu-button').click();
  for (const locale of ['en', 'ar']) {
    await page.evaluate(`I18n.choose(${JSON.stringify(locale)})`);
    for (const viewport of [{width: 800, height: 360}, {width: 320, height: 568}, {width: 1440, height: 900}]) {
      await page.setViewportSize(viewport);
      await expect(menu).toBeVisible();
      await expectMenuInViewport(menu);
      const last = menu.locator('button:visible,select:visible').last();
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      expect(await last.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
      })).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
