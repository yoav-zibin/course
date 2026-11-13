import {test, expect, type Locator} from '@playwright/test';
import {createUser, loginAs, uniqueName} from './helpers';

async function contrast(locator: Locator) {
  return locator.evaluate(element => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const luminance = (color: number[]) => color.slice(0, 3).map(value => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    let background = [255, 255, 255];
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
    for (const node of ancestors) {
      const color = rgb(getComputedStyle(node).backgroundColor);
      const alpha = color[3] ?? 1;
      background = background.map((value, i) => color[i] * alpha + value * (1 - alpha));
    }
    const a = luminance(rgb(getComputedStyle(element).color));
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

for (const skin of ['isaac-ui', 'lobby', 'library', 'white',
  'one-punch-man', 'frieren', 'my-hero-academia', 'spy-x-family']) {
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
