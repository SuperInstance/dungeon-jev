#!/usr/bin/env node
// run-v2.mjs — WAVE 74-a: the legality mask wired + the GAP-GATE + the
// pre-registered rerun. Named by this repo's own JEV-WAVE-1 null (83e4856):
//   (1) 18.2% of argmax picks were illegal wall-bumps → the upstream mask
//       cell (quilt-dungeons@6740b59, vendored in src/v2-mask.js) is wired
//       BEFORE every collapse: illegal picks are receipted mask-refused and
//       never executed (P3, the mask law);
//   (2) the corrected lens: top-2 GAP tracks danger (wave-1 rho +0.415) →
//       the model seat fires ONLY when the masked top-2 gap < eps=0.15
//       (contested); settled waves collapse to the local rule, free;
//   (3) masked-gap-gated JEV hybrid vs the local rule on seeds 1-8 (P1),
//       scored beside the UNTOUCHED wave-1 claims (73-c).
//
// DISCIPLINE: claims are SEALED before any run (tools/preregister.mjs, the
// fleet gold standard); this runner re-asserts the seal AND the engine
// source hashes (batteryBinding) pre-run, fail-closed. Typesafe budget:
// <=12 receipted calls per lane (per-seed attempt cap 1, global cap 12;
// every attempt — success or failure — is receipted to model-calls-v2.jsonl).
// Wave-1 receipts are read-only history; v2 writes only v2-prefixed files.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { genDungeon, step, episodeOver, worksheetCells, asciiMap, ACTIONS, MAX_TICKS } from "./dungeon.js";
import { scriptPick, collapseWave } from "./players.js";
import { jevAsk, countCalls } from "./jev.js";
import { gameMask } from "./v2-mask.js";
import { localWave, maskWave, top2Gap, collapseMasked, gateFires, assertLegal, isIllegal, EPS } from "./v2-wave.js";
import { claimsHashOf } from "../tools/preregister.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const P = (f) => path.join(ROOT, f);

const CALLS = process.env.V2_CALLS ?? P("receipts/model-calls-v2.jsonl");
const RUNS = process.env.V2_RUNS ?? P("receipts/v2-runs.jsonl");
const SUMMARY = process.env.V2_SUMMARY ?? P("receipts/v2-summary.json");
const RESULTS = process.env.V2_RESULTS ?? P("receipts/v2-results.json");
const W1REPLAY = process.env.V2_W1REPLAY ?? P("receipts/v2-wave1-replay.json");
const CLAIMS = process.env.V2_CLAIMS ?? P("receipts/v2-prereg-claims.json");
const SEAL = process.env.V2_SEAL ?? P("receipts/v2-prereg-seal.json");

const SEEDS = (process.env.V2_SEEDS ?? "1,2,3,4,5,6,7,8").split(",").map(Number);
const DRY = process.env.V2_DRY === "1";
const CAP_PER_SEED = Number(process.env.V2_SEAT_CAP_SEED ?? 1); // attempts per seed (sealed)
const GLOBAL_ATTEMPT_CAP = 12; // the lane's typesafe budget (mission 74-a)

const RUNS_EXISTS_GUARD = existsSync(RUNS);
if (RUNS_EXISTS_GUARD) throw new Error(`E_RUNS_EXISTS: ${RUNS} already exists — a fresh run needs a fresh receipt file (append-only; remove explicitly to rerun)`);

if (!DRY && (!existsSync(CLAIMS) || !existsSync(SEAL))) {
  throw new Error("E_UNSEALED: claims/seal missing — the fleet gold standard is seal BEFORE any run");
}
// PRE-RUN, fail-closed: the seal + the battery binding (syncopation pattern).
// A DRY run (zero model calls, held-out seed, no claim measurements) may
// execute pre-seal as a test fixture — receipted; every other run refuses.
const sealedRun = existsSync(CLAIMS) && existsSync(SEAL) &&
  claimsHashOf(JSON.parse(readFileSync(CLAIMS, "utf8"))) === JSON.parse(readFileSync(SEAL, "utf8")).claimsHash;
