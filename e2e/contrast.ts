import {expect, type Locator} from '@playwright/test';

export async function contrast(locator: Locator) {
  let sampled: number | null = null;
  await expect.poll(async () => {
    sampled = await locator.evaluate(element => {
      // A polling refresh can replace a card between locator resolution and
      // evaluation. Requery it rather than reading an empty detached-node style.
      if (!element.isConnected) return null;
      const rgb = (value: string) => {
        if (value === 'transparent') return [0, 0, 0, 0];
        const match = /^rgba?\(([^)]+)\)$/.exec(value.trim());
        const parts = match?.[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        if (!parts || ![3, 4].includes(parts.length) || parts.some(value => !Number.isFinite(value)) ||
            parts.slice(0, 3).some(value => value < 0 || value > 255) ||
            parts.length === 4 && (parts[3] < 0 || parts[3] > 1))
          throw new Error(`Unsupported computed color ${JSON.stringify(value)} while measuring ${element.tagName}.${element.className}`);
        return parts;
      };
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
    return sampled;
  }, {message: 'Contrast sampling needs a connected element with computed colors'}).not.toBeNull();
  return sampled as number;
}
