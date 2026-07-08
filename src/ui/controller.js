// controller.js
// Orchestrates input, rendering, AI turns, animations and the control bar.
// Holds transient UI state (selection / highlights); all rules go through the
// GameManager + RuleEngine.

import { PHASE } from '../game/gameManager.js';
import {
  WHITE, BLACK, AI_LEVELS, NAME_JA, START_COUNTS, opponent,
} from '../game/constants.js';
import { animateMove, showVictory, hideVictory } from './animations.js';

export class Controller {
  constructor({ gm, renderer, root, els, ai }) {
    this.gm = gm;
    this.renderer = renderer;
    this.root = root;      // board container (for overlays)
    this.els = els;        // named DOM elements for status/log/controls
    this.ai = ai;          // { chooseMove }
    this.level = AI_LEVELS.HARD;
    this.vsCPU = true;

    this.reset_ui();
    this._wire();
    this.gm.onChange(() => this.refresh());
    this.refresh();
  }

  reset_ui() {
    this.selected = null;         // [r,c]
    this.selectedHandType = null; // piece type string
    this.targets = new Set();     // "r-c"
    this.lastMove = null;
    this.uiLock = false;
  }

  get cpuColor() { return opponent(this.gm.humanColor); }

  // ---- wiring ----------------------------------------------------------

