// gameManager.js
// Owns the full game state on top of the rules layer: setup/deploy phase,
// turn management, move history (for undo & replay), action log, game-over
// detection, and JSON save/load of the kifu (game record).

import { Board } from './board.js';
import * as RE from './ruleEngine.js';
import {
  WHITE, BLACK, MARSHAL, GENERAL, LIEUTENANT, MAJOR, WARRIOR, LANCER,
  RIDER, SPY, FORTRESS, SOLDIER, CANNON, ARCHER, MUSKETEER, TACTICIAN,
  NAME_JA, START_COUNTS, opponent, homeRanks,
} from './constants.js';

export const PHASE = { SETUP: 'setup', PLAY: 'play', OVER: 'over' };

// A pleasant default army formation, given as {type, rankIdx, file}.
// rankIdx 0 = back rank, 1 = middle, 2 = front (closest to the enemy).
const FORMATION = [
  // back rank
  { t: FORTRESS, ri: 0, f: 1 }, { t: MAJOR, ri: 0, f: 2 }, { t: LIEUTENANT, ri: 0, f: 3 },
  { t: GENERAL, ri: 0, f: 4 }, { t: MARSHAL, ri: 0, f: 5 }, { t: WARRIOR, ri: 0, f: 6 },
  { t: RIDER, ri: 0, f: 7 }, { t: MAJOR, ri: 0, f: 8 }, { t: FORTRESS, ri: 0, f: 9 },
  // middle rank
  { t: LANCER, ri: 1, f: 1 }, { t: SPY, ri: 1, f: 2 }, { t: ARCHER, ri: 1, f: 3 },
  { t: CANNON, ri: 1, f: 4 }, { t: TACTICIAN, ri: 1, f: 5 }, { t: MUSKETEER, ri: 1, f: 6 },
  { t: ARCHER, ri: 1, f: 7 }, { t: SPY, ri: 1, f: 8 }, { t: LANCER, ri: 1, f: 9 },
  // front rank
  { t: SOLDIER, ri: 2, f: 2 }, { t: WARRIOR, ri: 2, f: 3 }, { t: SOLDIER, ri: 2, f: 4 },
  { t: RIDER, ri: 2, f: 5 }, { t: SOLDIER, ri: 2, f: 6 }, { t: LANCER, ri: 2, f: 7 },
  { t: SOLDIER, ri: 2, f: 8 },
];

function rankFor(color, rankIdx) {
  // back rank is deepest in own territory
  return color === WHITE ? 9 - rankIdx : 1 + rankIdx;
}

export class GameManager {
  constructor(humanColor = WHITE) {
    this.humanColor = humanColor;
    this.reset();
  }

