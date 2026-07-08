// ruleEngine.js
// Pure rules layer: move generation, legality (self-check filtering), board
// mutation (apply/undo) and win detection. Operates on a Board (grid + hands).
// Turn/draft/history bookkeeping lives in GameManager; every move object carries
// its own `color`, so this layer is turn-agnostic and reusable by the AI search.

import {
  BOARD_SIZE, MAX_TIER, DIRS, PIECE_PROBES, LEAPERS,
  MARSHAL, SOLDIER, TACTICIAN, WHITE, BLACK, opponent, homeRanks,
} from './constants.js';

// ---------------------------------------------------------------------------
// Movement geometry
// ---------------------------------------------------------------------------

// Squares reachable along one probe direction, honouring tower-height blocking
// and leaper rules. Mirrors gungi.js getAvailableSquares.
function probeSquares(board, dir, start, origin, length) {
  const [dy, dx] = dir;
  let [sy, sx] = start;
  const [py, px] = origin;
  const originPiece = board.top(py, px);
  if (!originPiece) return [];

  // Archer's diagonal is blocked by an immediately-adjacent taller "wing".
  if (originPiece.type === '弓' && Math.abs(dy) === 1 && Math.abs(dx) === 1) {
    const wing = board.top(py + dy, px + dx);
    if (wing && wing.tier > originPiece.tier) return [];
  }

  // Reverse-scan the gap between the origin and the probe's starting square:
  // a strictly-taller tower in the gap blocks the probe entirely. The scan stops
  // when it reaches the square just ahead of the origin (the "below" break), which
  // also terminates non-colinear jumps such as the archer's diagonal.
  const side = originPiece.color === BLACK ? -1 : 1;
  let rx = sx, ry = sy;
  while (rx !== px || ry !== py) {
    rx -= dx; ry -= dy;
    if (rx < 1 || rx > BOARD_SIZE || ry < 1 || ry > BOARD_SIZE) break; // safety
    const gap = board.top(ry, rx);
    if (gap && gap.tier > originPiece.tier) return [];
    const below = board.top(ry + side, rx);
    if (below && below.r === py && below.c === px) break;
  }

  // Forward-scan from the start square.
  const out = [];
  let fx = sx, fy = sy, step = 0;
  const canLeap = LEAPERS.has(originPiece.type);
  while (step < length) {
    if (fx < 1 || fx > BOARD_SIZE || fy < 1 || fy > BOARD_SIZE) break;
    const occ = board.top(fy, fx);
    if (occ && occ.tier > originPiece.tier) break; // cannot pass/land on taller tower
    out.push([fy, fx]);
    if (occ) {
      if (!canLeap) break;
      const movingForward = originPiece.color === WHITE ? dy < 0 : dy > 0;
      if (!movingForward) break; // leapers only jump while advancing
    }
    fx += dx; fy += dy; step++;
  }
  return out;
}

