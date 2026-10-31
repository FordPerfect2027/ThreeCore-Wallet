import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { newReportFixtures } from './helpers/rehearsal-report-fixtures.js';
import { rehearsalExampleV2 } from '../src/operation-rehearsal-examples.js';
import { reportRehearsalOverview } from '../src/operation-rehearsal-overview.js';
import { compareRehearsalWorkspaces } from '../src/operation-rehearsal-comparison.js';
import { compareRehearsalScenario } from '../src/operation-rehearsal-scenario.js';
import { reportRehearsalScenarioSet, REHEARSAL_SCENARIO_SET_SCHEMA } from '../src/operation-rehearsal-scenario-set.js';
import { REHEARSAL_WORKSPACE_SCHEMA } from '../src/operation-rehearsal-workspace.js';
import { reviewRehearsalReport, encodeRehearsalReviewEvidence, decodeRehearsalReviewEvidence,
  reviewRehearsalEvidence, REHEARSAL_REVIEW_EVIDENCE_LIMIT } from '../src/operation-rehearsal-report-review.js';
const options = { subtle: webcrypto.subtle };
const ledger = rehearsalExampleV2();
const workspace = { schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true, activeAgent: 'DAT', ledgers: [ledger] };
const set = { schema: REHEARSAL_SCENARIO_SET_SCHEMA, simulationOnly: true, cases: [{ id: 'dat', label: 'DAT', before: ledger, after: ledger }] };
const fixtures = newReportFixtures();
const reports = [reportRehearsalOverview(workspace), compareRehearsalWorkspaces(workspace, workspace),
  compareRehearsalScenario(ledger, ledger), reportRehearsalScenarioSet(set), fixtures.matching, fixtures.filtered];
const source = ' \r\n' + JSON.stringify(reports[0], null, 2).replaceAll('\n', '\r\n') + '\r\n';
const make = async (text = source, extra = {}) => encodeRehearsalReviewEvidence(await reviewRehearsalReport(text, { ...options, ...extra }));
const review = text => reviewRehearsalEvidence(text, options);
const mutate = async fn => { const value = JSON.parse(await make()); fn(value); return JSON.stringify(value); };

