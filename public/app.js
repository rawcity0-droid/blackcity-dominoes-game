// Blackcity Dominoes client: home screen, avatar builder, and the table. The server runs the game.
import { PARTS, PRESETS, avatarSrc, decode, encode, isCustom, randomCode, seededCode } from './avatar.js';

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

const state = {
  name: store.get('dom_name') || '',
  face: store.get('dom_face') || '',
  players: Number(store.get('dom_players')) === 2 ? 2 : 4,
  view: null,      // last table state from the server
  screen: 'home',
  selected: null,  // tile picked from my hand when it fits more than one end
};

/** Tiny element helper. */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
}
const btn = (cls, text, onclick) => h('button', { class: 'btn ' + cls, type: 'button', text, onclick });

// ---------- connection ----------
let ws = null;
const queue = [];
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => { while (queue.length) ws.send(queue.shift()); };
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'state') { state.view = m; if (state.screen === 'table') render(); } };
  ws.onclose = () => { setTimeout(connect, 1500); if (state.screen === 'table') { state.screen = 'home'; render(); } };
}
function send(m) { const s = JSON.stringify(m); if (ws && ws.readyState === 1) ws.send(s); else queue.push(s); }

// ---------- faces ----------
const validFace = (f) => isCustom(f) || PRESETS.some(([id]) => id === f);
const myFace = () => (validFace(state.face) ? state.face : seededCode(state.name || 'You'));
function facePhoto(face) {
  return h('img', { src: isCustom(face) ? avatarSrc(face) : `/faces/${face}.jpg`, alt: '', draggable: 'false' });
}
const avatar = (face, cls = '') => h('div', { class: 'avatar ' + cls }, facePhoto(face));

// ---------- tiles ----------
const SPOTS = { 0: [], 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]], 6: [[0, 0], [1, 0], [2, 0], [0, 2], [1, 2], [2, 2]] };
/** A domino as SVG. a = left/top half, b = right/bottom half. */
function tileSvg(a, b, vertical = false, cls = '') {
  const W = vertical ? 50 : 100, H = vertical ? 100 : 50;
  let s = `<svg class="tile ${vertical ? 'v' : 'h'} ${cls}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="7" fill="#f7f6f0" stroke="#1b1b12" stroke-width="1.5"/>`;
  s += vertical ? '<path d="M8 50 H42" stroke="#9a9a8e" stroke-width="2"/>' : '<path d="M50 8 V42" stroke="#9a9a8e" stroke-width="2"/>';
  [a, b].forEach((n, half) => {
    const ox = vertical ? 0 : half * 50, oy = vertical ? half * 50 : 0;
    for (const [r, c] of SPOTS[n]) s += `<circle cx="${ox + 12 + c * 13}" cy="${oy + 12 + r * 13}" r="4.6" fill="#141414"/>`;
  });
  return s + '</svg>';
}
const svgEl = (markup) => { const t = document.createElement('template'); t.innerHTML = markup; return t.content.firstChild; };
const tid = (t) => `${t[0]}-${t[1]}`;
const inner = (p) => (p.tile[0] === p.open ? p.tile[1] : p.tile[0]);
const dbl = (t) => t[0] === t[1];

// ---------- home ----------
function renderHome() {
  const nameIn = h('input', { value: state.name, maxlength: '16', placeholder: 'Your name', 'aria-label': 'Your name' });
  nameIn.addEventListener('input', () => { state.name = nameIn.value; store.set('dom_name', state.name); });
  const seg = h('div', { class: 'seg' }, [4, 2].map((n) =>
    h('button', { type: 'button', class: state.players === n ? 'on' : '', text: n === 4 ? '4 players' : '2 players', onclick: () => { state.players = n; store.set('dom_players', String(n)); render(); } })));
  const me = h('button', { class: 'avatar big', type: 'button', 'aria-label': 'Customize your avatar', onclick: openAvatarBuilder }, facePhoto(myFace()));
  $app.replaceChildren(h('div', { class: 'home' },
    h('div', { class: 'brand', text: 'BLACKCITY' }),
    h('h1', { class: 'title', text: 'DOMINOES' }),
    h('div', { class: 'hero' }, svgEl(tileSvg(6, 6, true)), svgEl(tileSvg(5, 0, true)), svgEl(tileSvg(3, 2, true))),
    h('div', { class: 'sub', text: 'All Fives · Double-six · 7 tiles each' }),
    h('div', { class: 'card' },
      h('div', { class: 'me-row' }, me, nameIn),
      btn('outline small', 'Customize avatar', openAvatarBuilder),
      h('div', { class: 'lab', text: 'Table' }), seg,
      h('div', { class: 'tiny', text: state.players === 4 ? 'You and your partner (across) vs. two players. All tiles dealt, no boneyard.' : 'Head to head. 14 tiles in the boneyard to draw from.' }),
      btn('gold', 'Play', () => start('play')),
      btn('outline', 'Watch a table', () => start('watch'))),
    h('div', { class: 'tiny', text: 'Score when the open ends add up to 5, 10, 15… First to 150 wins.' })));
}

