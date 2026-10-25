// Blackcity Dominoes client: home screen, avatar builder, and the table. The server runs the game.
import { boardPieces, fitLayout } from './board-layout.js';
import { PARTS, PRESETS, avatarSrc, decode, encode, isCustom, randomCode, seededCode } from './avatar.js';

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };

// Rejoin token: a random id kept on this device (separate from the name) so you can get back to your seat.
function rejoinToken() {
  let t = store.get('dom_rejoin');
  if (!t || !/^[A-Za-z0-9-]{16,64}$/.test(t)) {
    t = (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
    store.set('dom_rejoin', t);
  }
  return t;
}
const token = rejoinToken();

const state = {
  name: '', // never prefilled: shared phones must not show the last player's name
  face: store.get('dom_face') || '',
  players: Number(store.get('dom_players')) === 2 ? 2 : 4,
  view: null,      // last table state from the server
  screen: 'home',
  selected: null,  // tile picked from my hand when it fits more than one end
  lobby: null,     // join-code table waiting to start
  owner: false,    // owner mode on this device (hidden panel + OWNER_CODE)
  ownerAvailable: false,
  joinCode: '',
  resume: null,     // game this device can return to (from the server), or null
  reconnecting: false,
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
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => { setTimeout(connect, 1500); if (state.screen !== 'home') { state.reconnecting = true; toast('Connection lost. Reconnecting…'); } };
}
function onMessage(m) {
  switch (m.t) {
    case 'hello': { // fresh connection: show the saved owner pass, if any
      state.ownerAvailable = m.ownerAvailable;
      const pass = store.get('dom_owner');
      if (pass) send({ t: 'ownerPass', pass }); else state.owner = false;
      send({ t: 'check', token });
      return;
    }
    case 'resumable':
      state.resume = m.ok && !m.game.over ? m.game : null;
      if (state.reconnecting) { // came back after losing connection: go straight back to the seat
        state.reconnecting = false;
        if (state.resume) { send({ t: 'resume', token }); return; }
        if (state.screen !== 'home') { state.screen = 'home'; toast('That game has ended.'); }
      }
      if (state.screen === 'home') render();
      return;
    case 'resumeResult': if (!m.ok) { state.resume = null; state.screen = 'home'; toast(m.message); render(); } return;
    case 'tables': showTables(m.list); return;
    case 'ownerStatus':
      state.owner = m.owner;
      if (!m.owner) store.del('dom_owner');
      if (state.screen === 'home') render();
      return;
    case 'ownerResult': onOwnerResult(m); return;
    case 'state': state.view = m; state.lobby = null; if (state.screen !== 'home') { state.screen = 'table'; render(); } return;
    case 'lobby': state.lobby = m; if (state.screen !== 'home') { state.screen = 'lobby'; render(); } return;
    case 'joinResult': if (!m.ok) { state.screen = 'home'; toast(m.message); render(); } return;
    case 'closed': case 'error': state.screen = 'home'; toast(m.message); render(); return;
  }
}
function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status', text });
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}
function send(m) { const s = JSON.stringify(m); if (ws && ws.readyState === 1) ws.send(s); else queue.push(s); }

