// All Fives (Muggins) dominoes, double-six set, 2 or 4 players. Pure rules: no timers, no network.
// Spinner = the first double played. Score whenever the open ends add up to a multiple of 5.

export type Tile = [number, number]; // stored high pip first, e.g. [6, 3]
export type ArmId = 'L' | 'R' | 'N' | 'S';
export interface Placed { tile: Tile; open: number } // open = the pip facing outward
export interface Board {
  lead: Tile | null;
  arms: Record<ArmId, Placed[]>;
  /** Where the spinner sits: 'C' = the lead tile, or the index in arm L / R. null = no double played yet. */
  spinner: null | 'C' | { arm: 'L' | 'R'; index: number };
}
export interface Move { tile: Tile; arm: ArmId | 'lead' }
export type Rng = () => number;

export const MAX_PIP = 6;
export const HAND_SIZE = 7;
export const DEFAULT_TARGET = 150;

export const tileId = (t: Tile) => `${t[0]}-${t[1]}`;
export const pips = (t: Tile) => t[0] + t[1];
export const isDouble = (t: Tile) => t[0] === t[1];
export const sameTile = (a: Tile, b: Tile) => a[0] === b[0] && a[1] === b[1];
/** Round to the nearest 5 (12 -> 10, 13 -> 15). */
export const roundTo5 = (n: number) => Math.round(n / 5) * 5;