function start(mode) {
  state.screen = 'table'; state.view = null; state.selected = null;
  send({ t: 'start', mode, players: state.players, name: state.name || 'You', face: myFace() });
  render();
}
function toMenu() { send({ t: 'leave' }); state.screen = 'home'; render(); }

// ---------- table ----------
const seatPos = (v, i) => (v.n === 2 ? (i === 0 ? 's' : 'n') : ['s', 'w', 'n', 'e'][i]);
const who = (v, i) => (v.seats[i].human ? 'You' : v.seats[i].name);

function renderTable() {
  const v = state.view;
  if (!v) { $app.replaceChildren(h('div', { class: 'home' }, h('div', { class: 'sub', text: 'Shuffling…' }))); return; }
  const top = h('div', { class: 'topbar' },
    h('button', { class: 'roundbtn', type: 'button', 'aria-label': 'Back to the menu', text: '‹', onclick: toMenu }),
    [0, 1].map((t) => h('div', { class: 'sbox' + (!v.watch && t === 0 ? ' mine' : '') }, h('div', { class: 'num', text: String(v.scores[t]) }), h('div', { class: 'nm', text: v.teams[t] }))),
    h('div', { class: 'target', text: v.watch ? `Watching · to ${v.target}` : `to ${v.target}` }));

  const felt = h('div', { class: 'felt' });
  v.seats.forEach((s, i) => {
    felt.append(h('div', { class: `pill ${seatPos(v, i)}` + (v.turn === i && !v.result ? ' turn' : '') },
      avatar(s.face), h('div', {}, h('div', { class: 'pname', text: s.human ? 'You' : s.name }), h('div', { class: 'pstat', text: `${s.count} tile${s.count === 1 ? '' : 's'}` }))));
  });
  const center = h('div', { class: 'center' });
  felt.append(center);
  const myMoves = v.moves || [];
  const selMoves = state.selected ? myMoves.filter((m) => tid(m.tile) === state.selected) : [];
  center.append(boardEl(v.board, selMoves, v));
  if (v.board.lead) center.append(h('div', { class: 'count', text: `Ends: ${countEnds(v.board)}` }));
  if (v.n === 2) center.append(h('div', { class: 'yard', text: `Boneyard: ${v.boneyard}` }));
  const lp = v.lastPlay;
  if (lp && lp.scored) center.append(h('div', { class: 'score-pop', text: `${who(v, lp.seat)} +${lp.scored}` }));
  if (v.result) felt.append(resultBanner(v));

  const mine = !v.watch && v.turn === 0 && !v.result;
  const status = h('div', { class: 'status' },
    mine ? h('div', { class: 'big', text: myMoves.length ? (selMoves.length > 1 ? 'Tap an arrow to pick the end' : 'Your turn') : v.canDraw ? 'No play. Draw a tile.' : 'No play. Passing…' }) : null,
    h('div', { text: v.log[v.log.length - 1] || '' }));

  const parts = [top, felt, status];
  if (v.watch) {
    parts.push(h('div', { class: 'watch-hands' }, v.allHands.map((hand, i) =>
      h('div', { class: 'row' }, h('b', { text: v.seats[i].name }), hand.map((t) => svgEl(tileSvg(t[0], t[1])))))));
    parts.push(h('div', { class: 'actions' }, btn('outline small', 'New watch table', () => start('watch'))));
  } else {
    const okIds = new Set(myMoves.map((m) => tid(m.tile)));
    parts.push(h('div', { class: 'hand' }, (v.hand || []).map((t) => {
      const id = tid(t);
      return h('button', { type: 'button', class: (okIds.has(id) ? 'ok' : '') + (state.selected === id ? ' sel' : ''), 'aria-label': `Domino ${t[0]}-${t[1]}`,
        disabled: okIds.has(id) ? null : 'disabled', onclick: () => pickTile(id) }, svgEl(tileSvg(t[0], t[1], true)));
    })));
    if (v.canDraw) parts.push(h('div', { class: 'actions' }, btn('gold small', `Draw (${v.boneyard} left)`, () => send({ t: 'draw' }))));
  }
  $app.replaceChildren(...parts);
  fitBoard(center);
}

