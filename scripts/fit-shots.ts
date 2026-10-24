// Screenshots of a long board on phone and tablet, plus layout checks: no page scroll, board inside its area,
// nothing overlapping the board. Needs a local server: `DOMINOES_FAST=1 PORT=3311 npm start`.
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE ?? 'http://localhost:3311';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const VPS = { phone: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 } };
for (const [name, vp] of Object.entries(VPS)) {
  for (const n of [4, 2]) {
    const p = await browser.newPage();
    await p.setViewport({ ...vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.evaluateOnNewDocument('window.__name = (f) => f');
    p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
    await p.goto(BASE, { waitUntil: 'load' });
    await p.evaluate((n) => { localStorage.setItem('dom_players', String(n)); }, n);
    await p.reload({ waitUntil: 'load' }); await sleep(300);
    await p.evaluate(() => (window as any).__dom.start('play'));
    let best = 0, got = false;
    for (let i = 0; i < 4000 && !got; i++) {
      const r: any = await p.evaluate(() => {
        const v = (window as any).__dom.state.view;
        if (!v) return { c: 0 };
        const c = !v.board.lead ? 0 : 1 + ['L', 'R', 'N', 'S'].reduce((s, a) => s + v.board.arms[a].length, 0);
        if (!v.result && c >= 20 && v.moves.length) return { c, stop: true };
        const e = document.querySelector('.end-btn') as HTMLElement | null; if (e) { e.click(); return { c }; }
        const ok = document.querySelector('.hand button.ok') as HTMLElement | null; if (ok) { ok.click(); return { c }; }
        const d = [...document.querySelectorAll('.actions .btn')].find((b) => b.textContent!.startsWith('Draw')) as HTMLElement | undefined; d?.click();
        return { c };
      });
      best = Math.max(best, r.c); if (r.stop) got = true; else await sleep(40);
    }
    if (!got) { console.log(name, n, 'no 20+ board yet, best', best); await p.close(); continue; }
    await sleep(150);
    const chk: any = await p.evaluate(() => {
      const R = (el: Element) => el.getBoundingClientRect();
      const center = R(document.querySelector('.center')!);
      const tiles = [...document.querySelectorAll('.line .tile')].map(R);
      const inside = tiles.every((t) => t.left >= center.left - 0.5 && t.right <= center.right + 0.5 && t.top >= center.top - 0.5 && t.bottom <= center.bottom + 0.5);
      const others = [...document.querySelectorAll('.pill, .info, .hand, .status, .topbar')].map(R);
      const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      const covered = tiles.some((t) => others.some((o) => hit(t, o)));
      const touch = tiles.some((a, i) => tiles.some((b, j) => j > i && hit(a, b)));
      return { tiles: tiles.length, unit: getComputedStyle(document.querySelector('.line')!).getPropertyValue('--t'), inside, covered, touch,
        pageScroll: document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1 };
    });
    console.log(name, n + 'p', JSON.stringify(chk));
    await p.screenshot({ path: `/workspace/dominoes_fit_${name}_${n}p.png` });
    await p.close();
  }
}
await browser.close();
