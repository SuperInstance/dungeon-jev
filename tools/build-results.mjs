#!/usr/bin/env node
// build-results.mjs — computes the pre-registered metric paths from the
// receipted artifacts. Pure function of receipts; no wall clock, no model
// calls. Output: receipts/prereg-results.json (input to preregister score).
import { readFileSync, writeFileSync } from "node:fs";

const ab = JSON.parse(readFileSync("receipts/ab-results.json", "utf8"));
const an = JSON.parse(readFileSync("receipts/waveform-analysis.json", "utf8"));

// NOTE: preregister@1 resolves dotted metric paths INTO results.metrics
// (lookup walks parts), so the sealed path "ab.seedsJevStrictlyBetter" must
// be nested {ab:{seedsJevStrictlyBetter}}, not a flat dotted key.
const metrics = {
  "ab": { "seedsJevStrictlyBetter": ab.seedsJevStrictlyBetter },
  "waveform": {
    "modelNeededPct": an.modelNeededPct,
    "spearmanEntropyVsDanger": an.spearmanEntropyVsDanger,
    "waveTicks": an.waveTicks,
  },
};
const evidence = {
  meanOld: ab.meanOld, meanJev: ab.meanJev,
  sharpTicks: an.sharpTicks, meanEntropy: an.meanEntropy, meanGap: an.meanGap,
  spearmanGapVsDanger: an.spearmanGapVsDanger, modelLocalAgreePct: an.modelLocalAgreePct,
  oldRuns: ab.oldRuns, jevRuns: ab.jevRuns,
};
writeFileSync("receipts/prereg-results.json", JSON.stringify({ metrics, evidence }, null, 2) + "\n");
console.log(JSON.stringify(metrics));
