// renderer.js
// Pure presentation: builds the board / hands / panels DOM once and updates it
// from GameManager state plus a small `ui` object describing highlights.
// It never mutates game state -- all input is handled by the controller.

import { WHITE, BLACK, NAME_JA, NAME_EN, PIECE_TYPES } from '../game/constants.js';
import { PHASE } from '../game/gameManager.js';

const SYMBOL = Object.fromEntries(PIECE_TYPES.map((t) => [t, t]));

export class Renderer {
  constructor(root) {
    this.root = root;
    this.cells = new Map();       // "r-c" -> cell element
    this.handEls = { [WHITE]: new Map(), [BLACK]: new Map() };
    this._build();
  }

  _build() {
    this.root.innerHTML = '';
    this.root.classList.add('gungi');

    // Black hand tray (top)
    this.blackHand = el('div', 'hand hand-black');
    this.root.appendChild(this.blackHand);

    // Board
    const boardWrap = el('div', 'board-wrap');
    this.boardEl = el('div', 'board');
    for (let r = 1; r <= 9; r++) {
      for (let c = 1; c <= 9; c++) {
        const cell = el('div', 'cell');
        cell.dataset.r = r; cell.dataset.c = c;
        // territory shading
        if (r <= 3) cell.classList.add('terr-black');
        else if (r >= 7) cell.classList.add('terr-white');
        else cell.classList.add('terr-neutral');
        this.cells.set(`${r}-${c}`, cell);
        this.boardEl.appendChild(cell);
      }
    }
    boardWrap.appendChild(this.boardEl);
    this.root.appendChild(boardWrap);

    // White hand tray (bottom)
    this.whiteHand = el('div', 'hand hand-white');
    this.root.appendChild(this.whiteHand);
  }

  // ui = { selected, targets:Set<"r-c">, lastMove, checkSquare:"r-c",
  //        selectedHandType, deployMode:bool }
  update(gm, ui = {}) {
    const targets = ui.targets || new Set();
    for (const [key, cell] of this.cells) {
      const [r, c] = key.split('-').map(Number);
      cell.className = 'cell ' + territory(r);
      cell.innerHTML = '';

      const tower = gm.board.tower(r, c);
      if (tower.length) cell.appendChild(this._tower(tower));

      if (ui.selected === key) cell.classList.add('selected');
      if (targets.has(key)) {
        const t = gm.board.top(r, c);
        if (!t) cell.classList.add('target-move');
        else if (t.color === gm.turn) cell.classList.add('target-tsuke'); // stack on own tower
        else cell.classList.add('target-capture');                        // take enemy
      }
      if (ui.lastMove && sameSq(ui.lastMove.to, [r, c])) cell.classList.add('last-move');
      if (ui.lastMove && ui.lastMove.from && sameSq(ui.lastMove.from, [r, c])) cell.classList.add('last-from');
      if (ui.checkSquare === key) cell.classList.add('in-check');
      if (ui.deployMode && ((gm.humanColor === WHITE && r >= 7) || (gm.humanColor === BLACK && r <= 3))) {
        cell.classList.add('deploy-zone');
      }
    }

    this._renderHand(gm, WHITE, ui);
    this._renderHand(gm, BLACK, ui);
  }

  _tower(tower) {
    const wrap = el('div', 'tower');
    const top = tower[tower.length - 1];
    const p = el('div', `piece ${top.color === WHITE ? 'white' : 'black'} h${tower.length}`);
    const glyph = el('span', 'glyph');
    glyph.textContent = SYMBOL[top.type];
    p.appendChild(glyph); // enemy (black) glyphs are rotated 180° via CSS, shogi-style
    p.title = `${NAME_JA[top.type]} / ${NAME_EN[top.type]}  (${tower.length}段)`;
    if (tower.length > 1) {
      const badge = el('div', 'tier-badge');
      badge.textContent = tower.length;
      p.appendChild(badge);
      const dots = el('div', 'stack-dots');
      for (let i = 0; i < tower.length; i++) {
        const d = el('span', `dot ${tower[i].color === WHITE ? 'w' : 'b'}`);
        dots.appendChild(d);
      }
      p.appendChild(dots);
    }
    wrap.appendChild(p);
    return wrap;
  }

  _renderHand(gm, color, ui) {
    const container = color === WHITE ? this.whiteHand : this.blackHand;
    container.innerHTML = '';
    const label = el('div', 'hand-label');
    label.textContent = color === WHITE ? '白 持ち駒' : '黒 持ち駒';
    container.appendChild(label);
    const tray = el('div', 'hand-tray');
    for (const type of PIECE_TYPES) {
      const n = gm.board.handCount(color, type);
      if (n <= 0) continue;
      const item = el('button', `hand-piece ${color === WHITE ? 'white' : 'black'}`);
      item.dataset.type = type; item.dataset.color = color;
      item.innerHTML = `<span class="hp-sym">${SYMBOL[type]}</span><span class="hp-count">${n}</span>`;
      item.title = `${NAME_JA[type]}`;
      const interactive = (gm.phase === PHASE.SETUP && color === gm.humanColor) ||
        (gm.phase === PHASE.PLAY && color === gm.turn && color === gm.humanColor);
      if (!interactive) item.classList.add('disabled');
      if (ui.selectedHandType === type && color === gm.humanColor) item.classList.add('selected');
      tray.appendChild(item);
    }
    if (!tray.children.length) {
      const empty = el('span', 'hand-empty'); empty.textContent = 'なし'; tray.appendChild(empty);
    }
    container.appendChild(tray);
  }

  cellAt(r, c) { return this.cells.get(`${r}-${c}`); }
}

function territory(r) { return r <= 3 ? 'terr-black' : r >= 7 ? 'terr-white' : 'terr-neutral'; }
function sameSq(a, b) { return a && b && a[0] === b[0] && a[1] === b[1]; }
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
