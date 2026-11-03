import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReadProposalFees } from '../scripts/read-proposal-fees.js';
import { feeReaderFixture, feeRpcFixture } from './helpers/proposal-fee-rpc-fixture.js';
import { readProposalFeeReview } from '../src/proposal-fee-reader.js';
import { inspectProposalFeeReviewFile } from '../src/proposal-fee-review.js';

async function run(args, options) { let stdout = '', stderr = ''; const code = await runReadProposalFees(args, { write: s => { stdout += s; } }, { write: s => { stderr += s; } }, options); return { code, stdout, stderr }; }
test('CLI validates source and returns a complete replayable review without altering original file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'threecore-fee-cli-')), path = join(dir, 'plan.json'), bad = join(dir, 'bad.json');
  t.after(async () => { await unlink(path); await unlink(bad); await rmdir(dir); });
  const f = await feeReaderFixture(); await writeFile(path, f.prepared.text); await writeFile(bad, Buffer.from([0xc3, 0x28]));
  const result = await run(['read', path], { read: (text, options) => readProposalFeeReview(text, { ...options, fetchImpl: feeRpcFixture(f).fetchImpl }) });
  assert.equal(result.code, 0, result.stderr); const record = await inspectProposalFeeReviewFile(result.stdout); assert.equal(record.files.simulationPlanFile, f.prepared.text);
  let calls = 0; const invalid = await run(['read', bad], { read: () => { calls++; } }); assert.equal(invalid.code, 1); assert.equal(calls, 0); assert.match(invalid.stderr, /FEE_FILE_ENCODING/);
  const blocked = await run(['read', path], { read: async () => ({ review: { text: 'blocked', result: { checksSatisfied: false } } }) }); assert.equal(blocked.code, 2);
});

test('CLI bounds retain inputs and distinguish unknown components from failure without publishing remote error text', async () => {
  let received;
  for (const failures of [[], ['FEE_L1_UNAVAILABLE']]) {
    const result = await run(['bounds', '400', '500000', '123'], { bounds: async input => { received = input; return { failures, transactionSimulated: false }; } });
    assert.equal(result.code, failures.length ? 2 : 0); assert.equal(JSON.parse(result.stdout).transactionSimulated, false);
    assert.deepEqual(received, { blockNumber: '123', blockHash: null, unsignedTransactionBytes: 400, gasLimit: '500000' });
  }
  for (const args of [[], ['send'], ['bounds', '01', '1'], ['read', '--secret'], ['bounds', '400', '1', '2', '3']]) assert.equal((await run(args)).code, 1);
  const failed = await run(['bounds', '400', '500000'], { bounds: async () => { throw Error('untrusted remote detail'); } }); assert.equal(failed.code, 1); assert(!failed.stderr.includes('untrusted'));
  assert.equal((await run(['--help'])).code, 0);
});
