// dungeon-jev — VENDORED-PENDING-MERGE core.
//
// CONTRACT NOTE (wave 73-c): GET /repos/SuperInstance/quilt-dungeons → 404 at
// lane start ("Not Found"); the upstream repo does not exist yet, so there is
// nothing to import and nothing pushable-to. This file VENDORS a minimal
// deterministic core ON THE QUILT-DUNGEONS CONTRACT (grid dungeon; typed
// percepts; 5-action verdict; loot/exit/monster scoring) and is marked
// VENDORED-PENDING-MERGE: when quilt-dungeons lands upstream, this file is
// the declared merge point and its quirks are upstream's to overrule.
//
// Determinism law: NO Math.random anywhere. Every run is a pure function of
// (seed, weights | waves). Sorts carry explicit total-order tiebreaks.

export const ACTIONS = ["up", "down", "left", "right", "wait"];
export const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], wait: [0, 0] };

export const W = 11, H = 9, MAX_TICKS = 40, START_HP = 5;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const man = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

function bfs(grid, sx, sy) {
  const dist = new Map([[`${sx},${sy}`, 0]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    const d = dist.get(`${x},${y}`);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (grid[ny][nx] === '#' || dist.has(k)) continue;
      dist.set(k, d + 1); q.push([nx, ny]);
    }
  }
  return dist;
}

// Deterministic map generation: interior wall segments from a seeded PRNG;
// entity placement by explicit total orderings over BFS distance (no
// randomness in selection). Retries with attempt-scoped PRNG until the map
// is roomy enough — still a pure function of seed.
export function genDungeon(seed) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const rnd = mulberry32(((seed * 2654435761) ^ (attempt * 40503 + 0x9e3779b9)) >>> 0);
    const grid = Array.from({ length: H }, () => Array(W).fill('.'));
    for (let x = 0; x < W; x++) { grid[0][x] = '#'; grid[H - 1][x] = '#'; }
    for (let y = 0; y < H; y++) { grid[y][0] = '#'; grid[y][W - 1] = '#'; }
    const nseg = 5 + (attempt % 2);
    for (let s = 0; s < nseg; s++) {
      const horiz = rnd() < 0.5;
      const len = 2 + Math.floor(rnd() * 2);
      let x = 1 + Math.floor(rnd() * (W - 2));
      let y = 1 + Math.floor(rnd() * (H - 2));
      for (let i = 0; i < len; i++) {
        if (x > 0 && x < W - 1 && y > 0 && y < H - 1) grid[y][x] = '#';
        if (horiz) x++; else y++;
      }
    }
    grid[1][1] = '.';
    const dist = bfs(grid, 1, 1);
    const reach = [...dist.entries()]
      .map(([k, d]) => { const [x, y] = k.split(',').map(Number); return { x, y, d }; })
      .sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    if (reach.length < 30) continue; // too cramped — deterministic retry

    // exit = farthest reachable tile (ties: larger y, then larger x)
    const exitTile = reach.reduce((m, t) =>
      (t.d > m.d || (t.d === m.d && (t.y > m.y || (t.y === m.y && t.x > m.x)))) ? t : m, reach[0]);

    // loots: 3 tiles, spread greedily by far-min-distance, d>=3, not exit
    const cand = reach.filter(t => t.d >= 3 && !(t.x === exitTile.x && t.y === exitTile.y));
    const picked = [];
    for (let i = 0; i < 3 && cand.length; i++) {
      let best = null;
      for (const t of cand) {
        if (picked.some(p => p.x === t.x && p.y === t.y)) continue;
        const minD = Math.min(...picked.map(p => man([t.x, t.y], [p.x, p.y])), 99);
        const key = picked.length === 0 ? t.d * 1000 + t.y * 50 + t.x : minD * 1000 + t.d * 10 + t.x;
        if (!best || key > best.key) best = { t, key };
      }
      if (!best) break;
      picked.push(best.t);
    }
    if (picked.length < 3) continue;

    // chaser: reachable tile nearest distance 6 (d>=4), guard: nearest distance 9 (d>=6)
    const occupied = (t) =>
      (t.x === exitTile.x && t.y === exitTile.y) || picked.some(p => p.x === t.x && p.y === t.y);
    const chaser = reach.filter(t => t.d >= 4 && !occupied(t))
      .sort((a, b) => Math.abs(a.d - 6) - Math.abs(b.d - 6) || a.y - b.y || a.x - b.x)[0];
    const guard = reach.filter(t => t.d >= 6 && !occupied(t) && !(chaser && t.x === chaser.x && t.y === chaser.y))
      .sort((a, b) => Math.abs(a.d - 9) - Math.abs(b.d - 9) || a.y - b.y || a.x - b.x)[0];
    if (!chaser || !guard) continue;

    return {
      seed, w: W, h: H, grid,
      player: [1, 1], hp: START_HP, tick: 0,
      loots: picked.map(t => [t.x, t.y]),
      exit: [exitTile.x, exitTile.y],
      monsters: [
        { x: chaser.x, y: chaser.y, kind: "chaser", dir: 0 },
        { x: guard.x, y: guard.y, kind: "guard", dir: 1 },
      ],
      score: 0, died: false, exited: false, pickedLoot: 0,
    };
  }
  throw new Error(`E_NO_MAP: seed ${seed} produced no roomy connected dungeon in 64 attempts`);
}

