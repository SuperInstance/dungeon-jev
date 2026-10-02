#!/usr/bin/env node
// run-wave.js — THE WAVEFORM RUNS (class W): JEV seated per tick for a
// pre-committed consult cap, asked for a DISTRIBUTION over all 5 actions
// (the superposed state). The full wave + local percepts are receipted per
// tick to receipts/waveform.jsonl. When the cap is hit, the local rule takes
// over silently-and-receipted (class "local-collapse") so the episode still
// completes — the game continues without JEV.
//
// Wave seeds are FIXED IN ADVANCE (1 and 2) and receipted here — no
// selection after seeing behavior. Consult caps 6 + 5 => 11 typesafe calls
// (budget 14: 2 spare for retries; if a call fails and no budget remains,
// the tick falls back to the local rule and is receipted E_FALLBACK_LOCAL).
import { appendFileSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { genDungeon, step, episodeOver, worksheetCells, asciiMap, ACTIONS, MAX_TICKS } from "./dungeon.js";
import { scriptPick, collapseWave, normalizedEntropy } from "./players.js";
import { jevAsk, countCalls } from "./jev.js";

const RL = "receipts/model-calls.jsonl";
const WL = "receipts/waveform.jsonl";
const EPS = 0.15; // pre-registered ε (top-2 gap): flat if gap <= ε

const PLAN = [
  { ep: "W1", seed: 1, cap: 6 },
  { ep: "W2", seed: 2, cap: 5 },
];

const VERDICT_Q = {
  verdict: {
    type: "choice",
    instructions:
      "You are the verdict cell of a dungeon worksheet. Choose the player action for this tick. " +
      "threat-level: danger from monsters (3 = adjacent). loot-pull: nearness of loot (3 = on it). " +
      "hp-pressure: low hp (3 = critical). corridor-freedom: open moves (3 = all free). exit-pull: nearness of exit (3 = adjacent). " +
      "Survive, take loot, reach E. Do not step beside monsters when avoidable.",
    criteria: {
      up: "move up (dy -1)", down: "move down (dy +1)", left: "move left (dx -1)",
      right: "move right (dx +1)", wait: "stay in place this tick",
    },
  },
};

const oldW = JSON.parse(readFileSync("receipts/weights-old.json", "utf8")).weights;
if (!existsSync(WL)) appendFileSync(WL, "");

const summary = [];
for (const plan of PLAN) {
  const g = genDungeon(plan.seed);
  let consults = 0, waveRows = 0, localRows = 0, fallbacks = 0;
  while (!episodeOver(g)) {
    const cells = worksheetCells(g);
    const percepts = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.value]));
    const localPick = scriptPick(g, oldW).action;

    let action, row;
    if (consults < plan.cap) {
      const state = {
        worksheet: "dungeon-jev@1", episode: plan.ep, seed: plan.seed, tick: g.tick,
        cells: percepts, hp: g.hp,
        board: asciiMap(g),
        monsters: g.monsters.map(m => ({ x: m.x, y: m.y, kind: m.kind })),
        loots: g.loots, exit: g.exit, player: g.player,
      };
      try {
        const r = await jevAsk({
          receiptsPath: RL, state, questions: VERDICT_Q,
          purpose: "wave-tick", meta: { ep: plan.ep, seed: plan.seed, tick: g.tick },
        });
        consults++;
        const ans = r.answers.verdict;
        let probs;
        if (ans && ans.probabilities && typeof ans.probabilities === "object") {
          probs = Object.fromEntries(ACTIONS.map(a => [a, Number(ans.probabilities[a] ?? 0)]));
        } else {
          // no per-criterion probabilities: record the pick with p1 only (honest degradation)
          probs = Object.fromEntries(ACTIONS.map(a => [a, a === ans?.choice ? 1 : 0]));
        }
        const sorted = ACTIONS.map(a => probs[a]).sort((x, y) => y - x);
        const gap = sorted[0] - sorted[1];
        action = collapseWave(probs);
        row = {
          class: "wave", ep: plan.ep, seed: plan.seed, tick: g.tick, cells: percepts, hp: g.hp,
          wave: { probs, modelPick: ans?.choice ?? null, servedModel: r.model, p1: sorted[0], p2: sorted[1], gap, entropy: normalizedEntropy(probs), sharp: gap > EPS, eps: EPS },
          localPick,
        };
        waveRows++;
      } catch (e) {
        fallbacks++;
        row = { class: "local-collapse", fallback: e.code ?? "E_JEV", ep: plan.ep, seed: plan.seed, tick: g.tick, cells: percepts, hp: g.hp, localPick, action: null };
        action = localPick;
        localRows++;
      }
    } else {
      row = { class: "local-collapse", ep: plan.ep, seed: plan.seed, tick: g.tick, cells: percepts, hp: g.hp, localPick, action: localPick };
      action = localPick;
      localRows++;
    }
    const ev = step(g, action ?? localPick);
    Object.assign(row, { action: action ?? localPick, damage: ev.damage, picked: ev.picked, hpAfter: g.hp, scoreAfter: g.score, died: g.died, exited: g.exited });
    appendFileSync(WL, JSON.stringify(row) + "\n");
    if (g.died || g.exited) break;
  }
  summary.push({ ep: plan.ep, seed: plan.seed, consultCap: plan.cap, consults, waveRows, localRows, fallbacks, score: g.score, loots: g.pickedLoot, died: g.died, exited: g.exited, ticks: g.tick });
  console.log(`[${plan.ep}] seed ${plan.seed}: consults ${consults}/${plan.cap} score ${g.score} died ${g.died} exited ${g.exited}`);
}

const out = { plan: PLAN, eps: EPS, summary, typesafeCallsReceipted: countCalls(RL, "typesafe"), budget: { typesafe: 14, deepinfra: 4 } };
writeFileSync("receipts/waveform-run-summary.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out.summary));
