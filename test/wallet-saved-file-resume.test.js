import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inspectWalletSavedFileBatch, inspectWalletSavedTextBatch, resumeWalletSavedFileBatch, canResumeWalletSavedFileBatch, encodeWalletSavedTextBatch, encodeWalletSavedTextBatchCsv, walletSavedTextBatchManifest, compareWalletSavedTextBatches, encodeWalletSavedBatchComparison, reviewWalletSavedBatchComparison } from '../src/file-read-status.js';
const text = readFileSync(new URL('../docs/evidence/2026-11-01-wallet-file-batch/first.json', import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const input = ['first.json', 'second.json', 'third.json'].map(name => ({name, byteLength: Buffer.byteLength(text)}));
async function interrupted(options = {}, reader = () => text) {
  const abort = new AbortController();
  return inspectWalletSavedFileBatch(input, reader, { ...options, signal: abort.signal, onProgress: p => { if (p.checked === 1) abort.abort(); } });
}
test('continuation retains the exact checked prefix and reads only the remaining source indices', async () => {
  const previous = await interrupted(), saved = encodeWalletSavedTextBatch(previous), reads = [], progress = [];
  const result = await resumeWalletSavedFileBatch(previous, i => { reads.push(i); return text; }, { onProgress: p => progress.push(p.checked) });
  assert.deepEqual(reads, [1, 2]); assert.deepEqual(progress, [1, 2, 3]); assert.equal(result.files[0], previous.files[0]);
  assert.equal(result.allOriginalsValidated, true); assert.equal(result.complete, true); assert.equal(result.schema, 'threecore.wallet-saved-browser-batch.v4');
  assert.deepEqual(result.continuation, {sequence: 1, retainedChecks: 1, previousPhase: 'cancelled', previousBatchSha256: hash(saved)});
  assert.equal(encodeWalletSavedTextBatch(previous), saved); assert.equal(result.atomicSnapshot, false); assert.equal(canResumeWalletSavedFileBatch(result), false);
  assert.equal(walletSavedTextBatchManifest(result), input.map(row => hash(text) + '  ' + row.name).join('\n') + '\n');
  const csv = encodeWalletSavedTextBatchCsv(result); assert.match(csv, /"retainedChecks"/); assert.match(csv, new RegExp(hash(saved))); assert.doesNotMatch(csv, /undefined|"null"/);
});
test('continuation cannot accept uploaded, forged, text-only or already-complete receipts', async () => {
  const previous = await interrupted(), complete = await inspectWalletSavedFileBatch(input, () => text), abort = new AbortController(); abort.abort();
  const textOnly = await inspectWalletSavedTextBatch(input.map(row => ({name: row.name, text})), {signal: abort.signal});
  for (const value of [null, {}, JSON.parse(encodeWalletSavedTextBatch(previous)), {...previous}, textOnly, complete]) {
    assert.equal(canResumeWalletSavedFileBatch(value), false); let reads = 0;
    await assert.rejects(resumeWalletSavedFileBatch(value, () => { reads++; return text; }), {code: 'FILE_BATCH_RESUME'}); assert.equal(reads, 0);
  }
});
test('repeated cancellation preserves successively longer prefixes with separate receipt hashes', async () => {
  const previous = await interrupted(), abort = new AbortController(), reads = [];
  const second = await resumeWalletSavedFileBatch(previous, i => { reads.push(i); return text; }, {signal: abort.signal, onProgress: p => { if (p.checked === 2) abort.abort(); }});
  assert.deepEqual(reads, [1]); assert.equal(second.summary.pending, 1); assert.equal(second.phase, 'cancelled'); assert.equal(canResumeWalletSavedFileBatch(second), true);
  const third = await resumeWalletSavedFileBatch(second, i => { reads.push(i); return text; });
  assert.deepEqual(reads, [1, 2]); assert.equal(third.continuation.sequence, 2); assert.equal(third.continuation.retainedChecks, 2); assert.equal(third.continuation.previousBatchSha256, hash(encodeWalletSavedTextBatch(second))); assert.equal(third.files[1], second.files[1]);
});
test('a resumed source is still compared with its original manifest and callers cannot replace that reference', async () => {
  const manifestText = input.map(row => hash(text) + '  ' + row.name).join('\n') + '\n', previous = await interrupted({manifestText});
  const changed = text.replace(/\n$/, ' '); assert.notEqual(changed, text); assert.equal(Buffer.byteLength(changed), Buffer.byteLength(text));
  const result = await resumeWalletSavedFileBatch(previous, i => i === 1 ? changed : text);
  assert.equal(result.files[1].status, 'checksum-mismatch'); assert.equal(result.reference.text, manifestText); assert.equal(result.allExternalChecksumsMatch, false); assert.equal(result.summary.checksumsCompared, 3);
  await assert.rejects(resumeWalletSavedFileBatch(previous, () => text, {manifestText: ''}), {code: 'FILE_BATCH_OPTIONS'});
});
test('completed read failures are retained as failures, with unknown bytes explicit in resumed CSV', async () => {
  const previous = await interrupted({}, () => { throw Object.assign(Error('synthetic'), {code: 'FILE_ENCODING'}); });
  const result = await resumeWalletSavedFileBatch(previous, () => text);
  assert.equal(result.files[0], previous.files[0]); assert.equal(result.summary.sourceUnavailable, 1); assert.equal(result.summary.validatedOriginals, 2); assert.equal(result.allOriginalsValidated, false); assert.equal(result.complete, true);
  const csv = encodeWalletSavedTextBatchCsv(result); assert.match(csv, /"reportedByteLength"/); assert.doesNotMatch(csv, /undefined|"null"/);
  assert.throws(() => walletSavedTextBatchManifest(result), {code: 'FILE_BATCH_HASHES_INCOMPLETE'});
});
test('pre-cancelled continuation retains its prefix without reading or inventing a previous-receipt hash', async () => {
  const previous = await interrupted(), abort = new AbortController(); abort.abort(); let reads = 0;
  const result = await resumeWalletSavedFileBatch(previous, () => { reads++; return text; }, {signal: abort.signal});
  assert.equal(reads, 0); assert.equal(result.phase, 'cancelled'); assert.equal(result.continuation.previousBatchSha256, null); assert.equal(result.files[0], previous.files[0]); assert.equal(result.summary.checked, 1);
});
test('receipt-hash failure cannot start later sources or consume the previous continuation', async () => {
  const previous = await interrupted(); let reads = 0;
  await assert.rejects(resumeWalletSavedFileBatch(previous, () => { reads++; return text; }, {subtle: {digest: async () => { throw Error('synthetic'); }}}), {code: 'FILE_BATCH_RESUME_HASH_UNAVAILABLE'});
  assert.equal(reads, 0); assert.equal(canResumeWalletSavedFileBatch(previous), true);
});
test('overall continuation deadline retains earlier checked rows while an unfinished reader stays pending', async () => {
  const previous = await interrupted(); let reads = 0, reject;
  const result = await resumeWalletSavedFileBatch(previous, () => { reads++; return new Promise((_, no) => { reject = no; }); }, {timeoutMs: 50});
  assert.equal(reads, 1); assert.equal(result.phase, 'timed-out'); assert.equal(result.summary.checked, 1); assert.equal(result.summary.pending, 2);
  reject(Error('late synthetic source')); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(canResumeWalletSavedFileBatch(result), true);
});
test('saved before/after comparison binds the continuation lineage and rejects an altered retained-count claim', async () => {
  const before = await interrupted(), after = await resumeWalletSavedFileBatch(before, () => text);
  const saved = encodeWalletSavedBatchComparison(compareWalletSavedTextBatches(before, after));
  const checked = await reviewWalletSavedBatchComparison(before, after, saved);
  assert.equal(checked.matchesRecomputation, true); assert.equal(checked.bothBatchesComplete, false);
  const altered = JSON.parse(saved); altered.after.continuation.retainedChecks = 3;
  const refused = await reviewWalletSavedBatchComparison(before, after, JSON.stringify(altered));
  assert.equal(refused.matchesRecomputation, false); assert.equal(refused.afterBindingMatches, false);
});
