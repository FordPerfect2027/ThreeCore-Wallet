// Records observed UI work and verifies its actual downloaded files.
// This is an offline evidence checker, not a replay of MetaMask/browser actions.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash, webcrypto} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve, join} from 'node:path';
import {decodeWorkspaceFile} from '../../../src/workspace-file.js';
import {decodeTokenIdentityFile} from '../../../src/token-identity-report.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const downloads = 'C:/Users/aseet/Downloads';
const privateFolder = resolve(process.argv[2]);
const sourceRevision = '8e5079df4b3fa5aed51cc7054aeb82a92f46c901';
const applicationRevision = '7c12a280649ee56d52165d9412db3af4c5bd4770';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, windowsHide: true}).toString().trim();
assert.equal(head, sourceRevision, 'Record against the observed source checkpoint');

const sourceName = 'ThreeCore-workspace-backup (13).json';
const restoredName = 'ThreeCore-workspace-backup (14).json';
const source = await readFile(join(downloads, sourceName));
const restored = await readFile(join(downloads, restoredName));
assert(source.equals(restored), 'Restored export must equal the original bytes');
assert.equal(source.length, 4371);
assert.equal(hash(source), '97f0ff6650a6beb26077cb2257e6668c337a7cb8d579f687451990c85988efe4');
const decoded = await decodeWorkspaceFile(source, {subtle: webcrypto.subtle});
assert(decoded.checksumVerified);
assert.equal(decoded.workspace.entries.length, 3);
const account = decoded.workspace.entries[0].account;
assert.equal(account, '0xcfae42798e867968c60fedf38d7ee401120072c8');
const agents = ['DAT', 'EMA', 'CAWELON'];
const portfolioBlocks = ['53414276', '53414584', '53414584'];
const identityBlocks = ['53413786', '53413786', '53413972'];
const observations = [];
const filenames = [sourceName, restoredName];
for (const [index, entry] of decoded.workspace.entries.entries()) {
  assert.equal(entry.agent, agents[index]);
  assert.equal(entry.account, account);
  assert.equal(entry.chainId, 84532);
  assert.equal(entry.tokens.length, 1);
  assert.equal(entry.history.reports.length, 1);
  const snapshot = entry.history.reports[0].snapshot;
  assert.equal(snapshot.blockNumber, portfolioBlocks[index]);
  assert.equal(snapshot.account, account);
  assert.equal(snapshot.chainId, 84532);
  assert.equal(snapshot.siteOrigin, 'http://127.0.0.1:4231');
  assert.equal(snapshot.holdings.length, 1);
  assert.equal(snapshot.holdings[0].address, entry.tokens[0]);
  assert.equal(snapshot.holdings[0].balanceBaseUnits, '0');
  assert.equal(snapshot.holdings[0].hasCode, true);
  const filename = `ThreeCore-${entry.agent}-identity-${identityBlocks[index]}.json`;
  const bytes = await readFile(join(downloads, filename));
  const {observation, checksumVerified} = await decodeTokenIdentityFile(bytes, {subtle: webcrypto.subtle});
  assert(checksumVerified);
  assert.equal(observation.agent, entry.agent);
  assert.equal(observation.account, account);
  assert.equal(observation.chainId, 84532);
  assert.equal(observation.blockNumber, identityBlocks[index]);
  assert.equal(observation.tokenAddress, entry.tokens[0]);
  assert.equal(observation.balanceBaseUnits, '0');
  assert.equal(observation.hasCode, true);
  observations.push({agent: entry.agent, identityBlock: observation.blockNumber,
    identityBlockHash: observation.blockHash, portfolioBlock: snapshot.blockNumber,
    portfolioBlockHash: snapshot.blockHash, tokenAddress: observation.tokenAddress,
    balanceBaseUnits: '0', nativeBalanceBaseUnits: observation.nativeBalanceBaseUnits,
    metadata: observation.metadata, identityFileSha256: hash(bytes), checksumVerified});
  filenames.push(filename);
}
const previousBackups = [];
for (const suffix of ['9', '10', '11', '12']) {
  const bytes = await readFile(join(downloads, `ThreeCore-workspace-backup (${suffix}).json`));
  assert.equal(bytes.length, 4410);
  assert.equal(hash(bytes), '17d16f8c10f571ba04b23be790640cab36ccbae5feeddca44e6a4433328ac989');
  previousBackups.push({suffix, bytes: bytes.length, sha256: hash(bytes)});
}
const preview = await readFile(join(privateFolder, 'restore-preview.txt'), 'utf8');
assert.equal((preview.match(/取り除く既存記録: 0件/g) || []).length, 3);
assert(preview.includes('一覧へ追加: 0x2474a062ec669c1912ed41bc491e8a97db4743d4'));
const restoredState = JSON.parse(await readFile(join(privateFolder, 'restored-state.json'), 'utf8'));
assert(restoredState[0].statuses.some(text => text.startsWith('未接続')));
for (const index of [1, 2]) assert(restoredState[index].statuses.some(text => text.includes('接続済み')));
const comparison = await readFile(join(privateFolder, 'restore-comparison.txt'), 'utf8');
assert(comparison.includes('全3カードの設定・トークン一覧・保存履歴が一致しました。'));
const resume = JSON.parse(await readFile(join(privateFolder, 'resume-does-not-autoconnect.json'), 'utf8'));
assert.equal(resume.length, 3);
assert(resume.every(text => text.startsWith('未接続')));
const reconnect = JSON.parse(await readFile(join(privateFolder, 'reconnected-state.json'), 'utf8'));
assert.equal(reconnect.length, 3);
assert(reconnect.every(card => card.statuses.some(text => text.includes('接続済み') && text.includes('84532') && text.includes(account))));

