// train/warmstart.mjs  (Node-only)
// Bootstraps GungiNet by regressing to the minimax engine (behavioural cloning
// of moves + eval-based value), then reports strength vs minimax and random.
// Output: assets/model.json  (loaded by the browser for the "AI (学習)" level).
//
// Usage: node train/warmstart.mjs [games] [epochs] [arenaGames]

import fs from 'node:fs';
import { GungiNet, mulberry32 } from '../src/ai/nn.js';
import { INPUT_DIM } from '../src/ai/encode.js';
import { generateLegalMoves } from '../src/game/ruleEngine.js';
import { WHITE, BLACK } from '../src/game/constants.js';
import {
  collectSupervised, trainEpoch, playMatch, netPlayer, minimaxPlayer,
} from './lib.mjs';

const GAMES = +(process.argv[2] || 40);
const EPOCHS = +(process.argv[3] || 6);
const ARENA = +(process.argv[4] || 6);
const rng = mulberry32(20260709);

console.log(`# warm-start: games=${GAMES} epochs=${EPOCHS} arena=${ARENA}`);
let t = Date.now();
const samples = collectSupervised({ games: GAMES, maxPlies: 60, epsilon: 0.3, depth: 2, timeMs: 100, rng });
console.log(`collected ${samples.length} positions in ${((Date.now() - t) / 1000).toFixed(1)}s`);

const net = new GungiNet(INPUT_DIM, 160, 96, rng);
for (let e = 0; e < EPOCHS; e++) {
  t = Date.now();
  const loss = trainEpoch(net, samples, { batch: 32, lr: e < 2 ? 2e-3 : 1e-3, rng });
  console.log(`epoch ${e + 1}/${EPOCHS}  loss=${loss.toFixed(4)}  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
}

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync('assets/model.json', JSON.stringify(net.toQuant()));
const kb = (fs.statSync('assets/model.json').size / 1024) | 0;
console.log(`saved assets/model.json (${kb} KB, int8-quantized)`);

// ---- arena ----
function randomPlayer(board, mover) { const l = generateLegalMoves(board, mover); return l[(rng() * l.length) | 0]; }
const az = netPlayer(net, { sims: 100, cpuct: 1.5 });
const mm = minimaxPlayer({ depth: 2, timeMs: 200 });

function series(name, A, B, n) {
  let aWins = 0, bWins = 0, draws = 0;
  for (let i = 0; i < n; i++) {
    // alternate colors
    const [p1, p2] = i % 2 === 0 ? [A, B] : [B, A];
    const r = playMatch(p1, p2, { maxPlies: 140 });
    const aIsWhite = i % 2 === 0;
    if (!r.winner) draws++;
    else if ((r.winner === WHITE) === aIsWhite) aWins++;
    else bWins++;
    process.stdout.write('.');
  }
  console.log(`\n${name}: A ${aWins} - ${bWins} B  (draws ${draws}) /${n}`);
}

console.log('\n# arena (this may take a while)');
series('AZ(net) vs random', az, randomPlayer, ARENA);
series('AZ(net) vs minimax-d2', az, mm, ARENA);
console.log('done.');
