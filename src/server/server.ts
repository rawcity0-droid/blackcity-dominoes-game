// HTTP (static files from public/) + WebSocket.
// Solo and watch tables belong to one connection. Join-code tables (owner only) are shared: others join with the code.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { fallbackAvatar, validAvatar } from './avatar.js';
import { OwnerGate, makeJoinCode } from './owner.js';
import { serveStatic } from './static.js';
import { DEFAULT_TIMINGS, Table, Timings } from './table.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

export interface ServerOpts { ownerCode?: string }

export function startServer(port: number, timings: Timings = DEFAULT_TIMINGS, opts: ServerOpts = {}): Promise<http.Server> {
  const gate = new OwnerGate('ownerCode' in opts ? opts.ownerCode : process.env.OWNER_CODE);
  const coded = new Map<string, Table>();
  const live = new Set<Table>(); // every game being played, for rejoining and the owner's list
  const tableWith = (token: string) => [...live].find((t) => t.hasToken(token));
  const join = new Map<string, number[]>(); // wrong join-code tries per IP
  let connNo = 0;

  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }
    serveStatic(PUBLIC, req, res);
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  wss.on('connection', (ws, req) => {
    const id = 'c' + ++connNo;
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    let table: Table | null = null;
    let owner = false;
    const send = (m: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
    const persona = (m: any) => {
      const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 16) : 'Player';
      return { name, face: validAvatar(m.face) ?? fallbackAvatar(name) };
    };
    // Rejoin token: random, made by the browser and kept in localStorage. Only used to find this person's seat again.
    const tokenOf = (m: any) => (typeof m.token === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(m.token) ? m.token : undefined);
    const leave = () => { table?.away(send); table = null; };
    // Starting something new gives up any seat this person still had saved.
    const fresh = (token?: string) => { leave(); if (token) tableWith(token)?.forfeit(token); };
    const track = (t: Table) => { live.add(t); return t; };
    send({ t: 'hello', ownerAvailable: gate.available });

    ws.on('message', (raw) => {
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (!m || typeof m !== 'object') return;
      const players = m.players === 2 ? 2 : 4;
      switch (m.t) {
        case 'owner': { // typed code from the hidden panel
          const r = gate.tryCode(typeof m.code === 'string' ? m.code.trim().slice(0, 12) : '', ['c:' + id, ...(ip ? ['ip:' + ip] : [])]);
          if (r.ok) owner = true;
          send({ t: 'ownerResult', ok: r.ok, code: r.code, pass: r.pass, message: r.message });
          return;
        }
        case 'ownerPass': // saved pass from an earlier unlock on this device
          owner = gate.checkPass(m.pass);
          send({ t: 'ownerStatus', owner });
          return;
        case 'start': {
          const token = tokenOf(m);
          fresh(token);
          const me = persona(m);
          const watch = m.mode === 'watch';
          const t: Table = new Table({ players, watch, me: { name: m.name ? me.name : 'You', face: me.face }, token, onEmpty: () => live.delete(t) }, send, timings);
          table = watch ? t : track(t);
          return;
        }
        case 'host': { // owner only: a table others can join with a code
          const token = tokenOf(m);
          fresh(token);
          if (!owner) { send({ t: 'error', code: 'not_owner', message: 'Only the owner can host a code table.' }); return; }
          const code = makeJoinCode((c) => coded.has(c));
          const t: Table = new Table({ players, watch: false, me: persona(m), token, code, onEmpty: () => { coded.delete(code); live.delete(t); } }, send, timings);
          coded.set(code, t);
          table = track(t);
          return;
        }
        case 'join': {
          const token = tokenOf(m);
          fresh(token);
          const now = Date.now();
          const tries = (join.get(ip) ?? []).filter((x) => now - x < 60000);
          join.set(ip, tries);
          if (tries.length >= 10) { send({ t: 'joinResult', ok: false, message: 'Too many tries. Wait a minute.' }); return; }
          const code = typeof m.code === 'string' ? m.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : '';
          const t = coded.get(code);
          if (!t || t.closed) { tries.push(now); send({ t: 'joinResult', ok: false, message: 'No table with that code.' }); return; }
          if (!t.join(persona(m), send, token)) { send({ t: 'joinResult', ok: false, message: 'That table is full.' }); return; }
          table = t;
          send({ t: 'joinResult', ok: true, code });
          return;
        }
        case 'check': { // home screen: is there a game to return to?
          const token = tokenOf(m);
          const t = token ? tableWith(token) : undefined;
          send({ t: 'resumable', ok: !!t, game: t ? t.summary(token) : null });
          return;
        }
        case 'resume': {
          const token = tokenOf(m);
          const t = token ? tableWith(token) : undefined;
          if (!t || t === table) { if (!t) send({ t: 'resumeResult', ok: false, message: 'That game has ended.' }); return; }
          leave();
          t.resume(token!, send);
          table = t;
          send({ t: 'resumeResult', ok: true });
          return;
        }
        case 'forfeit': { // said no to returning
          const token = tokenOf(m);
          if (token) tableWith(token)?.forfeit(token);
          send({ t: 'resumable', ok: false, game: null });
          return;
        }
        case 'tables': // owner: list games in progress
          if (owner) send({ t: 'tables', list: [...live].map((t) => t.summary()) });
          return;
        case 'spectate': { // owner: look in on a game in progress
          const t = [...live].find((x) => x.id === m.id);
          if (!owner || !t) return;
          leave();
          t.spectate(send);
          table = t;
          return;
        }
        case 'begin': table?.begin(send); return;
        case 'play':
          if (table && Array.isArray(m.tile) && m.tile.length === 2 && ['L', 'R', 'N', 'S', 'lead'].includes(m.arm)) table.humanPlay(send, [Number(m.tile[0]), Number(m.tile[1])], m.arm);
          return;
        case 'draw': table?.humanDraw(send); return;
        case 'leave': leave(); return;
      }
    });
    ws.on('close', leave);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
