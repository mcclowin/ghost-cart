import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';

const repoRoot = process.cwd();
const imageArg = process.argv[2] || 'media/photo_2026-03-27_15-18-03.jpg';
const imagePath = resolve(repoRoot, imageArg);
const outDir = resolve(repoRoot, 'artifacts', 'lens-browser-test');
mkdirSync(outDir, { recursive: true });

function outPath(name) {
  return join(outDir, name);
}

async function saveState(page, name) {
  await page.screenshot({ path: outPath(`${name}.png`), fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '<html></html>');
  writeFileSync(outPath(`${name}.html`), html);
  writeFileSync(outPath(`${name}.url.txt`), page.url());
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  ],
});

const context = await browser.newContext({
  viewport: { width: 1400, height: 1100 },
  locale: 'en-GB',
});

const page = await context.newPage();

try {
  log(`Using image: ${imagePath}`);
  await page.goto('https://lens.google.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  await saveState(page, '01-home');

  const consentButtons = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Accept")',
  ];
  for (const selector of consentButtons) {
    const button = page.locator(selector).first();
    if (await button.count()) {
      try {
        await button.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        break;
      } catch {}
    }
  }

  let uploadInput = page.locator('input[type="file"]').first();
  if (!(await uploadInput.count())) {
    const uploadTriggers = [
      'button:has-text("upload")',
      'button:has-text("Upload")',
      'text="Upload a file"',
      'text="upload a file"',
      'text="Search any image with Google Lens"',
    ];

    for (const selector of uploadTriggers) {
      const trigger = page.locator(selector).first();
      if (!(await trigger.count())) continue;
      try {
        await trigger.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
        uploadInput = page.locator('input[type="file"]').first();
        if (await uploadInput.count()) break;
      } catch {}
    }
  }

  if (!(await uploadInput.count())) {
    throw new Error('Could not find a file input on lens.google.com');
  }

  log('Uploading image to Google Lens...');
  await uploadInput.setInputFiles(imagePath);
  await page.waitForTimeout(5000);
  await saveState(page, '02-after-upload');

  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await saveState(page, '03-results');

  const links = await page.locator('a[href]').evaluateAll(nodes => (
    nodes
      .map(node => ({
        href: node.href,
        text: (node.textContent || '').trim(),
      }))
      .filter(item => item.href && item.text)
      .slice(0, 80)
  ));

  writeFileSync(outPath('links.json'), JSON.stringify(links, null, 2));

  const summary = {
    finalUrl: page.url(),
    image: basename(imagePath),
    linkCount: links.length,
    sampleLinks: links.slice(0, 10),
  };
  writeFileSync(outPath('summary.json'), JSON.stringify(summary, null, 2));

  log(`Final URL: ${summary.finalUrl}`);
  log(`Captured ${summary.linkCount} links`);
  log(`Artifacts saved under ${outDir}`);
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
