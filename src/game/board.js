// board.js
// The 9x9x(<=3) board of towers, plus the two players' hands.
// A piece is a plain object { type, color }. A tower is an array bottom->top.

import { BOARD_SIZE, MAX_TIER, WHITE, BLACK, START_COUNTS } from './constants.js';

export class Board {
  constructor() {
    // grid[r-1][c-1] = array of pieces (bottom..top). Empty tower = [].
    this.grid = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => [])
    );
    // hand[color][type] = count of that piece available to drop.
    this.hand = { [WHITE]: {}, [BLACK]: {} };
  }

  static withFullHands() {
    const b = new Board();
    for (const color of [WHITE, BLACK]) {
      for (const [type, n] of Object.entries(START_COUNTS)) b.hand[color][type] = n;
    }
    return b;
  }

  inBounds(r, c) {
    return r >= 1 && r <= BOARD_SIZE && c >= 1 && c <= BOARD_SIZE;
  }

  tower(r, c) {
    return this.grid[r - 1][c - 1];
  }

  height(r, c) {
    return this.grid[r - 1][c - 1].length;
  }

  // Top piece as { type, color, tier, r, c } or null.
  top(r, c) {
    if (!this.inBounds(r, c)) return null;
    const t = this.grid[r - 1][c - 1];
    if (t.length === 0) return null;
    const p = t[t.length - 1];
    return { type: p.type, color: p.color, tier: t.length, r, c };
  }

  pushPiece(r, c, piece) {
    this.grid[r - 1][c - 1].push(piece);
  }

  popPiece(r, c) {
    return this.grid[r - 1][c - 1].pop();
  }

  handCount(color, type) {
    return this.hand[color][type] || 0;
  }

  addHand(color, type, n = 1) {
    this.hand[color][type] = (this.hand[color][type] || 0) + n;
  }

  removeHand(color, type, n = 1) {
    this.hand[color][type] = (this.hand[color][type] || 0) - n;
    if (this.hand[color][type] <= 0) delete this.hand[color][type];
  }

  // Total pieces a color still holds in hand.
  handTotal(color) {
    return Object.values(this.hand[color]).reduce((a, b) => a + b, 0);
  }

  // Locate a color's marshal on the board -> {r,c} or null.
  findMarshal(color) {
    for (let r = 1; r <= BOARD_SIZE; r++) {
      for (let c = 1; c <= BOARD_SIZE; c++) {
        const t = this.grid[r - 1][c - 1];
        for (const p of t) if (p.type === '帥' && p.color === color) return { r, c };
      }
    }
    return null;
  }

  clone() {
    const b = new Board();
    for (let r = 0; r < BOARD_SIZE; r++)
      for (let c = 0; c < BOARD_SIZE; c++)
        b.grid[r][c] = this.grid[r][c].map((p) => ({ type: p.type, color: p.color }));
    b.hand = {
      [WHITE]: { ...this.hand[WHITE] },
      [BLACK]: { ...this.hand[BLACK] },
    };
    return b;
  }

  // Compact position key for repetition detection / hashing.
  key(turn) {
    let s = '';
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const t = this.grid[r][c];
        s += t.length === 0 ? '.' : t.map((p) => p.color + p.type).join('') + ';';
        s += '|';
      }
    }
    s += 'H' + JSON.stringify(this.hand[WHITE]) + JSON.stringify(this.hand[BLACK]);
    return s + '@' + turn;
  }
}

export { MAX_TIER };
