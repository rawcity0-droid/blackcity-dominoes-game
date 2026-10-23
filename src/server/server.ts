// HTTP (static files from public/) + WebSocket. Each connection gets its own table.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { fallbackAvatar, validAvatar } from './avatar.js';
import { serveStatic } from './static.js';
import { DEFAULT_TIMINGS, Table, Timings } from './table.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

export function startServer(port: number, timings: Timings = DEFAULT_TIMINGS): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }
    serveStatic(PUBLIC, req, res);
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', (ws) => {
    let table: Table | null = null;
    const send = (m: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
    ws.on('message', (raw) => {
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'start') {
        table?.close();
        const players = m.players === 2 ? 2 : 4;
        const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 16) : 'You';
        const face = validAvatar(m.face) ?? fallbackAvatar(name);
        table = new Table({ players, watch: m.mode === 'watch', me: { name, face } }, send, timings);
      } else if (m.t === 'play' && table && Array.isArray(m.tile) && m.tile.length === 2 && ['L', 'R', 'N', 'S', 'lead'].includes(m.arm)) {
        table.humanPlay([Number(m.tile[0]), Number(m.tile[1])], m.arm);
      } else if (m.t === 'draw') table?.humanDraw();
      else if (m.t === 'leave') { table?.close(); table = null; }
    });
    ws.on('close', () => table?.close());
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