if (existsSync(CLAIMS) && existsSync(SEAL) && !sealedRun) {
  throw new Error("E_SEAL_MISMATCH: claims do not match the sealed hash — refusing to run");
}
if (!sealedRun && !DRY) throw new Error("E_UNSEALED: seal verification failed");

const oldW = JSON.parse(readFileSync(P("receipts/weights-old.json"), "utf8")).weights;

// The claims document (present for sealed runs; a dry fixture may run pre-seal).
const claims = existsSync(CLAIMS) ? JSON.parse(readFileSync(CLAIMS, "utf8")) : null;
const BOUND = ["src/dungeon.js", "src/players.js", "src/jev.js", "src/v2-mask.js", "src/v2-wave.js", "src/run-v2.mjs"];
const sha256 = (f) => createHash("sha256").update(readFileSync(P(f))).digest("hex");
const bindingNow = Object.fromEntries(BOUND.map(f => [f, `sha256:${sha256(f)}`]));
for (const [f, h] of Object.entries(claims?.batteryBinding ?? {})) {
  if (bindingNow[f] !== h) {
    throw new Error(`E_BATTERY_MISMATCH: ${f} is ${bindingNow[f]}, sealed as ${h} — refusing to run`);
  }
}
console.error(sealedRun
  ? `seal OK (${claimsHashOf(claims).slice(0, 26)}…), battery bound: ${BOUND.length} sources`
  : `DRY fixture mode: no seal, zero calls, zero claims (seeds ${SEEDS.join(",")})`);

// Same verdict instrument as wave-1 (verbatim criteria; the STATE gains the mask).
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

const row = (o) => appendFileSync(RUNS, JSON.stringify(o) + "\n");

// ---------------------------------------------------------------------------
// The legs
// ---------------------------------------------------------------------------

function runLocal(seed) {
  const g = genDungeon(seed);
  while (!episodeOver(g)) {
    const pick = scriptPick(g, oldW);
    try { assertLegal(g, pick.action); } catch (e) { return finishLocal(seed, g, e); }
    const illegalSeen = isIllegal(g, pick.action);
    const ev = step(g, pick.action);
    row({ leg: "local", seed, tick: g.tick - 1, action: pick.action, illegalSeen,
      damage: ev.damage, picked: ev.picked, hpAfter: g.hp, scoreAfter: g.score, died: g.died, exited: g.exited });
  }
  return { seed, score: g.score, loots: g.pickedLoot, died: g.died, exited: g.exited, ticks: g.tick };
}
let localViolation = null;
function finishLocal(seed, g, e) { localViolation = String(e.message); return { seed, score: g.score, ticks: g.tick, violation: true }; }

function probsFromAnswer(ans) {
  if (ans && ans.probabilities && typeof ans.probabilities === "object") {
    return Object.fromEntries(ACTIONS.map(a => [a, Number(ans.probabilities[a] ?? 0)]));
  }
  // no per-criterion probabilities: record the pick with p1 only (honest degradation)
  return Object.fromEntries(ACTIONS.map(a => [a, a === ans?.choice ? 1 : 0]));
}

