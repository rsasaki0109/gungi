// encode.js
// State + action encoding for the AlphaZero-style net. Everything is expressed
// from the mover's perspective ("canonical" frame): the board is vertically
// flipped for Black so the side to move always advances toward smaller row.
// This lets a single network serve both colours.

import { PIECE_TYPES, WHITE, MAX_TIER } from '../game/constants.js';

export const TYPE_INDEX = Object.fromEntries(PIECE_TYPES.map((t, i) => [t, i]));
const NT = PIECE_TYPES.length; // 14
const PER_SQ = NT * 2 + 1;     // own(14) + opp(14) + height(1)
export const INPUT_DIM = 81 * PER_SQ + NT * 2; // + own hand(14) + opp hand(14)

// Canonical row for a real row, given the mover.
function crow(r, mover) { return mover === WHITE ? r : 10 - r; }

// Encode the board into a Float32Array from `mover`'s perspective.
export function encodeState(board, mover) {
  const x = new Float32Array(INPUT_DIM);
  for (let r = 1; r <= 9; r++) {
    for (let c = 1; c <= 9; c++) {
      const tower = board.tower(r, c);
      if (!tower.length) continue;
      const cr = crow(r, mover);
      const sq = (cr - 1) * 9 + (c - 1);
      const base = sq * PER_SQ;
      const top = tower[tower.length - 1];
      const ownTop = top.color === mover;
      x[base + (ownTop ? 0 : NT) + TYPE_INDEX[top.type]] = 1;
      x[base + NT * 2] = tower.length / MAX_TIER;
    }
  }
  // hands
  const hbase = 81 * PER_SQ;
  const opp = mover === WHITE ? 'b' : 'w';
  for (const t of PIECE_TYPES) {
    x[hbase + TYPE_INDEX[t]] = (board.hand[mover][t] || 0) / 4;
    x[hbase + NT + TYPE_INDEX[t]] = (board.hand[opp][t] || 0) / 4;
  }
  return x;
}

// Map a real move to canonical policy indices.
//   returns { isDrop, from, to, drop }  (from/to are 0..80 canonical squares, drop 0..13)
export function moveToIndices(move, mover) {
  const [tr, tc] = move.to;
  const to = (crow(tr, mover) - 1) * 9 + (tc - 1);
  if (move.kind === 'arata') {
    return { isDrop: 1, from: -1, to, drop: TYPE_INDEX[move.pieceType] };
  }
  const [fr, fc] = move.from;
  const from = (crow(fr, mover) - 1) * 9 + (fc - 1);
  return { isDrop: 0, from, to, drop: -1 };
}

// Composite logit score for a move given the network's head outputs.
export function moveLogit(idx, heads) {
  return idx.isDrop ? heads.dL[idx.drop] + heads.tL[idx.to] : heads.fL[idx.from] + heads.tL[idx.to];
}

// Softmax priors over a list of legal moves (masking = only these are considered).
export function policyOverMoves(moves, mover, heads) {
  const idxs = moves.map((m) => moveToIndices(m, mover));
  const s = new Float32Array(moves.length);
  let mx = -Infinity;
  for (let i = 0; i < moves.length; i++) { s[i] = moveLogit(idxs[i], heads); if (s[i] > mx) mx = s[i]; }
  let Z = 0; for (let i = 0; i < moves.length; i++) { s[i] = Math.exp(s[i] - mx); Z += s[i]; }
  const p = new Array(moves.length);
  for (let i = 0; i < moves.length; i++) p[i] = s[i] / (Z + 1e-8);
  return { priors: p, idxs };
}
