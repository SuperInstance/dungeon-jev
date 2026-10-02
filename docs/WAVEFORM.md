# WAVEFORM.md — the JEV waveform player: mechanism, findings, honest failures

Wave 73, lane c. Repo `SuperInstance/dungeon-jev`. Pre-registration seal
`6b4f803e…` pushed **before any model call and before the A/B** (commit
`ffe7616`), scored afterwards by the fleet primitive `preregister@1` from
receipts only.

## 1. The mechanism (what was actually built)

**The worksheet quilt.** Each tick the player decision is decomposed into
typed game-logic cells — each cell a TYPE-SAFE input or output:

| cell | type | seat |
|---|---|---|
| `threat-level` | number 0-3 (from monster dx/dy/kind) | local — rules, free |
| `loot-pull` | number 0-3 | local |
| `hp-pressure` | number 0-3 | local |
| `corridor-freedom` | number 0-3 | local |
| `exit-pull` | number 0-3 | local |
| `verdict` | enum `up/down/left/right/wait` | **the soft joint — JEV** |

Facts local, verdict joint (the fleet's §5b law). The worksheet is literally
what the JEV call reads (`state`, with the ASCII board + typed cells) and
writes (the verdict cell).

**The waveform / superposition.** Per decision the player asks JEV a `choice`
question over all 5 actions. JEV returns a full probability vector — the
superposed state — and the player collapses it (argmax, tiebreak = fixed
action order). The ENTIRE wave (all 5 probabilities + the local percepts +
gap, entropy, sharp/flat flag at ε=0.15) is receipted per tick into
`receipts/waveform.jsonl`. When the pre-committed consult cap is hit
(6 + 5 ticks over seeds 1, 2 — fixed in advance, no selection), the local
rule takes over and the episode still completes: **the game continues
without JEV** (`class:"local-collapse"` rows).

**JEV as the weight-tuner.** After the scripted baseline (seeds 1-8, old
weights, zero calls), JEV is fed the aggregated waveform + score summaries
and asked — via five `score` questions on a 0-3 legend — to PROPOSE NEW CELL
WEIGHTS for the local rule cells: a typed patch to the worksheet
(`receipts/weights-jev.json`). The A/B then re-runs seeds 1-8 with the patch
baked into the script: fresh runs, **zero model calls**.

**Core provenance.** `GET /repos/SuperInstance/quilt-dungeons` → 404 at lane
start. Nothing to import; `src/dungeon.js` vendors a minimal deterministic
core ON the quilt-dungeons contract, marked **VENDORED-PENDING-MERGE**.

## 2. The verdicts (all sealed pre-run; scored post-run)

| claim | sealed threshold | measured | verdict |
|---|---|---|---|
| **P1** JEV-weighted script beats baseline on ≥5/8 seeds | `ab.seedsJevStrictlyBetter ≥ 5` | **1** (ties 6, loss 1; mean old 6.25 vs jev 5.00) | **FAIL** |
| **P2** ≤35% of ticks need the model seat | `waveform.modelNeededPct ≤ 35` | **45.45%** (5/11 sharp) | **FAIL** |
| **P3** entropy anti-correlates with danger (rho ≤ −0.40) | `waveform.spearmanEntropyVsDanger ≤ −0.40` | **−0.061** | **FAIL** |

## 3. The novel-JEV findings (the part worth keeping)

1. **The distribution is real and cheap.** One JEV call returns a calibrated,
   full 5-action wave in ~200-300 ms (12/12 HTTP 200; zero retries needed).
   The superposition is a first-class artifact: receiptable, rankable,
   entropy-scorable — no sampling, no self-consistency tax.
2. **The greeter law does NOT transfer to a dense-danger dungeon — and the
   way it fails is informative.** In the greeter domain most moments were
   routine; here 45% of ticks are contested (sharp wave). A dungeon tick is
   a *forced* decision: monsters move every tick, so almost every tick has a
   real fork. Domain structure, not model quality, decides the
   model-needed fraction.
3. **Entropy was the wrong lens; the gap was right.** P3's entropy
   operationalization found nothing (rho −0.06), but the **top-2 gap
   correlates with danger at rho +0.415** (receipted secondary):
   the wave *does* sharpen where threats near — a 2-way flee/fight contest
   with residual noise on the 3 other actions keeps entropy high while the
   gap opens. Pre-registering gap-vs-danger (not entropy-vs-danger) is the
   corrected instrument for the next lane.
4. **JEV-as-tuner validated the basin instead of moving it.** Asked to
   propose weights from waveform + score summaries, JEV returned a
   near-identical vector (old 2/1/2/1/1 → jev 2/1.09/2.02/1.26/1.14 on the
   0-3 legend). Two readings, both useful: (a) it *agreed* with the authored
   weights — a cheap sanity oracle for player-logic constants; (b) it did
   not find an improvement — tuning from aggregate summaries without
   episode-level counterfactuals is too coarse.
5. **The score landscape is chaotic; A/B needs more seeds than feels
   necessary.** An ε weight change flipped seed 1 from 20 → 0 (different
   argmax early → death instead of 2 loots). On 8 seeds, small weight deltas
   drown in trajectory chaos: 6/8 ties, 1 win, 1 loss. Any future weight A/B
   needs either score-robust metrics (loot rate, survival length) or far
   more seeds.
6. **The collapsed wave plays worse than the local rule in this dungeon.**
   JEV-led episodes scored 0 and 0 (one death at tick 10, one 40-tick
   wander) vs local mean 6.25; **18.2% of JEV argmax picks were illegal**
   (into walls — e.g. W1 t0 `right` at p=0.40 from the corner start). The
   model reads the worksheet's numbers, but the wall geometry needs to be a
   typed cell (a *legality mask*), not prose: the obvious next worksheet
   patch — pass legal-action flags as typed inputs, or renormalize the wave
   over legal actions before collapse.

## 4. Honest failures (receipted, not smoothed)

- **Token misparse (ledger defect, row 11 of `receipts/model-calls.jsonl`):**
  the wave-tick leg parsed `usage.input`/`usage.output`; JEV's actual shape
  is `usage.input_tokens`/`usage.output_tokens` (toolkit README). Responses
  were not stored raw, so those 11 calls' token counts are unrecoverable —
  left null, defect receipted in-ledger, parser fixed before the tuner call.
  No re-run (double-spend refused).
- **All three pre-registered claims FAILED.** Sealed `6b4f803e…` before any
  run; scored from receipts; no threshold surgery, no post-hoc metric
  swaps. The FAILs are the finding.
- **First `preregister score` run returned PENDING×3** — this lane wrote
  flat dotted metric keys into results; the scorer resolves dotted paths
  *into* `results.metrics`. Results-format fix only (claims untouched — the
  seal re-verified); scorer behavior is contract-correct, now documented in
  `tools/build-results.mjs`.
- **Two engine-design iterations happened BEFORE the seal** (equal-speed
  chaser was unescapable → chaser moves every other tick; an arg-parser bug
  made `--seeds 1,2` run the default 8 — fixed and determinism re-verified
  byte-identical). Both pre-data; the engine was frozen at the seal commit.

## 5. Provenance checks

- **Replay verification:** every ledger row re-derives from
  `genDungeon(seed)` + receipted actions with **zero damage/hp/tick
  mismatches** (`receipts/waveform-analysis.json → replay.mismatches: []`)
  — the waveform ledger is replayable, not just recorded.
- **Engine determinism:** two identical scripted runs are byte-identical.
- **Model budget:** 12/14 typesafe calls (11 wave-tick + 1 tuner), 0/4
  deepinfra fallbacks, every attempt receipted (provider, model, purpose,
  tokens, latency, http). One transport-free lane: 12/12 HTTP 200.
- **Claims integrity:** `preregister verify` re-hash matches the seal at
  scoring time.

## 6. Next-lane suggestions (from this lane's instruments)

- Legal-action mask as a typed worksheet cell; renormalize the wave over
  legal actions before collapse (kills the 18% illegal-pick failure).
- Pre-register gap-vs-danger (rho ≥ +0.40) — the corrected P3.
- Weight A/B on score-robust metrics or ≥32 seeds (chaos floor).
- Waveform-conditioned seats: hand the model only the SHARP ticks and let
  the local rule own the flat ones — measure score delta of the *split*,
  which is the greeter law's real test in a dungeon.
