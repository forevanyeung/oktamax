/**
 * Everything the Chrome Web Store listing uploads, in store/upload/: the icon and promo
 * tiles rendered from store/promo.html, and the five numbered screenshots that
 * e2e/screenshots.ts takes for the site. The listing's text is store/listing.md.
 *
 * Run: npm run store-assets
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const storeDir = resolve(import.meta.dirname, '../store');
const outDir = join(storeDir, 'upload');
const screenshotsDir = resolve(import.meta.dirname, '../../site/screenshots');

const artwork = [
  { variant: 'icon', file: 'icon-128.png', width: 128, height: 128 },
  { variant: 'tile', file: 'promo-small-440x280.png', width: 440, height: 280 },
  { variant: 'marquee', file: 'promo-marquee-1400x560.png', width: 1400, height: 560 },
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const { variant, file, width, height } of artwork) {
  const page = await browser.newPage({ viewport: { width, height } });
  const url = pathToFileURL(join(storeDir, 'promo.html'));
  url.searchParams.set('variant', variant);
  await page.goto(url.href);
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  // Only the icon may be transparent: the store wants tiles without an alpha channel.
  await page.screenshot({ path: join(outDir, file), omitBackground: variant === 'icon' });
  await page.close();
}
await browser.close();

for (const name of readdirSync(screenshotsDir)
  .filter((f) => /^\d-[^@]+\.png$/.test(f))
  .sort()) {
  copyFileSync(join(screenshotsDir, name), join(outDir, `screenshot-${name}`));
}

console.log(`Wrote ${readdirSync(outDir).length} files to ${outDir}`);
