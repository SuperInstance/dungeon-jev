#!/usr/bin/env node
// analyze.js — the waveform ledger analysis. The pre-registered metrics:
//   * modelNeededPct: % of class:'wave' rows whose top-2 probability gap
//     exceeds ε=0.15 (sharp = needs the model; flat = free local collapse)
//   * spearmanEntropyVsDanger: Spearman rho between normalized wave entropy
//     and the local threat-level cell (0-3) — sharp where threats near?
// Secondary (receipted, not sealed): gap-vs-danger rho, model-vs-local agreement.
import { readFileSync, writeFileSync } from "node:fs";
import { genDungeon, step, DELTA, walkable, episodeOver } from "./dungeon.js";

// ── replay verification: the ledger must be re-derivable (determinism law).
// Walk each episode from genDungeon(seed) applying the receipted actions;
// at each wave row, check whether the model's pick was LEGAL pre-collapse,
// and assert the receipted damage matches the replay.
function replay(rows) {
  const byEp = new Map();
  for (const r of rows) {
    if (!byEp.has(r.ep)) byEp.set(r.ep, { seed: r.seed, rows: [] });
    byEp.get(r.ep).rows.push(r);
  }
  let waveRows = 0, illegalPicks = 0, mismatches = [];
  const perTick = [];
  for (const [ep, { seed, rows: rs }] of byEp) {
    const g = genDungeon(seed);
    for (const r of rs) {
      const t = r.tick;
      if (t !== g.tick) mismatches.push({ ep, tick: t, replayAt: g.tick });
      let legal = null;
      if (r.class === "wave" && r.wave?.modelPick) {
        waveRows++;
        const [dx, dy] = DELTA[r.wave.modelPick];
        legal = r.wave.modelPick === "wait" || walkable(g, g.player[0] + dx, g.player[1] + dy);
        if (!legal) illegalPicks++;
      }
      const ev = step(g, r.action);
      if (ev.damage !== r.damage) mismatches.push({ ep, tick: t, receipted: r.damage, replayed: ev.damage });
      perTick.push({ ep, tick: t, modelPickLegal: legal, hpReplay: g.hp, hpReceipted: r.hpAfter });
    }
  }
  return { waveRows, illegalPicks, illegalPickPct: waveRows ? 100 * illegalPicks / waveRows : null, mismatches };
}

const rows = readFileSync("receipts/waveform.jsonl", "utf8").split("\n")
  .filter(l => l.trim()).map(l => JSON.parse(l))
  .filter(r => r.class === "wave" && r.wave);

function rank(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const r = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null; // degenerate (constant series)
  return num / Math.sqrt(dx * dy);
}

const n = rows.length;
const allRows = readFileSync("receipts/waveform.jsonl", "utf8").split("\n")
  .filter(l => l.trim()).map(l => JSON.parse(l));
const rv = replay(allRows);
const sharp = rows.filter(r => r.wave.sharp);
const entropies = rows.map(r => r.wave.entropy);
const gaps = rows.map(r => r.wave.gap);
const dangers = rows.map(r => r.cells["threat-level"]);
const agree = rows.filter(r => r.wave.modelPick === r.localPick);

const analysis = {
  eps: 0.15,
  waveTicks: n,
  sharpTicks: sharp.length,
  modelNeededPct: n ? 100 * sharp.length / n : null,
  meanEntropy: n ? entropies.reduce((s, v) => s + v, 0) / n : null,
  meanGap: n ? gaps.reduce((s, v) => s + v, 0) / n : null,
  spearmanEntropyVsDanger: spearman(entropies, dangers),
  spearmanGapVsDanger: spearman(gaps, dangers),
  modelLocalAgreePct: n ? 100 * agree.length / n : null,
  replay: rv,
  perTick: rows.map(r => ({ ep: r.ep, tick: r.tick, danger: r.cells["threat-level"], p1: r.wave.p1, p2: r.wave.p2, gap: Math.round(r.wave.gap * 1000) / 1000, entropy: Math.round(r.wave.entropy * 1000) / 1000, sharp: r.wave.sharp, modelPick: r.wave.modelPick, localPick: r.localPick })),
};
writeFileSync("receipts/waveform-analysis.json", JSON.stringify(analysis, null, 2) + "\n");
console.log(JSON.stringify({ waveTicks: analysis.waveTicks, sharp: analysis.sharpTicks, modelNeededPct: analysis.modelNeededPct, rhoED: analysis.spearmanEntropyVsDanger, rhoGD: analysis.spearmanGapVsDanger, agreePct: analysis.modelLocalAgreePct }));
