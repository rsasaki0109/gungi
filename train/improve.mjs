// train/improve.mjs  (Node-only, long-running)
// Phase 1: strong warm-start (depth-3 minimax teacher, score-based value).
// Phase 2: AlphaZero self-play improvement, replay seeded with the warm-start data.
// Checkpoints assets/model.json after each stage and prints arena vs minimax.

import fs from 'node:fs';
import { GungiNet, mulberry32 } from '../src/ai/nn.js';
import { INPUT_DIM } from '../src/ai/encode.js';
import { WHITE } from '../src/game/constants.js';
import {
  collectSupervised, selfPlayGame, trainEpoch, playMatch, netPlayer, minimaxPlayer,
} from './lib.mjs';

const rng = mulberry32(80808);
const MODEL = 'assets/model.json';
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

function arena(net, sims, n = 6) {
  const az = netPlayer(net, { sims }), mm = minimaxPlayer({ depth: 2, timeMs: 150 });
  let w = 0, l = 0, d = 0;
  for (let i = 0; i < n; i++) {
    const [p1, p2] = i % 2 === 0 ? [az, mm] : [mm, az];
    const r = playMatch(p1, p2, { maxPlies: 140 });
    const azWhite = i % 2 === 0;
    if (!r.winner) d++; else if ((r.winner === WHITE) === azWhite) w++; else l++;
  }
  return `AZ ${w}-${l} (draws ${d}) /${n}`;
}

// ---- Phase 1: strong warm-start ----
log('phase1: collecting depth-3 supervised data...');
const sup = collectSupervised({ games: 120, maxPlies: 60, epsilon: 0.3, depth: 3, timeMs: 320, rng });
log(`collected ${sup.length} positions`);

const net = new GungiNet(INPUT_DIM, 160, 96, rng);
for (let e = 0; e < 18; e++) {
  const loss = trainEpoch(net, sup, { batch: 32, lr: e < 3 ? 2e-3 : 8e-4, rng });
  if (e % 3 === 2 || e === 17) log(`  epoch ${e + 1}/18 loss=${loss.toFixed(4)}`);
}
fs.writeFileSync(MODEL, JSON.stringify(net.toQuant()));
log(`saved warm-start model (${(fs.statSync(MODEL).size / 1024) | 0} KB)`);
log(`arena(warm-start, 100 sims): ${arena(net, 100)}`);

// ---- Phase 2: self-play improvement ----
const replay = sup.slice(); // seed replay buffer with supervised data
const REPLAY_MAX = 24000;
const ITERS = 14, GPI = 10, SIMS = 80;
for (let it = 0; it < ITERS; it++) {
  let plies = 0;
  const g0 = Date.now();
  for (let g = 0; g < GPI; g++) {
    const { samples, plies: p } = selfPlayGame(net, { sims: SIMS, cpuct: 1.5, maxPlies: 120, tempMoves: 20, dirichlet: 0.3, rng });
    replay.push(...samples); plies += p;
  }
  while (replay.length > REPLAY_MAX) replay.shift();
  let loss = 0;
  for (let e = 0; e < 3; e++) loss = trainEpoch(net, replay, { batch: 32, lr: 8e-4, rng });
  fs.writeFileSync(MODEL, JSON.stringify(net.toQuant()));
  log(`selfplay iter ${it + 1}/${ITERS} avgPlies=${(plies / GPI).toFixed(0)} buffer=${replay.length} genTrain=${((Date.now() - g0) / 1000).toFixed(0)}s loss=${loss.toFixed(4)}`);
  if ((it + 1) % 4 === 0) log(`   arena: ${arena(net, 80, 4)}`);
}
log(`final arena(120 sims): ${arena(net, 120, 8)}`);
log('IMPROVE DONE');
