// Renders assets/logo.svg to the PNG sizes Chrome wants: `npm run icons`.
import { mkdirSync, readFileSync } from 'node:fs';

import { chromium } from 'playwright';

const svg = readFileSync('assets/logo.svg');
const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;
mkdirSync('public/icons', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>* { margin: 0 }</style><img src="${src}" width="${size}" height="${size}" style="display: block">`,
  );
  await page.screenshot({ path: `public/icons/icon-${size}.png`, omitBackground: true });
}
await browser.close();
