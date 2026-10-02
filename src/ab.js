#!/usr/bin/env node
// ab.js — THE A/B: script-with-old-weights vs script-with-JEV-weights on
// seeds 1-8, fresh runs, ZERO model calls (weights are baked into the
// script; the game continues without JEV). Writes receipts/ab-results.json.
import { writeFileSync, readFileSync } from "node:fs";
import { genDungeon, step, episodeOver } from "./dungeon.js";
import { scriptPick } from "./players.js";

function run(seed, w) {
  const g = genDungeon(seed);
  while (!episodeOver(g)) {
    const pick = scriptPick(g, w);
    step(g, pick.action);
    if (g.died || g.exited) break;
  }
  return { seed, score: g.score, loots: g.pickedLoot, died: g.died, exited: g.exited, ticks: g.tick };
}

const oldW = JSON.parse(readFileSync("receipts/weights-old.json", "utf8")).weights;
const jevDoc = JSON.parse(readFileSync("receipts/weights-jev.json", "utf8"));
const jevW = jevDoc.weights;
const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

const oldRuns = seeds.map(s => run(s, oldW));
const jevRuns = seeds.map(s => run(s, jevW));
const meanOld = oldRuns.reduce((s, r) => s + r.score, 0) / 8;
const meanJev = jevRuns.reduce((s, r) => s + r.score, 0) / 8;
const wins = seeds.filter((_, i) => jevRuns[i].score > oldRuns[i].score).length;
const ties = seeds.filter((_, i) => jevRuns[i].score === oldRuns[i].score).length;

const doc = {
  seeds, oldWeights: oldW, jevWeights: jevW,
  oldRuns, jevRuns, meanOld, meanJev,
  seedsJevStrictlyBetter: wins, ties, seedsJevLost: 8 - wins - ties,
  modelCalls: 0, // the A/B is call-free by construction
};
writeFileSync("receipts/ab-results.json", JSON.stringify(doc, null, 2) + "\n");
for (let i = 0; i < 8; i++) console.log(`seed ${seeds[i]}: old ${oldRuns[i].score} vs jev ${jevRuns[i].score}`);
console.log(`mean old ${meanOld.toFixed(2)} vs jev ${meanJev.toFixed(2)}; jev strictly better on ${wins}/8 (ties ${ties})`);
