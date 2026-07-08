// constants.js
// Canonical Gungi (軍儀) ruleset data.
//
// Coordinate system:
//   - Board is 9x9. Rows r = 1..9 (top to bottom), columns c = 1..9 (left to right).
//   - Black ('b') starts at the top (ranks 1-3) and moves toward larger r ("forward" = +r).
//   - White ('w') starts at the bottom (ranks 7-9) and moves toward smaller r ("forward" = -r).
//   - A "tower" is board[r][c]: an array of pieces from bottom (tier 1) to top (tier 3).
//
// Movesets follow the machine-precise gungi.io / gungi.js ruleset (14 piece types).
// Each piece has an 8-direction "probe" table. Range scales with tier:
//   length = tier + carry - 1   (so taller pieces reach further).
//
// The 8 directions are given from WHITE's point of view (forward = -r). For black the
// deltas are negated so "forward" is always toward the opponent.

export const BOARD_SIZE = 9;
export const MAX_TIER = 3;

export const WHITE = 'w';
export const BLACK = 'b';

// Piece type symbols (kanji) -- used as the canonical id everywhere.
export const MARSHAL = '帥';
export const GENERAL = '大';
export const LIEUTENANT = '中';
export const MAJOR = '小';
export const WARRIOR = '侍';
export const LANCER = '槍';
export const RIDER = '馬';
export const SPY = '忍';
export const FORTRESS = '砦';
export const SOLDIER = '兵';
export const CANNON = '砲';
export const ARCHER = '弓';
export const MUSKETEER = '筒';
export const TACTICIAN = '謀';

export const PIECE_TYPES = [
  MARSHAL, GENERAL, LIEUTENANT, MAJOR, WARRIOR, LANCER, RIDER,
  SPY, FORTRESS, SOLDIER, CANNON, ARCHER, MUSKETEER, TACTICIAN,
];

// Human-readable names.
export const NAME_EN = {
  [MARSHAL]: 'Marshal', [GENERAL]: 'General', [LIEUTENANT]: 'Lieutenant General',
  [MAJOR]: 'Major General', [WARRIOR]: 'Warrior', [LANCER]: 'Lancer',
  [RIDER]: 'Rider', [SPY]: 'Spy', [FORTRESS]: 'Fortress', [SOLDIER]: 'Soldier',
  [CANNON]: 'Cannon', [ARCHER]: 'Archer', [MUSKETEER]: 'Musketeer', [TACTICIAN]: 'Tactician',
};

export const NAME_JA = {
  [MARSHAL]: '帥（すい）', [GENERAL]: '大将', [LIEUTENANT]: '中将',
  [MAJOR]: '小将', [WARRIOR]: '侍', [LANCER]: '槍', [RIDER]: '馬',
  [SPY]: '忍', [FORTRESS]: '砦', [SOLDIER]: '兵', [CANNON]: '砲',
  [ARCHER]: '弓', [MUSKETEER]: '筒', [TACTICIAN]: '謀',
};

// Short latin code (for compact save files / logs).
export const CODE = {
  [MARSHAL]: 'm', [GENERAL]: 'g', [LIEUTENANT]: 'i', [MAJOR]: 'j', [WARRIOR]: 'w',
  [LANCER]: 'n', [RIDER]: 'r', [SPY]: 's', [FORTRESS]: 'f', [SOLDIER]: 'd',
  [CANNON]: 'c', [ARCHER]: 'a', [MUSKETEER]: 'k', [TACTICIAN]: 't',
};
export const CODE_TO_TYPE = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]));

// Full starting inventory (per player) for the "advanced" 3-tier mode.
export const START_COUNTS = {
  [MARSHAL]: 1, [GENERAL]: 1, [LIEUTENANT]: 1, [MAJOR]: 2, [WARRIOR]: 2,
  [LANCER]: 3, [RIDER]: 2, [SPY]: 2, [FORTRESS]: 2, [SOLDIER]: 4,
  [CANNON]: 1, [ARCHER]: 2, [MUSKETEER]: 1, [TACTICIAN]: 1,
};
// Total = 25 pieces per side.

// The 8 movement directions (WHITE perspective; forward = -row).
//   index: 0 fwd-right, 1 fwd, 2 fwd-left, 3 right, 4 left, 5 back-right, 6 back, 7 back-left
export const DIRS = [
  [-1, 1], [-1, 0], [-1, -1],
  [0, 1], [0, -1],
  [1, 1], [1, 0], [1, -1],
];

// Per-piece probe tables. Each entry is one of the 8 directions above.
//   number n        -> probe starts n rows forward (col +1 step for diagonals), range = tier + 1 - 1
//   [n, carry]      -> same, but range = tier + carry - 1
//   Infinity        -> sliding move (rook/bishop-like), unlimited range until blocked
//   0               -> cannot move in that direction
export const PIECE_PROBES = {
  [MARSHAL]:    [1, 1, 1, 1, 1, 1, 1, 1],
  [GENERAL]:    [1, Infinity, 1, Infinity, Infinity, 1, Infinity, 1],
  [LIEUTENANT]: [Infinity, 1, Infinity, 1, 1, Infinity, 1, Infinity],
  [MAJOR]:      [1, 1, 1, 1, 1, 0, 1, 0],
  [WARRIOR]:    [1, 1, 1, 0, 0, 0, 1, 0],
  [LANCER]:     [1, [1, 2], 1, 0, 0, 0, 1, 0],
  [RIDER]:      [0, [1, 2], 0, 1, 1, 0, [1, 2], 0],
  [SPY]:        [[1, 2], 0, [1, 2], 0, 0, [1, 2], 0, [1, 2]],
  [FORTRESS]:   [0, 1, 0, 1, 1, 1, 0, 1],
  [SOLDIER]:    [0, 1, 0, 0, 0, 0, 1, 0],
  [CANNON]:     [0, 3, 0, 1, 1, 0, 1, 0],
  [ARCHER]:     [2, 2, 2, 0, 0, 0, 1, 0],
  [MUSKETEER]:  [0, 2, 0, 0, 0, 1, 0, 1],
  [TACTICIAN]:  [1, 0, 1, 0, 0, 0, 1, 0],
};

// Pieces that may leap over one piece when moving forward.
export const LEAPERS = new Set([CANNON, MUSKETEER, ARCHER]);

// Base material values (in soldier-units) used by the AI evaluation.
export const PIECE_VALUE = {
  [MARSHAL]: 1000,
  [GENERAL]: 90,
  [LIEUTENANT]: 90,
  [MAJOR]: 55,
  [WARRIOR]: 42,
  [LANCER]: 40,
  [RIDER]: 52,
  [SPY]: 50,
  [FORTRESS]: 34,
  [SOLDIER]: 12,
  [CANNON]: 62,
  [ARCHER]: 48,
  [MUSKETEER]: 46,
  [TACTICIAN]: 58,
};

export const AI_LEVELS = { EASY: 'easy', NORMAL: 'normal', HARD: 'hard' };

// Territory helpers: a player's own 3 ranks (where drops may start during the draft).
export function homeRanks(color) {
  return color === BLACK ? [1, 2, 3] : [7, 8, 9];
}

export function opponent(color) {
  return color === WHITE ? BLACK : WHITE;
}

// "Forward" row delta for a color.
export function forward(color) {
  return color === WHITE ? -1 : 1;
}