function pickTile(id) {
  const ms = (state.view.moves || []).filter((m) => tid(m.tile) === id);
  if (!ms.length) return;
  if (ms.length === 1) { state.selected = null; send({ t: 'play', tile: ms[0].tile, arm: ms[0].arm }); return; }
  state.selected = state.selected === id ? null : id;
  render();
}
function playAt(arm) {
  const m = (state.view.moves || []).find((x) => tid(x.tile) === state.selected && x.arm === arm);
  state.selected = null;
  if (m) send({ t: 'play', tile: m.tile, arm: m.arm });
}

/** Same count rule as the server, shown as a hint. */
function countEnds(b) {
  const { L, R, N, S } = b.arms;
  if (!L.length && !R.length) return b.lead[0] + b.lead[1];
  const end = (arm) => { const x = arm[arm.length - 1]; return x.open * (dbl(x.tile) ? 2 : 1); };
  let s = 0;
  s += L.length ? end(L) : b.lead[0] * (dbl(b.lead) ? 2 : 1);
  s += R.length ? end(R) : b.lead[1] * (dbl(b.lead) ? 2 : 1);
  if (N.length) s += end(N);
  if (S.length) s += end(S);
  return s;
}

/** Board pieces: lead, left/right arms (these snake at the table edges), spinner up/down branches. Positions are set in fitBoard. */
function boardEl(b, selMoves, v) {
  const line = h('div', { class: 'line' });
  if (!b.lead) {
    line.classList.add('empty');
    line.append(selMoves.length || (v.moves || []).length ? h('div', { class: 'tiny', text: 'Tap a domino to lead' }) : h('div', { class: 'tiny', text: 'Waiting for the first domino…' }));
    return line;
  }
  const lastId = v.lastPlay && v.lastPlay.tile ? tid(v.lastPlay.tile) : '';
  const sp = b.spinner;
  const piece = (p) => ({ a: inner(p), b: p.open, d: dbl(p.tile), cls: tid(p.tile) === lastId ? 'new' : '' });
  line._board = {
    lead: { a: b.lead[0], b: b.lead[1], d: dbl(b.lead), cls: tid(b.lead) === lastId ? 'new' : '', spin: sp === 'C' },
    L: b.arms.L.map((p, i) => ({ ...piece(p), spin: !!sp && sp !== 'C' && sp.arm === 'L' && sp.index === i })),
    R: b.arms.R.map((p, i) => ({ ...piece(p), spin: !!sp && sp !== 'C' && sp.arm === 'R' && sp.index === i })),
    N: b.arms.N.map(piece), S: b.arms.S.map(piece),
    btn: (arm) => selMoves.some((m) => m.arm === arm) ? h('button', { class: 'end-btn', type: 'button', text: { L: '◀', R: '▶', N: '▲', S: '▼' }[arm], 'aria-label': 'Place it here', onclick: () => playAt(arm) }) : null,
  };
  return line;
}

