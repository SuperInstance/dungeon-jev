#!/usr/bin/env node
// run-script.js — the LOCAL rule player, full episodes, ZERO model calls.
// Used for: baseline (old weights) and the A/B legs (weights baked in —
// "the game continues without JEV"). Deterministic: same seed + weights =>
// byte-identical trajectory.
import { writeFileSync, readFileSync } from "node:fs";
import { genDungeon, step, episodeOver, MAX_TICKS } from "./dungeon.js";
import { scriptPick } from "./players.js";

const arg = (name, dflt) => {
  const m = process.argv.find(a => a.startsWith(`--${name}=`));
  if (m) return m.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`); // space form: --name value
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const weightsPath = arg("weights", "receipts/weights-old.json");
const seeds = (arg("seeds", "1,2,3,4,5,6,7,8")).split(",").map(Number);
const outPath = arg("out", "receipts/run.json");
const label = arg("label", weightsPath.includes("jev") ? "jev-weights" : "old-weights");

const w = JSON.parse(readFileSync(weightsPath, "utf8")).weights;

const runs = [];
for (const seed of seeds) {
  const g = genDungeon(seed);
  const trace = [];
  while (!episodeOver(g)) {
    const pick = scriptPick(g, w);
    const ev = step(g, pick.action);
    trace.push({ tick: g.tick, action: pick.action, damage: ev.damage, picked: ev.picked, hp: g.hp });
    if (g.died || g.exited) break;
  }
  runs.push({
    seed, score: g.score, ticks: g.tick, loots: g.pickedLoot,
    died: g.died, exited: g.exited, hpLeft: g.hp, actionCount: trace.length,
  });
  console.log(`[${label}] seed ${seed}: score ${g.score} (loots ${g.pickedLoot}, died ${g.died}, exited ${g.exited}, ticks ${g.tick})`);
}
const mean = runs.reduce((s, r) => s + r.score, 0) / runs.length;
const doc = { label, weights: w, seeds, runs, meanScore: mean, maxTicks: MAX_TICKS, engine: "dungeon-jev@1 vendored-pending-merge" };
writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
console.log(`[${label}] mean ${mean.toFixed(2)} -> ${outPath}`);
