// Entry point: `npm start`. PORT from env (default 3000). DOMINOES_FAST=1 shortens the pauses (testing only).
import { startServer } from './server.js';

const port = Number(process.env.PORT ?? 3000);
const timings = process.env.DOMINOES_FAST === '1' ? { botMs: 60, handPauseMs: 600 } : undefined;
await startServer(port, timings);
console.log(`Blackcity Dominoes listening on http://localhost:${port}`);
