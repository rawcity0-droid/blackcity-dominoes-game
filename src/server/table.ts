// One table: humans (one, or several on a join-code table) plus computer players.
// Runs the game with short pauses so moves are easy to follow, and sends each person their own view after every change.
// Views are turned so the viewer is always seat 0 (bottom) and their team is always team 0.

import { Game, Move, Tile, chooseMove, sameTile } from '../engine/dominoes.js';
import { Persona, pickPersona } from './personas.js';

export interface Timings { botMs: number; handPauseMs: number; reserveMs?: number }
export const DEFAULT_TIMINGS: Timings = { botMs: 900, handPauseMs: 4500 };
/** How long a seat stays saved for a person who closed the app, lost connection or stepped away. */
export const RESERVE_MS = 10 * 60000;

let tableNo = 0;

export type Send = (msg: unknown) => void;
/** A human seat with no `send` is away: a computer plays it until the person returns (rejoin token) or the time runs out. */
export interface Seat extends Persona { human: boolean; send?: Send; host?: boolean; token?: string; awayTimer?: NodeJS.Timeout }

export class Table {
  id = ++tableNo;
  game: Game;
  seats: Seat[];
  watch: boolean;
  /** Join code (code tables only). */
  code: string | null;
  /** Code tables wait in a lobby until the host starts. */
  started: boolean;
  log: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  closed = false;
  private watcher: Send | null = null;
  /** Owner looking in on a live game (sees every hand). */
  private spectators = new Set<Send>();
  private onEmpty: () => void;