  _wire() {
    this.renderer.boardEl.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      this.onCellClick(+cell.dataset.r, +cell.dataset.c);
    });
    const handHandler = (e) => {
      const btn = e.target.closest('.hand-piece');
      if (!btn || btn.classList.contains('disabled')) return;
      this.onHandClick(btn.dataset.type, btn.dataset.color);
    };
    this.renderer.whiteHand.addEventListener('click', handHandler);
    this.renderer.blackHand.addEventListener('click', handHandler);

    const E = this.els;
    E.btnNew?.addEventListener('click', () => this.newGame());
    E.btnRestart?.addEventListener('click', () => this.restart());
    E.btnUndo?.addEventListener('click', () => this.undo());
    E.btnSave?.addEventListener('click', () => this.save());
    E.btnLoadInput?.addEventListener('change', (e) => this.load(e));
    E.btnAuto?.addEventListener('click', () => { this.gm.autoDeploy(this.gm.humanColor); });
    E.btnClear?.addEventListener('click', () => this.clearDeployment());
    E.btnStart?.addEventListener('click', () => this.startGame());
    E.levelSelect?.addEventListener('change', (e) => { this.level = e.target.value; this._status(); });
  }

  // ---- input handlers --------------------------------------------------

  onHandClick(type, color) {
    if (this.uiLock) return;
    if (color !== this.gm.humanColor) return;
    if (this.gm.phase === PHASE.SETUP) {
      this.selectedHandType = this.selectedHandType === type ? null : type;
      this.selected = null; this.targets.clear();
      this.refresh();
      return;
    }
    if (this.gm.phase === PHASE.PLAY && this.gm.turn === this.gm.humanColor) {
      if (this.selectedHandType === type) { this.selectedHandType = null; this.targets.clear(); }
      else {
        this.selectedHandType = type; this.selected = null;
        this.targets = new Set(this.gm.legalArataFor(type).map((m) => `${m.to[0]}-${m.to[1]}`));
      }
      this.refresh();
    }
  }

  onCellClick(r, c) {
    if (this.uiLock) return;
    const gm = this.gm;

    if (gm.phase === PHASE.SETUP) return this._setupClick(r, c);
    if (gm.phase !== PHASE.PLAY || gm.turn !== gm.humanColor) return;

    const key = `${r}-${c}`;

    // dropping a hand piece
    if (this.selectedHandType && this.targets.has(key)) {
      const move = gm.legalArataFor(this.selectedHandType).find((m) => m.to[0] === r && m.to[1] === c);
      if (move) return this.playHuman(move);
    }

    const top = gm.board.top(r, c);

    // completing a move onto a highlighted target
    if (this.selected && this.targets.has(key)) {
      const [sr, sc] = this.selected;
      const candidates = gm.legalMovesFrom(sr, sc).filter((m) => m.to[0] === r && m.to[1] === c);
      if (candidates.length) return this.playHuman(this._pickMove(candidates));
    }

    // (re)selecting one of your own pieces
    if (top && top.color === gm.humanColor) {
      this.selectedHandType = null;
      this.selected = [r, c];
      this.targets = new Set(gm.legalMovesFrom(r, c).map((m) => `${m.to[0]}-${m.to[1]}`));
      this.refresh();
      return;
    }

    // otherwise clear selection
    this.selected = null; this.selectedHandType = null; this.targets.clear();
    this.refresh();
  }

  // When several moves land on the same square, prefer capture, then betray.
  _pickMove(candidates) {
    return candidates.find((m) => m.type === 'capture')
      || candidates.find((m) => m.type === 'betray')
      || candidates.find((m) => m.type === 'tsuke')
      || candidates[0];
  }

  _setupClick(r, c) {
    const gm = this.gm;
    if (this.selectedHandType) {
      const ok = gm.deployPiece(this.selectedHandType, r, c);
      if (ok && gm.board.handCount(gm.humanColor, this.selectedHandType) <= 0) this.selectedHandType = null;
      this.refresh();
      return;
    }
    // no hand piece selected: pick up a placed piece back to hand
    const top = gm.board.top(r, c);
    if (top && top.color === gm.humanColor) { gm.pickUpPiece(r, c); this.refresh(); }
  }

  // ---- move execution --------------------------------------------------

  async playHuman(move) {
    this.selected = null; this.selectedHandType = null; this.targets.clear();
    this.uiLock = true;
    this.gm.play(move);
    this.lastMove = move;
    this.refresh();
    await animateMove(this.renderer, move);
    this.uiLock = false;
    this._afterMove();
    await this.maybeAITurn();
  }

  async maybeAITurn() {
    const gm = this.gm;
    if (!this.vsCPU) return;
    while (gm.phase === PHASE.PLAY && gm.turn === this.cpuColor) {
      this.uiLock = true;
      this._showThinking(true);
      const t0 = performance.now();
      let result;
      try {
        result = await this.ai.chooseMove(gm.board, this.cpuColor, this.level);
      } catch (err) {
        console.error('AI error', err);
        this._showThinking(false); this.uiLock = false; return;
      }
      // keep the thinking indicator visible briefly so it never flickers
      const elapsed = performance.now() - t0;
      if (elapsed < 250) await new Promise((r) => setTimeout(r, 250 - elapsed));
      this._showThinking(false);

      const move = result && result.move;
      if (!move) { this.uiLock = false; break; }
      gm.play(move);
      this.lastMove = move;
      this._lastAIMeta = result.meta;
      this.refresh();
      await animateMove(this.renderer, move);
      this.uiLock = false;
      this._afterMove();
    }
  }

  _afterMove() {
    if (this.gm.phase === PHASE.OVER) {
      const winner = this.gm.winner === this.gm.humanColor ? 'あなたの勝ち！' :
        (this.vsCPU ? 'CPUの勝ち' : `${this.gm.winner === WHITE ? '白' : '黒'}の勝ち`);
      showVictory(this.root, winner, this.gm.winReason || '');
    }
  }

  // ---- control bar actions --------------------------------------------

  newGame() {
    hideVictory(this.root);
    this.gm.reset();
    this.reset_ui();
    this.refresh();
  }

  restart() {
    // replay from the same starting deployment
    hideVictory(this.root);
    const setup = this.gm._serializeSetup();
    this.gm.loadFromSetup(setup);
    this.gm.log = ['▶ 同じ布陣で対局開始'];
    this.reset_ui();
    this.gm._emit();
  }

  async undo() {
    if (this.uiLock) return;
    hideVictory(this.root);
    // roll back to the human's turn (their move + the CPU reply)
    let guard = 0;
    do { if (!this.gm.undo()) break; guard++; }
    while (this.vsCPU && this.gm.history.length && this.gm.turn !== this.gm.humanColor && guard < 4);
    this.reset_ui();
    this.gm._emit();
  }

  clearDeployment() {
    const color = this.gm.humanColor;
    for (let r = 1; r <= 9; r++) for (let c = 1; c <= 9; c++) {
      const t = this.gm.board.tower(r, c);
      this.gm.board.grid[r - 1][c - 1] = t.filter((p) => p.color !== color);
    }
    this.gm.board.hand[color] = { ...START_COUNTS };
    this.selectedHandType = null;
    this.gm._emit();
  }

  startGame() {
    if (!this.gm.canStart()) { this._flashStatus('帥（大将）を配置してください'); return; }
    this.gm.startGame();
    this.reset_ui();
    this.refresh();
    this.maybeAITurn();
  }

  save() {
    const data = this.gm.serialize();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url; a.download = `gungi-kifu-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  load(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        hideVictory(this.root);
        this.gm.deserialize(data);
        this.reset_ui();
        this.vsCPU = true;
        this.refresh();
        this._afterMove();
        this.maybeAITurn();
      } catch (err) {
        this._flashStatus('棋譜の読み込みに失敗しました');
        console.error(err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ---- rendering / status ----------------------------------------------

  refresh() {
    const gm = this.gm;
    let checkSquare = null;
    if (gm.phase === PHASE.PLAY && gm.inCheck(gm.turn)) {
      const m = gm.board.findMarshal(gm.turn);
      if (m) checkSquare = `${m.r}-${m.c}`;
    }
    this.renderer.update(gm, {
      selected: this.selected ? `${this.selected[0]}-${this.selected[1]}` : null,
      targets: this.targets,
      lastMove: this.lastMove,
      checkSquare,
      selectedHandType: this.selectedHandType,
      deployMode: gm.phase === PHASE.SETUP,
    });
    this._status();
    this._renderLog();
    this._renderCaptured();
    this._togglePanels();
  }

  _togglePanels() {
    const setup = this.gm.phase === PHASE.SETUP;
    if (this.els.setupPanel) this.els.setupPanel.classList.toggle('hidden', !setup);
    if (this.els.btnUndo) this.els.btnUndo.disabled = this.gm.history.length === 0 || setup;
    if (this.els.btnRestart) this.els.btnRestart.disabled = this.gm.history.length === 0;
  }

  _status() {
    const gm = this.gm;
    const E = this.els;
    if (!E.status) return;
    if (gm.phase === PHASE.SETUP) {
      const placed = 25 - gm.board.handTotal(gm.humanColor);
      E.status.textContent = `配置フェーズ — 自陣（下3段）に布陣 (${placed}/25)　帥を置いたら「対局開始」`;
      return;
    }
    if (gm.phase === PHASE.OVER) {
      E.status.textContent = `対局終了 — ${gm.winner === WHITE ? '白' : '黒'}の勝ち（${gm.winReason}）`;
      return;
    }
    const side = gm.turn === WHITE ? '白' : '黒';
    const who = gm.turn === gm.humanColor ? 'あなた' : 'CPU';
    let s = `手番: ${side}（${who}）`;
    if (gm.inCheck(gm.turn)) s += '　王手！';
    if (this._lastAIMeta && this._lastAIMeta.depth) s += `　　CPU: Lv.${labelLevel(this.level)} 深さ${this._lastAIMeta.depth}`;
    E.status.textContent = s;
  }

  _flashStatus(msg) {
    if (!this.els.status) return;
    const prev = this.els.status.textContent;
    this.els.status.textContent = msg;
    this.els.status.classList.add('flash');
    setTimeout(() => { this.els.status.classList.remove('flash'); this._status(); }, 1600);
  }

  _showThinking(on) {
    if (this.els.thinking) this.els.thinking.classList.toggle('hidden', !on);
    if (on && this.els.thinking) this.els.thinking.textContent = `CPU 思考中…（Lv.${labelLevel(this.level)}）`;
  }

  _renderLog() {
    if (!this.els.log) return;
    this.els.log.innerHTML = this.gm.log.slice(-60).map((l) => `<div class="log-line">${escapeHtml(l)}</div>`).join('');
    this.els.log.scrollTop = this.els.log.scrollHeight;
  }

  _renderCaptured() {
    if (!this.els.capturedWhite || !this.els.capturedBlack) return;
    const by = { [WHITE]: {}, [BLACK]: {} };
    for (const h of this.gm.history) {
      for (const p of (h.move.captured || [])) by[h.color][p.type] = (by[h.color][p.type] || 0) + 1;
    }
    this.els.capturedWhite.innerHTML = renderCaps(by[WHITE]);
    this.els.capturedBlack.innerHTML = renderCaps(by[BLACK]);
  }
}

function renderCaps(map) {
  const entries = Object.entries(map);
  if (!entries.length) return '<span class="cap-empty">—</span>';
  return entries.map(([t, n]) => `<span class="cap" title="${NAME_JA[t]}">${t}${n > 1 ? '×' + n : ''}</span>`).join('');
}
function labelLevel(l) { return l === AI_LEVELS.EASY ? '弱' : l === AI_LEVELS.NORMAL ? '中' : '強'; }
function escapeHtml(s) { return s.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }
