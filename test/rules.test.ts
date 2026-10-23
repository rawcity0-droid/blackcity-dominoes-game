import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Tile, boardCount, chooseMove, emptyBoard, fullSet, legalMoves, openPip, place, roundTo5 } from '../src/engine/dominoes.ts';

test('double-six set has 28 tiles, 7 each, boneyard only with 2 players', () => {
  assert.equal(fullSet().length, 28);
  const g4 = new Game(4); g4.deal();
  assert.deepEqual(g4.hands.map((h) => h.length), [7, 7, 7, 7]); assert.equal(g4.boneyard.length, 0);
  const g2 = new Game(2); g2.deal();
  assert.deepEqual(g2.hands.map((h) => h.length), [7, 7]); assert.equal(g2.boneyard.length, 14);
});

test('rounding to nearest 5', () => {
  assert.equal(roundTo5(12), 10); assert.equal(roundTo5(13), 15); assert.equal(roundTo5(0), 0); assert.equal(roundTo5(27), 25);
});

test('open-end counts: first tile, doubles count both halves', () => {
  const b = emptyBoard();
  assert.equal(place(b, { tile: [5, 5], arm: 'lead' }), 10); // lone 5-5 = 10
  assert.equal(place(b, { tile: [5, 0], arm: 'R' }), 10);   // 5-5 end (10) + 0
  assert.equal(place(b, { tile: [5, 3], arm: 'L' }), 3);    // both sides covered: 3 + 0
  const b2 = emptyBoard();
  assert.equal(place(b2, { tile: [6, 4], arm: 'lead' }), 10);
  assert.equal(place(b2, { tile: [4, 4], arm: 'R' }), 14);  // 6 + double 4 (8)
});

test('spinner: lead double opens up/down only after both sides are played', () => {
  const b = emptyBoard();
  place(b, { tile: [6, 6], arm: 'lead' });
  assert.equal(openPip(b, 'N'), null);
  assert.deepEqual(legalMoves(b, [[6, 2]]).map((m) => m.arm), ['R']);
  place(b, { tile: [6, 2], arm: 'R' });
  assert.equal(openPip(b, 'N'), null);
  place(b, { tile: [6, 3], arm: 'L' });
  assert.equal(openPip(b, 'N'), 6); assert.equal(openPip(b, 'S'), 6);
  assert.equal(boardCount(b), 5);
  assert.equal(place(b, { tile: [6, 5], arm: 'N' }), 10); // 3 + 2 + 5
  assert.equal(place(b, { tile: [6, 0], arm: 'S' }), 10); // 3 + 2 + 5 + 0
});

test('spinner: first double played later in the line becomes the spinner', () => {
  const b = emptyBoard();
  place(b, { tile: [4, 2], arm: 'lead' });
  place(b, { tile: [2, 2], arm: 'R' });
  assert.deepEqual(b.spinner, { arm: 'R', index: 0 });
  assert.equal(openPip(b, 'N'), null);
  place(b, { tile: [2, 1], arm: 'R' });
  assert.equal(openPip(b, 'N'), 2);
  assert.throws(() => place(b, { tile: [3, 3], arm: 'R' })); // end is 1
});

test('second double is not a spinner', () => {
  const b = emptyBoard();
  place(b, { tile: [1, 1], arm: 'lead' });
  place(b, { tile: [1, 3], arm: 'R' }); place(b, { tile: [3, 3], arm: 'R' });
  assert.equal(b.spinner, 'C');
  place(b, { tile: [1, 4], arm: 'L' });
  place(b, { tile: [3, 0], arm: 'R' });
  assert.equal(openPip(b, 'N'), 1); // branches come off the 1-1 only
});

function rig(n: 2 | 4, hands: Tile[][], boneyard: Tile[] = []) {
  const g = new Game(n, { rng: () => 0.42 });
  g.deal();
  g.hands = hands.map((h) => h.slice()); g.boneyard = boneyard.slice();
  g.forcedLead = null; g.turn = 0;
  return g;
}

