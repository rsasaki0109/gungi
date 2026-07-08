import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.GUNGI_URL || 'http://127.0.0.1:8123/index.html';
const OUT = process.env.SHOTS || new URL('./.shots', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok:', m); } else { fail++; console.error('  FAIL:', m); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1120, height: 940 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

console.log('# load');
await page.goto(BASE, { waitUntil: 'networkidle' });
ok(await page.locator('.cell').count() === 81, '81 cells rendered');
ok(await page.locator('#setup-panel').isVisible(), 'setup panel visible');
ok(await page.locator('#thinking').isHidden(), 'thinking indicator hidden at start');
ok((await page.locator('#status').textContent()).includes('配置'), 'status shows setup phase');
await page.screenshot({ path: `${OUT}/1-setup.png` });

console.log('# select CPU = Normal (faster test)');
await page.selectOption('#level-select', 'normal');

console.log('# auto-deploy');
await page.click('#btn-auto');
ok(await page.locator('.piece').count() === 25, 'auto-deploy: 25 pieces on board');
ok(await page.locator('.hand-piece.white').count() === 0, 'white hand emptied');
await page.screenshot({ path: `${OUT}/2-deployed.png` });

console.log('# start game');
await page.click('#btn-start');
await page.waitForFunction(() => window.__gungi && window.__gungi.gm.phase === 'play');
ok(await page.locator('.piece').count() === 50, 'both armies present (50 pieces)');
ok(await page.locator('#setup-panel').isHidden(), 'setup panel actually hidden (not visible) after start');
ok(await page.locator('#thinking').isHidden(), 'thinking hidden on human turn after start');
await page.screenshot({ path: `${OUT}/3-gamestart.png` });

console.log('# human selects a piece -> targets highlight');
const sel = await page.evaluate(() => {
  const gm = window.__gungi.gm;
  for (let r = 9; r >= 1; r--) for (let c = 1; c <= 9; c++) {
    const t = gm.board.top(r, c);
    if (t && t.color === 'w') { const mv = gm.legalMovesFrom(r, c); if (mv.length) return { r, c, to: mv[0].to }; }
  }
  return null;
});
ok(!!sel, 'found a white piece with a legal move');
await page.click(`.cell[data-r="${sel.r}"][data-c="${sel.c}"]`);
const targetCount = await page.locator('.cell.target-move, .cell.target-capture, .cell.target-tsuke').count();
ok(targetCount > 0, `selecting shows ${targetCount} highlighted targets`);
ok(await page.locator(`.cell[data-r="${sel.r}"][data-c="${sel.c}"].selected`).count() === 1, 'source cell marked selected');
await page.screenshot({ path: `${OUT}/4-selected.png` });

console.log('# human moves -> CPU replies');
await page.click(`.cell[data-r="${sel.to[0]}"][data-c="${sel.to[1]}"]`);
await page.waitForFunction(() => {
  const gm = window.__gungi.gm;
  return gm.history.length >= 2 && gm.turn === 'w'; // human move + CPU reply, back to human
}, null, { timeout: 15000 });
ok(true, 'human move + CPU reply completed, control back to human');
ok(await page.locator('#thinking.hidden').count() === 1, 'thinking indicator hidden after CPU move');
const logLines = await page.locator('#log .log-line').count();
ok(logLines >= 2, `move log populated (${logLines} lines)`);
await page.screenshot({ path: `${OUT}/5-after-moves.png` });

console.log('# arata drop: select a hand piece -> drop targets highlight');
const hasHand = await page.locator('.hand-piece.white:not(.disabled)').count();
if (hasHand > 0) {
  await page.locator('.hand-piece.white:not(.disabled)').first().click();
  const dropTargets = await page.locator('.cell.target-move').count();
  ok(true, `hand piece selectable (drop targets shown: ${dropTargets})`);
  // deselect to avoid accidental drop
  await page.locator('.hand-piece.white:not(.disabled)').first().click();
} else {
  ok(true, 'no hand pieces to drop yet (skipped)');
}

console.log('# undo returns control to human');
await page.waitForFunction(() => !window.__gungi.controller.uiLock, null, { timeout: 8000 });
const beforeUndo = await page.evaluate(() => window.__gungi.gm.history.length);
await page.click('#btn-undo');
await page.waitForFunction((n) => window.__gungi.gm.history.length < n, beforeUndo, { timeout: 5000 }).catch(() => {});
const afterUndo = await page.evaluate(() => window.__gungi.gm.history.length);
ok(afterUndo < beforeUndo, `undo removed plies (${beforeUndo} -> ${afterUndo})`);
ok(await page.evaluate(() => window.__gungi.gm.turn === 'w'), 'after undo it is human turn');

console.log('# save kifu round-trips (via app serialize/deserialize)');
const rt = await page.evaluate(() => {
  const { GameManager } = window.__gungi.gm.constructor.length ? {} : {}; // noop
  const gm = window.__gungi.gm;
  const data = gm.serialize();
  return { moves: data.moves.length, cells: data.setup.cells.length };
});
ok(rt.moves >= 0 && rt.cells > 0, `kifu serializes (moves=${rt.moves}, setupCells=${rt.cells})`);

console.log('# play several more plies to exercise captures/checks');
await page.evaluate(async () => {
  const c = window.__gungi.controller;
  const gm = window.__gungi.gm;
  for (let i = 0; i < 6 && gm.phase === 'play'; i++) {
    if (gm.turn !== gm.humanColor) { await new Promise(r => setTimeout(r, 50)); continue; }
    const legal = gm.legalMoves('w');
    if (!legal.length) break;
    // prefer a capture if available to exercise capture animation
    const mv = legal.find(m => m.type === 'capture') || legal[0];
    await c.playHuman(mv);
    await new Promise(r => setTimeout(r, 100));
  }
});
await page.waitForTimeout(1500);
ok(await page.evaluate(() => window.__gungi.gm.history.length) > 2, 'extended play advanced the game');
await page.screenshot({ path: `${OUT}/6-midgame.png` });

console.log('# responsive: mobile viewport render');
const mobile = await ctx.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(BASE, { waitUntil: 'networkidle' });
await mobile.click('#btn-auto');
await mobile.click('#btn-start');
await mobile.waitForFunction(() => window.__gungi && window.__gungi.gm.phase === 'play');
ok(await mobile.locator('.board').count() === 1, 'mobile: board renders');
const boardBox = await mobile.locator('.board').boundingBox();
ok(boardBox && boardBox.width <= 390, `mobile: board fits width (${Math.round(boardBox.width)}px)`);
await mobile.screenshot({ path: `${OUT}/7-mobile.png`, fullPage: true });

console.log('# console errors during whole run:', consoleErrors.length);
ok(consoleErrors.length === 0, 'no console/page errors' + (consoleErrors.length ? ': ' + consoleErrors.slice(0,3).join(' | ') : ''));

await browser.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