async function runHybrid(seed, seatsUsed) {
  const g = genDungeon(seed);
  let gateFiredTicks = 0, consulted = 0, maskRefused = 0, illegalSeen = 0;
  while (!episodeOver(g)) {
    const cells = worksheetCells(g);
    const percepts = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.value]));
    const mask = gameMask(g);                       // the upstream typed mask cell
    const wave = localWave(g, oldW);                // free preliminary wave (sealed T=1)
    const masked = maskWave(wave.probs, mask);      // masked BEFORE any gap/collapse
    const gap = top2Gap(masked, mask);
    const unmaskedGap = top2Gap(wave.probs, ACTIONS);
    const contested = gateFires(gap);               // THE GAP-GATE: seat iff gap < eps
    const localPick = collapseMasked(masked, mask); // == scriptPick's pick (argmax over legal)
    let action = localPick, seatRow = null;
    const base = { leg: "hybrid", seed, tick: g.tick, cells: percepts, hp: g.hp, mask,
      wave: wave.probs, scores: wave.scores, masked: masked, maskedTop2Gap: gap, unmaskedGap,
      eps: EPS, gate: contested ? "contested" : "settled", localPick };

    if (contested) {
      gateFiredTicks++;
      const canSeat = !DRY && seatsUsed[seed] < CAP_PER_SEED && attemptsTotal < GLOBAL_ATTEMPT_CAP;
      if (canSeat) {
        seatsUsed[seed]++; attemptsTotal++;
        const state = {
          worksheet: "dungeon-jev@2", episode: `V2-s${seed}`, seed, tick: g.tick,
          cells: percepts, hp: g.hp, board: asciiMap(g),
          monsters: g.monsters.map(m => ({ x: m.x, y: m.y, kind: m.kind })),
          loots: g.loots, exit: g.exit, player: g.player,
          mask: { legal: mask, maskedTop2Gap: gap, eps: EPS, contested }, // the seat sees the mask
        };
        try {
          const r = await jevAsk({
            receiptsPath: CALLS, state, questions: VERDICT_Q,
            purpose: "v2-seat", meta: { leg: "hybrid", seed, tick: g.tick },
          });
          consulted++;
          const ans = r.answers.verdict;
          const probs = probsFromAnswer(ans);
          const rawPick = collapseWave(probs);                    // the model's unmasked opinion
          const refused = !mask.includes(rawPick);                // THE MASK LAW: refused, never executed
          if (refused) maskRefused++;
          action = collapseMasked(probs, mask);                   // masked collapse
          seatRow = { seat: "jev", servedModel: r.model, modelWave: probs, modelRawPick: rawPick,
            maskRefused: refused, executedPick: action };
        } catch (e) {
          // the game continues: budget/transport/channel — local collapse, receipted
          seatRow = { seat: "jev", fallback: e.code ?? "E_JEV", detail: String(e.message).slice(0, 120) };
          action = localPick;
        }
      } else {
        seatRow = { seat: "jev", fallback: DRY ? "dry-run-no-call" : "seat-cap-consumed" };
      }
    }
    try { assertLegal(g, action); } catch (e) {
      row({ ...base, ...seatRow, action, VIOLATION: String(e.message).slice(0, 160) });
      return { seed, score: g.score, ticks: g.tick, gateFiredTicks, consulted, maskRefused, violation: true };
    }
    if (isIllegal(g, action)) illegalSeen++; // belt-and-braces: 0 unless the law is broken
    const ev = step(g, action);
    row({ ...base, ...seatRow, action, illegalSeen: illegalSeen > 0, maskRefusedThisTick: seatRow?.maskRefused === true,
      damage: ev.damage, picked: ev.picked, hpAfter: g.hp, scoreAfter: g.score, died: g.died, exited: g.exited });
  }
  return { seed, score: g.score, loots: g.pickedLoot, died: g.died, exited: g.exited, ticks: g.tick, gateFiredTicks, consulted, maskRefused, illegalSeen };
}

