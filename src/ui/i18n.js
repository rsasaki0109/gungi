// i18n.js
// Tiny dependency-free localisation layer for the UI (Japanese / English).
//
// - The current language is persisted in localStorage under `gungi.lang`.
// - Default is Japanese (the game's native language); English is opt-in via the
//   header toggle. We deliberately do NOT auto-detect from navigator.language so
//   behaviour stays deterministic (and the e2e test keeps seeing Japanese).
// - `t(key, params)` looks up a string and interpolates `{name}` placeholders.
// - Static DOM is translated by tagging elements with `data-i18n` /
//   `data-i18n-title` / `data-i18n-html` and calling `applyStaticI18n()`.

const STORE_KEY = 'gungi.lang';
const subscribers = new Set();

const DICT = {
  ja: {
    // header / controls
    cpu_level_title: 'CPUの強さ',
    lvl_easy: '弱 (Easy)',
    lvl_normal: '中 (Normal)',
    lvl_hard: '強 (Hard)',
    lvl_neural: '学習AI (実験)',
    btn_new: '新規',
    btn_restart: '同じ布陣で再戦',
    btn_undo: '待った',
    btn_save: '棋譜保存',
    btn_load: '棋譜読込',
    lang_button: 'EN',            // label shown to switch AWAY from Japanese
    lang_button_title: 'Switch to English',
    // status / thinking
    loading: '読み込み中…',
    thinking_plain: 'CPU 思考中…',
    thinking: 'CPU 思考中…（Lv.{lvl}）',
    status_setup: '配置フェーズ — 自陣（下3段）に布陣 ({placed}/25)　帥を置いたら「対局開始」',
    status_over: '対局終了 — {side}の勝ち（{reason}）',
    status_turn: '手番: {side}（{who}）',
    check_suffix: '　王手！',
    cpu_meta: '　　CPU: Lv.{lvl} 深さ{depth}',
    who_you: 'あなた',
    who_cpu: 'CPU',
    need_marshal: '帥（大将）を配置してください',
    load_failed: '棋譜の読み込みに失敗しました',
    // setup panel
    setup_title: '布陣',
    setup_hint: '下の「持ち駒」から駒を選び、自陣（下3段）をクリックして配置。置いた駒をクリックで戻せます。',
    btn_auto: 'おまかせ配置',
    btn_clear: 'クリア',
    btn_start: '対局開始 ▶',
    // captured / log panels
    captured_title: '取った駒',
    log_title: '対局ログ',
    side_white: '白',
    side_black: '黒',
    // hand trays (renderer)
    hand_white: '白 持ち駒',
    hand_black: '黒 持ち駒',
    hand_none: 'なし',
    // victory / status win phrases
    win_you: 'あなたの勝ち！',
    win_cpu: 'CPUの勝ち',
    win_side: '{side}の勝ち',
    // level short labels
    lvllabel_easy: '弱',
    lvllabel_normal: '中',
    lvllabel_hard: '強',
    lvllabel_neural: '学習AI',
    // game log lines
    log_start: '▶ 対局開始',
    log_restart: '▶ 同じ布陣で対局開始',
    log_loaded: '▶ 棋譜を読み込みました',
    log_move: '{n}. {side} {san}',
    log_win: '★ {side}の勝ち（{reason}）',
    log_undo: '↩ 待った: {san}',
    // win reasons
    reason_capture: '帥を取った',
    reason_mate: '詰み',
    reason_stalemate: '手詰まり',
    // footer / rules
    rules_summary: '遊び方・ルール概要',
    rules_html:
      '<p><b>目的：</b>相手の<b>帥（すい／大将）</b>を取れば勝ち。</p>' +
      '<p><b>盤：</b>9×9。駒は最大3段まで積める（ツケ）。上の段ほど遠くまで動ける。</p>' +
      '<p><b>配置：</b>最初に自陣3段へ布陣。持ち駒は「新（アラタ）」として盤に打てる（最前線より前には打てない）。</p>' +
      '<p><b>戦闘：</b>相手の駒の上に乗ると取れる（取った駒は持ち駒になる）。同じ高さ以上でないと積めない・取れない。</p>' +
      '<p><b>謀（策士）：</b>相手を含む塔に乗ると、その相手駒を寝返らせる（返）。</p>' +
      '<p class="dim">駒の動きは gungi.io 準拠のルールセット（14種）に基づきます。</p>',
  },
  en: {
    // header / controls
    cpu_level_title: 'CPU strength',
    lvl_easy: 'Easy',
    lvl_normal: 'Normal',
    lvl_hard: 'Hard',
    lvl_neural: 'Learned AI (beta)',
    btn_new: 'New',
    btn_restart: 'Rematch (same setup)',
    btn_undo: 'Undo',
    btn_save: 'Save',
    btn_load: 'Load',
    lang_button: '日本語',        // label shown to switch AWAY from English
    lang_button_title: '日本語に切り替え',
    // status / thinking
    loading: 'Loading…',
    thinking_plain: 'CPU thinking…',
    thinking: 'CPU thinking… (Lv.{lvl})',
    status_setup: 'Setup — deploy in your territory (bottom 3 ranks) ({placed}/25). Place your Marshal, then “Start”.',
    status_over: 'Game over — {side} wins ({reason}).',
    status_turn: 'Turn: {side} ({who})',
    check_suffix: '  Check!',
    cpu_meta: '   CPU: Lv.{lvl} depth {depth}',
    who_you: 'You',
    who_cpu: 'CPU',
    need_marshal: 'Place your Marshal first.',
    load_failed: 'Failed to load the kifu.',
    // setup panel
    setup_title: 'Deployment',
    setup_hint: 'Pick a piece from “In hand” below, then click your territory (bottom 3 ranks) to place it. Click a placed piece to return it.',
    btn_auto: 'Auto-place',
    btn_clear: 'Clear',
    btn_start: 'Start ▶',
    // captured / log panels
    captured_title: 'Captured',
    log_title: 'Game log',
    side_white: 'White',
    side_black: 'Black',
    // hand trays (renderer)
    hand_white: 'White — in hand',
    hand_black: 'Black — in hand',
    hand_none: 'none',
    // victory / status win phrases
    win_you: 'You win!',
    win_cpu: 'CPU wins',
    win_side: '{side} wins',
    // level short labels
    lvllabel_easy: 'Easy',
    lvllabel_normal: 'Normal',
    lvllabel_hard: 'Hard',
    lvllabel_neural: 'Learned AI',
    // game log lines
    log_start: '▶ Game start',
    log_restart: '▶ Restart (same setup)',
    log_loaded: '▶ Kifu loaded',
    log_move: '{n}. {side} {san}',
    log_win: '★ {side} wins ({reason})',
    log_undo: '↩ Undo: {san}',
    // win reasons
    reason_capture: 'Marshal captured',
    reason_mate: 'Checkmate',
    reason_stalemate: 'Stalemate',
    // footer / rules
    rules_summary: 'How to play / rules',
    rules_html:
      '<p><b>Goal:</b> Capture the enemy <b>Marshal (帥)</b> to win.</p>' +
      '<p><b>Board:</b> 9×9. Pieces stack up to 3 tiers (tsuke); higher tiers move farther.</p>' +
      '<p><b>Setup:</b> Deploy across your 3 home ranks first. Pieces in hand can be dropped as “arata” (new) — but never ahead of your frontline.</p>' +
      '<p><b>Combat:</b> Move onto an enemy piece to capture it (captured pieces join your hand). You can only stack on, or capture, pieces of equal or lower height.</p>' +
      '<p><b>Tactician (謀):</b> Land on a tower holding an enemy piece to turn that piece to your side (betray).</p>' +
      '<p class="dim">Piece movement follows the gungi.io-compatible ruleset (14 types).</p>',
  },
};