export function fullSet(): Tile[] {
  const s: Tile[] = [];
  for (let a = 0; a <= MAX_PIP; a++) for (let b = 0; b <= a; b++) s.push([a, b]);
  return s;
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export const emptyBoard = (): Board => ({ lead: null, arms: { L: [], R: [], N: [], S: [] }, spinner: null });

/** True once both main sides of the spinner have a tile, so the up/down branches open. */
function branchesOpen(b: Board): boolean {
  if (b.spinner === null) return false;
  if (b.spinner === 'C') return b.arms.L.length > 0 && b.arms.R.length > 0;
  return b.arms[b.spinner.arm].length > b.spinner.index + 1;
}

function spinnerPip(b: Board): number {
  if (b.spinner === 'C') return b.lead![0];
  const s = b.spinner as { arm: 'L' | 'R'; index: number };
  return b.arms[s.arm][s.index].open;
}

/** The pip showing at the end of an arm, or null if that arm can't be played on. */
export function openPip(b: Board, arm: ArmId): number | null {
  if (!b.lead) return null;
  const list = b.arms[arm];
  if (list.length) return list[list.length - 1].open;
  if (arm === 'L') return b.lead[0];
  if (arm === 'R') return b.lead[1];
  if (!branchesOpen(b)) return null;
  return spinnerPip(b);
}

/** Sum of the open ends. A double at an end counts both halves. */
export function boardCount(b: Board): number {
  if (!b.lead) return 0;
  const { L, R, N, S } = b.arms;
  if (!L.length && !R.length) return pips(b.lead); // just the first tile
  let sum = 0;
  const leadMul = isDouble(b.lead) ? 2 : 1;
  for (const arm of [L, R]) {
    if (arm.length) { const last = arm[arm.length - 1]; sum += last.open * (isDouble(last.tile) ? 2 : 1); }
    else sum += (arm === L ? b.lead[0] : b.lead[1]) * leadMul;
  }
  for (const arm of [N, S]) if (arm.length) { const last = arm[arm.length - 1]; sum += last.open * (isDouble(last.tile) ? 2 : 1); }
  return sum;
}

export function legalMoves(b: Board, hand: Tile[]): Move[] {
  if (!b.lead) return hand.map((tile) => ({ tile, arm: 'lead' as const }));
  const out: Move[] = [];
  for (const tile of hand) for (const arm of ['L', 'R', 'N', 'S'] as ArmId[]) {
    const p = openPip(b, arm);
    if (p === null || (tile[0] !== p && tile[1] !== p)) continue;
    // Lead double with both main sides empty: L and R are the same move, so only R is offered
    if (arm === 'L' && b.spinner === 'C' && !b.arms.L.length && !b.arms.R.length) continue;
    out.push({ tile, arm });
  }
  return out;
}

/** Place a tile (must be legal). Returns the new board count. */
export function place(b: Board, m: Move): number {
  const t = m.tile;
  if (m.arm === 'lead') {
    if (b.lead) throw new Error('board not empty');
    b.lead = t;
    if (isDouble(t)) b.spinner = 'C';
    return boardCount(b);
  }
  const p = openPip(b, m.arm);
  if (p === null || (t[0] !== p && t[1] !== p)) throw new Error('illegal move');
  const list = b.arms[m.arm];
  list.push({ tile: t, open: t[0] === p ? t[1] : t[0] });
  if (isDouble(t) && b.spinner === null && (m.arm === 'L' || m.arm === 'R')) b.spinner = { arm: m.arm, index: list.length - 1 };
  return boardCount(b);
}

export function boardTiles(b: Board): Tile[] {
  const out: Tile[] = b.lead ? [b.lead] : [];
  for (const a of ['L', 'R', 'N', 'S'] as ArmId[]) for (const p of b.arms[a]) out.push(p.tile);
  return out;
}

// ---------------- a whole game ----------------

export interface HandResult { kind: 'domino' | 'blocked'; team: number | null; points: number; pipsLeft: number[] }
export interface GameEvent { seat: number; kind: 'play' | 'draw' | 'pass'; tile?: Tile; arm?: Move['arm']; scored?: number }

export class Game {
  readonly n: 2 | 4;
  readonly target: number;
  hands: Tile[][] = [];
  boneyard: Tile[] = [];
  board: Board = emptyBoard();
  scores: [number, number] = [0, 0];
  turn = 0;
  handNo = 0;
  passes = 0;
  /** First hand only: the tile that must be led (highest double). */
  forcedLead: Tile | null = null;
  lastResult: HandResult | null = null;
  winner: number | null = null; // team
  events: GameEvent[] = [];
  private rng: Rng;
  private nextLeader: number | null = null;

  constructor(n: 2 | 4, opts: { target?: number; rng?: Rng } = {}) {
    this.n = n;
    this.target = opts.target ?? DEFAULT_TARGET;
    this.rng = opts.rng ?? Math.random;
  }

  /** 4 players: seats 0 & 2 are one team, 1 & 3 the other. 2 players: each seat is its own team. */
  teamOf(seat: number): number { return this.n === 4 ? seat % 2 : seat; }
  get over(): boolean { return this.winner !== null; }
  get handOver(): boolean { return this.lastResult !== null; }

  deal(): void {
    const tiles = shuffle(fullSet(), this.rng);
    this.hands = Array.from({ length: this.n }, (_, i) => tiles.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE));
    this.boneyard = tiles.slice(this.n * HAND_SIZE); // 14 tiles with 2 players, none with 4
    this.board = emptyBoard();
    this.passes = 0;
    this.lastResult = null;
    this.events = [];
    this.handNo++;
    if (this.nextLeader === null) {
      // First hand: highest double leads (if nobody holds a double, the heaviest tile)
      let best: { seat: number; tile: Tile; rank: number } | null = null;
      this.hands.forEach((h, seat) => h.forEach((t) => {
        const rank = (isDouble(t) ? 1000 : 0) + pips(t) * 10 + t[0];
        if (!best || rank > best.rank) best = { seat, tile: t, rank };
      }));
      this.turn = best!.seat;
      this.forcedLead = best!.tile;
    } else {
      this.turn = this.nextLeader;
      this.forcedLead = null;
    }
  }

  /** Legal moves for the seat whose turn it is. */
  moves(): Move[] {
    const ms = legalMoves(this.board, this.hands[this.turn]);
    return this.forcedLead ? ms.filter((m) => sameTile(m.tile, this.forcedLead!)) : ms;
  }
  canDraw(): boolean { return !this.handOver && !this.over && this.moves().length === 0 && this.boneyard.length > 0; }
  mustPass(): boolean { return !this.handOver && !this.over && this.moves().length === 0 && this.boneyard.length === 0; }

  play(m: Move): GameEvent {
    if (this.over || this.handOver) throw new Error('hand is over');
    const legal = this.moves().find((x) => sameTile(x.tile, m.tile) && x.arm === m.arm);
    if (!legal) throw new Error('illegal move');
    const seat = this.turn;
    const hand = this.hands[seat];
    hand.splice(hand.findIndex((t) => sameTile(t, m.tile)), 1);
    const count = place(this.board, legal);
    this.forcedLead = null;
    this.passes = 0;
    const scored = count > 0 && count % 5 === 0 ? count : 0;
    const ev: GameEvent = { seat, kind: 'play', tile: m.tile, arm: m.arm, scored };
    this.events.push(ev);
    if (scored) this.addPoints(this.teamOf(seat), scored);
    if (this.over) return ev;
    if (hand.length === 0) { this.endHand('domino', seat); return ev; }
    this.turn = (seat + 1) % this.n;
    return ev;
  }

  draw(): GameEvent {
    if (!this.canDraw()) throw new Error('cannot draw');
    this.hands[this.turn].push(this.boneyard.pop()!);
    const ev: GameEvent = { seat: this.turn, kind: 'draw' };
    this.events.push(ev);
    return ev;
  }

  pass(): GameEvent {
    if (!this.mustPass()) throw new Error('cannot pass');
    const seat = this.turn;
    const ev: GameEvent = { seat, kind: 'pass' };
    this.events.push(ev);
    this.passes++;
    if (this.passes >= this.n) { this.endHand('blocked', null); return ev; }
    this.turn = (seat + 1) % this.n;
    return ev;
  }

  teamPips(team: number): number {
    return this.hands.reduce((s, h, seat) => s + (this.teamOf(seat) === team ? h.reduce((a, t) => a + pips(t), 0) : 0), 0);
  }

  private endHand(kind: 'domino' | 'blocked', seat: number | null): void {
    const pipsLeft = this.hands.map((h) => h.reduce((a, t) => a + pips(t), 0));
    let team: number | null = null, points = 0;
    if (kind === 'domino') {
      team = this.teamOf(seat!);
      points = roundTo5(this.teamPips(1 - team));
      this.nextLeader = seat;
    } else {
      // Blocked: the side with fewer pips scores the other side's pips. A tie scores nothing.
      const a = this.teamPips(0), b = this.teamPips(1);
      if (a !== b) { team = a < b ? 0 : 1; points = roundTo5(this.teamPips(1 - team)); }
      let low = 0; pipsLeft.forEach((p, i) => { if (p < pipsLeft[low]) low = i; });
      this.nextLeader = low; // next hand led by the player holding the fewest pips
    }
    this.lastResult = { kind, team, points, pipsLeft };
    if (team !== null && points) this.addPoints(team, points);
  }

  private addPoints(team: number, pts: number): void {
    this.scores[team] += pts;
    if (this.scores[team] >= this.target && this.winner === null) {
      this.winner = team;
      if (!this.lastResult) this.lastResult = { kind: 'domino', team, points: 0, pipsLeft: this.hands.map((h) => h.reduce((a, t) => a + pips(t), 0)) };
    }
  }
}

// ---------------- computer player ----------------

/** Pick a move: score the most points now, avoid leaving the next player an easy score, unload heavy tiles and doubles. */
export function chooseMove(g: Game): Move | null {
  const ms = g.moves();
  if (!ms.length) return null;
  const mine = new Set(g.hands[g.turn].map(tileId));
  let best = ms[0], bestVal = -Infinity;
  for (const m of ms) {
    const b: Board = structuredClone(g.board);
    const count = place(b, m);
    const now = count > 0 && count % 5 === 0 ? count : 0;
    // Biggest score any unseen tile could make right after this move
    let threat = 0;
    const onBoard = new Set(boardTiles(b).map(tileId));
    for (const t of fullSet()) {
      if (mine.has(tileId(t)) || onBoard.has(tileId(t))) continue;
      for (const r of legalMoves(b, [t])) {
        const c2 = place(structuredClone(b), r);
        if (c2 > 0 && c2 % 5 === 0) threat = Math.max(threat, c2);
      }
    }
    const val = now * 10 - threat * 2 + pips(m.tile) * 1.5 + (isDouble(m.tile) ? 4 : 0) + Math.random() * 0.5;
    if (val > bestVal) { bestVal = val; best = m; }
  }
  return best;
}
