// v2-mask.js — THE TYPED MASK CELL + the masked-wave instrument (wave 74-a).
//
// THE MASK CELL is vendored FROM UPSTREAM quilt-dungeons@6740b59
// (src/engine.mjs, CONTRACT v1.1.0 §6.5) — the patch dungeon-jev's own
// JEV-WAVE-1 null (83e4856) named: 18.2% of argmax picks were illegal
// wall-bumps. The function bodies below are copied verbatim from upstream;
// only this header and the DIRS binding are lane-local. A script with no
// memory of walls asks the percept's local window; a bump is never in the
// mask; a monster cell IS legal (bump = attack); wait is always legal.
// THE MASK LAW: the mask is OFFERED, never enforced — and in this lane it is
// additionally wired BEFORE every collapse: an illegal pick is receipted
// mask-refused and never executed (claim P3).

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], wait: [0, 0] };

export function legalActions(p) {
  let cell, cx, cy;
  if (p && Array.isArray(p.local)) {
    const rows = p.local;
    const r = (rows.length - 1) / 2; // window radius; center is always the player
    if (!Number.isInteger(r) || r < 1 || rows[r] == null || rows[r].length !== rows.length) {
      throw new TypeError('legalActions: percept.local must be (2r+1) square rows with the player at center');
    }
    cx = r; cy = r;
    cell = (x, y) => (y >= 0 && y < rows.length && x >= 0 && x < rows[y].length) ? rows[y][x] : '#';
  } else if (p && Array.isArray(p.grid) && p.player) {
    cx = p.player.x; cy = p.player.y;
    cell = (x, y) => (y >= 0 && y < p.grid.length && x >= 0 && x < p.grid[y].length) ? p.grid[y][x] : '#';
  } else {
    throw new TypeError('legalActions: pass a percept ({local}) or a state ({grid, player})');
  }
  return Object.keys(DIRS).filter(a => {
    if (a === 'wait') return true; // staying never bumps
    const [dx, dy] = DIRS[a];
    return cell(cx + dx, cy + dy) !== '#';
  });
}

export function isLegalAction(action, p) {
  return legalActions(p).includes(action);
}

// ---------------------------------------------------------------------------
// Lane-local plumbing: the JEV game is terrain-only (walls/floor in
// game.grid; entities painted only in asciiMap), so the upstream-shaped
// percept window is exactly the wall patch the mask needs. OOB pads '#'
// (upstream §6), the center is forced '@' (upstream §6).
// ---------------------------------------------------------------------------

export function perceptWindow(game, radius = 1) {
  const [px, py] = game.player;
  const r = radius;
  const rows = [];
  for (let wy = py - r; wy <= py + r; wy++) {
    let row = '';
    for (let wx = px - r; wx <= px + r; wx++) {
      row += (wy >= 0 && wy < game.h && wx >= 0 && wx < game.w) ? game.grid[wy][wx] : '#';
    }
    rows.push(row);
  }
  rows[r] = rows[r].slice(0, r) + '@' + rows[r].slice(r + 1); // center is always the player
  return { local: rows };
}

// The mask for a JEV game tick — the upstream cell, fed the local window.
export function gameMask(game) {
  return legalActions(perceptWindow(game, 1));
}
