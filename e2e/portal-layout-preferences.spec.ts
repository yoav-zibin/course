import { test, expect } from '@playwright/test';
import { createUser, loginAs, uniqueName } from './helpers';

for (const skin of ['classic', 'arcade', 'immersive']) {
  test(`${skin}: layout preference selects top navigation, a drawer or a docked sidebar`, async ({ page, request }) => {
    test.setTimeout(60_000);
    await loginAs(page, await createUser(request, uniqueName('Layout guest')));
    for (const width of [390, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/static/portal.html?skin=${skin}#games`);
      for (const layout of ['top', 'left', 'hamburger', '']) {
        await page.locator('.auth-menu-button').click();
        await page.locator('#portal-layout-picker').selectOption(layout);
        await page.keyboard.press('Escape');
        const modern = layout === 'top' || (!layout && skin === 'arcade');
        const navigation = page.locator('.topbar .portal-nav');
        const opener = page.locator('.topbar .sidebar-toggle');
        await expect(page.locator('html')).toHaveAttribute('data-portal-navigation', modern ? 'modern' : 'legacy');
        await expect(page.locator(modern ? '#matches-groups-home #my-matches' : '#legacy-match-navigation #my-matches')).toHaveCount(1);
        if (modern) {
          await expect(navigation).toBeVisible();
          await expect(opener).toBeHidden();
          await navigation.getByRole('link', { name: /Matches/ }).click();
          await expect(page.locator('#my-matches')).toBeVisible();
          await navigation.getByRole('link', { name: 'Leaderboards', exact: true }).click();
          await expect(page.locator('#leaderboards-screen')).toBeVisible();
          await navigation.getByRole('link', { name: 'Games', exact: true }).click();
        } else {
          await expect(navigation).toBeHidden();
          const pinned = layout === 'left' && width >= 900;
          if (pinned) {
            await expect(opener).toBeHidden();
            await expect(page.locator('#portal-sidebar')).toBeVisible();
          } else {
            await expect(opener).toBeVisible();
            await opener.click();
            await expect(page.locator('#portal-sidebar')).toBeVisible();
            await expect(page.locator('#my-matches')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(opener).toHaveAttribute('aria-expanded', 'false');
          }
        }
        await expect(page.locator('.portal-main')).not.toHaveAttribute('inert', '');
        await expect(page.locator('#token-wallet')).toHaveAttribute('data-i18n-title', skin === 'arcade'
          ? 'ui.portal.wallet_gems_title' : 'ui.portal.wallet_title');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
    }
  });
}