// ---------------------------------------------------------------------------
// Descriptive side-receipt (zero calls): the mask replayed over wave-1's own
// receipted trajectory — would the mask have caught the 18.2%?
// ---------------------------------------------------------------------------
function replayWave1() {
  const rows = readFileSync(P("receipts/waveform.jsonl"), "utf8").split("\n").filter(l => l.trim()).map(JSON.parse);
  const byEp = new Map();
  for (const r of rows) { if (!byEp.has(r.ep)) byEp.set(r.ep, { seed: r.seed, rows: [] }); byEp.get(r.ep).rows.push(r); }
  const out = { eps: EPS, note: "DESCRIPTIVE ONLY (zero calls, claims untouched): the vendored mask replayed over wave-1's receipted trajectory (receipts/waveform.jsonl, read-only).", fidelity: true, waveTicks: 0, illegalRawPicks: 0, refusedAll: 0, contestedUnmasked: 0, contestedMasked: 0, perTick: [] };
  for (const [ep, { seed, rows: epRows }] of byEp) {
    const g = genDungeon(seed);
    for (const r of epRows) {
      const cells = worksheetCells(g);
      const cur = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.value]));
      const faithful = ["threat-level", "loot-pull", "hp-pressure", "corridor-freedom", "exit-pull"]
        .every(k => cur[k] === r.cells?.[k]);
      if (!faithful) out.fidelity = false;
      const mask = gameMask(g);
      if (r.class === "wave" && r.wave?.probs) {
        out.waveTicks++;
        const refused = r.wave.modelPick != null && !mask.includes(r.wave.modelPick);
        const maskedGap = top2Gap(maskWave(r.wave.probs, mask), mask);
        if (refused) { out.illegalRawPicks++; out.refusedAll++; }
        if (r.wave.gap < EPS) out.contestedUnmasked++;
        if (maskedGap < EPS) out.contestedMasked++;
        out.perTick.push({ ep, tick: r.tick, modelPick: r.wave.modelPick, maskRefused: refused, unmaskedGap: r.wave.gap, maskedGap });
      }
      step(g, r.action); // wave-1's executed action — replaying ITS law, not ours
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
appendFileSync(RUNS, ""); // touch — append-only from here (pre-existing file refused at entry)
const seatsUsed = {};
let attemptsTotal = 0;
const localRuns = SEEDS.map(runLocal);
if (localViolation) throw new Error(`E_MASK_LAW_VIOLATED (local leg): ${localViolation}`);
const hybridRuns = [];
for (const seed of SEEDS) hybridRuns.push(await runHybrid(seed, seatsUsed));

const w1 = replayWave1();
writeFileSync(W1REPLAY, JSON.stringify(w1, null, 2) + "\n");

// metrics
const totalTicks = hybridRuns.reduce((s, r) => s + r.ticks, 0);
const contestedTicks = hybridRuns.reduce((s, r) => s + (r.gateFiredTicks ?? 0), 0);
const maskRefusedTotal = hybridRuns.reduce((s, r) => s + (r.maskRefused ?? 0), 0);
const consultedTotal = hybridRuns.reduce((s, r) => s + (r.consulted ?? 0), 0);

// scan the receipt chain for the law + the no-mask counterfactual (both legs)
let receiptedIllegal = 0, receiptedUnmaskedContested = 0, receiptedMaskRefused = 0, hybridReceiptTicks = 0;
for (const line of readFileSync(RUNS, "utf8").split("\n").filter(l => l.trim())) {
  const r = JSON.parse(line);
  if (r.leg === "hybrid") {
    hybridReceiptTicks++;
    if (r.unmaskedGap < EPS) receiptedUnmaskedContested++;
    if (r.maskRefusedThisTick) receiptedMaskRefused++;
  }
  if (r.illegalSeen) receiptedIllegal++; // any leg — the law tolerates zero
}
if (receiptedIllegal > 0) {
  throw new Error(`E_MASK_LAW_VIOLATED: ${receiptedIllegal} illegal action(s) executed — P3 broken, run invalid`);
}
const illegalExecuted = 0; // proven: assertLegal pre-step (fail-closed) + zero receipted violations

const localMean = localRuns.reduce((s, r) => s + r.score, 0) / SEEDS.length;
const hybridMean = hybridRuns.reduce((s, r) => s + r.score, 0) / SEEDS.length;
const seedsHybridGteLocalMean = SEEDS.filter(s => hybridRuns[SEEDS.indexOf(s)].score >= localMean).length;
const paired = SEEDS.map((s, i) => ({ seed: s, hybrid: hybridRuns[i].score, local: localRuns[i].score,
  delta: hybridRuns[i].score - localRuns[i].score }));
const wins = paired.filter(p => p.delta > 0).length, ties = paired.filter(p => p.delta === 0).length;