/** Lay the board out in tile units (1 unit = short side of a domino). Left/right arms turn at ±half so they snake. */
function layoutBoard(B, half) {
  const out = []; // {x, y, w, h, svg | btn}
  const put = (x, y, w, hh, p, vert, flip) => out.push({ x, y, w, h: hh, svg: tileSvg(flip ? p.b : p.a, flip ? p.a : p.b, vert, p.cls) });
  let spinAt = null;
  const L0 = B.lead;
  if (L0.d) put(-0.5, -1, 1, 2, L0, true, false); else put(-1, -0.5, 2, 1, L0, false, false);
  if (L0.spin) spinAt = { x: 0, top: -1, bot: 1 };
  const edge = L0.d ? 0.5 : 1;
  // dir: +1 right / -1 left; turn: +1 down / -1 up
  const arm = (tiles, dir, turn, key) => {
    const out0 = dir;
    let cx = dir * edge, cy = 0;
    // Rows heading back toward the middle stop short of the spinner column so they never hit its up/down branches.
    const limit = (d) => (d === out0 ? d * half : spinAt && (spinAt.x - cx) * out0 < 0 ? spinAt.x + out0 : d * half);
    for (const p of tiles) {
      const len = p.d ? 1 : 2;
      const far = cx + dir * len;
      if (!p.spin && !p.d && (dir > 0 ? far > limit(dir) : far < limit(dir))) {
        // corner: vertical tile hanging off the end, then reverse direction one row over
        const x = dir > 0 ? cx - 1 : cx;
        const y = turn > 0 ? cy + 0.5 : cy - 2.5;
        put(x, y, 1, 2, p, true, turn < 0);
        cy += turn * 2; cx = dir > 0 ? cx - 1 : cx + 1; dir = -dir;
        continue;
      }
      if (p.d) {
        const x = dir > 0 ? cx : cx - 1;
        put(x, cy - 1, 1, 2, p, true, false);
        if (p.spin) spinAt = { x: x + 0.5, top: cy - 1, bot: cy + 1 };
      } else {
        put(dir > 0 ? cx : cx - 2, cy - 0.5, 2, 1, p, false, dir < 0);
      }
      cx += dir * len;
    }
    const b = B.btn(key);
    if (b) out.push({ x: dir > 0 ? cx + 0.1 : cx - 1.1, y: cy - 0.5, w: 1, h: 1, btn: b });
  };
  // Lay the arm holding the spinner first so the other arm knows where its branches are.
  if (B.R.some((p) => p.spin)) { arm(B.R, 1, 1, 'R'); arm(B.L, -1, -1, 'L'); } else { arm(B.L, -1, -1, 'L'); arm(B.R, 1, 1, 'R'); }
  if (spinAt) {
    const branch = (tiles, s, key) => {
      let y = s < 0 ? spinAt.top : spinAt.bot;
      for (const p of tiles) {
        if (p.d) { put(spinAt.x - 1, s < 0 ? y - 1 : y, 2, 1, p, false, false); y += s; }
        else { put(spinAt.x - 0.5, s < 0 ? y - 2 : y, 1, 2, p, true, s < 0); y += 2 * s; }
      }
      const b = B.btn(key);
      if (b) out.push({ x: spinAt.x - 0.5, y: s < 0 ? y - 1.1 : y + 0.1, w: 1, h: 1, btn: b });
    };
    branch(B.N, -1, 'N'); branch(B.S, 1, 'S');
  }
  return out;
}
const overlaps = (items) => items.some((a, i) => items.some((b, j) => j > i && a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01));

/** Pick a tile size from the table, snake the arms to fit the width, and only shrink as a last resort. */
function fitBoard(center) {
  const line = center.querySelector('.line');
  if (!line || !line._board) return;
  const W = center.clientWidth - 8, H = center.clientHeight - 40;
  // Largest tile size (in px per unit) whose snaked layout fits the table without shrinking.
  let t, items;
  for (t = 52; ; t -= 2) {
    let half = Math.max(3, Math.floor(W / t / 2));
    items = layoutBoard(line._board, half);
    for (let i = 0; i < 12 && overlaps(items); i++) items = layoutBoard(line._board, ++half);
    const bw = Math.max(...items.map((i) => i.x + i.w)) - Math.min(...items.map((i) => i.x));
    const bh = Math.max(...items.map((i) => i.y + i.h)) - Math.min(...items.map((i) => i.y));
    if (t <= 20 || (bw * t <= W && bh * t <= H)) break;
  }
  const x0 = Math.min(...items.map((i) => i.x)), y0 = Math.min(...items.map((i) => i.y));
  const bw = Math.max(...items.map((i) => i.x + i.w)) - x0, bh = Math.max(...items.map((i) => i.y + i.h)) - y0;
  line.style.width = `${bw * t}px`; line.style.height = `${bh * t}px`; line.style.setProperty('--t', `${t}px`);
  for (const it of items) {
    const el = it.btn || svgEl(it.svg);
    Object.assign(el.style, { position: 'absolute', left: `${(it.x - x0) * t}px`, top: `${(it.y - y0) * t}px`, width: `${it.w * t}px`, height: `${it.h * t}px` });
    if (it.btn) Object.assign(el.style, { minWidth: '0', minHeight: '0', fontSize: `${Math.round(t * 0.5)}px` });
    line.append(el);
  }
  const k = Math.min(1, W / (bw * t), H / (bh * t));
  line.style.transform = k < 1 ? `scale(${k})` : '';
}

