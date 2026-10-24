// Two-browser join-by-code check against a local server started with a test OWNER_CODE (OWNER_CODE env passed here too).
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE ?? 'http://localhost:3311';
const CODE = process.env.OWNER_CODE ?? '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
async function open() {
  const ctx = await browser.createBrowserContext(); // separate storage, like a second phone
  const p = await ctx.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await p.goto(BASE, { waitUntil: 'load' }); await sleep(500);
  return p;
}
const host = await open();
for (let i = 0; i < 3; i++) await host.click('.title');
await host.type('#owner-code', CODE); await host.keyboard.press('Enter'); await sleep(600);
await host.type('.me-row input', 'Raw');
const hostBtn = await host.$$('xpath/.//button[contains(., "Host a table")]');
console.log('host button visible:', hostBtn.length === 1);
await host.screenshot({ path: '/workspace/dominoes_join_owner_home.png' });
await hostBtn[0].click(); await sleep(600);
const code = await host.$eval('.join-code', (e) => e.textContent);
console.log('code', code);
const guest = await open();
await guest.type('.me-row input', 'Keisha');
await guest.type('.code-in', code!.toLowerCase());
await (await guest.$$('xpath/.//button[text()="Join"]'))[0].click(); await sleep(800);
await guest.screenshot({ path: '/workspace/dominoes_join_guest_lobby.png' });
await host.screenshot({ path: '/workspace/dominoes_join_host_lobby.png' });
console.log('host lobby:', await host.$$eval('.lobby-seat', (r) => r.map((x) => (x as HTMLElement).innerText.replace(/\n/g, ' '))));
await (await host.$$('xpath/.//button[text()="Start game"]'))[0].click(); await sleep(2500);
const names = async (p: any) => p.$$eval('.pname', (r: any[]) => r.map((x) => x.textContent));
console.log('host sees', await names(host), '| guest sees', await names(guest));
await host.screenshot({ path: '/workspace/dominoes_join_host_table.png' });
await guest.screenshot({ path: '/workspace/dominoes_join_guest_table.png' });
await browser.close();