// integrity: the local leg must equal the untouched wave-1 A/B baseline
let abCheck = "skipped";
try {
  const ab = JSON.parse(readFileSync(P("receipts/ab-results.json"), "utf8"));
  const same = ab.oldRuns.every(r => { const m = localRuns.find(x => x.seed === r.seed); return m && m.score === r.score; });
  abCheck = same ? "match" : "MISMATCH";
  if (!same) throw new Error("local leg drifted from ab-results oldRuns");
} catch (e) { abCheck = e.message.slice(0, 80); }

const receiptedCalls = countCalls(CALLS, "typesafe");
if (receiptedCalls > GLOBAL_ATTEMPT_CAP) {
  throw new Error(`E_BUDGET_BREACH: ${receiptedCalls} receipted typesafe calls > cap ${GLOBAL_ATTEMPT_CAP}`);
}
const summary = {
  wave: "74-a", discipline: "dungeon-jev v2 — legality mask + gap-gate rerun",
  eps: EPS, softmaxT: 1.0, seeds: SEEDS, dry: DRY,
  caps: { perSeedAttempts: CAP_PER_SEED, globalAttempts: GLOBAL_ATTEMPT_CAP },
  claimsHash: claims ? claimsHashOf(claims) : null, sealedRun, batteryBinding: bindingNow,
  localRuns, hybridRuns, localMean, hybridMean, paired, wins, ties,
  seedsHybridGteLocalMean, totalTicks, contestedTicks, gateFiredPct: totalTicks ? 100 * contestedTicks / totalTicks : 0,
  unmaskedContestedPct: hybridReceiptTicks ? 100 * receiptedUnmaskedContested / hybridReceiptTicks : 0,
  consultedTotal, attemptsTotal, receiptedCalls, maskRefusedTotal, receiptedMaskRefused,
  illegalExecuted: 0, receiptedIllegal, abCheck,
  jevLedW1W2: { source: "receipts/waveform-run-summary.json (wave-1, untouched)", scores: [0, 0] },
  wave1ReplayFile: path.relative(ROOT, W1REPLAY),
};
writeFileSync(SUMMARY, JSON.stringify(summary, null, 2) + "\n");

// results for preregister score (metrics + evidence)
const results = {
  metrics: {
    "v2.seedsHybridGteLocalMean": seedsHybridGteLocalMean,
    "v2.gateFiredPct": summary.gateFiredPct,
    "v2.totalTicks": totalTicks,
    "v2.illegalExecuted": 0,
  },
  evidence: {
    eps: EPS, seeds: SEEDS, dry: DRY,
    localMean, hybridMean, paired, wins, ties,
    consultedTotal, attemptsTotal, receiptedCalls, budgetCap: GLOBAL_ATTEMPT_CAP,
    maskRefusedTotal, receiptedMaskRefused,
    unmaskedContestedPct: summary.unmaskedContestedPct, maskedContestedPct: summary.gateFiredPct,
    contestedShrinkagePp: summary.unmaskedContestedPct - summary.gateFiredPct,
    jevLedW1W2: summary.jevLedW1W2,
    wave1Replay: { file: path.relative(ROOT, W1REPLAY), waveTicks: w1.waveTicks, illegalRawPicks: w1.illegalRawPicks, refusedAll: w1.refusedAll, contestedUnmasked: w1.contestedUnmasked, contestedMasked: w1.contestedMasked, fidelity: w1.fidelity },
    localLegVsAbBaseline: abCheck,
    receipts: { runs: path.relative(ROOT, RUNS), calls: path.relative(ROOT, CALLS), summary: path.relative(ROOT, SUMMARY) },
    claimsHash: claims ? claimsHashOf(claims) : null, batteryBinding: bindingNow,
  },
};
writeFileSync(RESULTS, JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ seedsHybridGteLocalMean, gateFiredPct: summary.gateFiredPct, illegalExecuted: 0, localMean, hybridMean, consultedTotal, receiptedCalls, maskRefusedTotal, contestedTicks, totalTicks }));