export function walkable(game, x, y) {
  return x >= 0 && y >= 0 && x < game.w && y < game.h && game.grid[y][x] !== '#';
}

// threat-level cell: from monster dx/dy/kind (the mission's spec, verbatim)
export function threatLevel(game) {
  let t = 0;
  for (const m of game.monsters) {
    const d = man(game.player, [m.x, m.y]);
    let base = d <= 1 ? 3 : d === 2 ? 2 : d <= 4 ? 1 : 0;
    if (m.kind === "chaser" && d <= 3) base += 1;
    t = Math.max(t, base);
  }
  return Math.min(3, t);
}

export function lootPull(game) {
  if (!game.loots.length) return 0;
  const d = Math.min(...game.loots.map(l => man(game.player, l)));
  return d <= 1 ? 3 : d <= 3 ? 2 : d <= 6 ? 1 : 0;
}

export function hpPressure(game) {
  return game.hp <= 1 ? 3 : game.hp <= 2 ? 2 : game.hp <= 4 ? 1 : 0;
}

export function corridorFreedom(game) {
  const n = [[0, -1], [0, 1], [-1, 0], [1, 0]]
    .filter(([dx, dy]) => walkable(game, game.player[0] + dx, game.player[1] + dy)).length;
  return n >= 4 ? 3 : n === 3 ? 2 : n === 2 ? 1 : 0;
}

export function exitPull(game) {
  const d = man(game.player, game.exit);
  return d <= 1 ? 3 : d <= 3 ? 2 : d <= 6 ? 1 : 0;
}

// The worksheet: typed cells computed LOCALLY (rules — free).
export function worksheetCells(game) {
  return {
    "threat-level": { type: "number-0-3", value: threatLevel(game) },
    "loot-pull": { type: "number-0-3", value: lootPull(game) },
    "hp-pressure": { type: "number-0-3", value: hpPressure(game) },
    "corridor-freedom": { type: "number-0-3", value: corridorFreedom(game) },
    "exit-pull": { type: "number-0-3", value: exitPull(game) },
    "verdict": { type: "enum:up|down|left|right|wait", value: null }, // the soft joint
  };
}

export function asciiMap(game) {
  const g = game.grid.map(r => r.slice());
  for (const [x, y] of game.loots) g[y][x] = 'L';
  g[game.exit[1]][game.exit[0]] = 'E';
  for (const m of game.monsters) g[m.y][m.x] = m.kind === "chaser" ? 'M' : 'G';
  g[game.player[1]][game.player[0]] = '@';
  return g.map(r => r.join('')).join('\n');
}

function moveMonster(game, m) {
  if (m.kind === "chaser") {
    // pacing: the chaser moves every OTHER tick (even pre-increment ticks) —
    // equal-speed pursuit is unescapable in a grid; this gives the player a
    // real escape game. Deterministic (parity of the tick counter).
    if (game.tick % 2 !== 0) return;
    const d = man(game.player, [m.x, m.y]);
    if (d > 5) return;
    const dx = Math.sign(game.player[0] - m.x), dy = Math.sign(game.player[1] - m.y);
    const steps = Math.abs(game.player[0] - m.x) >= Math.abs(game.player[1] - m.y)
      ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
    for (const [sx, sy] of steps) {
      if ((sx || sy) && walkable(game, m.x + sx, m.y + sy)) { m.x += sx; m.y += sy; return; }
    }
  } else { // guard: horizontal bounce
    const nx = m.x + m.dir;
    if (walkable(game, nx, m.y)) m.x = nx; else m.dir = -m.dir;
  }
}

// One tick: player action -> pickups -> monsters move -> adjacency damage.
// Returns event list for receipting.
export function step(game, action) {
  const events = { action, damage: 0, picked: 0, moved: true };
  const [dx, dy] = DELTA[action];
  const nx = game.player[0] + dx, ny = game.player[1] + dy;
  if (action !== "wait" && walkable(game, nx, ny)) { game.player = [nx, ny]; }
  else events.moved = false;

  const keep = [];
  for (const l of game.loots) {
    if (l[0] === game.player[0] && l[1] === game.player[1]) { game.score += 10; game.pickedLoot++; events.picked++; }
    else keep.push(l);
  }
  game.loots = keep;

  for (const m of game.monsters) moveMonster(game, m);

  for (const m of game.monsters) {
    if (man(game.player, [m.x, m.y]) <= 1) { game.hp -= 1; events.damage++; break; }
  }

  game.tick++;
  if (game.hp <= 0) { game.died = true; }
  else if (game.player[0] === game.exit[0] && game.player[1] === game.exit[1]) {
    game.exited = true; game.score += 50 + game.hp * 2;
  }
  return events;
}

export const episodeOver = (game) => game.died || game.exited || game.tick >= MAX_TICKS;
