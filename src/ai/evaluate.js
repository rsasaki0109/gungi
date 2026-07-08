// evaluate.js
// Static evaluation of a position from a given colour's point of view.
// Blends: material (board + hand), tower height (mobility proxy), flag pressure
// (distance to the enemy Marshal), Marshal safety, and light board control.

import {
  BOARD_SIZE, PIECE_VALUE, MARSHAL, WHITE, opponent,
} from '../game/constants.js';
import { pseudoTargets } from '../game/ruleEngine.js';

const HAND_FACTOR = 0.82;   // a piece in hand is worth slightly less than on board
const TIER_BONUS = 4;       // per tier above the first (higher = longer reach)
const CHECK_PENALTY = 45;

// Chebyshev distance (king-move steps).
function cheb(r1, c1, r2, c2) { return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)); }

// Full static score for `color` (higher is better for `color`).
export function evaluate(board, color) {
  const opp = opponent(color);
  const mMe = board.findMarshal(color);
  const mOp = board.findMarshal(opp);

  // Terminal-ish: a captured marshal is decisive.
  if (!mMe) return -100000;
  if (!mOp) return 100000;

  let score = 0;

  // Board material + structure.
  for (let r = 1; r <= BOARD_SIZE; r++) {
    for (let c = 1; c <= BOARD_SIZE; c++) {
      const tower = board.tower(r, c);
      if (!tower.length) continue;
      for (let i = 0; i < tower.length; i++) {
        const p = tower[i];
        const sign = p.color === color ? 1 : -1;
        let v = PIECE_VALUE[p.type];
        // top of tower gets a mobility/height bonus
        if (i === tower.length - 1) v += TIER_BONUS * i;
        score += sign * v;
      }

      // Flag pressure & safety are driven by the top (active) piece.
      const top = tower[tower.length - 1];
      if (top.type === MARSHAL) continue;
      const targetMarshal = top.color === color ? mOp : mMe;
      const d = cheb(r, c, targetMarshal.r, targetMarshal.c);
      // being close to the enemy marshal is good; scaled by piece strength
      const pressure = Math.max(0, (9 - d)) * (0.6 + PIECE_VALUE[top.type] / 200);
      score += (top.color === color ? 1 : -1) * pressure;

      // gentle center gravity
      const centrality = (4 - Math.abs(r - 5)) + (4 - Math.abs(c - 5));
      score += (top.color === color ? 1 : -1) * centrality * 0.3;
    }
  }

  // Marshal safety: shelter (friendly neighbours) minus enemy attackers nearby.
  score += marshalSafety(board, color, mMe) - marshalSafety(board, opp, mOp);

  return score;
}

function marshalSafety(board, color, m) {
  let s = 0;
  const opp = opponent(color);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = m.r + dr, c = m.c + dc;
      if (!board.inBounds(r, c)) { s += 4; continue; } // edge/corner = wall shelter
      const t = board.top(r, c);
      if (t && t.color === color) s += 6;        // friendly shield
      if (t && t.color === opp) s -= 10;          // enemy on the doorstep
    }
  }
  // enemy pieces directly attacking the marshal square
  for (let r = 1; r <= BOARD_SIZE; r++) {
    for (let c = 1; c <= BOARD_SIZE; c++) {
      const top = board.top(r, c);
      if (!top || top.color !== opp) continue;
      for (const [tr, tc] of pseudoTargets(board, r, c)) {
        if (tr === m.r && tc === m.c) { s -= CHECK_PENALTY; break; }
      }
    }
  }
  return s;
}

// Quick static score of a move for move-ordering (higher = try earlier).
export function moveScore(board, move) {
  let s = 0;
  if (move.type === 'capture') {
    for (const cp of move.captured) s += PIECE_VALUE[cp.type];
    s += 5;
  }
  if (move.type === 'betray') s += 40;
  if (move.type === 'tsuke') s += 6;            // climbing a tower gains reach
  if (move.kind === 'arata') s += 2;
  // advancing toward the enemy marshal
  const enemyM = board.findMarshal(opponent(move.color));
  if (enemyM) s += Math.max(0, 8 - cheb(move.to[0], move.to[1], enemyM.r, enemyM.c)) * 1.5;
  return s;
}
