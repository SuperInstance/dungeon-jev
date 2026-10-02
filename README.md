# dungeon-jev — the JEV waveform player

SuperInstance fleet wave-73, lane c. Built on the **quilt-dungeons core contract**:
`GET /repos/SuperInstance/quilt-dungeons` → 404 at lane start (repo does not exist),
so `src/dungeon.js` **vendors a minimal deterministic core** marked
**VENDORED-PENDING-MERGE** — when quilt-dungeons lands, that file is the merge point.

## The worksheet quilt

Each tick, the player decision is decomposed into typed game-logic **cells** —
each cell a TYPE-SAFE input or output:

| cell | type | seat |
|---|---|---|
| `threat-level` | number 0-3 (from monster dx/dy/kind) | local (rules — free) |
| `loot-pull` | number 0-3 | local |
| `hp-pressure` | number 0-3 | local |
| `corridor-freedom` | number 0-3 | local |
| `exit-pull` | number 0-3 | local |
| `verdict` | enum up/down/left/right/wait | **the soft joint — the model** |

Facts local, verdict joint (the fleet's §5b law). The worksheet IS what the JEV
call reads (`state`) and writes (the verdict cell; later, a weights patch).

## The waveform / superposition (novel JEV experiment)

Per decision the player asks JEV for a **distribution over all 5 actions** (a
`choice` question; the returned probabilities are the superposed state), then
collapses it (argmax, tiebreak = fixed action order). The full wave — all 5
probabilities plus the local percepts — is receipted per tick into
`receipts/waveform.jsonl`. Post-run analysis hunts the finding: **what fraction
of ticks actually need the model?** Where the wave is flat (top-2 within ε),
a cheap local tiebreak collapses it for free; where it is sharp, the model's
pick stands. (The 71-c greeter law, now in a dungeon.)

## JEV as the weight-tuner (second novel use)

After the scripted runs, JEV is fed the aggregated waveform + score summaries
and asked to **PROPOSE NEW CELL WEIGHTS** for the local rule cells — a typed
patch to the worksheet (`receipts/weights-jev.json`). Then A/B on seeds 1-8:
old weights vs JEV weights, fresh runs, **zero model calls** (weights baked in;
the game continues without JEV).

## Honest bookkeeping

- Pre-registration via the fleet primitive (`preregister@1`): claims sealed and
  pushed BEFORE any run. See `receipts/prereg-claims.json` + `prereg-seal.json`.
- Every model attempt receipted: `receipts/model-calls.jsonl`
  (provider, model, purpose, tokens, latency, http — failures too).
- Model budget: ≤14 typesafe calls, ≤4 deepinfra fallbacks — enforced in code.

## Run order

```sh
node src/run-script.js --weights receipts/weights-old.json --seeds 1,2,3,4,5,6,7,8 --out receipts/baseline-weights.json
node src/run-wave.js        # 11 typesafe calls, receipted
node src/analyze.js
node src/tune.js            # 1 typesafe call, receipted
node src/ab.js              # 0 calls
node tools/build-results.mjs
# preregister score (fleet tool) -> receipts/prereg-verdict.json
```
