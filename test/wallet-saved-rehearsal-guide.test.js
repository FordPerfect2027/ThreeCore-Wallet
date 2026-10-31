import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { savedRehearsalGuideFixtures } from './helpers/workspace-fixtures.js';
import { inspectWalletSavedText, walletSavedInspectionText, inspectWalletSavedTextBatch, encodeWalletSavedTextBatchCsv, WALLET_SAVED_REHEARSAL_SCOPE_FIELDS, compareWalletSavedInspections, prepareWalletSavedBundle } from '../src/file-read-status.js';
const fixtures = savedRehearsalGuideFixtures();
for (const fixture of fixtures) {
  test('rehearsal source guidance recalculates references without presenting practice as chain evidence: ' + fixture.name, async () => {
    const result = await inspectWalletSavedText(fixture.text);
    assert.equal(result.validation, 'validated-structure'); assert.equal(result.simulationOnly, true);
    assert.equal(result.target, fixture.target); assert.equal(result.checksumVerified, false); assert.equal(result.sourceDigest, null);
    assert.equal(result.textDigest, createHash('sha256').update(fixture.text).digest('hex'));
    for (const field of ['originalEvidenceValidated', 'restorable', 'automaticallyImported', 'liveChainRechecked', 'authenticated', 'authorizesExecution']) assert.equal(result[field], false);
    assert.deepEqual(WALLET_SAVED_REHEARSAL_SCOPE_FIELDS.map(field => result.scope[field]), fixture.counts);
    assert.equal(result.scope.draftReferences, null);
    const display = walletSavedInspectionText(result); assert.match(display, /実際の入出金の証拠ではありません/); assert.match(display, /再計算/); assert.doesNotMatch(display, /0x[0-9a-f]{40}|Synthetic limit comparison|130000000|null件|undefined/);
    assert.equal(compareWalletSavedInspections(result, result).kind, 'unverified');
    await assert.rejects(prepareWalletSavedBundle(fixture.text, fixture.text), { code: 'FILE_BUNDLE_ORIGINALS_REQUIRED' });
  });
  test('rehearsal guide refuses simulation flag changes and extra input fields: ' + fixture.name, async () => {
    const flag = JSON.parse(fixture.text); flag.simulationOnly = false;
    await assert.rejects(inspectWalletSavedText(JSON.stringify(flag)));
    const extra = JSON.parse(fixture.text); extra.authorizesExecution = true;
    await assert.rejects(inspectWalletSavedText(JSON.stringify(extra)));
  });
}
test('mixed rehearsal batches preserve simulation scope, external hashes and structure-only outcomes', async () => {
  const manifestText = fixtures.map(row => createHash('sha256').update(row.text).digest('hex') + '  ' + row.name).join('\n') + '\n';
  const result = await inspectWalletSavedTextBatch(fixtures.map(({name, text}) => ({name, text})), { manifestText });
  assert.equal(result.allOriginalsValidated, false); assert.equal(result.allExternalChecksumsMatch, true); assert.equal(result.summary.structureValidated, 5);
  const csv = encodeWalletSavedTextBatchCsv(result); assert.match(csv, /"simulationOnly"/); assert.match(csv, /"rehearsalRejectedRecordReferences"/); assert.doesNotMatch(csv, /"null"/);
  assert(result.files.every(row => row.inspection.simulationOnly === true));
});
test('empty practice collections use zero counts, while malformed nested sources never gain guidance', async () => {
  for (const fixture of fixtures.slice(2)) {
    const input = JSON.parse(fixture.text);
    if (input.ledgers) input.ledgers = []; else if (Array.isArray(input.cases)) input.cases = []; else { input.workspace.ledgers = []; input.cases.cases = []; }
    const result = await inspectWalletSavedText(JSON.stringify(input)); assert.equal(result.scope.rehearsalRecordReferences, 0); assert.equal(result.scope.rehearsalRejectedRecordReferences, 0); assert.equal(result.scope.rehearsalLedgerReferences, 0);
  }
  const input = JSON.parse(fixtures[4].text); input.cases.cases[0].after.events[0].principal = '-1';
  await assert.rejects(inspectWalletSavedText(JSON.stringify(input)));
  const duplicate = JSON.parse(fixtures[2].text); duplicate.ledgers[1] = duplicate.ledgers[0];
  await assert.rejects(inspectWalletSavedText(JSON.stringify(duplicate)), { code: 'DUPLICATE_AGENT' });
});
