// Board layout in tile units (1 unit = short side of a domino), no DOM, so tests can run it in Node.
// B = { lead, L, R, N, S, btn(arm) } where each piece is { a, b, d (double), spin? }.
// Left/right arms snake: they turn at ±half and come back one row over. Spinner branches go up/down and turn at ±vhalf.

export function layoutBoard(B, half, vhalf = 99) {
  const out = []; // {x, y, w, h, p, vert, flip} or {x, y, w, h, btn}
  const put = (x, y, w, h, p, vert, flip) => out.push({ x, y, w, h, p, vert, flip });
  let spinAt = null;
  const L0 = B.lead;
  if (L0.d) put(-0.5, -1, 1, 2, L0, true, false); else put(-1, -0.5, 2, 1, L0, false, false);
  if (L0.spin) spinAt = { x: 0, top: -1, bot: 1 };
  const edge = L0.d ? 0.5 : 1;
  // Snake a run of tiles along a row: dir +1 right / -1 left, turn +1 down / -1 up, from (cx, cy) = open end / row center.
  // limit(dir, cx) = how far the row may run that way before it turns. Returns where the open end finished.
  const snake = (tiles, cx, cy, dir, turn, ext, limit) => {
    for (const p of tiles) {
      const len = p.d ? 1 : 2;
      const far = cx + dir * len;
      const lim = limit(dir, cx);
      if (!p.spin && !p.d && (dir > 0 ? far > lim : far < lim)) {
        // corner: vertical tile hanging off the end, then reverse direction one row over
        const x = dir > 0 ? cx - 1 : cx;
        const y = turn > 0 ? cy + ext : cy - ext - 2;
        put(x, y, 1, 2, p, true, turn < 0);
        cy += turn * (ext + 1.5); ext = 0.5; cx = dir > 0 ? cx - 1 : cx + 1; dir = -dir;
        continue;
      }
      if (p.d) {
        const x = dir > 0 ? cx : cx - 1;
        put(x, cy - 1, 1, 2, p, true, false);
        if (p.spin) spinAt = { x: x + 0.5, top: cy - 1, bot: cy + 1 };
        ext = 1;
      } else {
        put(dir > 0 ? cx : cx - 2, cy - 0.5, 2, 1, p, false, dir < 0);
        ext = 0.5;
      }
      cx += dir * len;
    }
    return { cx, cy, dir };
  };
  const endBtn = (key, e) => { if (B.btn(key)) out.push({ x: e.dir > 0 ? e.cx + 0.1 : e.cx - 1.1, y: e.cy - 0.5, w: 1, h: 1, btn: key }); };
  const arm = (tiles, dir, turn, key) => {
    const out0 = dir;
    // Rows heading back toward the middle stop short of the spinner column so they never hit its up/down branches.
    const limit = (d, cx) => (d === out0 ? d * half : spinAt && (spinAt.x - cx) * out0 < 0 ? spinAt.x + out0 : d * half);
    endBtn(key, snake(tiles, dir * edge, 0, dir, turn, L0.d ? 1 : 0.5, limit));
  };
  // Lay the arm holding the spinner first so the other arm knows where its branches are.
  if (B.R.some((p) => p.spin)) { arm(B.R, 1, 1, 'R'); arm(B.L, -1, -1, 'L'); } else { arm(B.L, -1, -1, 'L'); arm(B.R, 1, 1, 'R'); }
  if (spinAt) {
    // s: -1 up / +1 down. A branch turns sideways (away from side = +1 right for up, -1 left for down) once it runs past vhalf.
    const branch = (tiles, s, side, key) => {
      const x = spinAt.x;
      let y = s < 0 ? spinAt.top : spinAt.bot; // open edge of the column
      let i = 0;
      for (; i < tiles.length; i++) {
        const p = tiles[i];
        if (!p.d && Math.abs(y + s * 2) > vhalf) break;
        if (p.d) { put(x - 1, s < 0 ? y - 1 : y, 2, 1, p, false, false); y += s; }
        else { put(x - 0.5, s < 0 ? y - 2 : y, 1, 2, p, true, s < 0); y += 2 * s; }
      }
      if (i === tiles.length) {
        if (B.btn(key)) out.push({ x: x - 0.5, y: s < 0 ? y - 1.1 : y + 0.1, w: 1, h: 1, btn: key });
        return;
      }
      // corner: a flat tile on top (or bottom) of the column, then snake sideways, rows stacking away from the middle
      const p = tiles[i];
      put(side > 0 ? x - 0.5 : x - 1.5, s < 0 ? y - 1 : y, 2, 1, p, false, side < 0);
      const e = snake(tiles.slice(i + 1), side > 0 ? x + 1.5 : x - 1.5, s < 0 ? y - 0.5 : y + 0.5, side, s, 0.5, (d) => d * half);
      endBtn(key, e);
    };
    branch(B.N, -1, 1, 'N'); branch(B.S, 1, -1, 'S');
  }
  return out;
}

export const overlaps = (items) => items.some((a, i) => items.some((b, j) => j > i && a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01));

const box = (it) => {
  const x0 = Math.min(...it.map((i) => i.x)), y0 = Math.min(...it.map((i) => i.y));
  return { x0, y0, w: Math.max(...it.map((i) => i.x + i.w)) - x0, h: Math.max(...it.map((i) => i.y + i.h)) - y0 };
};

/**
 * Pick the layout (turn widths) that lets tiles be biggest while the whole board fits in W x H pixels.
 * Tiles never go above maxT px per unit; they shrink only as much as needed. Never needs scrolling.
 */
export function fitLayout(B, W, H, maxT = 52) {
  let best = null;
  for (let half = 2; half <= 30; half++) {
    for (const vhalf of [99, 3, 4, 5, 6, 8, 10]) {
      const items = layoutBoard(B, half, vhalf);
      if (overlaps(items)) continue;
      const b = box(items);
      const t = Math.min(maxT, W / b.w, H / b.h);
      // Prefer bigger tiles; on a tie (both capped) prefer the straighter, more compact board.
      if (!best || t > best.t + 0.01 || (Math.abs(t - best.t) <= 0.01 && b.w * b.h < best.b.w * best.b.h)) best = { t, items, b };
    }
  }
  if (!best) { const items = layoutBoard(B, 30); const b = box(items); best = { t: Math.min(maxT, W / b.w, H / b.h), items, b }; }
  best.t = Math.floor(best.t * 2) / 2; // whole half-pixels keep tile edges crisp
  return best;
}

/** Server board -> layout pieces. a = the side touching the tile before it, b = the open side. */
export function boardPieces(board, lastId = '', canPlay = () => false) {
  const tid = (t) => `${t[0]}-${t[1]}`;
  const dbl = (t) => t[0] === t[1];
  const sp = board.spinner;
  const piece = (p) => ({ a: p.tile[0] === p.open ? p.tile[1] : p.tile[0], b: p.open, d: dbl(p.tile), cls: tid(p.tile) === lastId ? 'new' : '' });
  const lead = board.lead;
  return {
    lead: { a: lead[0], b: lead[1], d: dbl(lead), cls: tid(lead) === lastId ? 'new' : '', spin: sp === 'C' },
    L: board.arms.L.map((p, i) => ({ ...piece(p), spin: !!sp && sp !== 'C' && sp.arm === 'L' && sp.index === i })),
    R: board.arms.R.map((p, i) => ({ ...piece(p), spin: !!sp && sp !== 'C' && sp.arm === 'R' && sp.index === i })),
    N: board.arms.N.map(piece), S: board.arms.S.map(piece),
    btn: canPlay,
  };
}