// ---------- faces ----------
const isPhoto = (f) => typeof f === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(f) && f.length <= 40000;
const validFace = (f) => isPhoto(f) || isCustom(f) || PRESETS.some(([id]) => id === f);
const myFace = () => (validFace(state.face) ? state.face : seededCode(state.name || 'You'));
function facePhoto(face) {
  return h('img', { src: isPhoto(face) ? face : isCustom(face) ? avatarSrc(face) : `/faces/${face}.jpg`, alt: '', draggable: 'false' });
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
  nameIn.addEventListener('input', () => { state.name = nameIn.value; });
  try { localStorage.removeItem('dom_name'); } catch {} // clear names saved by older versions
  const seg = h('div', { class: 'seg' }, [4, 2].map((n) =>
    h('button', { type: 'button', class: state.players === n ? 'on' : '', text: n === 4 ? '4 players' : '2 players', onclick: () => { state.players = n; store.set('dom_players', String(n)); render(); } })));
  const me = h('button', { class: 'avatar big', type: 'button', 'aria-label': 'Customize your avatar', onclick: openAvatarBuilder }, facePhoto(myFace()));
  $app.replaceChildren(h('div', { class: 'home' },
    h('div', { class: 'brand', text: 'BLACKCITY' }),
    h('h1', { class: 'title', text: 'DOMINOES', onclick: ownerTap }),
    h('div', { class: 'hero' }, svgEl(tileSvg(6, 6, true)), svgEl(tileSvg(5, 0, true)), svgEl(tileSvg(3, 2, true))),
    h('div', { class: 'sub', text: 'All Fives · Double-six · 7 tiles each' }),
    resumeCard(),
    h('div', { class: 'card' },
      h('div', { class: 'me-row' }, me, nameIn),
      h('div', { class: 'face-btns' }, btn('outline small', 'Customize avatar', openAvatarBuilder), btn('outline small', '📷 Use my photo', pickPhoto)),
      h('div', { class: 'lab', text: 'Table' }), seg,
      h('div', { class: 'tiny', text: state.players === 4 ? 'You and your partner (across) vs. two players. All tiles dealt, no boneyard.' : 'Head to head. 14 tiles in the boneyard to draw from.' }),
      btn('gold', 'Play', () => start('play')),
      btn('outline', 'Watch a table', () => start('watch')),
      state.owner ? btn('outline owner', `Host a table with a code (${state.players} players)`, host) : null,
      h('div', { class: 'lab', text: 'Have a code?' }), joinRow()),
    h('div', { class: 'tiny', text: 'Score when the open ends add up to 5, 10, 15… First to 150 wins.' })));
}

/** "Return to your game" when this device still has a seat saved at a game. */
function resumeCard() {
  const g = state.resume;
  if (!g) return null;
  const what = `${g.code ? 'Code table ' + g.code : g.n + '-player game'} · ${g.started ? `Hand ${g.handNo} · ${g.scores[0]} to ${g.scores[1]}` : 'waiting to start'}`;
  return h('div', { class: 'card resume' },
    h('div', { class: 'lab', text: 'Game in progress' }),
    h('div', { class: 'tiny', text: what }),
    btn('gold', 'Return to your game', resumeGame),
    btn('outline small', 'No thanks, end it', () => { if (confirm('Leave that game for good? A computer player takes your seat.')) { state.resume = null; send({ t: 'forfeit', token }); render(); } }));
}
function resumeGame() {
  state.screen = 'table'; state.view = null; state.lobby = null; state.selected = null;
  send({ t: 'resume', token });
  render();
}

function start(mode) {
  state.screen = 'table'; state.view = null; state.selected = null;
  if (mode === 'play') state.resume = null; // a new game replaces the saved one
  send({ t: 'start', mode, players: state.players, name: state.name || 'You', face: myFace(), token });
  render();
}
function joinRow() {
  const input = h('input', { class: 'code-in', value: state.joinCode, maxlength: '5', placeholder: 'CODE', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Table code' });
  input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); state.joinCode = input.value; });
  const go = () => {
    if (input.value.length < 5) { toast('Enter the 5-character code.'); input.focus(); return; }
    state.screen = 'lobby'; state.lobby = null; state.view = null; state.selected = null;
    state.resume = null;
    send({ t: 'join', code: input.value, name: state.name || 'Player', face: myFace(), token });
    render();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return h('div', { class: 'join-row' }, input, btn('gold small', 'Join', go));
}
function host() {
  state.screen = 'lobby'; state.lobby = null; state.view = null; state.selected = null;
  state.resume = null;
  send({ t: 'host', players: state.players, name: state.name || 'Host', face: myFace(), token });
  render();
}

