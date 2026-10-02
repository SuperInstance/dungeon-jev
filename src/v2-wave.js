// v2-wave.js — the masked-wave instrument (wave 74-a). SEALED definitions
// (see receipts/v2-prereg-claims.json before touching anything):
//   * localWave: softmax with temperature T=1 (a priori: one cell-unit of
//     actionScore = e-fold odds; no tuning on claim seeds) over actionScore
//     for ALL 5 actions (wait carries its penalty) on the PRE-move state.
//   * maskWave: renormalize the wave over the upstream legality mask.
//   * top2Gap: p1 - p2 over LEGAL actions only (the masked top-2 gap).
//   * GAP-GATE: the model seat fires IFF top2Gap(masked) < EPS = 0.15
//     (the mission's sealed instrument). Settled waves (gap >= eps) collapse
//     to the local rule for free. Contested = gap < eps — the seat's domain;
//     P2's "the mask shrinks contested space" is about exactly this rate.
//   * collapseMasked: argmax over LEGAL actions only, tiebreak = fixed
//     ACTIONS order (the pre-registered tiebreak, now inside the mask).
// Pure float math, deterministic, zero I/O, zero RNG.
import { ACTIONS, DELTA, walkable } from "./dungeon.js";
import { actionScore } from "./players.js";

export const EPS = 0.15; // sealed instrument (mission 74-a; wave-1's sealed eps)
export const T = 1.0;    // sealed softmax temperature

export function localWave(game, w, temp = T) {
  const scores = Object.fromEntries(ACTIONS.map(a => [a, actionScore(game, a, w)]));
  const maxS = Math.max(...ACTIONS.map(a => scores[a])); // stability shift (softmax-invariant)
  const exps = Object.fromEntries(ACTIONS.map(a => [a, Math.exp((scores[a] - maxS) / temp)]));
  const Z = ACTIONS.reduce((s, a) => s + exps[a], 0);
  const probs = Object.fromEntries(ACTIONS.map(a => [a, exps[a] / Z]));
  return { scores, probs };
}

export function maskWave(probs, mask) {
  const Z = mask.reduce((s, a) => s + (probs[a] ?? 0), 0);
  const out = {};
  for (const a of ACTIONS) {
    out[a] = (mask.includes(a) && Z > 0) ? (probs[a] ?? 0) / Z : 0;
  }
  return out;
}

export function top2Gap(probs, mask) {
  const ps = mask.map(a => probs[a] ?? 0).sort((x, y) => y - x);
  return (ps[0] ?? 0) - (ps[1] ?? 0);
}

export function collapseMasked(probs, mask) {
  let best = null;
  for (const a of mask) { // mask arrives in ACTIONS order — the tiebreak lives inside the mask
    const p = probs[a] ?? 0;
    if (best === null || p > best.p + 1e-12) best = { a, p };
  }
  return best.a;
}

// THE GAP-GATE: the seat's domain is the contested masked wave.
export function gateFires(maskedGap, eps = EPS) {
  return maskedGap < eps;
}

// THE MASK LAW, asserted pre-step (claim P3): an illegal non-wait action
// must never reach step(). Fail loudly — a violation invalidates the run.
export function assertLegal(game, action) {
  if (action === 'wait') return;
  const [dx, dy] = DELTA[action];
  if (!walkable(game, game.player[0] + dx, game.player[1] + dy)) {
    throw new Error(`E_MASK_LAW_VIOLATED: action '${action}' targets an unwalkable cell at tick ${game.tick} (player ${game.player})`);
  }
}

export function isIllegal(game, action) {
  if (action === 'wait') return false;
  const [dx, dy] = DELTA[action];
  return !walkable(game, game.player[0] + dx, game.player[1] + dy);
}
