import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { newReportFixtures } from './helpers/rehearsal-report-fixtures.js';
import { describeRehearsalFileTarget, decodeRehearsalForPanel, describeFileReadError } from '../src/file-read-status.js';
import { reviewRehearsalReport, encodeRehearsalReviewEvidence, reviewRehearsalEvidence } from '../src/operation-rehearsal-report-review.js';
const source = JSON.stringify(newReportFixtures().filtered, null, 2);
const evidence = encodeRehearsalReviewEvidence(await reviewRehearsalReport(source, { subtle: webcrypto.subtle }));
test('actual evidence with a long embedded source points to its dedicated read-only destination', () => {
  assert.ok(source.length > 4096);
  for (const target of ['record', 'workspace', 'session', 'cases', 'expectations', 'report'])
    assert.match(describeRehearsalFileTarget(evidence, target), /まとめて保存した証拠を再確認する/);
  assert.equal(describeRehearsalFileTarget(evidence, 'evidence'), null);
});
test('ordinary reports selected as evidence point to ordinary recomputation', () => {
  assert.match(describeRehearsalFileTarget(source, 'evidence'), /保存した資料を再計算して確認/);
});
test('a verification result requests the original evidence file', async () => {
  const text = JSON.stringify(await reviewRehearsalEvidence(evidence, { subtle: webcrypto.subtle }));
  assert.match(describeRehearsalFileTarget(text, 'report'), /元の証拠ファイル/);
  assert.match(describeRehearsalFileTarget(text, 'evidence'), /元の証拠ファイル/);
});
test('guidance is not content validation or automatic restoration', () => {
  const incomplete = JSON.stringify({ schema: JSON.parse(evidence).schema, simulationOnly: true });
  assert.match(describeRehearsalFileTarget(incomplete, 'session'), /証拠/);
  const saved = {};
  assert.equal(decodeRehearsalForPanel(incomplete, 'session', () => saved), saved);
  assert.throws(() => decodeRehearsalForPanel(incomplete, 'session', () => { throw Error('private data'); }), error => {
    assert.match(describeFileReadError(error, '2 MiB'), /証拠/); assert.doesNotMatch(describeFileReadError(error, '2 MiB'), /private/); return true;
  });
});
test('ambiguous, oversized and unsafe evidence declarations receive no hint', () => {
  for (const text of [' '.repeat(6291457), '{"schema":"threecore.operation-rehearsal-review-evidence.v1","schema":"x","simulationOnly":true}',
    '{"schema":"threecore.operation-rehearsal-review-evidence.v1","simulationOnly":true,"__proto__":{}}'])
    assert.equal(describeRehearsalFileTarget(text, 'session'), null);
});
