import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { newReportFixtures } from './helpers/rehearsal-report-fixtures.js';
import { reviewRehearsalReport, encodeRehearsalReviewReceipt, encodeRehearsalReviewEvidence, reviewRehearsalEvidence,
  pageReviewedRehearsalDifferences, pageRehearsalEvidenceReceiptDifferences } from '../src/operation-rehearsal-report-review.js';
const options = { subtle: webcrypto.subtle }, original = newReportFixtures().filtered;
const changed = structuredClone(original); for (let i = 0; i < 103; i++) changed['extra' + String(i).padStart(3, '0')] = i;
const text = JSON.stringify(changed), receipt = await reviewRehearsalReport(text, options);
const saved = JSON.parse(encodeRehearsalReviewEvidence(receipt));
for (let i = 0; i < 87; i++) saved.receipt['extra' + String(i).padStart(3, '0')] = i;
const verification = await reviewRehearsalEvidence(JSON.stringify(saved), options);
test('all report differences are inspectable in order without altering the receipt', () => {
  const before = encodeRehearsalReviewReceipt(receipt), pages = [0, 40, 80].map(offset => pageReviewedRehearsalDifferences(receipt, offset));
  assert.deepEqual(pages.map(p => p.differences.length), [40, 40, 23]);
  assert.ok(pages.every(p => p.totalDifferences === 103 && p.totalPages === 3));
  const paths = pages.flatMap(p => p.differences.map(d => d.path)); assert.equal(new Set(paths).size, 103);
  assert.deepEqual(paths, Array.from({ length: 103 }, (_, i) => '/extra' + String(i).padStart(3, '0')));
  assert.equal(encodeRehearsalReviewReceipt(receipt), before); assert.equal(receipt.differences.length, 40);
  assert.equal(pages[0].hasPrevious, false); assert.equal(pages[2].hasNext, false);
});
test('receipt difference pages use the bound original receipt, independently of source differences', () => {
  const pages = [0, 40, 80].map(offset => pageRehearsalEvidenceReceiptDifferences(verification, offset));
  assert.deepEqual(pages.map(p => p.differences.length), [40, 40, 7]);
  assert.ok(pages.every(p => p.totalDifferences === 87));
  assert.equal(new Set(pages.flatMap(p => p.differences.map(d => d.path))).size, 87);
  assert.equal(pageReviewedRehearsalDifferences(verification.reportReview).totalDifferences, 103);
});
for (const [name, get] of [['report', offset => pageReviewedRehearsalDifferences(receipt, offset)],
  ['receipt', offset => pageRehearsalEvidenceReceiptDifferences(verification, offset)]]) {
  test(name + ' pages normalize offsets and clamp beyond the last page', () => {
    assert.equal(get(39).offset, 0); assert.equal(get(41).offset, 40); assert.equal(get(Number.MAX_SAFE_INTEGER).offset, 80);
    assert.ok(Object.isFrozen(get(40))); assert.ok(Object.isFrozen(get(40).differences));
  });
  test(name + ' pages reject invalid offsets', () => {
    for (const value of [-1, 1.5, NaN, Infinity, '40', null, {}, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => get(value), { code: 'INVALID_REVIEW_DIFFERENCE_OFFSET' });
  });
}
test('zero differences has one empty page without navigation', async () => {
  const good = await reviewRehearsalReport(JSON.stringify(original), options), reviewed = await reviewRehearsalEvidence(encodeRehearsalReviewEvidence(good), options);
  for (const page of [pageReviewedRehearsalDifferences(good, 900), pageRehearsalEvidenceReceiptDifferences(reviewed, 900)]) {
    assert.equal(page.page, 1); assert.equal(page.totalPages, 1); assert.equal(page.totalDifferences, 0);
    assert.equal(page.hasPrevious, false); assert.equal(page.hasNext, false); assert.deepEqual(page.differences, []);
  }
});
test('foreign receipts and verifications cannot supply or swap a paging source', () => {
  for (const value of [null, {}, JSON.parse(JSON.stringify(receipt))])
    assert.throws(() => pageReviewedRehearsalDifferences(value), { code: 'UNRECOGNIZED_REVIEW_RECEIPT' });
  for (const value of [null, {}, JSON.parse(JSON.stringify(verification))])
    assert.throws(() => pageRehearsalEvidenceReceiptDifferences(value), { code: 'UNRECOGNIZED_EVIDENCE_REVIEW' });
});
test('paging does not request another hash and first-page receipts keep their existing encoding', async () => {
  let calls = 0;
  const reviewed = await reviewRehearsalReport(text, { subtle: { digest(...args) { calls++; return webcrypto.subtle.digest(...args); } } });
  const before = encodeRehearsalReviewReceipt(reviewed);
  pageReviewedRehearsalDifferences(reviewed, 80); pageReviewedRehearsalDifferences(reviewed, 0);
  assert.equal(calls, 1); assert.equal(encodeRehearsalReviewReceipt(reviewed), before);
});
