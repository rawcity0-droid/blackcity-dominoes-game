// Screens for "Return to your game": back to menu, then a full page reload (like closing and reopening the app).
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE ?? 'http://localhost:3312';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
for (const [label, vp] of [['phone', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['tablet', { width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]] as const) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport(vp);
  p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await p.goto(BASE, { waitUntil: 'load' }); await sleep(500);
  await p.type('.me-row input', 'Raw');
  await (await p.$$('xpath/.//button[text()="Play"]'))[0].click(); await sleep(2500);
  const handBefore = await p.$$eval('.hand button', (b) => b.map((x) => x.getAttribute('aria-label')));
  await p.click('.roundbtn'); await sleep(600);
  if (label === 'phone') await p.screenshot({ path: '/workspace/dominoes_rejoin_menu.png' });
  await p.reload({ waitUntil: 'load' }); await sleep(800);
  console.log(label, 'name box after reload:', JSON.stringify(await p.$eval('.me-row input', (e) => (e as HTMLInputElement).value)));
  await p.screenshot({ path: `/workspace/dominoes_rejoin_home_${label}.png` });
  await (await p.$$('xpath/.//button[text()="Return to your game"]'))[0].click(); await sleep(1200);
  const handAfter = await p.$$eval('.hand button', (b) => b.map((x) => x.getAttribute('aria-label')));
  console.log(label, 'same hand after return:', JSON.stringify(handBefore) === JSON.stringify(handAfter), handAfter.length);
  await p.screenshot({ path: `/workspace/dominoes_rejoin_back_${label}.png` });
  await ctx.close();
}
await browser.close();
