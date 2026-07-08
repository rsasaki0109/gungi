// search.js
// Selective negamax with alpha-beta pruning, iterative deepening, a time budget,
// and a capture-only quiescence search. Branching in Gungi is very large, so we
// generate a curated candidate set (all board moves + relevant drops), order it,
// and expand only the most promising children per node.

import {
  BOARD_SIZE, MARSHAL, SOLDIER, opponent,
} from '../game/constants.js';
import {
  movesFrom, droppableRanks, applyMove, undoMove, inCheck, winnerByCapture,
  generateLegalMoves,
} from '../game/ruleEngine.js';
import { evaluate, moveScore } from './evaluate.js';

const MATE = 90000;
const INF = Infinity;
const TIMEOUT = Symbol('timeout');

function cheb(r, c, m) { return Math.max(Math.abs(r - m.r), Math.abs(c - m.c)); }

// Curated candidate moves for the search: every board move, plus a bounded set
// of tactically relevant drops (near either Marshal / on the front line).
function candidateMoves(board, color) {
  const moves = [];
  for (let r = 1; r <= BOARD_SIZE; r++) {
    for (let c = 1; c <= BOARD_SIZE; c++) {
      const top = board.top(r, c);
      if (top && top.color === color) moves.push(...movesFrom(board, r, c));
    }
  }
  moves.push(...searchDrops(board, color));
  return moves;
}

function searchDrops(board, color) {
  const out = [];
  const mOp = board.findMarshal(opponent(color));
  const mMe = board.findMarshal(color);
  if (!mOp || !mMe) return out;
  const ranks = droppableRanks(board, color, false);
  const types = Object.keys(board.hand[color]).filter((t) => board.hand[color][t] > 0);
  if (!types.length) return out;
  // keep the drop list short for branching control
  let budget = 26;
  for (const r of ranks) {
    for (let c = 1; c <= BOARD_SIZE && budget > 0; c++) {
      if (board.top(r, c)) continue; // search only considers drops on empty squares
      const relevant = cheb(r, c, mOp) <= 3 || cheb(r, c, mMe) <= 2;
      if (!relevant) continue;
      for (const t of types) {
        if (t === SOLDIER && fileHasSoldier(board, color, c)) continue;
        out.push({ kind: 'arata', type: 'arata', color, pieceType: t, from: null, to: [r, c], captured: [] });
        if (--budget <= 0) break;
      }
    }
  }
  return out;
}

function fileHasSoldier(board, color, c) {
  for (let r = 1; r <= BOARD_SIZE; r++)
    for (const p of board.tower(r, c)) if (p.type === SOLDIER && p.color === color) return true;
  return false;
}

function captureMoves(board, color) {
  const caps = [];
  for (let r = 1; r <= BOARD_SIZE; r++) {
    for (let c = 1; c <= BOARD_SIZE; c++) {
      const top = board.top(r, c);
      if (top && top.color === color) {
        for (const m of movesFrom(board, r, c)) if (m.type === 'capture') caps.push(m);
      }
    }
  }
  return caps;
}

function ordered(board, color, moves) {
  return moves
    .map((m) => ({ m, s: moveScore(board, m) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

function widthFor(depth) {
  if (depth >= 5) return 10;
  if (depth === 4) return 13;
  if (depth === 3) return 18;
  if (depth === 2) return 26;
  return 34;
}

function quiescence(board, color, alpha, beta, deadline, qdepth) {
  if (Date.now() > deadline) throw TIMEOUT;
  const wc = winnerByCapture(board);
  if (wc) return wc === color ? MATE : -MATE;

  let best = evaluate(board, color);
  if (best >= beta) return best;
  if (best > alpha) alpha = best;
  if (qdepth <= 0) return best;

  const caps = ordered(board, color, captureMoves(board, color)).slice(0, 8);
  for (const m of caps) {
    const undo = applyMove(board, m);
    try {
      if (inCheck(board, color)) continue;
      const val = -quiescence(board, opponent(color), -beta, -alpha, deadline, qdepth - 1);
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    } finally {
      undoMove(board, undo);
    }
  }
  return best;
}

function negamax(board, color, depth, alpha, beta, deadline, ply, useQ) {
  if (Date.now() > deadline) throw TIMEOUT;
  const wc = winnerByCapture(board);
  if (wc) return wc === color ? MATE - ply : -(MATE - ply);
  if (depth <= 0) return useQ ? quiescence(board, color, alpha, beta, deadline, 4) : evaluate(board, color);

  const moves = ordered(board, color, candidateMoves(board, color));
  const width = widthFor(depth);
  let best = -INF, expanded = 0, anyLegal = false;

  for (const m of moves) {
    const undo = applyMove(board, m);
    try {
      if (inCheck(board, color)) continue;
      anyLegal = true;
      const val = -negamax(board, opponent(color), depth - 1, -beta, -alpha, deadline, ply + 1, useQ);
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
      if (++expanded >= width) break;
    } finally {
      undoMove(board, undo);
    }
  }

  if (!anyLegal) return -(MATE - ply); // mated / stalemated: side to move loses
  return best;
}

// Root search with iterative deepening. Returns { move, score, depth }.
export function searchBestMove(board, color, { maxDepth = 3, timeMs = 1500, useQ = true } = {}) {
  const deadline = Date.now() + timeMs;
  // full legal set at the root guarantees we never return an illegal move
  const legal = generateLegalMoves(board, color);
  if (legal.length === 0) return { move: null, score: -MATE, depth: 0 };
  let rootMoves = ordered(board, color, legal);

  let best = { move: rootMoves[0], score: -INF, depth: 0 };

  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -INF, beta = INF;
    let localBest = null, localScore = -INF;
    try {
      let expanded = 0;
      const width = Math.max(widthFor(depth), 28); // keep the root fairly wide
      for (const m of rootMoves) {
        const undo = applyMove(board, m);
        let val;
        try {
          val = -negamax(board, opponent(color), depth - 1, -beta, -alpha, deadline, 1, useQ);
        } finally {
          undoMove(board, undo);
        }
        if (val > localScore) { localScore = val; localBest = m; }
        if (val > alpha) alpha = val;
        if (++expanded >= width && depth >= 3) break;
      }
    } catch (e) {
      if (e === TIMEOUT) break;   // keep the best from the last complete depth
      throw e;
    }
    if (localBest) {
      best = { move: localBest, score: localScore, depth };
      // move the best to the front for the next iteration (ordering aid)
      rootMoves = [localBest, ...rootMoves.filter((x) => x !== localBest)];
      if (localScore >= MATE - 50) break; // forced win found
    }
    if (Date.now() > deadline) break;
  }
  return best;
}

export { MATE };