// All destination squares (empty, own or enemy) the top piece at (r,c) can reach.
export function pseudoTargets(board, r, c) {
  const origin = board.top(r, c);
  if (!origin) return [];
  const probes = PIECE_PROBES[origin.type];
  const targets = [];
  for (let i = 0; i < 8; i++) {
    const probe = probes[i];
    const pval = Array.isArray(probe) ? probe[0] : probe;
    const carry = Array.isArray(probe) ? probe[1] : 1;
    if (pval < 1) continue;
    let [dy, dx] = DIRS[i];
    if (origin.color === BLACK) { dy = -dy; dx = -dx; }
    const start = pval === Infinity ? [r + dy, c + dx] : [r + pval * dy, c + dx];
    const length = pval === Infinity ? Infinity : origin.tier + carry - 1;
    for (const sq of probeSquares(board, [dy, dx], start, [r, c], length)) targets.push(sq);
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Board move objects
// ---------------------------------------------------------------------------

// Generate concrete moves (route / tsuke / capture / betray) from square (r,c).
export function movesFrom(board, r, c) {
  const origin = board.top(r, c);
  if (!origin) return [];
  const color = origin.color;
  const moves = [];
  const seen = new Set();

  for (const [tr, tc] of pseudoTargets(board, r, c)) {
    const key = tr * 10 + tc;
    if (seen.has(key)) continue;
    seen.add(key);

    const destTower = board.tower(tr, tc);
    const destTop = board.top(tr, tc);

    if (!destTop) {
      moves.push({ kind: 'board', type: 'route', color, pieceType: origin.type,
        from: [r, c], to: [tr, tc], captured: [] });
      continue;
    }

    if (destTop.color === color) {
      // tsuke onto own tower
      if (destTower.length < MAX_TIER && destTop.type !== MARSHAL) {
        moves.push({ kind: 'board', type: 'tsuke', color, pieceType: origin.type,
          from: [r, c], to: [tr, tc], captured: [] });
      }
    } else {
      // enemy top: capture (removes every enemy piece in the tower)
      const captured = destTower
        .filter((p) => p.color !== color)
        .map((p) => ({ type: p.type }));
      moves.push({ kind: 'board', type: 'capture', color, pieceType: origin.type,
        from: [r, c], to: [tr, tc], captured });

      // tactician betrayal: instead of capturing, tsuke on top and flip the
      // enemy pieces below to your side (House rule: Betrayal Effect).
      if (origin.type === TACTICIAN && destTower.length < MAX_TIER) {
        const betrayed = destTower
          .map((p, idx) => ({ p, idx }))
          .filter(({ p }) => p.color !== color)
          .map(({ idx }) => idx);
        moves.push({ kind: 'board', type: 'betray', color, pieceType: origin.type,
          from: [r, c], to: [tr, tc], captured: [], betrayed });
      }
    }
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Arata (drops)
// ---------------------------------------------------------------------------

// Ranks on which `color` may drop. During the draft only the home 3 ranks;
// otherwise every rank from home up to (and including) the most-forward rank
// that already holds one of your pieces -- no paradropping past the front line.
export function droppableRanks(board, color, inDraft) {
  if (inDraft) return homeRanks(color);
  const order = color === BLACK ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [9, 8, 7, 6, 5, 4, 3, 2, 1];
  const ranks = [];
  let pending = [];
  for (const r of order) {
    let hasOwn = false;
    for (let c = 1; c <= BOARD_SIZE; c++) {
      const t = board.top(r, c);
      if (t && t.color === color) { hasOwn = true; break; }
    }
    if (hasOwn) { ranks.push(...pending, r); pending = []; }
    else pending.push(r);
  }
  return ranks;
}

// Whether `color` already has a soldier on file `c` (blocks a second soldier drop).
function fileHasSoldier(board, color, c) {
  for (let r = 1; r <= BOARD_SIZE; r++) {
    for (const p of board.tower(r, c)) if (p.type === SOLDIER && p.color === color) return true;
  }
  return false;
}

// Drop moves for one hand piece type.
export function arataMovesForType(board, color, type, inDraft) {
  const moves = [];
  if (board.handCount(color, type) <= 0) return moves;
  const ranks = droppableRanks(board, color, inDraft);
  for (const r of ranks) {
    for (let c = 1; c <= BOARD_SIZE; c++) {
      // no double-soldier on a file
      if (type === SOLDIER && fileHasSoldier(board, color, c)) continue;
      const top = board.top(r, c);
      if (!top) {
        moves.push({ kind: 'arata', type: 'arata', color, pieceType: type, from: null, to: [r, c], captured: [] });
      } else if (top.color === color && board.tower(r, c).length < MAX_TIER && top.type !== MARSHAL) {
        moves.push({ kind: 'arata', type: 'arata', color, pieceType: type, from: null, to: [r, c], captured: [] });
      }
    }
  }
  return moves;
}

// All drop moves for a color.
export function arataMoves(board, color, inDraft) {
  const moves = [];
  for (const type of Object.keys(board.hand[color])) {
    if (board.hand[color][type] > 0) moves.push(...arataMovesForType(board, color, type, inDraft));
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Apply / undo (snapshot-based, safe for AI make/unmake)
// ---------------------------------------------------------------------------

export function applyMove(board, move) {
  const [tr, tc] = move.to;
  const undo = {
    to: [tr, tc],
    toTower: board.tower(tr, tc).map((p) => ({ type: p.type, color: p.color })),
    handW: { ...board.hand[WHITE] },
    handB: { ...board.hand[BLACK] },
    from: move.from ? [...move.from] : null,
    fromTower: move.from ? board.tower(move.from[0], move.from[1]).map((p) => ({ type: p.type, color: p.color })) : null,
  };

  if (move.kind === 'arata') {
    board.removeHand(move.color, move.pieceType, 1);
    board.pushPiece(tr, tc, { type: move.pieceType, color: move.color });
    return undo;
  }

  // board move
  const [fr, fc] = move.from;
  const mover = board.popPiece(fr, fc); // top piece leaves origin

  const destTower = board.tower(tr, tc);
  if (move.type === 'capture') {
    // remove all enemy pieces; they enter the mover's hand as their own colour
    for (let i = destTower.length - 1; i >= 0; i--) {
      if (destTower[i].color !== move.color) {
        board.addHand(move.color, destTower[i].type, 1);
        destTower.splice(i, 1);
      }
    }
  } else if (move.type === 'betray') {
    for (const idx of move.betrayed) {
      if (destTower[idx]) destTower[idx].color = move.color;
    }
  }
  board.pushPiece(tr, tc, mover);
  return undo;
}

export function undoMove(board, undo) {
  const [tr, tc] = undo.to;
  board.grid[tr - 1][tc - 1] = undo.toTower.map((p) => ({ type: p.type, color: p.color }));
  if (undo.from) {
    const [fr, fc] = undo.from;
    board.grid[fr - 1][fc - 1] = undo.fromTower.map((p) => ({ type: p.type, color: p.color }));
  }
  board.hand[WHITE] = { ...undo.handW };
  board.hand[BLACK] = { ...undo.handB };
}

// ---------------------------------------------------------------------------
// Attacks, check, game over
// ---------------------------------------------------------------------------

// Is (r,c) attacked by any top piece of `byColor`?
export function isSquareAttacked(board, r, c, byColor) {
  for (let sr = 1; sr <= BOARD_SIZE; sr++) {
    for (let sc = 1; sc <= BOARD_SIZE; sc++) {
      const t = board.top(sr, sc);
      if (!t || t.color !== byColor) continue;
      for (const [tr, tc] of pseudoTargets(board, sr, sc)) {
        if (tr === r && tc === c) return true;
      }
    }
  }
  return false;
}

export function inCheck(board, color) {
  const m = board.findMarshal(color);
  if (!m) return false; // already captured
  return isSquareAttacked(board, m.r, m.c, opponent(color));
}

// Winner color if a marshal has been captured, else null.
export function winnerByCapture(board) {
  const hasW = !!board.findMarshal(WHITE);
  const hasB = !!board.findMarshal(BLACK);
  if (hasW && !hasB) return WHITE;
  if (hasB && !hasW) return BLACK;
  return null;
}

// A move captures the enemy marshal (immediate win, always legal).
function capturesMarshal(move) {
  return move.type === 'capture' && move.captured.some((p) => p.type === MARSHAL);
}

// All fully-legal moves for `color` during normal play (self-check filtered).
export function generateLegalMoves(board, color) {
  const pseudo = [];
  for (let r = 1; r <= BOARD_SIZE; r++) {
    for (let c = 1; c <= BOARD_SIZE; c++) {
      const t = board.top(r, c);
      if (t && t.color === color) pseudo.push(...movesFrom(board, r, c));
    }
  }
  pseudo.push(...arataMoves(board, color, false));

  const legal = [];
  for (const move of pseudo) {
    if (capturesMarshal(move)) { legal.push(move); continue; }
    const undo = applyMove(board, move);
    if (!inCheck(board, color)) legal.push(move);
    undoMove(board, undo);
  }
  return legal;
}

// checkmate/stalemate: side to move has no legal move (treated as a loss).
export function hasNoLegalMoves(board, color) {
  return generateLegalMoves(board, color).length === 0;
}

export { MAX_TIER };