function resultBanner(v) {
  const r = v.result;
  let big, small;
  if (v.winner !== null) {
    big = v.watch ? `${v.teams[v.winner]} win!` : v.winner === 0 ? 'You win!' : `${v.teams[v.winner]} win`;
    small = `Final: ${v.scores[0]} – ${v.scores[1]}`;
  } else if (r.kind === 'domino') { big = 'Domino!'; small = `+${r.points} for ${v.teams[r.team]}`; }
  else { big = 'Blocked'; small = r.team === null ? 'Tie on pips. No points.' : `Fewest pips: +${r.points} for ${v.teams[r.team]}`; }
  return h('div', { class: 'banner' }, h('div', {}, h('div', { class: 'big', text: big }), h('div', { text: small }),
    h('div', { class: 'tiny', text: 'Pips left: ' + r.pipsLeft.map((p, i) => `${who(v, i)} ${p}`).join(' · ') }),
    v.winner !== null
      ? h('div', { class: 'actions' }, btn('gold small', v.watch ? 'Watch another' : 'Play again', () => start(v.watch ? 'watch' : 'play')), btn('outline small', 'Menu', toMenu))
      : h('div', { class: 'tiny', text: 'Next hand coming up…' })));
}

// ---------- avatar builder (same parts and codes as Blackcity Spades) ----------
function openAvatarBuilder() {
  let code = isCustom(state.face) ? state.face : (state.face ? '' : myFace());
  let preset = code ? '' : state.face;
  let tab = 0;
  const preview = h('div', { class: 'avatar xl' });
  const tabs = h('div', { class: 'av-tabs', role: 'tablist' });
  const grid = h('div', { class: 'av-grid' });
  const current = () => preset || code;
  const option = (thumb, label, on, pick, round = false) =>
    h('button', { class: 'av-opt' + (on ? ' on' : ''), type: 'button', 'aria-label': label, title: label, onclick: () => { pick(); draw(); } }, thumb, round ? null : h('span', { text: label }));
  function draw() {
    preview.replaceChildren(facePhoto(current()));
    tabs.replaceChildren(...[...PARTS.map((p) => p.label), 'Pictures'].map((label, i) =>
      h('button', { class: 'av-tab' + (i === tab ? ' on' : ''), type: 'button', text: label, onclick: () => { tab = i; draw(); } })));
    grid.replaceChildren();
    if (tab === PARTS.length) { for (const [id, label] of PRESETS) grid.append(option(avatar(id), label, preset === id, () => { preset = id; })); return; }
    const part = PARTS[tab];
    const now = decode(code || seededCode(state.name || 'You'));
    for (let i = 0; i < part.n; i++) {
      let thumb;
      if (part.swatch) { thumb = h('span', { class: 'swatch' }); thumb.style.background = part.swatch[i]; }
      else thumb = avatar(encode({ ...now, [part.key]: i, ...(part.key === 'hair' ? { hat: 0 } : {}) }));
      grid.append(option(thumb, part.names ? part.names[i] : `${part.label} ${i + 1}`, !preset && now[part.key] === i, () => { preset = ''; code = encode({ ...now, [part.key]: i }); }, !!part.swatch));
    }
  }
  draw();
  $modal.replaceChildren(h('div', { class: 'sheet' }, h('h2', { text: 'Your avatar' }),
    h('div', { class: 'av-top' }, preview, btn('outline small', '🎲 Surprise me', () => { preset = ''; code = randomCode(); draw(); })),
    tabs, grid,
    h('div', { class: 'av-actions' },
      btn('gold', 'Save avatar', () => { state.face = current(); store.set('dom_face', state.face); closeModal(); render(); }),
      btn('outline small', 'Cancel', closeModal))));
  $modal.classList.remove('hidden');
}
function closeModal() { $modal.classList.add('hidden'); $modal.replaceChildren(); }
$modal.addEventListener('click', (e) => { if (e.target === $modal) closeModal(); });

function render() { if (state.screen === 'home') renderHome(); else renderTable(); }
window.addEventListener('resize', () => { if (state.screen === 'table') render(); });
connect();
render();
window.__dom = { state, start };
