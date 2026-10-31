import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { webcrypto } from 'node:crypto';
import { newReportFixtures } from './helpers/rehearsal-report-fixtures.js';
import { reviewRehearsalReport, encodeRehearsalReviewEvidence, reviewRehearsalEvidence,
  REHEARSAL_REVIEW_EVIDENCE_LIMIT } from '../src/operation-rehearsal-report-review.js';
import { runRehearsalEvidenceReview } from '../scripts/verify-rehearsal-evidence.js';
const options = { subtle: webcrypto.subtle };
async function fixture(action) {
  const root = await realpath(tmpdir()), dir = await mkdtemp(join(root, 'threecore-evidence-cli-'));
  const file = join(dir, 'evidence.json');
  const source = JSON.stringify(newReportFixtures().filtered, null, 2) + '\n';
  const text = encodeRehearsalReviewEvidence(await reviewRehearsalReport(source, options));
  try { await writeFile(file, text); await action({ dir, file, source, text }); }
  finally {
    assert.equal(dirname(resolve(dir)), root); assert.ok(basename(dir).startsWith('threecore-evidence-cli-'));
    assert.equal(await realpath(dir), resolve(dir)); await rm(dir, { recursive: true });
  }
}
async function run(args) {
  let output = '', errors = '';
  const code = await runRehearsalEvidenceReview(args, { write: s => { output += s; } }, { write: s => { errors += s; } });
  return { code, output, errors };
}
test('offline evidence review matches the API and writes no files', () => fixture(async ({ dir, file, text }) => {
  const before = await readdir(dir), result = await run([file]);
  assert.equal(result.code, 0); assert.equal(result.errors, '');
  assert.deepEqual(JSON.parse(result.output), await reviewRehearsalEvidence(text, options));
  assert.equal(await readFile(file, 'utf8'), text); assert.deepEqual(await readdir(dir), before);
}));
test('an escaped package above two MiB retains a source within its independent two MiB limit', () => fixture(async ({ file, source }) => {
  const largeSource = source.padStart(2097152, '\t');
  const encoded = encodeRehearsalReviewEvidence(await reviewRehearsalReport(largeSource, options));
  assert.ok(Buffer.byteLength(encoded) > 2097152); assert.ok(Buffer.byteLength(encoded) < REHEARSAL_REVIEW_EVIDENCE_LIMIT);
  await writeFile(file, encoded); const result = await run([file]);
  assert.equal(result.code, 0); assert.equal(JSON.parse(result.output).reportReview.byteLength, 2097152);
  assert.equal(await readFile(file, 'utf8'), encoded);
}));
for (const kind of ['receipt', 'source', 'recorded-calculation', 'recorded-checksum'])
  test('offline ' + kind + ' discrepancy returns two with a complete result', () => fixture(async ({ file, source, text }) => {
    let value = JSON.parse(text);
    if (kind === 'receipt') value.receipt.sourceVerified = true;
    if (kind === 'source') value.sourceText += '\n';
    if (kind === 'recorded-calculation') {
      const report = JSON.parse(source); report.matchedRecords = 999;
      value = JSON.parse(encodeRehearsalReviewEvidence(await reviewRehearsalReport(JSON.stringify(report), options)));
    }
    if (kind === 'recorded-checksum') value = JSON.parse(encodeRehearsalReviewEvidence(await reviewRehearsalReport(source, { ...options, expectedSha256: '0'.repeat(64) })));
    const changed = JSON.stringify(value); await writeFile(file, changed);
    const result = await run([file]); assert.equal(result.code, 2); assert.equal(result.errors, '');
    assert.equal(JSON.parse(result.output).sourceVerified, false); assert.equal(await readFile(file, 'utf8'), changed);
  }));
test('faithfully recorded expectation mismatch remains visible without claiming report corruption', () => fixture(async ({ file }) => {
  const source = JSON.stringify(newReportFixtures().differing);
  await writeFile(file, encodeRehearsalReviewEvidence(await reviewRehearsalReport(source, options)));
  const result = await run([file]); assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.output).reportReview.reportOutcome.allMatched, false);
}));
for (const [name, content] of [['invalid JSON', '{'], ['invalid UTF-8', new Uint8Array([255])],
  ['BOM', new Uint8Array([239, 187, 191, 123, 125])], ['oversized', ' '.repeat(REHEARSAL_REVIEW_EVIDENCE_LIMIT + 1)],
  ['ordinary report', JSON.stringify(newReportFixtures().matching)]])
  test(name + ' fails without partial output or input modification', () => fixture(async ({ file }) => {
    await writeFile(file, content); const before = await readFile(file), result = await run([file]);
    assert.equal(result.code, 1); assert.equal(result.output, ''); assert.deepEqual(await readFile(file), before);
  }));
test('invalid arguments and unavailable paths fail without output', () => fixture(async ({ file, dir }) => {
  for (const args of [[], [file, '--sha256', '0'.repeat(64)], ['--help'], [dir], [join(dir, 'absent.json')], [null], [42]]) {
    const result = await run(args); assert.equal(result.code, 1); assert.equal(result.output, '');
  }
}));
