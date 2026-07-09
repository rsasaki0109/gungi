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
import { GungiNet } from './nn.js';
import { MCTS } from './mcts.js';

const LEVEL_CONFIG = {
  [AI_LEVELS.EASY]: { random: 0.7 },
  [AI_LEVELS.NORMAL]: { maxDepth: 2, timeMs: 800, useQ: true },
  [AI_LEVELS.HARD]: { maxDepth: 5, timeMs: 2400, useQ: true },
  [AI_LEVELS.NEURAL]: { timeMs: 1600, cpuct: 1.6 },
};

// Lazily fetch + cache the trained model (browser only).
let _net = null, _netPromise = null;
export function loadModel() {
  if (_net) return Promise.resolve(_net);
  if (!_netPromise) {
    const url = new URL('../../assets/model.json', import.meta.url);
    _netPromise = fetch(url)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((j) => { _net = GungiNet.fromJSON(j); return _net; })
      .catch((e) => { console.warn('[gungi] model.json load failed, neural level will fall back to Hard:', e.message); return null; });
  }
  return _netPromise;
}

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

  if (level === AI_LEVELS.NEURAL) {
    const net = await loadModel();
    if (net) {
      const { move, visits } = new MCTS(net, { timeMs: cfg.timeMs, cpuct: cfg.cpuct }).run(board, color);
      if (move) return { move, meta: { level, sims: visits ? visits.reduce((a, b) => a + b, 0) : 0 } };
    }
    // fall back to the Hard minimax if the model is unavailable
    const fb = searchBestMove(board, color, LEVEL_CONFIG[AI_LEVELS.HARD]);
    return { move: fb.move, meta: { level, depth: fb.depth, fallback: true } };
  }

  const res = searchBestMove(board, color, cfg);
  return { move: res.move, meta: { level, depth: res.depth, score: res.score } };
}

function paintTick() { return new Promise((r) => setTimeout(r, 30)); }
