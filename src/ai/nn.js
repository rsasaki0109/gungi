// nn.js
// A tiny, dependency-free neural network for the AlphaZero-style agent.
// Shared by the Node training scripts and the browser inference path.
//
// Architecture (compact MLP so it trains on CPU and runs in a phone browser):
//   input(x) -> Dense(H) -> ReLU -> Dense(H2) -> ReLU -> {
//       value:  Dense(1)  -> tanh          (position value in [-1, 1])
//       pFrom:  Dense(81)                   policy logits: "from" square
//       pTo:    Dense(81)                   policy logits: "to" square
//       pDrop:  Dense(14)                   policy logits: drop piece-type
//   }
// The move policy is FACTORED: a board move f->t scores pFrom[f]+pTo[t]; a drop
// of type k to t scores pDrop[k]+pTo[t]. Probabilities come from a softmax over
// the *legal* action set only (see mcts / encode).

const EPS = 1e-8;

function mat(rows, cols) { return new Float32Array(rows * cols); }

// He-ish init using a supplied deterministic RNG (so training is reproducible).
function initDense(inN, outN, rng) {
  const W = mat(outN, inN);
  const scale = Math.sqrt(2 / inN);
  for (let i = 0; i < W.length; i++) W[i] = (rng() * 2 - 1) * scale;
  const b = new Float32Array(outN);
  return { inN, outN, W, b, mW: mat(outN, inN), vW: mat(outN, inN), mb: new Float32Array(outN), vb: new Float32Array(outN) };
}

// y = W x + b  (W is [outN x inN] row-major)
function denseForward(layer, x) {
  const { inN, outN, W, b } = layer;
  const y = new Float32Array(outN);
  for (let o = 0; o < outN; o++) {
    let s = b[o];
    const base = o * inN;
    for (let i = 0; i < inN; i++) s += W[base + i] * x[i];
    y[o] = s;
  }
  return y;
}

// Given dL/dy, accumulate weight grads and return dL/dx.
function denseBackward(layer, x, dy, gW, gb) {
  const { inN, outN, W } = layer;
  const dx = new Float32Array(inN);
  for (let o = 0; o < outN; o++) {
    const g = dy[o];
    if (g === 0) continue;
    const base = o * inN;
    gb[o] += g;
    for (let i = 0; i < inN; i++) {
      gW[base + i] += g * x[i];
      dx[i] += W[base + i] * g;
    }
  }
  return dx;
}

function reluFwd(v) { const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] > 0 ? v[i] : 0; return o; }
function reluBwd(pre, dy) { const o = new Float32Array(dy.length); for (let i = 0; i < dy.length; i++) o[i] = pre[i] > 0 ? dy[i] : 0; return o; }

export class GungiNet {
  constructor(inDim, H = 160, H2 = 96, rng = Math.random) {
    this.inDim = inDim; this.H = H; this.H2 = H2;
    this.l1 = initDense(inDim, H, rng);
    this.l2 = initDense(H, H2, rng);
    this.vHead = initDense(H2, 1, rng);
    this.fHead = initDense(H2, 81, rng);
    this.tHead = initDense(H2, 81, rng);
    this.dHead = initDense(H2, 14, rng);
    this.layers = [this.l1, this.l2, this.vHead, this.fHead, this.tHead, this.dHead];
  }

  // Forward pass. Returns raw head outputs plus cached activations for training.
  forward(x) {
    const z1 = denseForward(this.l1, x); const a1 = reluFwd(z1);
    const z2 = denseForward(this.l2, a1); const a2 = reluFwd(z2);
    const v = Math.tanh(denseForward(this.vHead, a2)[0]);
    const fL = denseForward(this.fHead, a2);
    const tL = denseForward(this.tHead, a2);
    const dL = denseForward(this.dHead, a2);
    return { x, z1, a1, z2, a2, v, fL, tL, dL };
  }

  // Inference helper: just value + logits.
  evaluate(x) { const o = this.forward(x); return { v: o.v, fL: o.fL, tL: o.tL, dL: o.dL }; }

  zeroGrads() {
    this._g = this.layers.map((l) => ({ gW: mat(l.outN, l.inN), gb: new Float32Array(l.outN) }));
  }