// Hidden owner panel: 3 taps on the DOMINOES title within 2 seconds (same as Blackcity Spades). Nothing on screen points to it.
let ownerTaps = [];
function ownerTap() {
  const now = Date.now();
  ownerTaps = ownerTaps.filter((t) => now - t < 2000);
  ownerTaps.push(now);
  if (ownerTaps.length >= 3) { ownerTaps = []; openOwnerPanel(); }
}
let ownerMsg = null;
function openOwnerPanel() {
  const input = h('input', { type: 'text', id: 'owner-code', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '6', autocomplete: 'off', 'aria-label': 'Owner code' });
  const msg = h('div', { class: 'field-error', role: 'alert' });
  ownerMsg = (text) => { msg.textContent = text || ''; };
  const go = () => {
    const code = input.value.trim();
    if (!/^\d{6}$/.test(code)) { ownerMsg('Enter the 6-digit code.'); return; }
    ownerMsg('Checking…'); send({ t: 'owner', code }); input.value = '';
  };
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); ownerMsg(''); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const rows = state.owner
    ? [h('p', { text: 'Owner mode is on for this device. You can host tables with a join code, or look in on games being played.' }), h('div', { class: 'av-actions' }, btn('gold small', 'Games in progress', () => send({ t: 'tables' })), btn('outline small', 'Turn off on this device', () => { store.del('dom_owner'); state.owner = false; send({ t: 'ownerPass', pass: '' }); closeModal(); render(); }), btn('gold small', 'Close', closeModal))]
    : [input, msg, h('div', { class: 'av-actions' }, btn('gold', 'Unlock', go), btn('outline small', 'Close', closeModal))];
  $modal.replaceChildren(h('div', { class: 'sheet small' }, h('h2', { text: 'Owner' }), ...rows));
  $modal.classList.remove('hidden');
  if (!state.owner) input.focus();
}
/** Owner: games being played right now. "Look in" shows the table with every hand face up. */
function showTables(list) {
  const rows = list.length ? list.map((g) => h('div', { class: 'lobby-seat' },
    h('div', {}, h('b', { text: g.people.map((p) => p.name + (p.here ? '' : ' (away)')).join(', ') || 'Computer players' }),
      h('div', { class: 'tiny', text: `${g.code ? 'Code ' + g.code : 'Solo'} · ${g.n} players · ${g.started ? `hand ${g.handNo}, ${g.scores[0]}–${g.scores[1]}` : 'in lobby'}${g.over ? ' · finished' : ''}` })),
    btn('outline small', 'Look in', () => { closeModal(); state.screen = 'table'; state.view = null; state.lobby = null; send({ t: 'spectate', id: g.id }); render(); })))
    : [h('p', { text: 'No games right now.' })];
  $modal.replaceChildren(h('div', { class: 'sheet small' }, h('h2', { text: 'Games in progress' }), ...rows,
    h('div', { class: 'av-actions' }, btn('outline small', 'Refresh', () => send({ t: 'tables' })), btn('gold small', 'Close', closeModal))));
  $modal.classList.remove('hidden');
}
function onOwnerResult(m) {
  if (m.ok) {
    store.set('dom_owner', m.pass);
    state.owner = true; closeModal(); toast(m.message); render();
  } else if (ownerMsg) ownerMsg(m.message);
}

// ---------- lobby (join-code table before it starts) ----------
function renderLobby() {
  const l = state.lobby;
  if (!l) { $app.replaceChildren(h('div', { class: 'home' }, h('div', { class: 'sub', text: 'Connecting…' }), btn('outline small', 'Back', toMenu))); return; }
  $app.replaceChildren(h('div', { class: 'home lobby' },
    h('div', { class: 'brand', text: 'BLACKCITY' }),
    h('div', { class: 'sub', text: l.host ? 'Share this code. Each person who joins takes a computer player’s seat.' : 'You’re in. Waiting for the host to start.' }),
    h('div', { class: 'join-code', 'aria-label': 'Table code', text: l.code }),
    h('div', { class: 'card' },
      h('div', { class: 'lab', text: `${l.n}-player table` }),
      l.seats.map((s) => h('div', { class: 'lobby-seat' }, avatar(s.face), h('b', { text: s.name }), h('span', { class: 'tiny', text: s.host ? 'Host' : s.human ? 'Joined' : 'Computer' }))),
      l.host ? btn('gold', 'Start game', () => send({ t: 'begin' })) : null,
      btn('outline small', 'Leave', toMenu))));
}

// Your seat stays saved for 10 minutes, so the home screen offers "Return to your game".
function toMenu() { send({ t: 'leave' }); send({ t: 'check', token }); state.screen = 'home'; render(); }

// ---------- table ----------
const seatPos = (v, i) => (v.n === 2 ? (i === 0 ? 's' : 'n') : ['s', 'w', 'n', 'e'][i]);
const who = (v, i) => v.seats[i].name; // the server already says "You" for your own seat

