// Coming back to the same game and seat with a rejoin token (closed app, lost connection, back to menu), and the owner looking in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { startServer } from '../src/server/server.ts';

const CODE = '482916'; // made-up test code
const FAST = { botMs: 20, handPauseMs: 50, reserveMs: 400 };

async function server(ownerCode?: string, reserveMs = FAST.reserveMs) {
  const s = await startServer(0, { ...FAST, reserveMs }, { ownerCode });
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
const TOK = 'tok-aaaaaaaaaaaaaaaa', TOK2 = 'tok-bbbbbbbbbbbbbbbb';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('solo game: close the app, come back with the token to the same hand and score; game waits meanwhile', async () => {
  const { s, url } = await server(undefined);
  try {
    const a = new Client(url); await a.ready;
    a.send({ t: 'start', mode: 'play', players: 2, name: 'Raw', token: TOK });
    const before = await a.wait((m) => m.t === 'state');
    await sleep(200);
    const snap = a.last('state');
    a.close(); await sleep(150);

    const b = new Client(url); await b.ready;
    b.send({ t: 'check', token: 'tok-zzzzzzzzzzzzzzzz' });
    assert.equal((await b.wait((m) => m.t === 'resumable')).ok, false); // someone else's token finds nothing
    const n = b.log.length;
    b.send({ t: 'check', token: TOK });
    const r = await b.wait((m) => m.t === 'resumable', n);
    assert.equal(r.ok, true); assert.equal(r.game.n, 2);
    b.send({ t: 'resume', token: TOK });
    assert.equal((await b.wait((m) => m.t === 'resumeResult')).ok, true);
    const after = await b.wait((m) => m.t === 'state');
    assert.equal(after.handNo, before.handNo);
    assert.deepEqual(after.hand, snap.hand);       // nothing moved while nobody was there
    assert.deepEqual(after.scores, snap.scores);
    assert.equal(after.seats[0].name, 'You');
    b.close();
  } finally { s.close(); }
});

test('back to menu keeps the seat; saying no frees it; starting a new game frees the old one', async () => {
  const { s, url } = await server(undefined);
  try {
    const a = new Client(url); await a.ready;
    a.send({ t: 'start', mode: 'play', players: 4, name: 'Raw', token: TOK });
    await a.wait((m) => m.t === 'state');
    a.send({ t: 'leave' });
    a.send({ t: 'check', token: TOK });
    assert.equal((await a.wait((m) => m.t === 'resumable')).ok, true);
    let n = a.log.length;
    a.send({ t: 'forfeit', token: TOK });
    await a.wait((m) => m.t === 'resumable', n);
    n = a.log.length; a.send({ t: 'check', token: TOK });
    assert.equal((await a.wait((m) => m.t === 'resumable', n)).ok, false);

    a.send({ t: 'start', mode: 'play', players: 2, name: 'Raw', token: TOK });
    await a.wait((m) => m.t === 'state' && m.n === 2);
    a.send({ t: 'start', mode: 'play', players: 4, name: 'Raw', token: TOK }); // new game replaces it
    await a.wait((m) => m.t === 'state' && m.n === 4);
    n = a.log.length; a.send({ t: 'check', token: TOK });
    assert.equal((await a.wait((m) => m.t === 'resumable', n)).game.n, 4);
    a.close();
  } finally { s.close(); }
});

test('saved seat runs out after the time limit', async () => {
  const { s, url } = await server(undefined);
  try {
    const a = new Client(url); await a.ready;
    a.send({ t: 'start', mode: 'play', players: 2, name: 'Raw', token: TOK });
    await a.wait((m) => m.t === 'state');
    a.close(); await sleep(600); // reserveMs is 400 in tests (10 minutes for real)
    const b = new Client(url); await b.ready;
    b.send({ t: 'check', token: TOK });
    assert.equal((await b.wait((m) => m.t === 'resumable')).ok, false);
    b.close();
  } finally { s.close(); }
});

test('code table: a joined player who drops keeps their seat (computer covers), then returns; host can return too', async () => {
  const { s, url } = await server(CODE, 10000);
  try {
    const host = new Client(url); await host.ready;
    host.send({ t: 'owner', code: CODE }); await host.wait((m) => m.t === 'ownerResult' && m.ok);
    host.send({ t: 'host', players: 2, name: 'Raw', token: TOK });
    const { code } = await host.wait((m) => m.t === 'lobby');
    const p = new Client(url); await p.ready;
    p.send({ t: 'join', code, name: 'Keisha', token: TOK2 });
    await p.wait((m) => m.t === 'joinResult' && m.ok);
    host.send({ t: 'begin' });
    const pv = await p.wait((m) => m.t === 'state');
    p.close(); await sleep(150);

    // Game keeps going for the host: the computer plays Keisha's turns; her seat still shows as a person.
    for (let i = 0; i < 40; i++) {
      const v = host.last('state');
      if (v.moves.length) host.send({ t: 'play', tile: v.moves[0].tile, arm: v.moves[0].arm }); else if (v.canDraw) host.send({ t: 'draw' });
      await sleep(30);
    }
    const hv = host.last('state');
    assert.equal(hv.seats[1].name, 'Keisha'); assert.equal(hv.seats[1].human, true);

    const p2 = new Client(url); await p2.ready;
    p2.send({ t: 'resume', token: TOK2 });
    const back = await p2.wait((m) => m.t === 'state');
    assert.equal(back.seats[0].name, 'You'); assert.equal(back.seats[1].name, 'Raw');
    assert.equal(back.code, code);
    assert.ok(back.handNo >= pv.handNo);

    host.close(); await sleep(100);
    const h2 = new Client(url); await h2.ready;
    h2.send({ t: 'resume', token: TOK });
    assert.equal((await h2.wait((m) => m.t === 'resumeResult')).ok, true);
    assert.equal((await h2.wait((m) => m.t === 'state')).code, code); // table did not close
    h2.close(); p2.close();
  } finally { s.close(); }
});

test('owner can list games in progress and look in on one; others cannot', async () => {
  const { s, url } = await server(CODE);
  try {
    const a = new Client(url); await a.ready;
    a.send({ t: 'start', mode: 'play', players: 4, name: 'Raw', token: TOK });
    await a.wait((m) => m.t === 'state');
    const guest = new Client(url); await guest.ready;
    guest.send({ t: 'tables' }); guest.send({ t: 'spectate', id: 1 });
    await sleep(150);
    assert.ok(!guest.log.some((m) => m.t === 'tables' || m.t === 'state'));

    const o = new Client(url); await o.ready;
    o.send({ t: 'owner', code: CODE }); await o.wait((m) => m.t === 'ownerResult' && m.ok);
    o.send({ t: 'tables' });
    const { list } = await o.wait((m) => m.t === 'tables');
    assert.equal(list.length, 1); assert.equal(list[0].people[0].name, 'Raw');
    o.send({ t: 'spectate', id: list[0].id });
    const v = await o.wait((m) => m.t === 'state' && m.spectate);
    assert.equal(v.allHands.length, 4);
    o.send({ t: 'leave' }); await sleep(100);
    a.send({ t: 'check', token: TOK });
    assert.equal((await a.wait((m) => m.t === 'resumable')).ok, true); // owner leaving doesn't end the game
    a.close(); o.close(); guest.close();
  } finally { s.close(); }
});
