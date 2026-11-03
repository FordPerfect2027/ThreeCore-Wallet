import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReadProposalState } from '../scripts/read-proposal-state.js';
import { stateFixture, stateRpcFixture } from './helpers/proposal-state-rpc-fixture.js';
import { readProposalStateReview } from '../src/proposal-state-reader.js';
const sink = () => ({ text: '', write(s) { this.text += s; } });
test('CLI read/verify exit codes distinguish recorded failure from acquisition errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'threecore-state-')), f = await stateFixture({ nowSeconds: Math.floor(Date.now() / 1000) - 1000 }), plan = join(dir, 'plan.json'); await writeFile(plan, f.prepared.text);
  const output = sink(), errors = sink(); let calls = 0;
  const read = text => { calls++; return readProposalStateReview(text, stateRpcFixture(f)); };
  assert.equal(await runReadProposalState(['read', plan], output, errors, { read }), 2); assert.equal(calls, 1); assert.equal(errors.text, '');
  const saved = join(dir, 'saved.json'); await writeFile(saved, output.text); const verify = sink(); assert.equal(await runReadProposalState(['verify', saved], verify, errors, { read }), 2); assert.equal(calls, 1); assert.equal(JSON.parse(verify.text).verified, true);
  for (const args of [[], ['read', '--bad'], ['verify', join(dir, 'missing')]]) assert.equal(await runReadProposalState(args, sink(), sink(), { read }), 1);
  await writeFile(join(dir, 'bad.json'), Buffer.from([0xc3, 0x28])); assert.equal(await runReadProposalState(['read', join(dir, 'bad.json')], sink(), sink(), { read }), 1); assert.equal(calls, 1);
});
