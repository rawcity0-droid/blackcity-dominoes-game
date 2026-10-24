// Screenshots of the own-photo flow: `PORT=3312 npm start`, then `BASE=http://localhost:3312 tsx scripts/photo-shots.ts`.
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE ?? 'http://localhost:3312';
const PHOTO = process.env.PHOTO ?? '/tmp/test_photo.jpg';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
for (const [tag, vp] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]] as const) {
  const p = await browser.newPage();
  await p.setViewport({ ...vp, isMobile: true, deviceScaleFactor: 2, hasTouch: true });
  p.on('dialog', async (d) => { console.log('DIALOG', d.message()); await d.dismiss(); });
  p.on('console', (m) => console.log('CONSOLE', m.text()));
  p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await p.goto(BASE, { waitUntil: 'load' }); await sleep(500);
  const [chooser] = await Promise.all([p.waitForFileChooser(), p.evaluate(() => ([...document.querySelectorAll('button')].find((b) => b.textContent!.includes('Use my photo')) as HTMLElement).click())]);
  await chooser.accept([PHOTO]); await sleep(800);
  await p.screenshot({ path: `/workspace/dominoes_photo_${tag}_preview.png` });
  await p.evaluate(() => ([...document.querySelectorAll('button')].find((b) => b.textContent === 'Use this photo') as HTMLElement).click());
  await sleep(300);
  console.log(tag, 'saved chars', await p.evaluate(() => localStorage.getItem('dom_face')!.length), 'name box:', JSON.stringify(await p.$eval('.me-row input', (i: any) => i.value)));
  await p.reload({ waitUntil: 'load' }); await sleep(500);
  await p.screenshot({ path: `/workspace/dominoes_photo_${tag}_home.png` });
  await p.evaluate(() => (window as any).__dom.start('play')); await sleep(2500);
  await p.screenshot({ path: `/workspace/dominoes_photo_${tag}_table.png` });
  await p.close();
}
await browser.close();
