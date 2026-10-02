#!/usr/bin/env node
// tune.js — JEV AS THE WEIGHT-TUNER (the second novel use).
// Feed JEV the aggregated waveform + score summaries; ask it to PROPOSE NEW
// CELL WEIGHTS for the local rule cells — a typed patch to the worksheet
// (each weight a `score` answer on a 0-3 legend). The patch is baked into
// receipts/weights-jev.json and the A/B re-runs seeds 1-8 with ZERO model
// calls. Fallback (only if typesafe fails twice): deepinfra ≤4 attempts.
import { readFileSync, writeFileSync } from "node:fs";
import { jevAsk, deepinfraAsk } from "./jev.js";

const RL = "receipts/model-calls.jsonl";
const oldW = JSON.parse(readFileSync("receipts/weights-old.json", "utf8"));
const base = JSON.parse(readFileSync("receipts/baseline-weights.json", "utf8"));
const waveSum = JSON.parse(readFileSync("receipts/waveform-run-summary.json", "utf8"));
const analysis = JSON.parse(readFileSync("receipts/waveform-analysis.json", "utf8"));

const state = {
  worksheet: "dungeon-jev@1 (tuner seat)",
  task: "You are tuning the LOCAL rule player of a dungeon worksheet. The local player scores each action as: -wT*threat + wL*loot - wH*hpPressure + wC*corridor + wE*exitPull - waitPenalty(if wait). Propose new integer weights 0-3 per cell.",
  currentWeights: oldW.weights,
  baselineRunsOldWeights: base.runs,
  baselineMeanScore: base.meanScore,
  waveformAggregate: { eps: analysis.eps, waveTicks: analysis.waveTicks, sharpTicks: analysis.sharpTicks, modelNeededPct: analysis.modelNeededPct, meanEntropy: analysis.meanEntropy, meanGap: analysis.meanGap, modelLocalAgreePct: analysis.modelLocalAgreePct },
  waveformEpisodes: waveSum.summary,
  cellLegend: "threat-level: danger from monsters 0-3; loot-pull: nearness of loot 0-3; hp-pressure: low hp 0-3; corridor-freedom: open moves 0-3; exit-pull: nearness of exit 0-3",
};

const QUESTIONS = {
  wT: { type: "score", instructions: "Weight for threat-level (monster danger) in the local player's action score. 0 = dead weight, 1 = light, 2 = strong, 3 = dominant.", criteria: ["0 dead weight (ignore this cell)", "1 light", "2 strong", "3 dominant"] },
  wL: { type: "score", instructions: "Weight for loot-pull. 0 = dead weight, 1 = light, 2 = strong, 3 = dominant.", criteria: ["0 dead weight (ignore this cell)", "1 light", "2 strong", "3 dominant"] },
  wH: { type: "score", instructions: "Weight for hp-pressure (low hp urgency). 0 = dead weight, 1 = light, 2 = strong, 3 = dominant.", criteria: ["0 dead weight (ignore this cell)", "1 light", "2 strong", "3 dominant"] },
  wC: { type: "score", instructions: "Weight for corridor-freedom (keeping escape routes open). 0 = dead weight, 1 = light, 2 = strong, 3 = dominant.", criteria: ["0 dead weight (ignore this cell)", "1 light", "2 strong", "3 dominant"] },
  wE: { type: "score", instructions: "Weight for exit-pull (heading to the exit once loot is taken). 0 = dead weight, 1 = light, 2 = strong, 3 = dominant.", criteria: ["0 dead weight (ignore this cell)", "1 light", "2 strong", "3 dominant"] },
};

let served = null, patch = null, via = null, err = null;
try {
  const r = await jevAsk({ receiptsPath: RL, state, questions: QUESTIONS, purpose: "weight-tuner", meta: { stage: "tuner" } });
  served = r.model;
  patch = Object.fromEntries(Object.entries(r.answers).map(([k, v]) => [k, v?.score]));
  via = "typesafe";
} catch (e) {
  err = `${e.code}: ${e.message}`;
  // deepinfra fallback (budget ≤4, receipted): one chat call, JSON weights out
  const prompt = `${JSON.stringify(state)}\n\nReply with ONLY a JSON object {"wT":<0-3 int>,"wL":<0-3 int>,"wH":<0-3 int>,"wC":<0-3 int>,"wE":<0-3 int>} proposing new weights that raise the mean score.`;
  try {
    const r2 = await deepinfraAsk({ receiptsPath: RL, prompt, purpose: "weight-tuner-fallback", meta: { stage: "tuner-fallback", typesafeErr: err } });
    const m = r2.content.match(/\{[\s\S]*\}/);
    patch = JSON.parse(m[0]);
    served = r2.modelServed;
    via = "deepinfra";
  } catch (e2) {
    err += ` | fallback: ${e2.code}: ${e2.message}`;
  }
}

if (!patch) {
  writeFileSync("receipts/tuner-patch.json", JSON.stringify({ ok: false, err, via: null, servedModel: null, askedState: state }, null, 2) + "\n");
  console.error(`E_TUNER_FAILED ${err}`);
  process.exit(1);
}

const weights = {
  wT: Math.max(0, Math.min(3, Number(patch.wT) || 0)),
  wL: Math.max(0, Math.min(3, Number(patch.wL) || 0)),
  wH: Math.max(0, Math.min(3, Number(patch.wH) || 0)),
  wC: Math.max(0, Math.min(3, Number(patch.wC) || 0)),
  wE: Math.max(0, Math.min(3, Number(patch.wE) || 0)),
  waitPenalty: oldW.weights.waitPenalty, // held fixed — not offered to the tuner
};
const out = { ok: true, via, servedModel: served, rawPatch: patch, weights, oldWeights: oldW.weights, askedState: state };
writeFileSync("receipts/tuner-patch.json", JSON.stringify(out, null, 2) + "\n");
writeFileSync("receipts/weights-jev.json", JSON.stringify({ source: `jev tuner (${via}, model ${served})`, weights, note: "typed patch to the worksheet's local rule cells — JEV fine-tunes the quilt's player-logic weights" }, null, 2) + "\n");
console.log(`[tuner] via ${via} model ${served}: ${JSON.stringify(weights)}`);