  // Accumulate gradients for one sample.
  //   target = { value, actions:[{from,to,drop,isDrop,pi}] }  (pi sums to 1 over legal set)
  // Returns the sample loss (value MSE + policy cross-entropy).
  accumulate(out, target) {
    const g = this._g;
    // ----- policy: softmax over legal composite scores -----
    const acts = target.actions;
    const scores = new Float32Array(acts.length);
    let mx = -Infinity;
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      const s = a.isDrop ? out.dL[a.drop] + out.tL[a.to] : out.fL[a.from] + out.tL[a.to];
      scores[i] = s; if (s > mx) mx = s;
    }
    let Z = 0; for (let i = 0; i < acts.length; i++) { scores[i] = Math.exp(scores[i] - mx); Z += scores[i]; }
    let ploss = 0;
    const dF = new Float32Array(81), dT = new Float32Array(81), dD = new Float32Array(14);
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i]; const p = scores[i] / (Z + EPS);
      if (a.pi > 0) ploss -= a.pi * Math.log(p + EPS);
      const gs = p - a.pi; // dL/dscore
      dT[a.to] += gs;
      if (a.isDrop) dD[a.drop] += gs; else dF[a.from] += gs;
    }
    // ----- value: MSE on tanh output -----
    const vErr = out.v - target.value;               // dL/dv (MSE, factor 1)
    const dVpre = vErr * (1 - out.v * out.v);          // through tanh
    const vloss = 0.5 * vErr * vErr;

    // ----- backprop heads into a2 -----
    let dA2 = new Float32Array(this.H2);
    const add = (dx) => { for (let i = 0; i < dA2.length; i++) dA2[i] += dx[i]; };
    add(denseBackward(this.vHead, out.a2, new Float32Array([dVpre]), g[2].gW, g[2].gb));
    add(denseBackward(this.fHead, out.a2, dF, g[3].gW, g[3].gb));
    add(denseBackward(this.tHead, out.a2, dT, g[4].gW, g[4].gb));
    add(denseBackward(this.dHead, out.a2, dD, g[5].gW, g[5].gb));
    // through layer2
    const dZ2 = reluBwd(out.z2, dA2);
    const dA1 = denseBackward(this.l2, out.a1, dZ2, g[1].gW, g[1].gb);
    const dZ1 = reluBwd(out.z1, dA1);
    denseBackward(this.l1, out.x, dZ1, g[0].gW, g[0].gb);

    return ploss + vloss;
  }

  // Adam update using accumulated grads over `count` samples.
  step(count, lr = 1e-3, wd = 1e-4, b1 = 0.9, b2 = 0.999) {
    this._t = (this._t || 0) + 1;
    const t = this._t, bc1 = 1 - Math.pow(b1, t), bc2 = 1 - Math.pow(b2, t);
    for (let li = 0; li < this.layers.length; li++) {
      const l = this.layers[li], g = this._g[li];
      adam(l.W, l.mW, l.vW, g.gW, count, lr, wd, b1, b2, bc1, bc2);
      adam(l.b, l.mb, l.vb, g.gb, count, lr, 0, b1, b2, bc1, bc2);
    }
  }

  toJSON() {
    const enc = (l) => ({ inN: l.inN, outN: l.outN, W: Array.from(l.W), b: Array.from(l.b) });
    return { inDim: this.inDim, H: this.H, H2: this.H2, t: this._t || 0,
      l1: enc(this.l1), l2: enc(this.l2), vHead: enc(this.vHead), fHead: enc(this.fHead), tHead: enc(this.tHead), dHead: enc(this.dHead) };
  }

  static fromJSON(j) {
    const net = new GungiNet(j.inDim, j.H, j.H2, () => 0);
    const load = (dst, src) => { dst.W = Float32Array.from(src.W); dst.b = Float32Array.from(src.b); dst.inN = src.inN; dst.outN = src.outN;
      dst.mW = mat(dst.outN, dst.inN); dst.vW = mat(dst.outN, dst.inN); dst.mb = new Float32Array(dst.outN); dst.vb = new Float32Array(dst.outN); };
    load(net.l1, j.l1); load(net.l2, j.l2); load(net.vHead, j.vHead); load(net.fHead, j.fHead); load(net.tHead, j.tHead); load(net.dHead, j.dHead);
    net.layers = [net.l1, net.l2, net.vHead, net.fHead, net.tHead, net.dHead];
    net._t = j.t || 0;
    return net;
  }
}

function adam(P, m, v, g, count, lr, wd, b1, b2, bc1, bc2) {
  const inv = 1 / Math.max(1, count);
  for (let i = 0; i < P.length; i++) {
    let grad = g[i] * inv + wd * P[i];
    m[i] = b1 * m[i] + (1 - b1) * grad;
    v[i] = b2 * v[i] + (1 - b2) * grad * grad;
    const mh = m[i] / bc1, vh = v[i] / bc2;
    P[i] -= lr * mh / (Math.sqrt(vh) + EPS);
  }
}

// Deterministic RNG (mulberry32) for reproducible init/self-play.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