for (const report of reports) test('evidence round trip recomputes ' + report.schema, async () => {
  const text = JSON.stringify(report), encoded = await make(text), result = await review(encoded);
  assert.equal(decodeRehearsalReviewEvidence(encoded).sourceText, text);
  assert.equal(result.matchesReceipt, true); assert.equal(result.reportReview.matchesRecomputation, true);
  assert.equal(result.reportReview.sha256, createHash('sha256').update(text).digest('hex'));
  assert.equal(result.sourceVerified, false); assert.equal(result.authorizesExecution, false);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.reportReview));
});
test('evidence preserves exact CRLF source and can be regenerated from the recomputed receipt', async () => {
  const encoded = await make(), result = await review(encoded);
  assert.equal(decodeRehearsalReviewEvidence(encoded).sourceText, source);
  assert.equal(encodeRehearsalReviewEvidence(result.reportReview), encoded);
  assert.equal(result.reportReview.byteLength, Buffer.byteLength(source));
});
test('encoder rejects invented or deserialized receipts and never evaluates their accessors', async () => {
  let reads = 0; const foreign = { get schema() { reads++; throw Error('private marker'); } };
  for (const value of [null, undefined, 1, foreign, JSON.parse(await make()).receipt])
    assert.throws(() => encodeRehearsalReviewEvidence(value), { code: 'UNRECOGNIZED_REVIEW_RECEIPT' });
  assert.equal(reads, 0);
});
test('source whitespace change is visible even when the recalculation still agrees', async () => {
  const result = await review(await mutate(data => { data.sourceText += '\n'; }));
  assert.equal(result.matchesReceipt, false); assert.equal(result.reportReview.matchesRecomputation, true);
  assert.ok(result.differences.some(d => d.path === '/sha256'));
  assert.ok(result.differences.some(d => d.path === '/byteLength'));
});
test('changed source calculation and a forged receipt cannot hide a discrepancy', async () => {
  const result = await review(await mutate(data => {
    const input = JSON.parse(data.sourceText); input.rows[0].recordCount = 999;
    data.sourceText = JSON.stringify(input); data.receipt.sha256 = createHash('sha256').update(data.sourceText).digest('hex');
    data.receipt.byteLength = Buffer.byteLength(data.sourceText);
  }));
  assert.equal(result.matchesReceipt, false); assert.equal(result.reportReview.matchesRecomputation, false);
});
test('a faithfully recorded calculation discrepancy stays a discrepancy', async () => {
  const data = JSON.parse(source); data.rows[0].recordCount = 999;
  const result = await review(await make(JSON.stringify(data)));
  assert.equal(result.matchesReceipt, true); assert.equal(result.reportReview.matchesRecomputation, false);
});
test('a faithfully recorded wrong expected hash stays a hash discrepancy', async () => {
  const result = await review(await make(source, { expectedSha256: '0'.repeat(64) }));
  assert.equal(result.matchesReceipt, true); assert.equal(result.reportReview.checksumMatches, false);
});
test('expected-outcome discrepancy remains separate from receipt and report fidelity', async () => {
  const result = await review(await make(JSON.stringify(fixtures.differing)));
  assert.equal(result.matchesReceipt, true); assert.equal(result.reportReview.matchesRecomputation, true);
  assert.equal(result.reportReview.reportOutcome.allMatched, false);
});
test('receipt authority flags, omission and type changes are compared rather than trusted', async () => {
  const result = await review(await mutate(data => {
    data.receipt.sourceVerified = true; data.receipt.authorizesExecution = true;
    delete data.receipt.scope; data.receipt.byteLength = '123';
  }));
  assert.equal(result.matchesReceipt, false); assert.equal(result.differenceCount, 4);
  assert.equal(result.reportReview.sourceVerified, false); assert.equal(result.reportReview.authorizesExecution, false);
});
test('receipt differences are bounded and JSON-pointer escaped', async () => {
  const result = await review(await mutate(data => { for (let i = 0; i < 70; i++) data.receipt['x/' + i + '~'] = i; }));
  assert.equal(result.differenceCount, 70); assert.equal(result.differences.length, 40); assert.equal(result.differencesTruncated, true);
  assert.ok(result.differences[0].path.includes('~1')); assert.ok(result.differences[0].path.endsWith('~0'));
});
test('reordered receipt object keys remain equivalent', async () => {
  const result = await review(await mutate(data => { data.receipt = Object.fromEntries(Object.entries(data.receipt).reverse()); }));
  assert.equal(result.matchesReceipt, true);
});
test('untrusted envelope flags, extra fields, wrong hash and missing receipt are rejected', async () => {
  for (const change of [d => { d.sourceVerified = true; }, d => { d.authorizesExecution = true; },
    d => { d.simulationOnly = false; }, d => { d.extra = true; }, d => { delete d.receipt; },
    d => { d.receipt.expectedSha256 = 'bad'; }, d => { delete d.receipt.expectedSha256; },
    d => { d.receipt.schema = 'unknown'; }, d => { d.sourceText = {}; }])
    await assert.rejects(review(await mutate(change)), { code: 'INVALID_REVIEW_EVIDENCE' });
});
test('nested, duplicate-key, unsafe and oversized envelopes fail before hashing', async () => {
  let digests = 0;
  for (const text of ['', '{', '{"schema":1,"schema":2}', '{"__proto__":{}}',
    '['.repeat(29) + '0' + ']'.repeat(29), ' '.repeat(REHEARSAL_REVIEW_EVIDENCE_LIMIT + 1),
    await mutate(d => { d.receipt.extra = 'x'.repeat(128 * 1024); }), await mutate(d => { d.sourceText = ' '.repeat(2097153); })])
    await assert.rejects(reviewRehearsalEvidence(text, { subtle: { digest() { digests++; } } }), { code: 'INVALID_REVIEW_EVIDENCE' });
  assert.equal(digests, 0);
});
test('hash failures and cancellation produce no completed evidence review', async () => {
  const encoded = await make();
  await assert.rejects(reviewRehearsalEvidence(encoded, { subtle: null }), { code: 'REVIEW_HASH_UNAVAILABLE' });
  const control = new AbortController(); control.abort();
  await assert.rejects(reviewRehearsalEvidence(encoded, { ...options, signal: control.signal }), { code: 'REVIEW_HASH_UNAVAILABLE' });
});
test('self-consistent input changes cannot authenticate an author or actual assets', async () => {
  const changed = structuredClone(workspace); changed.ledgers[0].account = '0x' + '9'.repeat(40);
  const result = await review(await make(JSON.stringify(reportRehearsalOverview(changed))));
  assert.equal(result.matchesReceipt, true); assert.equal(result.sourceVerified, false); assert.equal(result.reportReview.sourceVerified, false);
});
