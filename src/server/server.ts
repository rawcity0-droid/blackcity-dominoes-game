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
    const leave = () => { table?.leave(send); table = null; };
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
          leave();
          const me = persona(m);
          table = new Table({ players, watch: m.mode === 'watch', me: { name: m.name ? me.name : 'You', face: me.face } }, send, timings);
          return;
        }
        case 'host': { // owner only: a table others can join with a code
          leave();
          if (!owner) { send({ t: 'error', code: 'not_owner', message: 'Only the owner can host a code table.' }); return; }
          const code = makeJoinCode((c) => coded.has(c));
          const t: Table = new Table({ players, watch: false, me: persona(m), code, onEmpty: () => coded.delete(code) }, send, timings);
          coded.set(code, t);
          table = t;
          return;
        }
        case 'join': {
          leave();
          const now = Date.now();
          const tries = (join.get(ip) ?? []).filter((x) => now - x < 60000);
          join.set(ip, tries);
          if (tries.length >= 10) { send({ t: 'joinResult', ok: false, message: 'Too many tries. Wait a minute.' }); return; }
          const code = typeof m.code === 'string' ? m.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : '';
          const t = coded.get(code);
          if (!t || t.closed) { tries.push(now); send({ t: 'joinResult', ok: false, message: 'No table with that code.' }); return; }
          if (!t.join(persona(m), send)) { send({ t: 'joinResult', ok: false, message: 'That table is full.' }); return; }
          table = t;
          send({ t: 'joinResult', ok: true, code });
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
