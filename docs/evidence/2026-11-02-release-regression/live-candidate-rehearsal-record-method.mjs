// Checks actual downloaded bytes; UI observations are recorded separately.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { decodeRehearsalSession } from '../../../src/operation-rehearsal-session.js';
import { reportRehearsalWorkspace } from '../../../src/operation-rehearsal-workspace.js';
import { reportRehearsalScenarioSet } from '../../../src/operation-rehearsal-scenario-set.js';

const [downloads, privateDirectory] = process.argv.slice(2);
assert(downloads && privateDirectory, 'Expected Downloads and existing private evidence directory');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceWorkspace = 'ThreeCore-operation-workspace.json';
const candidateWorkspace = 'ThreeCore-operation-workspace (22).json';
const sessions = ['ThreeCore-rehearsal-session (14).json', 'ThreeCore-rehearsal-session (15).json', 'ThreeCore-rehearsal-session (16).json'];
const workspaceBytes = await readFile(join(downloads, sourceWorkspace));
assert.equal(sha256(workspaceBytes), 'b3ab23fb3c2af4d1b88051fb6c976f2437bfc721b3a0e8764d965b80da770302');
assert.deepEqual(await readFile(join(downloads, candidateWorkspace)), workspaceBytes);
const original = await readFile(join(downloads, sessions[0]));
assert.equal(sha256(original), '22c7909969a4221d443d8452cefb4e147fa796782f9ef7ce50462cb6ea4d8f9c');
for (const filename of sessions) assert.deepEqual(await readFile(join(downloads, filename)), original);
const session = decodeRehearsalSession(original.toString('utf8'));
const workspace = reportRehearsalWorkspace(session.workspace).rows.map(row => ({agent: row.agent, records: row.recordCount}));
const cases = reportRehearsalScenarioSet(session.cases).rows.map(row => ({id: row.id, agent: row.agent}));
assert.deepEqual(workspace.map(row => row.records), [3, 2, 1]);
assert.deepEqual(cases.map(row => row.id), ['dat-limit-50', 'dat-quota-5', 'ema-opening-1001']);
const files = [sourceWorkspace, candidateWorkspace, ...sessions];
for (const filename of files) await copyFile(join(downloads, filename), join(privateDirectory, filename));
files.push('rehearsal-candidate-preview.txt', 'rehearsal-candidate-restored.txt',
  'rehearsal-candidate-session-preview.txt', 'rehearsal-candidate-session-restored.txt',
  'rehearsal-candidate-session.png', 'rehearsal-return-empty.txt',
  'rehearsal-return-preview.txt', 'rehearsal-return-restored.txt',
  'rehearsal-return-table.txt', 'rehearsal-return-session.png');
const evidence = [];
for (const filename of files) {
  const bytes = await readFile(join(privateDirectory, filename));
  evidence.push({filename, bytes: bytes.length, sha256: sha256(bytes)});
}
const receipt = {
  schema: 'threecore.live-candidate-rehearsal-return.v1', recordedAt: new Date().toISOString(),
  candidateSource: 'f52109a3a5d25665667b19b811584e33da035d15',
  recordingSource: '3687bc035847f2c81b31aa9ebca62e6330de43ae',
  browser: 'Microsoft Edge', simulationOnly: true,
  candidateOrigin: 'http://127.0.0.1:4232', returnOrigin: 'http://127.0.0.1:4231',
  workspace, cases,
  observedUi: {
    candidateOpenedThroughOrdinaryWalletLink: true,
    candidateInitiallyEmpty: true,
    candidateWorkspacePreviewAndRestoreConfirmed: true,
    candidateSessionPreviewAndRestoreConfirmed: true,
    returnOpenedAsSeparateEmptyTab: true,
    existingUserRehearsalTabsNotReloadedOrOverwritten: true,
    candidateExportSelectedThroughRealBrowserFileChooserOnReturn: true,
    returnPreviewAndRestoreConfirmed: true,
    restoredRecords: [3, 2, 1], restoredCases: 3,
    actualCandidateAndReturnDownloadsFoundOnDisk: true
  },
  integrity: {
    workspaceBytes: workspaceBytes.length, workspaceSha256: sha256(workspaceBytes),
    candidateWorkspaceByteIdentical: true,
    sessionBytes: original.length, sessionSha256: sha256(original),
    originalCandidateAndReturnSessionBytesIdentical: true,
    offlineSessionDecoderAndRecalculationPassed: true,
    privateEvidence: evidence
  },
  scope: {
    rehearsalMigrationAndReturnCompleted: true,
    olderImmutableReleaseRollbackProven: false,
    originalServerPid: 2108, originalServerRestarted: false,
    candidateServerPid: 28252
  },
  limitations: [
    'These are six fictional simulation records and three comparison cases, not live assets or transactions.',
    'Return used the preserved development server with current client files, not a pinned older public release.',
    'UI observations were made through actual page controls; this script checks their saved file bytes, not the UI itself.',
    'The supported browser file chooser was used; native Windows picker traversal was not exercised.',
    'This does not establish live wallet switch-event invalidation, independent review, or a release percentage.'
  ],
  transactionsSigned: 0, transactionsSubmitted: 0, secretKeysRead: false, githubModified: false
};
const text = JSON.stringify(receipt, null, 2) + '\n';
await writeFile(new URL('./live-candidate-rehearsal-return-summary.json', import.meta.url), text);
await writeFile(join(privateDirectory, 'rehearsal-return-summary.json'), text);
await writeFile(join(privateDirectory, 'rehearsal-return-SHA256SUMS.txt'), evidence.map(file => `${file.sha256}  ${file.filename}`).join('\n') + '\n');
console.log(JSON.stringify({workspace, cases: cases.length, workspaceBytes: workspaceBytes.length, sessionBytes: original.length, privateEvidenceFiles: evidence.length, allDownloadedBytesMatch: true}));