function renderTable() {
  const v = state.view;
  if (!v) { $app.replaceChildren(h('div', { class: 'home' }, h('div', { class: 'sub', text: 'Shuffling…' }))); return; }
  const top = h('div', { class: 'topbar' },
    h('button', { class: 'roundbtn', type: 'button', 'aria-label': 'Back to the menu', text: '‹', onclick: toMenu }),
    [0, 1].map((t) => h('div', { class: 'sbox' + (!v.watch && t === 0 ? ' mine' : '') }, h('div', { class: 'num', text: String(v.scores[t]) }), h('div', { class: 'nm', text: v.teams[t] }))),
    h('div', { class: 'target', text: v.spectate ? `Owner view · to ${v.target}` : v.watch ? `Watching · to ${v.target}` : `to ${v.target}` }));

  const felt = h('div', { class: 'felt' });
  v.seats.forEach((s, i) => {
    felt.append(h('div', { class: `pill ${seatPos(v, i)}` + (v.turn === i && !v.result ? ' turn' : '') },
      avatar(s.face), h('div', {}, h('div', { class: 'pname', text: s.name }), h('div', { class: 'pstat', text: `${s.count} tile${s.count === 1 ? '' : 's'}` }))));
  });
  const center = h('div', { class: 'center' });
  felt.append(center);
  const myMoves = v.moves || [];
  const selMoves = state.selected ? myMoves.filter((m) => tid(m.tile) === state.selected) : [];
  center.append(boardEl(v.board, selMoves, v));
  // Info strip sits above the table, so nothing ever covers the dominoes.
  const lp = v.lastPlay;
  const info = h('div', { class: 'info' },
    h('div', { class: 'yard', text: v.n === 2 ? `Boneyard: ${v.boneyard}` : '' }),
    lp && lp.scored ? h('div', { class: 'score-pop', text: `${who(v, lp.seat)} +${lp.scored}` }) : h('div'),
    h('div', { class: 'count', text: v.board.lead ? `Ends: ${countEnds(v.board)}` : '' }));
  if (v.result) felt.append(resultBanner(v));

  const mine = !v.watch && v.turn === 0 && !v.result;
  const status = h('div', { class: 'status' },
    mine ? h('div', { class: 'big', text: myMoves.length ? (selMoves.length > 1 ? 'Tap an arrow to pick the end' : 'Your turn') : v.canDraw ? 'No play. Draw a tile.' : 'No play. Passing…' }) : null,
    h('div', { text: v.log[v.log.length - 1] || '' }));

  const parts = [top, info, felt, status];
  if (v.watch) {
    parts.push(h('div', { class: 'watch-hands' }, v.allHands.map((hand, i) =>
      h('div', { class: 'row' }, h('b', { text: v.seats[i].name }), hand.map((t) => svgEl(tileSvg(t[0], t[1])))))));
    if (!v.spectate) parts.push(h('div', { class: 'actions' }, btn('outline small', 'New watch table', () => start('watch'))));
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

/** Board: the server board turned into pieces; fitBoard lays them out once the table size is known. */
function boardEl(b, selMoves, v) {
  const line = h('div', { class: 'line' });
  if (!b.lead) {
    line.classList.add('empty');
    line.append(selMoves.length || (v.moves || []).length ? h('div', { class: 'tiny', text: 'Tap a domino to lead' }) : h('div', { class: 'tiny', text: 'Waiting for the first domino…' }));
    return line;
  }
  const lastId = v.lastPlay && v.lastPlay.tile ? tid(v.lastPlay.tile) : '';
  line._board = boardPieces(b, lastId, (arm) => selMoves.some((m) => m.arm === arm));
  return line;
}

/** Snake the board into the table and size tiles as big as fit (max 52px a unit). The whole board always shows. */
function fitBoard(center) {
  const line = center.querySelector('.line');
  if (!line || !line._board) return;
  const W = center.clientWidth - 8, H = center.clientHeight - 8;
  const { t, items, b } = fitLayout(line._board, W, H, 52);
  const x0 = Math.min(...items.map((i) => i.x)), y0 = Math.min(...items.map((i) => i.y));
  line.style.width = `${b.w * t}px`; line.style.height = `${b.h * t}px`; line.style.setProperty('--t', `${t}px`);
  for (const it of items) {
    let el;
    if (it.btn) {
      const arm = it.btn;
      el = h('button', { class: 'end-btn', type: 'button', text: { L: '◀', R: '▶', N: '▲', S: '▼' }[arm], 'aria-label': 'Place it here', onclick: () => playAt(arm) });
    } else {
      const p = it.p;
      el = svgEl(tileSvg(it.flip ? p.b : p.a, it.flip ? p.a : p.b, it.vert, p.cls));
    }
    Object.assign(el.style, { position: 'absolute', left: `${(it.x - x0) * t}px`, top: `${(it.y - y0) * t}px`, width: `${it.w * t}px`, height: `${it.h * t}px` });
    // End buttons stay finger-sized even when tiles shrink: centered on their spot.
    if (it.btn) {
      const s = Math.max(t, 30);
      Object.assign(el.style, { left: `${(it.x - x0 + 0.5) * t - s / 2}px`, top: `${(it.y - y0 + 0.5) * t - s / 2}px`, width: `${s}px`, height: `${s}px`, minWidth: '0', minHeight: '0', fontSize: `${Math.round(s * 0.5)}px`, zIndex: 2 });
    }
    line.append(el);
  }
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
    v.winner !== null && v.spectate ? h('div', { class: 'actions' }, btn('outline small', 'Menu', toMenu))
    : v.winner !== null
      ? h('div', { class: 'actions' }, btn('gold small', v.watch ? 'Watch another' : 'Play again', () => start(v.watch ? 'watch' : 'play')), btn('outline small', 'Menu', toMenu))
      : h('div', { class: 'tiny', text: 'Next hand coming up…' })));
}

