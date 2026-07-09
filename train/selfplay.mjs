// train/selfplay.mjs  (Node-only)
// AlphaZero self-play improvement loop. Loads assets/model.json (e.g. the
// warm-started net), then repeatedly: plays self-play games with MCTS+Dirichlet,
// trains on a replay buffer of (state, visit-policy, outcome), checkpoints, and
// periodically measures strength vs the minimax engine.
//
// Usage: node train/selfplay.mjs [iterations] [gamesPerIter] [sims]

import fs from 'node:fs';
import { GungiNet, mulberry32 } from '../src/ai/nn.js';
import { INPUT_DIM } from '../src/ai/encode.js';
import { WHITE } from '../src/game/constants.js';
import { selfPlayGame, trainEpoch, playMatch, netPlayer, minimaxPlayer } from './lib.mjs';

const ITERS = +(process.argv[2] || 10);
const GPI = +(process.argv[3] || 12);
const SIMS = +(process.argv[4] || 80);
const rng = mulberry32(4242);
const MODEL = 'assets/model.json';

let net;
if (fs.existsSync(MODEL)) {
  net = GungiNet.fromJSON(JSON.parse(fs.readFileSync(MODEL, 'utf8')));
  console.log('loaded existing model as starting point');
} else {
  net = new GungiNet(INPUT_DIM, 160, 96, rng);
  console.log('no model found; starting from a fresh net');
}

const replay = [];
const REPLAY_MAX = 20000;

for (let it = 0; it < ITERS; it++) {
  let t = Date.now(), plies = 0;
  for (let g = 0; g < GPI; g++) {
    const { samples, plies: p } = selfPlayGame(net, { sims: SIMS, cpuct: 1.5, maxPlies: 120, tempMoves: 20, dirichlet: 0.3, rng });
    replay.push(...samples); plies += p;
  }
  while (replay.length > REPLAY_MAX) replay.shift();
  const genS = ((Date.now() - t) / 1000).toFixed(1);

  t = Date.now();
  let loss = 0;
  for (let e = 0; e < 3; e++) loss = trainEpoch(net, replay, { batch: 32, lr: 1e-3, rng });
  fs.writeFileSync(MODEL, JSON.stringify(net.toQuant()));
  console.log(`iter ${it + 1}/${ITERS}  games=${GPI} avgPlies=${(plies / GPI).toFixed(0)} buffer=${replay.length}  gen=${genS}s train=${((Date.now() - t) / 1000).toFixed(1)}s loss=${loss.toFixed(4)}`);

  // occasional strength check
  if ((it + 1) % 5 === 0) {
    const az = netPlayer(net, { sims: SIMS }), mm = minimaxPlayer({ depth: 2, timeMs: 150 });
    let w = 0, l = 0, d = 0;
    for (let i = 0; i < 4; i++) {
      const [p1, p2] = i % 2 === 0 ? [az, mm] : [mm, az];
      const r = playMatch(p1, p2, { maxPlies: 140 });
      const azWhite = i % 2 === 0;
      if (!r.winner) d++; else if ((r.winner === WHITE) === azWhite) w++; else l++;
    }
    console.log(`   arena vs minimax-d2: AZ ${w}-${l} (draws ${d})`);
  }
}
console.log('self-play training complete; assets/model.json updated.');
