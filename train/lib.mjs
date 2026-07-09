// train/lib.mjs  (Node-only, offline)
// Shared helpers for the AlphaZero training pipeline: position generation,
// supervised (minimax-teacher) targets, self-play data, and a training step.

import { GameManager, PHASE } from '../src/game/gameManager.js';
import { generateLegalMoves, applyMove, undoMove, winnerByCapture } from '../src/game/ruleEngine.js';
import { evaluate } from '../src/ai/evaluate.js';
import { searchBestMove } from '../src/ai/search.js';
import { MCTS } from '../src/ai/mcts.js';
import { encodeState, moveToIndices } from '../src/ai/encode.js';
import { WHITE, BLACK, opponent } from '../src/game/constants.js';

const VALUE_SCALE = 320; // maps minimax eval -> tanh target

export function freshGame() {
  const gm = new GameManager();
  gm.autoDeploy(WHITE); gm.autoDeploy(BLACK); gm.startGame();
  return gm;
}

function pick(a, rng) { return a[(rng() * a.length) | 0]; }

// ---- Supervised (behavioural cloning of the minimax engine) ----------------
// Plays epsilon-greedy minimax games and, at each visited position, emits a
// training sample: value = tanh(eval), policy = one-hot on the minimax best move.
export function collectSupervised({ games = 30, maxPlies = 60, epsilon = 0.25, depth = 2, timeMs = 120, rng = Math.random } = {}) {
  const samples = [];
  for (let g = 0; g < games; g++) {
    const gm = freshGame();
    let plies = 0;
    while (gm.phase === PHASE.PLAY && plies < maxPlies) {
      const mover = gm.turn;
      const legal = generateLegalMoves(gm.board, mover);
      if (!legal.length) break;

      // teacher move + policy target (one-hot on best); value = search score
      // (captures the teacher's lookahead, not just a static eval)
      const res = searchBestMove(gm.board, mover, { maxDepth: depth, timeMs, useQ: true });
      const best = res.move || legal[0];
      const sc = Number.isFinite(res.score) ? res.score : evaluate(gm.board, mover);
      const x = encodeState(gm.board, mover);
      const value = Math.tanh(sc / VALUE_SCALE);
      const actions = legal.map((m) => {
        const idx = moveToIndices(m, mover);
        idx.pi = sameMove(m, best) ? 1 : 0;
        return idx;
      });
      samples.push({ x, actions, value });

      // play epsilon-greedy to diversify states
      const move = rng() < epsilon ? pick(legal, rng) : best;
      gm.play(move);
      plies++;
    }
  }
  return samples;
}

// ---- Self-play (AlphaZero) --------------------------------------------------
// Plays one self-play game with MCTS(net); returns samples with the MCTS visit
// policy as target and the final game outcome as the value target.
export function selfPlayGame(net, { sims = 80, cpuct = 1.5, maxPlies = 120, tempMoves = 20, dirichlet = 0.3, rng = Math.random } = {}) {
  const gm = freshGame();
  const trace = []; // { x, actions(from moves), mover, ply }
  let plies = 0;
  let result = 0; // +1 white wins, -1 black wins, 0 draw
  while (gm.phase === PHASE.PLAY && plies < maxPlies) {
    const mover = gm.turn;
    const mcts = new MCTS(net, { sims, cpuct, dirichlet });
    const { move, moves, visits } = mcts.run(gm.board, mover);
    if (!move) break;
    const sum = visits.reduce((a, b) => a + b, 0) || 1;
    const x = encodeState(gm.board, mover);
    const actions = moves.map((m, i) => { const idx = moveToIndices(m, mover); idx.pi = visits[i] / sum; return idx; });
    trace.push({ x, actions, mover });

    // temperature: sample early, argmax later
    let chosen = move;
    if (plies < tempMoves) chosen = sampleByVisits(moves, visits, rng);
    gm.play(chosen);
    plies++;
  }
  if (gm.phase === PHASE.OVER && gm.winner) result = gm.winner === WHITE ? 1 : -1;

  // assign outcome from each mover's perspective
  const samples = trace.map((s) => ({ x: s.x, actions: s.actions, value: s.mover === WHITE ? result : -result }));
  return { samples, plies, result };
}

function sampleByVisits(moves, visits, rng) {
  const sum = visits.reduce((a, b) => a + b, 0);
  if (sum <= 0) return moves[(rng() * moves.length) | 0];
  let r = rng() * sum;
  for (let i = 0; i < moves.length; i++) { r -= visits[i]; if (r <= 0) return moves[i]; }
  return moves[moves.length - 1];
}

// ---- Training ---------------------------------------------------------------
export function trainEpoch(net, samples, { batch = 32, lr = 1e-3, rng = Math.random } = {}) {
  const order = samples.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
  let total = 0, n = 0;
  for (let b = 0; b < order.length; b += batch) {
    net.zeroGrads();
    let count = 0;
    for (let k = b; k < Math.min(b + batch, order.length); k++) {
      const s = samples[order[k]];
      const out = net.forward(s.x);
      total += net.accumulate(out, { value: s.value, actions: s.actions });
      count++; n++;
    }
    net.step(count, lr);
  }
  return total / Math.max(1, n);
}

// ---- Arena: measure strength of two policies ------------------------------
// playerA / playerB are functions (board, mover) -> move.
export function playMatch(playerA, playerB, { maxPlies = 140 } = {}) {
  const gm = freshGame();
  let plies = 0;
  while (gm.phase === PHASE.PLAY && plies < maxPlies) {
    const fn = gm.turn === WHITE ? playerA : playerB;
    const move = fn(gm.board, gm.turn);
    if (!move) break;
    gm.play(move); plies++;
  }
  return { winner: gm.winner, reason: gm.winReason, plies: gm.history.length, gm };
}

export function netPlayer(net, { sims = 120, cpuct = 1.5 } = {}) {
  return (board, mover) => new MCTS(net, { sims, cpuct }).run(board, mover).move;
}
export function minimaxPlayer({ depth = 2, timeMs = 200 } = {}) {
  return (board, mover) => searchBestMove(board, mover, { maxDepth: depth, timeMs, useQ: true }).move;
}

function sameMove(a, b) {
  return a.type === b.type && a.pieceType === b.pieceType &&
    a.to[0] === b.to[0] && a.to[1] === b.to[1] &&
    ((!a.from && !b.from) || (a.from && b.from && a.from[0] === b.from[0] && a.from[1] === b.from[1]));
}
