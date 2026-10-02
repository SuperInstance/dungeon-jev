// players.js — the two seats of the quilt.
//  * scriptPick: the LOCAL rule player (weighted sum over worksheet cells;
//    zero model calls — weights are baked in, the game continues without JEV).
//  * collapseWave: the superposition collapse (argmax seeded by the tiebreak
//    rule: fixed ACTIONS order on equal probability).
import { ACTIONS, DELTA, walkable, threatLevel, lootPull, hpPressure, corridorFreedom, exitPull } from "./dungeon.js";

// Cells on the post-move player position (monster positions pre-move — the
// monsters move after the player; this approximation is receipted in docs).
function cellsAfter(game, action) {
  const [dx, dy] = DELTA[action];
  const nx = game.player[0] + dx, ny = game.player[1] + dy;
  const g2 = { ...game, player: action !== "wait" && walkable(game, nx, ny) ? [nx, ny] : game.player.slice() };
  return {
    threat: threatLevel(g2),
    loot: lootPull(g2),
    hp: hpPressure(g2),
    corr: corridorFreedom(g2),
    exit: exitPull(g2),
  };
}

export function legalActions(game) {
  return ACTIONS.filter(a => {
    if (a === "wait") return true;
    const [dx, dy] = DELTA[a];
    return walkable(game, game.player[0] + dx, game.player[1] + dy);
  });
}

// score(a) = -wT*threat' + wL*loot' - wH*hp' + wC*corr' + wE*exit' - waitPenalty(if wait)
export function actionScore(game, action, w) {
  const c = cellsAfter(game, action);
  return -w.wT * c.threat + w.wL * c.loot - w.wH * c.hp + w.wC * c.corr + w.wE * c.exit
    - (action === "wait" ? (w.waitPenalty ?? 0.25) : 0);
}

export function scriptPick(game, w) {
  const legal = legalActions(game);
  let best = null;
  for (const a of legal) { // ACTIONS order is the tiebreak (deterministic)
    const s = actionScore(game, a, w);
    if (best === null || s > best.s + 1e-12) best = { a, s };
  }
  return { action: best.a, score: best.s, legal, scores: Object.fromEntries(legal.map(a => [a, actionScore(game, a, w)])) };
}

// Collapse the wave: argmax over the 5 probabilities; ties broken by the
// fixed ACTIONS order (the pre-registered tiebreak rule).
export function collapseWave(probs) {
  let best = null;
  for (const a of ACTIONS) {
    const p = probs[a] ?? 0;
    if (best === null || p > best.p + 1e-12) best = { a, p };
  }
  return best.a;
}

export function normalizedEntropy(probs) {
  const ps = ACTIONS.map(a => Math.max(0, probs[a] ?? 0));
  const tot = ps.reduce((s, p) => s + p, 0);
  if (tot <= 0) return 1;
  let h = 0;
  for (const p of ps) { const q = p / tot; if (q > 0) h -= q * Math.log2(q); }
  return h / Math.log2(ACTIONS.length); // in [0,1]; 1 = perfectly flat
}
