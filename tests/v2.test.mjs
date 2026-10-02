// v2 tests — the mask wiring, the wave instrument, the gate, and the mask
// law (P3) — all ZERO network, ZERO model calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { genDungeon, step, episodeOver, ACTIONS, DELTA, walkable } from '../src/dungeon.js';
import { scriptPick } from '../src/players.js';
import { legalActions, perceptWindow, gameMask } from '../src/v2-mask.js';
import { localWave, maskWave, top2Gap, collapseMasked, gateFires, assertLegal, isIllegal, EPS } from '../src/v2-wave.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const oldW = JSON.parse(readFileSync(path.join(root, 'receipts/weights-old.json'), 'utf8')).weights;

test('vendored mask == engine walkability, seeds 1-8, every tick of local-rule walks', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    let g = genDungeon(seed);
    for (let i = 0; i < 200 && !episodeOver(g); i++) {
      const mask = gameMask(g);
      const truth = ACTIONS.filter(a => {
        if (a === 'wait') return true;
        const [dx, dy] = DELTA[a];
        return walkable(g, g.player[0] + dx, g.player[1] + dy);
      });
      assert.deepEqual(mask, truth, `seed ${seed} tick ${g.tick}`);
      // upstream window shape: 3x3, '@' center, '#' padding OOB
      const win = perceptWindow(g, 1);
      assert.equal(win.local.length, 3);
      assert.equal(win.local[1][1], '@');
      const pick = scriptPick(g, oldW).action;
      step(g, pick);
    }
  }
});

test('the mask refuses an illegal model pick — never executed, a legal pick runs instead', () => {
  const g = genDungeon(1);
  const mask = gameMask(g);
  const illegal = ACTIONS.find(a => !mask.includes(a) && a !== 'wait');
  assert.ok(illegal, 'seed 1 opens with at least one illegal cardinal (wall or edge)');

  // a rogue model wave that puts ALL its mass on the illegal action:
  const rogue = Object.fromEntries(ACTIONS.map(a => [a, a === illegal ? 1 : 0]));
  const masked = maskWave(rogue, mask);            // rogue mass wiped — the mask wins
  assert.ok(masked[illegal] === 0, 'illegal action carries zero masked probability');
  const pick = collapseMasked(masked, mask);       // ACTIONS-order tiebreak INSIDE the mask
  assert.ok(mask.includes(pick), 'executed pick is legal');
  assert.notEqual(pick, illegal, 'the rogue pick was never executed');

  // a lawful wave keeps its argmax through the mask (the mask only removes):
  const lawful = Object.fromEntries(ACTIONS.map(a => [a, a === mask[0] ? 0.6 : 0.1]));
  assert.equal(collapseMasked(maskWave(lawful, mask), mask), mask[0]);
});

test('gate: contested strictly below eps; boundary 0.15 is settled', () => {
  assert.equal(gateFires(0.149), true);
  assert.equal(gateFires(EPS), false, 'gap == eps is settled (strict <)');
  assert.equal(gateFires(0.9), false);
  const g = genDungeon(2);
  const mask = gameMask(g);
  const flat = Object.fromEntries(ACTIONS.map(a => [a, 0.2]));
  assert.ok(top2Gap(maskWave(flat, mask), mask) < 1e-12, 'flat wave: zero masked gap');
});

test('mask law assert: rejects an unwalkable non-wait action, tolerates wait and legal moves', () => {
  const g = genDungeon(1);
  assert.doesNotThrow(() => assertLegal(g, 'wait'));
  const illegal = ACTIONS.find(a => !gameMask(g).includes(a) && a !== 'wait');
  assert.throws(() => assertLegal(g, illegal), /E_MASK_LAW_VIOLATED/);
  assert.equal(isIllegal(g, illegal), true);
  assert.equal(isIllegal(g, 'wait'), false);
  const legal = gameMask(g).find(a => a !== 'wait');
  assert.doesNotThrow(() => assertLegal(g, legal));
});

test('wave instrument: sealed T=1 softmax is a distribution on every tick of seed 3', () => {
  let g = genDungeon(3);
  for (let i = 0; i < 10 && !episodeOver(g); i++) {
    const { scores, probs } = localWave(g, oldW);
    const Z = ACTIONS.reduce((s, a) => s + probs[a], 0);
    assert.ok(Math.abs(Z - 1) < 1e-12, 'probabilities sum to 1');
    for (const a of ACTIONS) assert.ok(Number.isFinite(probs[a]) && probs[a] > 0 && probs[a] <= 1);
    assert.ok(Object.values(scores).every(Number.isFinite));
    step(g, scriptPick(g, oldW).action);
  }
});

test('full dry hybrid on a held-out seed: zero calls, mask law holds end-to-end, receipts written', () => {
  const tmp = mkdtempSync(path.join(root, 'receipts', 'test-tmp-'));
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY; // even with no key at all, the game continues
  Object.assign(env, {
    V2_DRY: '1', V2_SEEDS: '9', V2_SEAT_CAP_SEED: '1',
    V2_CALLS: path.join(tmp, 'calls.jsonl'), V2_RUNS: path.join(tmp, 'runs.jsonl'),
    V2_SUMMARY: path.join(tmp, 'summary.json'), V2_RESULTS: path.join(tmp, 'results.json'),
    V2_W1REPLAY: path.join(tmp, 'w1.json'),
  });
  const out = execFileSync(process.execPath, [path.join(root, 'src/run-v2.mjs')], { env, encoding: 'utf8', cwd: root });
  assert.ok(existsSync(path.join(tmp, 'runs.jsonl')));
  const summary = JSON.parse(readFileSync(path.join(tmp, 'summary.json'), 'utf8'));
  assert.equal(summary.receiptedCalls, 0, 'zero typesafe calls in a dry run');
  assert.ok(summary.totalTicks > 0);

  // every hybrid row: mask present, executed action inside it, law held
  const rows = readFileSync(path.join(tmp, 'runs.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(JSON.parse);
  assert.ok(rows.some(r => r.leg === 'hybrid' && r.gate === 'contested'), 'the gate actually fired somewhere on seed 9 (instrument alive)');
  for (const r of rows.filter(r => r.leg === 'hybrid')) {
    assert.ok(r.mask.includes('wait'));
    assert.ok(r.mask.includes(r.action), `executed action ${r.action} inside the mask at tick ${r.tick}`);
    assert.equal(r.illegalSeen, false);
    if (r.modelRawPick != null) assert.ok(r.mask.includes(r.executedPick), 'seat pick legal');
  }
  assert.equal(summary.illegalExecuted, 0);
  assert.equal(summary.receiptedIllegal ?? 0, 0);
  assert.match(out, /illegalExecuted/);
  rmSync(tmp, { recursive: true, force: true });
});

test('the local leg is the frozen baseline: hybrid-leg-independent replay equals ab-results oldRuns', () => {
  const ab = JSON.parse(readFileSync(path.join(root, 'receipts/ab-results.json'), 'utf8'));
  for (const r of ab.oldRuns) {
    const g = genDungeon(r.seed);
    while (!episodeOver(g)) step(g, scriptPick(g, oldW).action);
    assert.equal(g.score, r.score, `seed ${r.seed}: local rule drifted from the wave-1 baseline receipt`);
  }
});
