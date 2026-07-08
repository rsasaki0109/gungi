// animations.js
// Lightweight, dependency-free animations: FLIP slide for a moving piece,
// a flash for captures, and a victory overlay. All effects are best-effort and
// degrade gracefully if elements are missing.

export function animateMove(renderer, move) {
  return new Promise((resolve) => {
    const toCell = renderer.cellAt(move.to[0], move.to[1]);
    if (!toCell) { resolve(); return; }
    const piece = toCell.querySelector('.piece');
    if (!piece) { resolve(); return; }

    if (move.from) {
      const fromCell = renderer.cellAt(move.from[0], move.from[1]);
      if (fromCell) {
        const a = fromCell.getBoundingClientRect();
        const b = toCell.getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        piece.style.transition = 'none';
        piece.style.transform = `translate(${dx}px, ${dy}px)`;
        // force reflow, then animate to natural position
        void piece.offsetWidth;
        piece.style.transition = 'transform 220ms cubic-bezier(.2,.8,.2,1)';
        piece.style.transform = 'translate(0,0)';
      }
    } else {
      piece.classList.add('drop-in');
    }

    let done = false;
    const finish = () => { if (done) return; done = true; piece.style.transition = ''; piece.style.transform = ''; resolve(); };
    piece.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 280);

    if (move.type === 'capture' || move.type === 'betray') {
      toCell.classList.add('capture-flash');
      setTimeout(() => toCell.classList.remove('capture-flash'), 500);
    }
  });
}

export function showVictory(root, text, sub) {
  let overlay = root.querySelector('.victory-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'victory-overlay';
    root.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="victory-card"><div class="victory-title">${text}</div><div class="victory-sub">${sub || ''}</div></div>`;
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('show'));
}

export function hideVictory(root) {
  const overlay = root.querySelector('.victory-overlay');
  if (overlay) { overlay.classList.remove('show'); overlay.classList.add('hidden'); }
}
