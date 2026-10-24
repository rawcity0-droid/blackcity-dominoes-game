// The whole board fits the phone and tablet table area with no scrolling and no tiles touching, up to every tile played.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, chooseMove, boardTiles } from '../src/engine/dominoes.ts';
// @ts-ignore plain JS module shared with the browser
import { boardPieces, fitLayout, overlaps } from '../public/board-layout.js';

// Table area (px) left for the board: phone 390x844 and tablet 820x1180, measured in the browser.
const SIZES = { phone: [366, 400], tablet: [736, 620] };

function boards(games: number, n: 2 | 4) {
  const out: any[] = [];
  for (let k = 0; k < games; k++) {
    const g = new Game(n); g.deal();
    while (!g.handOver) {
      const m = chooseMove(g);
      if (m) g.play(m); else if (g.canDraw()) g.draw(); else g.pass();
      if (g.board.lead) out.push(structuredClone(g.board));
    }
  }
  return out;
}

test('every board from 400 hands fits phone and tablet, tiles never overlap, stay readable', () => {
  const all = [...boards(200, 4), ...boards(200, 2)];
  let biggest = 0;
  for (const [name, [W, H]] of Object.entries(SIZES)) {
    let minT = 99;
    for (const b of all) {
      const B = boardPieces(b, '', () => true); // with end buttons showing
      const fit = fitLayout(B, W, H);
      assert.equal(overlaps(fit.items), false);
      assert.ok(fit.b.w * fit.t <= W + 0.01 && fit.b.h * fit.t <= H + 0.01, `${name} overflow`);
      minT = Math.min(minT, fit.t);
      biggest = Math.max(biggest, boardTiles(b).length);
    }
    console.log(name, 'smallest tile unit', minT, 'px; longest board', biggest, 'tiles');
    assert.ok(minT >= (name === 'phone' ? 18 : 32), `${name} tiles too small: ${minT}`);
  }
});

test('short boards keep full-size 52px tiles', () => {
  const g = new Game(4); g.deal();
  g.play(chooseMove(g)!);
  assert.equal(fitLayout(boardPieces(g.board), 366, 400).t, 52);
});
