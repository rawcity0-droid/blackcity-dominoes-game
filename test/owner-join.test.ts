// Owner back door (OWNER_CODE) and join-code tables, over the real WebSocket server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { startServer } from '../src/server/server.ts';
import { OwnerGate } from '../src/server/owner.ts';

const CODE = '482916'; // made-up test code
const FAST = { botMs: 20, handPauseMs: 50 };

async function server(ownerCode?: string) {
  const s = await startServer(0, FAST, { ownerCode });
  return { s, url: `ws://localhost:${(s.address() as AddressInfo).port}/ws` };
}
class Client {
  log: any[] = [];
  ws: WebSocket;
  ready: Promise<void>;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => this.log.push(JSON.parse(String(d))));
    this.ready = new Promise((r) => this.ws.on('open', () => r()));
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  async wait(pred: (m: any) => boolean, from = 0, ms = 3000): Promise<any> {
    const end = Date.now() + ms;
    for (;;) {
      const m = this.log.slice(from).find(pred);
      if (m) return m;
      if (Date.now() > end) throw new Error('timeout; got ' + JSON.stringify(this.log.slice(-3)));
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  last(t: string) { return [...this.log].reverse().find((m) => m.t === t); }
  close() { this.ws.close(); }
}
async function ownerClient(url: string) {
  const c = new Client(url); await c.ready;
  c.send({ t: 'owner', code: CODE });
  const r = await c.wait((m) => m.t === 'ownerResult');
  assert.equal(r.ok, true);
  return { c, pass: r.pass as string };
}

test('owner code: right code gives a pass, wrong is refused, lockout after 5, code never echoed or logged', async () => {
  const lines: string[] = [];
  const orig = console.log; console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
  const { s, url } = await server(CODE);
  try {
    const bad = new Client(url); await bad.ready;
    for (let i = 0; i < 4; i++) { const n = bad.log.length; bad.send({ t: 'owner', code: '111111' }); assert.equal((await bad.wait((m) => m.t === 'ownerResult', n)).code, 'wrong'); }
    let n = bad.log.length; bad.send({ t: 'owner', code: '111111' });
    assert.equal((await bad.wait((m) => m.t === 'ownerResult', n)).code, 'locked');
    n = bad.log.length; bad.send({ t: 'owner', code: CODE }); // even the right code is refused while locked
    assert.equal((await bad.wait((m) => m.t === 'ownerResult', n)).code, 'locked');
    bad.close();

    const gate = new OwnerGate(CODE);
    const ok = gate.tryCode(CODE, ['x']);
    assert.equal(ok.ok, true);
    assert.ok(gate.checkPass(ok.pass));
    assert.equal(new OwnerGate('999999').checkPass(ok.pass), false); // changing OWNER_CODE cancels old passes
    assert.equal(gate.checkPass(ok.pass!.slice(0, -1) + (ok.pass!.endsWith('0') ? '1' : '0')), false);
    assert.ok(!JSON.stringify(ok).includes(CODE));
    assert.ok(lines.every((l) => !l.includes(CODE)));
    assert.ok(lines.some((l) => l.includes('"ev":"owner_code_unlock","ok":false')));
  } finally { console.log = orig; s.close(); }
});

test('owner code off when OWNER_CODE is unset or not 6 digits', async () => {
  for (const code of [undefined, '12345', 'abcdef']) {
    const { s, url } = await server(code);
    const c = new Client(url); await c.ready;
    assert.equal((await c.wait((m) => m.t === 'hello')).ownerAvailable, false);
    c.send({ t: 'owner', code: '123456' });
    assert.equal((await c.wait((m) => m.t === 'ownerResult')).code, 'not_available');
    c.close(); s.close();
  }
});

test('only the owner can host; a saved pass works on a new connection', async () => {
  const { s, url } = await server(CODE);
  try {
    const guest = new Client(url); await guest.ready;
    guest.send({ t: 'host', players: 4, name: 'Guest' });
    assert.equal((await guest.wait((m) => m.t === 'error')).code, 'not_owner');
    guest.send({ t: 'ownerPass', pass: 'nope' });
    assert.equal((await guest.wait((m) => m.t === 'ownerStatus')).owner, false);
    const { c, pass } = await ownerClient(url); c.close();
    const again = new Client(url); await again.ready;
    again.send({ t: 'ownerPass', pass });
    assert.equal((await again.wait((m) => m.t === 'ownerStatus')).owner, true);
    again.send({ t: 'host', players: 2, name: 'Raw' });
    const lobby = await again.wait((m) => m.t === 'lobby');
    assert.match(lobby.code, /^[A-HJKMNP-Z2-9]{5}$/);
    again.close(); guest.close();
  } finally { s.close(); }
});

test('join by code: players replace computer seats, everyone sees their own hand, plays reach both', async () => {
  const { s, url } = await server(CODE);
  try {
    const { c: hostC } = await ownerClient(url);
    hostC.send({ t: 'host', players: 4, name: 'Raw' });
    const { code } = await hostC.wait((m) => m.t === 'lobby');
    const bad = new Client(url); await bad.ready;
    bad.send({ t: 'join', code: 'ZZZZZ', name: 'X' });
    assert.equal((await bad.wait((m) => m.t === 'joinResult')).ok, false);

    const p2 = new Client(url); await p2.ready;
    p2.send({ t: 'join', code: code.toLowerCase(), name: 'Keisha' });
    assert.equal((await p2.wait((m) => m.t === 'joinResult')).ok, true);
    const l2 = await p2.wait((m) => m.t === 'lobby' && m.seats.some((x: any) => x.name === 'You'));
    assert.equal(l2.host, false);
    const hl = await hostC.wait((m) => m.t === 'lobby' && m.seats.some((x: any) => x.name === 'Keisha'));
    assert.deepEqual(hl.seats.map((x: any) => x.human), [true, true, false, false]); // seat 1 was a computer player

    hostC.send({ t: 'begin' });
    const sv = await p2.wait((m) => m.t === 'state');
    assert.equal(sv.seats[0].name, 'You');                 // each viewer sits at the bottom
    assert.equal(sv.seats[3].name, 'Raw');                 // host is seat 0, so to Keisha's right
    assert.ok(sv.teams[0].startsWith('You') || sv.teams[0].includes('You'));
    assert.ok(sv.hand.length >= 6);
    const hv = hostC.last('state');
    assert.notDeepEqual(hv.hand, sv.hand);

    // Play the game out: whoever's turn it is plays their first legal move.
    for (let i = 0; i < 400; i++) {
      for (const c of [hostC, p2]) {
        const v = c.last('state');
        if (v && v.moves.length) c.send({ t: 'play', tile: v.moves[0].tile, arm: v.moves[0].arm });
        else if (v && v.canDraw) c.send({ t: 'draw' });
      }
      await new Promise((r) => setTimeout(r, 15));
      if (hostC.last('state')?.winner != null) break;
    }
    const hEnd = hostC.last('state'), pEnd = p2.last('state');
    assert.notEqual(hEnd.winner, null);
    assert.deepEqual(hEnd.scores, pEnd.scores.slice().reverse()); // same game, each sees own team first
    assert.equal(hEnd.winner, 1 - pEnd.winner);

    // A full table refuses more players.
    const p3 = new Client(url); await p3.ready; p3.send({ t: 'join', code, name: 'A' }); assert.equal((await p3.wait((m) => m.t === 'joinResult')).ok, true);
    const p4 = new Client(url); await p4.ready; p4.send({ t: 'join', code, name: 'B' }); assert.equal((await p4.wait((m) => m.t === 'joinResult')).ok, true);
    const p5 = new Client(url); await p5.ready; p5.send({ t: 'join', code, name: 'C' });
    assert.match((await p5.wait((m) => m.t === 'joinResult')).message, /full/);

    // A joined player leaving gives the seat back to a computer player; the host leaving closes the table for all.
    p4.close();
    await hostC.wait((m) => m.t === 'state' && m.seats.filter((x: any) => x.human).length === 3, hostC.log.length - 1);
    hostC.send({ t: 'leave' });
    assert.match((await p2.wait((m) => m.t === 'closed')).message, /host left/);
    const p6 = new Client(url); await p6.ready; p6.send({ t: 'join', code, name: 'D' });
    assert.equal((await p6.wait((m) => m.t === 'joinResult')).ok, false);
    for (const c of [bad, p2, p3, p5, p6, hostC]) c.close();
  } finally { s.close(); }
});

test('watch mode and solo play still work', async () => {
  const { s, url } = await server(undefined);
  try {
    const w = new Client(url); await w.ready;
    w.send({ t: 'start', mode: 'watch', players: 4 });
    const v = await w.wait((m) => m.t === 'state' && m.allHands);
    assert.equal(v.watch, true); assert.equal(v.hand, null);
    const p = new Client(url); await p.ready;
    p.send({ t: 'start', mode: 'play', players: 2, name: 'Raw' });
    const pv = await p.wait((m) => m.t === 'state');
    assert.equal(pv.seats[0].name, 'You'); assert.ok(Array.isArray(pv.hand));
    w.close(); p.close();
  } finally { s.close(); }
});
