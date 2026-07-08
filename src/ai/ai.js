// ai.js
// Level dispatcher. Easy is random-leaning (legal only), Normal does a shallow
// blunder-avoiding search, Hard runs deep iterative-deepening alpha-beta.
// chooseMove is async so the UI can paint the "thinking" indicator first and so
// deeper levels can be given a real time budget without blocking startup.

import { AI_LEVELS, MARSHAL } from '../game/constants.js';
import {
  generateLegalMoves, applyMove, undoMove,
} from '../game/ruleEngine.js';
import { evaluate } from './evaluate.js';
import { searchBestMove } from './search.js';

const LEVEL_CONFIG = {
  [AI_LEVELS.EASY]: { random: 0.7 },
  [AI_LEVELS.NORMAL]: { maxDepth: 2, timeMs: 800, useQ: true },
  [AI_LEVELS.HARD]: { maxDepth: 5, timeMs: 2400, useQ: true },
};

function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

function easyMove(board, color, randomness) {
  const legal = generateLegalMoves(board, color);
  if (!legal.length) return null;
  // never miss a marshal capture
  const win = legal.find((m) => m.type === 'capture' && m.captured.some((p) => p.type === MARSHAL));
  if (win) return win;
  if (Math.random() < randomness) return pick(legal);
  // otherwise a 1-ply greedy choice, with a little noise for variety
  let best = legal[0], bestScore = -Infinity;
  for (const m of legal) {
    const undo = applyMove(board, m);
    const s = evaluate(board, color) + Math.random() * 8;
    undoMove(board, undo);
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

// Returns { move, meta } where meta may include search depth/score for display.
export async function chooseMove(board, color, level) {
  await paintTick();
  const cfg = LEVEL_CONFIG[level] || LEVEL_CONFIG[AI_LEVELS.NORMAL];

  if (level === AI_LEVELS.EASY) {
    return { move: easyMove(board, color, cfg.random), meta: { level } };
  }
  const res = searchBestMove(board, color, cfg);
  return { move: res.move, meta: { level, depth: res.depth, score: res.score } };
}

function paintTick() { return new Promise((r) => setTimeout(r, 30)); }