  reset() {
    this.board = Board.withFullHands();
    this.phase = PHASE.SETUP;
    this.turn = WHITE;
    this.winner = null;
    this.winReason = null;
    this.history = [];   // { move, undo, san, color, capturedNames }
    this.log = [];       // human-readable strings
    this.listeners = new Set();
    this._emit();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  // ----- setup / deploy -------------------------------------------------

  autoDeploy(color) {
    // clear any existing pieces of that color first
    for (let r = 1; r <= 9; r++) for (let c = 1; c <= 9; c++) {
      const t = this.board.tower(r, c);
      const kept = t.filter((p) => p.color !== color);
      this.board.grid[r - 1][c - 1] = kept;
    }
    // refill hand then place the formation
    this.board.hand[color] = { ...START_COUNTS };
    for (const { t, ri, f } of FORMATION) {
      const r = rankFor(color, ri);
      this.board.pushPiece(r, f, { type: t, color });
      this.board.removeHand(color, t, 1);
    }
    this._emit();
  }

  // place one hand piece during setup
  deployPiece(type, r, c) {
    if (this.phase !== PHASE.SETUP) return false;
    const color = this.humanColor;
    if (!homeRanks(color).includes(r)) return false;
    if (this.board.handCount(color, type) <= 0) return false;
    const top = this.board.top(r, c);
    if (top) {
      if (top.color !== color || this.board.tower(r, c).length >= 3 || top.type === MARSHAL) return false;
    }
    if (type === SOLDIER) {
      // no two soldiers on one file
      for (let rr = 1; rr <= 9; rr++)
        for (const p of this.board.tower(rr, c))
          if (p.type === SOLDIER && p.color === color) return false;
    }
    this.board.pushPiece(r, c, { type, color });
    this.board.removeHand(color, type, 1);
    this._emit();
    return true;
  }

  // return the top piece at (r,c) to hand during setup
  pickUpPiece(r, c) {
    if (this.phase !== PHASE.SETUP) return false;
    const top = this.board.top(r, c);
    if (!top || top.color !== this.humanColor) return false;
    const p = this.board.popPiece(r, c);
    this.board.addHand(this.humanColor, p.type, 1);
    this._emit();
    return true;
  }

  canStart() {
    return !!this.board.findMarshal(this.humanColor);
  }

  startGame() {
    if (!this.canStart()) return false;
    // CPU auto-deploys if it has no marshal yet
    const cpu = opponent(this.humanColor);
    if (!this.board.findMarshal(cpu)) this.autoDeploy(cpu);
    this.phase = PHASE.PLAY;
    this.turn = WHITE;
    this.log.push('▶ 対局開始');
    this._checkGameOver();
    this._emit();
    return true;
  }

  // ----- play -----------------------------------------------------------

  legalMoves(color = this.turn) {
    if (this.phase !== PHASE.PLAY) return [];
    return RE.generateLegalMoves(this.board, color);
  }

  legalMovesFrom(r, c) {
    if (this.phase !== PHASE.PLAY) return [];
    const top = this.board.top(r, c);
    if (!top || top.color !== this.turn) return [];
    const all = this.legalMoves(this.turn);
    return all.filter((m) => m.from && m.from[0] === r && m.from[1] === c);
  }

  legalArataFor(type) {
    if (this.phase !== PHASE.PLAY) return [];
    return this.legalMoves(this.turn).filter((m) => m.kind === 'arata' && m.pieceType === type);
  }

  play(move) {
    if (this.phase !== PHASE.PLAY) return false;
    const undo = RE.applyMove(this.board, move);
    const san = moveToSan(move);
    const capturedNames = (move.captured || []).map((p) => NAME_JA[p.type]);
    this.history.push({ move, undo, san, color: move.color, capturedNames });
    this._pushLog(move, san, capturedNames);
    this.turn = opponent(this.turn);
    this._checkGameOver();
    this._emit();
    return true;
  }

  _pushLog(move, san, capturedNames) {
    const n = this.history.length;
    const side = move.color === WHITE ? '☗白' : '☖黒';
    let s = `${n}. ${side} ${san}`;
    if (capturedNames.length) s += `  ×${capturedNames.join('・')}`;
    this.log.push(s);
  }

  _checkGameOver() {
    const w = RE.winnerByCapture(this.board);
    if (w) { this._end(w, '帥を取った'); return; }
    // side to move mated / no legal moves
    if (RE.hasNoLegalMoves(this.board, this.turn)) {
      const checked = RE.inCheck(this.board, this.turn);
      this._end(opponent(this.turn), checked ? '詰み' : '手詰まり');
    }
  }

  _end(winner, reason) {
    this.phase = PHASE.OVER;
    this.winner = winner;
    this.winReason = reason;
    const side = winner === WHITE ? '白' : '黒';
    this.log.push(`★ ${side}の勝ち（${reason}）`);
  }

  inCheck(color = this.turn) {
    return this.phase === PHASE.PLAY && RE.inCheck(this.board, color);
  }

  // Undo a single ply. The controller calls this enough times to return control
  // to the human. Returns false when there is nothing left to undo.
  undo() {
    if (this.history.length === 0) return false;
    if (this.phase === PHASE.OVER) { this.phase = PHASE.PLAY; this.winner = null; this.winReason = null; }
    const h = this.history.pop();
    RE.undoMove(this.board, h.undo);
    this.turn = h.color;
    this.log.push(`↩ 待った: ${h.san}`);
    this._emit();
    return true;
  }

  // ----- save / load ----------------------------------------------------

  serialize() {
    return {
      format: 'gungi-kifu',
      version: 1,
      humanColor: this.humanColor,
      moves: this.history.map((h) => compactMove(h.move)),
      // store the deployed starting position so a game mid-play reloads exactly
      setup: this._serializeSetup(),
    };
  }

  _serializeSetup() {
    // reconstruct the board as it was before move 0 by undoing a clone
    const b = this.board.clone();
    for (let i = this.history.length - 1; i >= 0; i--) RE.undoMove(b, this.history[i].undo);
    const cells = [];
    for (let r = 1; r <= 9; r++) for (let c = 1; c <= 9; c++) {
      const t = b.tower(r, c);
      if (t.length) cells.push({ r, c, tower: t.map((p) => ({ t: p.type, c: p.color })) });
    }
    return { cells, hand: b.hand };
  }

  loadFromSetup(setup) {
    this.reset();
    this.board = new Board();
    for (const cell of setup.cells) {
      for (const p of cell.tower) this.board.pushPiece(cell.r, cell.c, { type: p.t, color: p.c });
    }
    this.board.hand = { [WHITE]: { ...setup.hand[WHITE] }, [BLACK]: { ...setup.hand[BLACK] } };
    this.phase = PHASE.PLAY;
    this.turn = WHITE;
  }

  deserialize(data) {
    if (!data || data.format !== 'gungi-kifu') throw new Error('未対応の棋譜形式です');
    this.humanColor = data.humanColor || WHITE;
    this.loadFromSetup(data.setup);
    this.log = ['▶ 棋譜を読み込みました'];
    // replay the moves
    for (const cm of data.moves) {
      const move = expandMove(cm);
      // resolve captured pieces against the live board so undo works
      resolveCaptured(this.board, move);
      const undo = RE.applyMove(this.board, move);
      this.history.push({
        move, undo, san: moveToSan(move), color: move.color,
        capturedNames: (move.captured || []).map((p) => NAME_JA[p.type]),
      });
      this.turn = opponent(move.color);
    }
    this._checkGameOver();
    this._emit();
  }
}

// ----- move notation & (de)serialization --------------------------------

export function moveToSan(move) {
  const t = NAME_JA[move.pieceType].replace(/（.*）/, '');
  const to = `${move.to[0]}${String.fromCharCode(9311 + move.to[1])}`; // e.g. 5②
  const dst = `${move.to[0]}-${move.to[1]}`;
  if (move.kind === 'arata') return `新${t}(${dst})`;
  const from = `${move.from[0]}-${move.from[1]}`;
  const mark = move.type === 'capture' ? '取' : move.type === 'tsuke' ? '付'
    : move.type === 'betray' ? '返' : '';
  return `${t}(${from}→${dst})${mark}`;
}

function compactMove(m) {
  return {
    k: m.kind, y: m.type, p: m.pieceType, cl: m.color,
    f: m.from ? m.from.join('-') : null, t: m.to.join('-'),
    b: m.betrayed || null,
  };
}
function expandMove(c) {
  return {
    kind: c.k, type: c.y, pieceType: c.p, color: c.cl,
    from: c.f ? c.f.split('-').map(Number) : null, to: c.t.split('-').map(Number),
    captured: [], betrayed: c.b || undefined,
  };
}
// Rebuild the `captured` array from the current board so applyMove/undo is exact.
function resolveCaptured(board, move) {
  if (move.type !== 'capture') return;
  const [r, c] = move.to;
  move.captured = board.tower(r, c).filter((p) => p.color !== move.color).map((p) => ({ type: p.type }));
}