function detect() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'ja' || saved === 'en') return saved;
  } catch { /* localStorage may be unavailable */ }
  return 'ja';
}

let lang = detect();

export function getLang() { return lang; }

export function setLang(next) {
  if (next !== 'ja' && next !== 'en' || next === lang) return;
  lang = next;
  try { localStorage.setItem(STORE_KEY, lang); } catch { /* ignore */ }
  try { document.documentElement.lang = lang; } catch { /* no document */ }
  for (const fn of subscribers) fn(lang);
}

export function toggleLang() { setLang(lang === 'ja' ? 'en' : 'ja'); }

export function onLangChange(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }

export function t(key, params) {
  const table = DICT[lang] || DICT.ja;
  let s = table[key];
  if (s == null) s = DICT.ja[key] != null ? DICT.ja[key] : key;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? params[k] : `{${k}}`));
  return s;
}

// Translate static markup: [data-i18n] -> textContent, [data-i18n-title] ->
// title attribute, [data-i18n-html] -> innerHTML (for rich rule text).
export function applyStaticI18n(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.getAttribute('data-i18n'));
  }
  for (const node of root.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.getAttribute('data-i18n-title'));
  }
  for (const node of root.querySelectorAll('[data-i18n-html]')) {
    node.innerHTML = t(node.getAttribute('data-i18n-html'));
  }
}
