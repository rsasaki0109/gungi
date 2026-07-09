// mcts.js
// AlphaZero-style PUCT Monte-Carlo Tree Search guided by GungiNet.
// Runs on the live Board using make/unmake (applyMove/undoMove) along each path,
// so no per-node board cloning. Values are always from the perspective of the
// side to move at that node; backups negate across plies.

import { opponent } from '../game/constants.js';
import { generateLegalMoves, applyMove, undoMove, winnerByCapture, inCheck } from '../game/ruleEngine.js';
import { encodeState, policyOverMoves } from './encode.js';

function makeNode() {
  return { expanded: false, terminal: false, tv: 0, moves: null, P: null, N: null, W: null, Q: null, child: null, sumN: 0, value: 0 };
}

export class MCTS {
  constructor(net, { cpuct = 1.5, sims = 120, timeMs = 0, dirichlet = 0, dirEps = 0.25 } = {}) {
    this.net = net; this.cpuct = cpuct; this.sims = sims; this.timeMs = timeMs;
    this.dirichlet = dirichlet; this.dirEps = dirEps;
  }

  _expand(node, board, mover) {
    const wc = winnerByCapture(board);
    if (wc) { node.terminal = true; node.tv = wc === mover ? 1 : -1; node.expanded = true; return node.tv; }
    const moves = generateLegalMoves(board, mover);
    if (moves.length === 0) {
      node.terminal = true;
      node.tv = -1; // mated / stalemated: side to move loses
      node.expanded = true; return node.tv;
    }
    const x = encodeState(board, mover);
    const heads = this.net.evaluate(x);
    const { priors } = policyOverMoves(moves, mover, heads);
    node.moves = moves;
    node.P = priors;
    node.N = new Float32Array(moves.length);
    node.W = new Float32Array(moves.length);
    node.Q = new Float32Array(moves.length);
    node.child = new Array(moves.length).fill(null);
    node.expanded = true;
    node.value = heads.v;
    return heads.v;
  }

  // one simulation from `node` (already-expanded root recurses here)
  _search(board, mover, node) {
    if (node.terminal) return node.tv;
    if (!node.expanded) { const v = this._expand(node, board, mover); return v; }

    // PUCT selection
    const sqrtSum = Math.sqrt(node.sumN + 1e-8);
    let best = -Infinity, bi = 0;
    for (let i = 0; i < node.moves.length; i++) {
      const u = node.Q[i] + this.cpuct * node.P[i] * sqrtSum / (1 + node.N[i]);
      if (u > best) { best = u; bi = i; }
    }
    const move = node.moves[bi];
    const undo = applyMove(board, move);
    let v;
    try {
      if (!node.child[bi]) node.child[bi] = makeNode();
      v = -this._search(board, opponent(mover), node.child[bi]);
    } finally {
      undoMove(board, undo);
    }
    node.N[bi]++; node.W[bi] += v; node.Q[bi] = node.W[bi] / node.N[bi]; node.sumN++;
    return v;
  }

  // Public: run search from (board, mover). Returns visit policy + chosen move.
  run(board, mover) {
    const root = makeNode();
    this._expand(root, board, mover);
    if (root.terminal || !root.moves) return { move: null, moves: [], visits: [], value: root.terminal ? root.tv : root.value };

    if (this.dirichlet > 0) this._addRootNoise(root);

    const deadline = this.timeMs > 0 ? Date.now() + this.timeMs : 0;
    let i = 0;
    while (true) {
      this._search(board, mover, root);
      i++;
      if (deadline) { if (Date.now() > deadline) break; }
      else if (i >= this.sims) break;
    }

    const visits = Array.from(root.N);
    let bi = 0; for (let k = 1; k < visits.length; k++) if (visits[k] > visits[bi]) bi = k;
    return { move: root.moves[bi], moves: root.moves, visits, value: root.value, root };
  }

  _addRootNoise(root) {
    const n = root.P.length;
    const noise = sampleDirichlet(n, this.dirichlet);
    for (let i = 0; i < n; i++) root.P[i] = (1 - this.dirEps) * root.P[i] + this.dirEps * noise[i];
  }
}

// Symmetric Dirichlet via normalized Gamma(alpha,1) samples (Marsaglia-Tsang).
function sampleDirichlet(n, alpha, rng = Math.random) {
  const g = new Array(n); let s = 0;
  for (let i = 0; i < n; i++) { g[i] = gamma(alpha, rng); s += g[i]; }
  for (let i = 0; i < n; i++) g[i] /= (s + 1e-8);
  return g;
}
function gamma(a, rng) {
  if (a < 1) return gamma(a + 1, rng) * Math.pow(rng() + 1e-9, 1 / a);
  const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do { x = gaussian(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function gaussian(rng) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

export { inCheck };