  constructor(
    opts: { players: 2 | 4; watch: boolean; me?: Persona; token?: string; target?: number; code?: string; onEmpty?: () => void },
    send: Send,
    private t: Timings = DEFAULT_TIMINGS,
  ) {
    this.watch = opts.watch;
    this.code = opts.code ?? null;
    this.onEmpty = opts.onEmpty ?? (() => {});
    this.game = new Game(opts.players, { target: opts.target });
    const used = new Set<string>(opts.me ? [opts.me.name] : []);
    this.seats = [];
    for (let i = 0; i < opts.players; i++) {
      if (i === 0 && !opts.watch && opts.me) { this.seats.push({ ...opts.me, human: true, send, host: true, token: opts.token }); continue; }
      const p = pickPersona(used); used.add(p.name);
      this.seats.push({ ...p, human: false });
    }
    if (opts.watch) this.watcher = send;
    this.started = !this.code;
    if (this.started) this.newHand(); else this.push();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const s of this.seats) if (s.awayTimer) clearTimeout(s.awayTimer);
    this.onEmpty();
  }

  /** Host starts a code table. Seats nobody joined stay computer players. */
  begin(send: Send): void {
    if (this.closed || this.started || this.seats[0].send !== send) return;
    this.started = true;
    this.newHand();
  }

  /** A person with the code takes the first computer seat. Returns false if the table is full. */
  join(me: Persona, send: Send, token?: string): boolean {
    if (this.closed || !this.code) return false;
    const i = this.seats.findIndex((s) => !s.human);
    if (i < 0) return false;
    let name = me.name;
    for (let k = 2; this.seats.some((s) => s.name === name); k++) name = `${me.name.slice(0, 13)} ${k}`;
    this.seats[i] = { name, face: me.face, human: true, send, token };
    if (this.started) this.note(`${name} joined.`);
    this.kick();
    return true;
  }

  /** A connection went away (closed app, lost signal, back to menu). Players keep their seat for a while. */
  away(send: Send): void {
    if (this.closed) return;
    if (this.spectators.delete(send)) return;
    if (this.watcher === send) { this.close(); return; }
    const i = this.seatOf(send);
    if (i < 0) return;
    const s = this.seats[i];
    if (!s.token) { this.drop(i); return; } // no rejoin token: they can't come back, so free the seat now
    s.send = undefined;
    if (this.code && this.started) this.note(`${s.name} stepped away. A computer plays for them.`);
    if (s.awayTimer) clearTimeout(s.awayTimer);
    s.awayTimer = setTimeout(() => this.drop(i), this.t.reserveMs ?? RESERVE_MS);
    s.awayTimer.unref(); // a saved seat never keeps the server process alive on its own
    this.kick();
  }

  /** The person with this token comes back to their seat. Returns false if there is no such seat. */
  resume(token: string, send: Send): boolean {
    const i = this.seats.findIndex((s) => s.human && s.token === token);
    if (this.closed || i < 0) return false;
    const s = this.seats[i];
    if (s.send && s.send !== send) s.send({ t: 'closed', message: 'Your game was opened on another screen.' });
    if (s.awayTimer) clearTimeout(s.awayTimer);
    s.awayTimer = undefined;
    s.send = send;
    if (this.code && this.started) this.note(`${s.name} is back.`);
    this.kick();
    return true;
  }

  /** Gives up a seat for good (said no to returning, started another game, or the saved time ran out). */
  forfeit(token: string): void {
    const i = this.seats.findIndex((s) => s.human && s.token === token);
    if (i >= 0) this.drop(i);
  }

  /** The host leaving ends the table; anyone else is replaced by a computer player. */
  private drop(i: number): void {
    if (this.closed) return;
    const gone = this.seats[i];
    if (gone.awayTimer) clearTimeout(gone.awayTimer);
    if (i === 0 && !this.watch) {
      for (const s of this.seats) if (s.send && s !== gone) s.send({ t: 'closed', message: 'The host left the table.' });
      this.close();
      return;
    }
    const used = new Set(this.seats.map((s) => s.name));
    const p = pickPersona(used);
    this.note(`${gone.name} left. ${p.name} takes the seat.`);
    this.seats[i] = { ...p, human: false };
    this.kick();
  }

  /** Owner looks in on this table. */
  spectate(send: Send): void { if (!this.closed) { this.spectators.add(send); send(this.spectatorView()); } }

  /** Short description for the "Return to your game" button and the owner's table list. */
  summary(token?: string): unknown {
    const g = this.game;
    const me = token ? this.seats.findIndex((s) => s.human && s.token === token) : -1;
    const mine = me >= 0 ? g.teamOf(me) : 0;
    return { id: this.id, n: g.n, code: this.code, started: this.started, handNo: g.handNo, over: g.over,
      scores: [g.scores[mine], g.scores[1 - mine]],
      people: this.seats.filter((s) => s.human).map((s) => ({ name: s.name, here: !!s.send })) };
  }

  hasToken(token: string): boolean { return !this.closed && this.seats.some((s) => s.human && s.token === token); }

  seatOf(send: Send): number { return this.seats.findIndex((s) => s.send === send); }

  /** Re-run the loop after a seat changed between human and computer. */
  private kick(): void {
    if (!this.started) { this.push(); return; }
    if (this.timer) clearTimeout(this.timer);
    this.step();
  }

  private newHand(): void {
    this.game.deal();
    const lead = this.game.forcedLead;
    const s = this.game.turn;
    this.log = [`Hand ${this.game.handNo}: ${this.who(s)} ${this.you(s) ? 'lead' : 'leads'}${lead ? ' the ' + lead.join('-') : ''}.`];
    this.step();
  }

  /** On a one-person table the human is "You"; with several people everyone is shown by name. */
  private you(seat: number): boolean { return this.seats[seat].human && !this.code; }
  private who(seat: number): string { return this.you(seat) ? 'You' : this.seats[seat].name; }

  /** Schedule what comes next: a computer move, the next hand, or wait for a human. */
  private step(): void {
    if (this.closed) return;
    this.push();
    const g = this.game;
    if (g.over) return;
    if (g.handOver) { this.later(this.t.handPauseMs, () => this.newHand()); return; }
    // Nobody at the table (solo game, app closed): wait for them instead of playing on without them.
    if (!this.seats.some((s) => s.send) && !this.watcher) return;
    const seat = this.seats[g.turn];
    if (seat.human && seat.send) {
      if (g.mustPass()) this.later(this.t.botMs, () => { this.note(`${this.who(g.turn)} ${this.you(g.turn) ? 'pass' : 'passes'}.`); g.pass(); this.step(); });
      return; // wait for a play or draw from that person
    }
    this.later(this.t.botMs, () => {
      const m = chooseMove(g);
      if (m) this.doPlay(m);
      else if (g.canDraw()) { g.draw(); this.note(`${seat.name} draws.`); }
      else { g.pass(); this.note(`${seat.name} passes.`); }
      this.step();
    });
  }

  private later(ms: number, fn: () => void): void { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(fn, ms); }
  private note(s: string): void { this.log.push(s); if (this.log.length > 30) this.log.shift(); }

  private doPlay(m: Move): void {
    const g = this.game;
    const seat = g.turn;
    const ev = g.play(m);
    const y = this.you(seat);
    this.note(`${this.who(seat)} ${y ? 'play' : 'plays'} ${m.tile.join('-')}${ev.scored ? ` and ${y ? 'score' : 'scores'} ${ev.scored}!` : '.'}`);
    const r = g.lastResult;
    if (!r) return;
    if (g.over) this.note(`${this.teamName(g.winner!)} won ${Math.max(...g.scores)} to ${Math.min(...g.scores)}.`);
    else if (r.kind === 'domino') this.note(`Domino! +${r.points} for ${this.teamName(r.team!)}.`);
    else this.note(r.team === null ? 'Blocked. Tie, no points.' : `Blocked. +${r.points} for ${this.teamName(r.team)}.`);
  }

  /** Team name as the viewer sees it ("You" for their own seat). */
  teamName(team: number, viewer = -1): string {
    const g = this.game;
    const nm = (i: number) => (i === viewer || (viewer < 0 && this.you(i)) ? 'You' : this.seats[i].name);
    if (g.n === 2) return nm(team);
    const [a, b] = [team, team + 2];
    if (nm(b) === 'You') return `You & ${nm(a)}`;
    return `${nm(a)} & ${nm(b)}`;
  }

  /** Human actions. Ignored unless it's that person's turn and the move is legal. */
  humanPlay(send: Send, tile: Tile, arm: Move['arm']): void {
    const g = this.game;
    if (!this.started || this.closed || this.seatOf(send) !== g.turn || g.handOver || g.over) return;
    if (!g.moves().some((x) => sameTile(x.tile, tile) && x.arm === arm)) return;
    if (this.timer) clearTimeout(this.timer);
    this.doPlay({ tile, arm });
    this.step();
  }
  humanDraw(send: Send): void {
    const g = this.game;
    if (!this.started || this.closed || this.seatOf(send) !== g.turn || !g.canDraw()) return;
    g.draw(); this.note(`${this.who(g.turn)} ${this.you(g.turn) ? 'draw' : 'draws'}.`);
    this.step();
  }

  /** Lobby view for a code table before it starts. */
  lobby(me: number): unknown {
    return { t: 'lobby', code: this.code, n: this.game.n, host: me === 0, me,
      seats: this.seats.map((s, i) => ({ name: i === me ? 'You' : s.name, face: s.face, human: s.human, host: !!s.host })) };
  }

  /** Game view for seat `me` (-1 = watching: no rotation, every hand face up). */
  view(me = -1): unknown {
    const g = this.game;
    const watch = me < 0;
    const off = watch ? 0 : me;
    const n = g.n;
    const real = (i: number) => (i + off) % n;               // view seat -> real seat
    const rot = (i: number) => (i - off + n) % n;            // real seat -> view seat
    const myTeam = watch ? 0 : g.teamOf(me);
    const rt = (team: number) => (myTeam === 0 ? team : 1 - team); // real team <-> view team (symmetric)
    const r = g.lastResult;
    const last = [...g.events].reverse().find((e) => e.kind === 'play') ?? null;
    const mine = !watch && g.turn === me && !g.handOver && !g.over;
    return {
      t: 'state', watch, n, target: g.target, handNo: g.handNo, turn: rot(g.turn), code: this.code,
      scores: [g.scores[rt(0)], g.scores[rt(1)]], teams: [this.teamName(rt(0), me), this.teamName(rt(1), me)],
      seats: Array.from({ length: n }, (_, v) => { const s = this.seats[real(v)]; return { name: real(v) === me ? 'You' : s.name, face: s.face, human: s.human, count: g.hands[real(v)].length, team: rt(g.teamOf(real(v))) }; }),
      hand: watch ? null : g.hands[me],
      allHands: watch ? g.hands : null, // watch mode shows every hand face up
      board: g.board, boneyard: g.boneyard.length,
      moves: mine ? g.moves() : [],
      canDraw: !watch && g.turn === me && g.canDraw(),
      result: r ? { ...r, team: r.team === null ? null : rt(r.team), pipsLeft: Array.from({ length: n }, (_, v) => r.pipsLeft[real(v)]) } : null,
      winner: g.winner === null ? null : rt(g.winner), log: this.log.slice(-6),
      lastPlay: last ? { ...last, seat: rot(last.seat) } : null,
    };
  }

  private push(): void {
    if (this.closed) return;
    this.seats.forEach((s, i) => { if (s.send) s.send(this.started ? this.view(i) : this.lobby(i)); });
    if (this.watcher) this.watcher(this.view(-1));
    if (this.spectators.size) { const v = this.spectatorView(); for (const s of this.spectators) s(v); }
  }

  private spectatorView(): unknown {
    return this.started ? { ...(this.view(-1) as object), spectate: true } : this.lobby(-1);
  }
}