const privateEvidence = [];
for (const filename of filenames) {
  const bytes = await readFile(join(downloads, filename));
  await writeFile(join(privateFolder, filename), bytes, {flag: 'wx'});
  privateEvidence.push({filename, bytes: bytes.length, sha256: hash(bytes)});
}
for (const filename of ['identity-overview.txt', 'identity-overview.png', 'restore-preview.txt',
  'restored-state.json', 'restore-comparison.txt', 'resume-does-not-autoconnect.json',
  'reconnected-state.json', 'restored-overview.png']) {
  const bytes = await readFile(join(privateFolder, filename));
  privateEvidence.push({filename, bytes: bytes.length, sha256: hash(bytes)});
}
const summary = {
  schema: 'threecore.live-sepolia-acceptance.v1', recordedAt: new Date().toISOString(),
  sourceRevision, applicationRevision, browser: 'Microsoft Edge, existing profile with MetaMask',
  origin: 'http://127.0.0.1:4231', network: 'Base Sepolia', chainId: 84532,
  tokenCards: 3, distinctObservedAccounts: 1, accountLabel: 'Account 2', accountValuesRedacted: true,
  observations, stepsObserved: {
    permittedAccountAndNetworkReadFromActualWallet: true, permittedAccountCount: 2,
    allThreeCardsExplicitlyConnected: true, allThreeIdentityReadsSaved: true,
    portfolioHistoryCounts: [1, 1, 1], downloadedFilesDecodedAndChecksummed: true,
    liveSiteSpecificGuidanceVisible: true, originalTabReloadedByAgent: false,
    datTokenListClearedAfterBackupForRestoreExercise: true, supportedBrowserFileChooserUsed: true,
    restorePreviewInspected: true, existingHistoryRecordsRemoved: 0,
    changedDatCardDisconnectedByRestore: true, unchangedCardsRetainedConnection: true,
    allThreeSettingsTokensHistoriesMatchedInUi: true, stopAndResumeDidNotAutoConnect: true,
    allThreeCardsExplicitlyReconnected: true, reexportByteIdentical: true
  },
  integrity: {workspaceBytes: source.length, workspaceSha256: hash(source),
    workspaceInternalChecksum: decoded.digest, previousMainnetBackupsPreserved: previousBackups, privateEvidence},
  originalServer: {pid: 2108, observedStartLocal: '2026-10-30T00:41:41+09:00', restarted: false},
  limitations: [
    'One existing account serves all three token cards; this is not three independently controlled accounts.',
    'This successful Sepolia session follows an earlier stopped Mainnet session. A live accountsChanged/chainChanged invalidation sequence was not observed.',
    'The existing tab returned with empty histories and updated client text after the operator intervention. Its prior in-memory histories were not claimed to survive; the saved Mainnet backups were verified unchanged.',
    'Restore was into the same live tab after clearing the DAT token list, retaining its histories. It was not an empty-tab or full-candidate server migration.',
    'File selection used the documented browser chooser API, not traversal of the native Windows picker.',
    'Identity and portfolio blocks differ. These are recorded observations, not a common current balance checkpoint, security audit, or ownership certificate.',
    'Raw account evidence remains in the private local folder. Redacted summaries do not replace the original files.',
    'No new full regression or release-percentage calculation was performed.'
  ], transactionsSigned: 0, transactionsSubmitted: 0, secretKeysRead: false, githubModified: false
};
await writeFile(join(privateFolder, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', {flag: 'wx'});
await writeFile(join(privateFolder, 'SHA256SUMS.txt'), privateEvidence.map(x => `${x.sha256}  ${x.filename}`).join('\n') + '\n', {flag: 'wx'});
await writeFile(join(evidence, 'live-sepolia-acceptance-summary.json'), JSON.stringify(summary, null, 2) + '\n', {flag: 'wx'});
const manifestPath = join(evidence, 'SHA256SUMS.txt');
let manifest = await readFile(manifestPath, 'utf8');
for (const filename of ['live-sepolia-record-method.mjs', 'live-sepolia-acceptance-summary.json']) {
  assert(!manifest.split(/\r?\n/).some(line => line.endsWith('  ' + filename)));
  manifest += `${hash(await readFile(join(evidence, filename)))}  ${filename}\n`;
}
await writeFile(manifestPath, manifest);
console.log(JSON.stringify({privateFolder, workspaceByteIdentical: true, internalChecksumVerified: true,
  priorMainnetBackupsUnchanged: 4, identityObservations: observations.length, privateEvidenceFiles: privateEvidence.length}));
