// One table for one connection: the human (or nobody, in watch mode) plus computer players.
// Runs the game with short pauses so moves are easy to follow, and sends a view after every change.

import { Game, Move, Tile, chooseMove, sameTile } from '../engine/dominoes.js';
import { Persona, pickPersona } from './personas.js';

export interface Timings { botMs: number; handPauseMs: number }
export const DEFAULT_TIMINGS: Timings = { botMs: 900, handPauseMs: 4500 };

export interface Seat extends Persona { human: boolean }

export class Table {
  game: Game;
  seats: Seat[];
  watch: boolean;
  log: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(opts: { players: 2 | 4; watch: boolean; me?: Persona; target?: number }, private send: (msg: unknown) => void, private t: Timings = DEFAULT_TIMINGS) {
    this.watch = opts.watch;
    this.game = new Game(opts.players, { target: opts.target });
    const used = new Set<string>(opts.me ? [opts.me.name] : []);
    this.seats = [];
    for (let i = 0; i < opts.players; i++) {
      if (i === 0 && !opts.watch && opts.me) { this.seats.push({ ...opts.me, human: true }); continue; }
      const p = pickPersona(used); used.add(p.name);
      this.seats.push({ ...p, human: false });
    }
    this.newHand();
  }

  close(): void { this.closed = true; if (this.timer) clearTimeout(this.timer); }

  private newHand(): void {
    this.game.deal();
    const lead = this.game.forcedLead;
    this.log = [`Hand ${this.game.handNo}: ${this.who(this.game.turn)} ${this.seats[this.game.turn].human ? 'lead' : 'leads'}${lead ? ' the ' + lead.join('-') : ''}.`];
    this.step();
  }

  private who(seat: number): string { return this.seats[seat].human ? 'You' : this.seats[seat].name; }

  /** Schedule what comes next: a computer move, the next hand, or wait for the human. */
  private step(): void {
    if (this.closed) return;
    this.push();
    const g = this.game;
    if (g.over) return;
    if (g.handOver) { this.later(this.t.handPauseMs, () => this.newHand()); return; }
    const seat = this.seats[g.turn];
    if (seat.human) {
      if (g.mustPass()) this.later(this.t.botMs, () => { this.note('You pass.'); g.pass(); this.step(); });
      return; // wait for a play or draw from the human
    }
    this.later(this.t.botMs, () => {
      const m = chooseMove(g);
      if (m) this.doPlay(m);
      else if (g.canDraw()) { g.draw(); this.note(`${seat.name} draws.`); }
      else { g.pass(); this.note(`${seat.name} passes.`); }
      this.step();
    });
  }

  private later(ms: number, fn: () => void): void { this.timer = setTimeout(fn, ms); }
  private note(s: string): void { this.log.push(s); if (this.log.length > 30) this.log.shift(); }

  private doPlay(m: Move): void {
    const g = this.game;
    const seat = g.turn;
    const ev = g.play(m);
    this.note(`${this.who(seat)} ${this.seats[seat].human ? 'play' : 'plays'} ${m.tile.join('-')}${ev.scored ? ` and ${this.seats[seat].human ? 'score' : 'scores'} ${ev.scored}!` : '.'}`);
    const r = g.lastResult;
    if (!r) return;
    if (g.over) this.note(`${this.teamName(g.winner!)} won ${Math.max(...g.scores)} to ${Math.min(...g.scores)}.`);
    else if (r.kind === 'domino') this.note(`Domino! +${r.points} for ${this.teamName(r.team!)}.`);
    else this.note(r.team === null ? 'Blocked. Tie, no points.' : `Blocked. +${r.points} for ${this.teamName(r.team)}.`);
  }

  teamName(team: number): string {
    const g = this.game;
    if (g.n === 2) return this.who(team);
    const [a, b] = [this.seats[team], this.seats[team + 2]];
    return a.human ? 'You & ' + b.name : `${a.name} & ${b.name}`;
  }

  /** Human actions. Ignored unless it's their turn and the move is legal. */
  humanPlay(tile: Tile, arm: Move['arm']): void {
    const g = this.game;
    if (this.watch || !this.seats[g.turn].human || g.handOver || g.over) return;
    if (!g.moves().some((x) => sameTile(x.tile, tile) && x.arm === arm)) return;
    if (this.timer) clearTimeout(this.timer);
    this.doPlay({ tile, arm });
    this.step();
  }
  humanDraw(): void {
    const g = this.game;
    if (this.watch || !this.seats[g.turn].human || !g.canDraw()) return;
    g.draw(); this.note('You draw.');
    this.step();
  }

  view(): unknown {
    const g = this.game;
    const human = !this.watch;
    return {
      t: 'state', watch: this.watch, n: g.n, target: g.target, handNo: g.handNo, turn: g.turn,
      scores: g.scores, teams: [this.teamName(0), this.teamName(1)],
      seats: this.seats.map((s, i) => ({ name: s.name, face: s.face, human: s.human, count: g.hands[i].length, team: g.teamOf(i) })),
      hand: human ? g.hands[0] : null,
      allHands: this.watch ? g.hands : null, // watch mode shows every hand face up
      board: g.board, boneyard: g.boneyard.length,
      moves: human && g.turn === 0 && !g.handOver && !g.over ? g.moves() : [],
      canDraw: human && g.turn === 0 && g.canDraw(),
      result: g.lastResult, winner: g.winner, log: this.log.slice(-6),
      lastPlay: [...g.events].reverse().find((e) => e.kind === 'play') ?? null,
    };
  }

  private push(): void { if (!this.closed) this.send(this.view()); }
}
