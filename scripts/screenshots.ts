// Phone-sized screenshots of a running local server: `PORT=3311 npm start`, then `npm run screenshots`.
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE ?? 'http://localhost:3311';
const OUT = process.env.OUT ?? '/workspace';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
console.log('launched');
const VP = process.env.VP === 'tablet' ? { width: 820, height: 1180, isMobile: true } : { width: 390, height: 844, isMobile: true };
const TAG = process.env.TAG ?? '';
async function page(players: 2 | 4) {
  const p = await browser.newPage();
  await p.setViewport({ ...VP, deviceScaleFactor: 2, hasTouch: true });
  p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await p.goto(BASE, { waitUntil: 'load', timeout: 15000 });
  await p.evaluate((n) => { localStorage.setItem('dom_name', 'Raw'); localStorage.setItem('dom_face', 'c81401110330320'); localStorage.setItem('dom_players', String(n)); }, players);
  await p.reload({ waitUntil: 'load' });
  await sleep(600);
  return p;
}
/** Play my turns (tap a playable tile, pick an end if asked, draw if needed). */
async function autoplay(p: any, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await p.evaluate(() => {
      const e = document.querySelector('.end-btn') as HTMLElement | null; if (e) { e.click(); return; }
      const ok = document.querySelector('.hand button.ok') as HTMLElement | null; if (ok) { ok.click(); return; }
      const d = [...document.querySelectorAll('.actions .btn')].find((b) => b.textContent!.startsWith('Draw')) as HTMLElement | undefined; d?.click();
    });
    await sleep(600);
  }
}
async function waitMyTurn(p: any) { for (let i = 0; i < 30 && !(await p.$('.hand button.ok')); i++) await sleep(300); }
const shot = async (p: any, name: string) => { await p.screenshot({ path: `${OUT}/dominoes_${TAG}${name}.png` }); console.log('saved', name); };

const home = await page(4); await shot(home, 'home');
await home.click('.me-row .avatar'); await sleep(400); await shot(home, 'avatar'); await home.close();

const p4 = await page(4);
await p4.evaluate(() => (window as any).__dom.start('play'));
await autoplay(p4, 12000); await waitMyTurn(p4);
await shot(p4, '4player'); await autoplay(p4, 14000); await waitMyTurn(p4); await shot(p4, '4player_late'); await p4.close();

const p2 = await page(2);
await p2.evaluate(() => (window as any).__dom.start('play'));
await autoplay(p2, 10000); await waitMyTurn(p2);
await shot(p2, '2player'); await p2.close();

const w = await page(4);
await w.evaluate(() => (window as any).__dom.start('watch'));
await sleep(14000); await shot(w, 'watch'); await w.close();
await browser.close();
console.log('done');