test('playing a multiple of 5 scores for the team (4 players: partners share)', () => {
  const g = rig(4, [[[5, 5], [0, 0]], [[1, 2]], [[5, 0], [6, 6]], [[3, 4]]]);
  g.play({ tile: [5, 5], arm: 'lead' });
  assert.deepEqual(g.scores, [10, 0]);
  g.pass(); // seat 1 has no 5
  g.play({ tile: [5, 0], arm: 'R' }); // 10 + 0 for team 0 (seat 2 is seat 0's partner)
  assert.deepEqual(g.scores, [20, 0]);
});

test('domino: winner gets opponents pips rounded to 5', () => {
  const g = rig(4, [[[6, 4]], [[6, 6], [1, 0]], [[2, 2]], [[3, 2]]]);
  g.play({ tile: [6, 4], arm: 'lead' }); // 10 scored, hand empty -> domino
  assert.equal(g.lastResult!.kind, 'domino');
  assert.equal(g.lastResult!.team, 0);
  assert.equal(g.lastResult!.points, 20); // opponents 13 + 5 = 18 -> 20
  assert.deepEqual(g.scores, [30, 0]);
});

test('blocked game: fewer pips scores the other side, next hand led by lowest', () => {
  const g = rig(2, [[[6, 1], [0, 0]], [[5, 5], [4, 4]]]);
  g.play({ tile: [6, 1], arm: 'lead' });
  g.pass(); g.pass();
  assert.equal(g.lastResult!.kind, 'blocked');
  assert.equal(g.lastResult!.team, 0);
  assert.equal(g.lastResult!.points, 20); // 18 -> 20
  g.deal();
  assert.equal(g.turn, 0); assert.equal(g.forcedLead, null);
});

test('blocked game tie scores nothing', () => {
  const g = rig(2, [[[6, 1], [4, 0]], [[2, 2], [0, 0]]]);
  g.play({ tile: [6, 1], arm: 'lead' });
  g.pass(); g.pass();
  assert.equal(g.lastResult!.team, null); assert.deepEqual(g.scores, [0, 0]);
});

test('2 players draw from the boneyard until they can play', () => {
  const g = rig(2, [[[6, 6], [0, 0]], [[1, 0]]], [[2, 3], [6, 2]]);
  g.play({ tile: [6, 6], arm: 'lead' });
  assert.equal(g.moves().length, 0);
  assert.ok(g.canDraw()); g.draw(); // draws 6-2
  assert.equal(g.moves().length, 1);
  assert.throws(() => g.draw());
});

test('first hand: highest double must lead', () => {
  const g = new Game(4, { rng: () => 0.3 }); g.deal();
  assert.deepEqual(g.forcedLead, [6, 6]); // all 28 dealt, so 6-6 is always out with 4 players
  assert.ok(g.moves().every((m) => m.arm === 'lead' && m.tile[0] === 6 && m.tile[1] === 6));
});

test('reaching the target ends the game', () => {
  const g = rig(2, [[[5, 0], [1, 1]], [[2, 3]]]);
  g.scores = [145, 0];
  g.play({ tile: [5, 0], arm: 'lead' });
  assert.equal(g.winner, 0); assert.ok(g.over);
});

test('computer players finish full games for both table sizes', () => {
  for (const n of [2, 4] as const) for (let k = 0; k < 5; k++) {
    const g = new Game(n);
    let guard = 0;
    while (!g.over && guard++ < 50) {
      g.deal();
      while (!g.handOver) {
        const m = chooseMove(g);
        if (m) g.play(m); else if (g.canDraw()) g.draw(); else g.pass();
      }
    }
    assert.ok(g.over); assert.ok(Math.max(...g.scores) >= 150);
    assert.ok(g.scores.every((s) => s % 5 === 0));
  }
});

test('computer player takes an available score', () => {
  const g = rig(2, [[[5, 0], [3, 2], [6, 1]], [[4, 4]]]);
  const m = chooseMove(g)!;
  assert.ok([[5, 0], [3, 2]].some((t) => t[0] === m.tile[0] && t[1] === m.tile[1]));
});