// ---------- own photo: square crop, 128px, small JPEG kept on this device ----------
function pickPhoto() {
  const input = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  document.body.append(input); // some phones only open the picker for an input that is on the page
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    try { openPhotoPreview(await shrinkPhoto(file)); } catch { alert('That picture could not be opened. Try another one.'); }
  });
  input.click();
}
async function shrinkPhoto(file) {
  // Read as a data URL (the page's security policy allows data: images, not blob:)
  const url = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });
  {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 128, 128);
    for (const q of [0.8, 0.65, 0.5, 0.35]) { const d = c.toDataURL('image/jpeg', q); if (d.length <= 40000) return d; }
    throw new Error('too big');
  }
}
function openPhotoPreview(data) {
  $modal.replaceChildren(h('div', { class: 'sheet small' }, h('h2', { text: 'Your photo' }),
    h('div', { class: 'av-top' }, avatar(data, 'xl')),
    h('div', { class: 'tiny', text: 'Everyone at your table will see this picture. It stays saved on this device only.' }),
    h('div', { class: 'av-actions' },
      btn('gold', 'Use this photo', () => { state.face = data; store.set('dom_face', data); closeModal(); render(); }),
      btn('outline small', 'Pick another', pickPhoto),
      btn('outline small', 'Cancel', closeModal))));
  $modal.classList.remove('hidden');
}

// ---------- avatar builder (same parts and codes as Blackcity Spades) ----------
function openAvatarBuilder() {
  let code = isCustom(state.face) ? state.face : (state.face && !isPhoto(state.face) ? '' : seededCode(state.name || 'You'));
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
    h('div', { class: 'av-top' }, preview, btn('outline small', '🎲 Surprise me', () => { preset = ''; code = randomCode(); draw(); }), btn('outline small', '📷 Use my photo', pickPhoto)),
    tabs, grid,
    h('div', { class: 'av-actions' },
      btn('gold', 'Save avatar', () => { state.face = current(); store.set('dom_face', state.face); closeModal(); render(); }),
      btn('outline small', 'Cancel', closeModal))));
  $modal.classList.remove('hidden');
}
function closeModal() { $modal.classList.add('hidden'); $modal.replaceChildren(); }
$modal.addEventListener('click', (e) => { if (e.target === $modal) closeModal(); });

function render() { if (state.screen === 'home') renderHome(); else if (state.screen === 'lobby') renderLobby(); else renderTable(); }
window.addEventListener('resize', () => { if (state.screen === 'table') render(); });
connect();
render();
window.__dom = { state, start, host, token };
