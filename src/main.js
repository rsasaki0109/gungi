// main.js -- application bootstrap. Wires GameManager + Renderer + Controller
// together and exposes named DOM elements to the controller.

import { GameManager } from './game/gameManager.js';
import { Renderer } from './ui/renderer.js';
import { Controller } from './ui/controller.js';
import { chooseMove } from './ai/ai.js';

function boot() {
  const boardRoot = document.getElementById('board-root');
  const gm = new GameManager();
  const renderer = new Renderer(boardRoot);

  const els = {
    status: document.getElementById('status'),
    thinking: document.getElementById('thinking'),
    log: document.getElementById('log'),
    capturedWhite: document.getElementById('captured-white'),
    capturedBlack: document.getElementById('captured-black'),
    setupPanel: document.getElementById('setup-panel'),
    btnNew: document.getElementById('btn-new'),
    btnRestart: document.getElementById('btn-restart'),
    btnUndo: document.getElementById('btn-undo'),
    btnSave: document.getElementById('btn-save'),
    btnLoadInput: document.getElementById('load-input'),
    btnAuto: document.getElementById('btn-auto'),
    btnClear: document.getElementById('btn-clear'),
    btnStart: document.getElementById('btn-start'),
    levelSelect: document.getElementById('level-select'),
  };

  const controller = new Controller({ gm, renderer, root: boardRoot, els, ai: { chooseMove } });

  // expose for debugging in the console
  window.__gungi = { gm, renderer, controller };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
