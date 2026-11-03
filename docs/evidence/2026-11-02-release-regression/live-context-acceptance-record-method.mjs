import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Records an observed UI sequence; does not replay the browser or contact a wallet.
const repo = 'C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029';
const privateDir = 'C:/Users/aseet/Downloads/ThreeCore-private-context-acceptance-20261102-Fg9Opw';
const evidence = join(repo, 'docs/evidence/2026-11-02-release-regression');
const revision = '2e470d9386a3a5e7ef216e27928ee2f41c582dc1';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, windowsHide: true }).toString().trim(), revision);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const before = await readFile('C:/Users/aseet/Downloads/ThreeCore-workspace-backup (9).json');
const after = await readFile(join(privateDir, 'after-context-roundtrip.json'));
assert(before.equals(after));
assert.equal(after.length, 4410);
assert.equal(sha(after), '17d16f8c10f571ba04b23be790640cab36ccbae5feeddca44e6a4433328ac989');
const { decodeWorkspaceFile } = await import(pathToFileURL(join(repo, 'src/workspace-file.js')));
const decoded = await decodeWorkspaceFile(after, { subtle: webcrypto.subtle });
assert(decoded.checksumVerified);
assert.deepEqual(decoded.workspace.entries.map(e => e.agent), ['DAT', 'EMA', 'CAWELON']);
assert(decoded.workspace.entries.every(e => e.chainId === 8453 && e.history.reports.length === 1));
assert.equal(new Set(decoded.workspace.entries.map(e => e.account)).size, 1);
const trace = JSON.parse(await readFile(join(privateDir, 'visible-steps.json'), 'utf8'));
const step = name => { const found = trace.steps.filter(s => s.phase === name); assert.equal(found.length, 1); return found[0]; };
const wrongNetwork = step('wrong-network-rejected'), wrongAccount = step('wrong-account-rejected');
assert(wrongNetwork.status.some(s => s.includes('Walletのネットワークが、このカードのチェーンと一致しません')));
assert(wrongAccount.status.some(s => s.includes('Walletで選ばれたアカウントが、このカードの公開アドレスと一致しません')));
assert.equal(wrongNetwork.readBalanceEnabled, false);
assert.equal(wrongAccount.readBalanceEnabled, false);
for (const phase of ['card-network-changed', 'card-account-changed']) {
  assert(step(phase).status.some(s => s.startsWith('未接続')));
  assert(step(phase).status.some(s => s.includes('履歴 1件')));
}
assert(step('mainnet-return').status.some(s => s.startsWith('DAT 接続済み')));
const all = step('three-card-reconnected').status;
assert(all.some(s => s.startsWith('DAT 接続済み')) && all.some(s => s.startsWith('EMA 接続済み')));
assert(step('cawelon-reconnect-result').status.some(s => s.startsWith('CAWELON 接続済み')));
assert.equal(trace.actualWalletNetworkSwitched, false);
assert.equal(trace.actualWalletAccountSwitched, false);
const privateFiles = [];
for (const file of ['after-context-roundtrip.json', 'visible-steps.json', 'wrong-network.png', 'wrong-account.png', 'restored-connection.png', 'finished.png']) {
  const bytes = await readFile(join(privateDir, file));
  privateFiles.push({ file, bytes: bytes.length, sha256: sha(bytes) });
}
const summary = {
  schema: 'threecore.live-context-acceptance.v1', recordedAt: new Date().toISOString(),
  sourceRevision: revision, applicationRevision: '96b59459a0f593246c60f0bed4b52052211a464a',
  origin: 'http://127.0.0.1:4231', browser: 'Microsoft Edge with existing MetaMask permission',
  subject: 'DAT card configuration changes against the existing Mainnet Account 1 permission',
  accountValuesRedacted: true,
  observations: {
    changingCardNetworkDisconnects: true, wrongNetworkRejected: true,
    wrongNetworkBalanceButtonDisabled: true, originalMainnetReconnectPassed: true,
    changingCardAccountDisconnects: true, wrongAccountRejected: true,
    wrongAccountBalanceButtonDisabled: true, threeCardsExplicitlyReconnectedAfterRestore: true,
    savedHistoriesPerCard: [1, 1, 1], afterExportByteIdentical: true,
    ordinaryStopUsedAfterChecks: true
  },
  wrongNetworkObservedAt: wrongNetwork.at, wrongAccountObservedAt: wrongAccount.at,
  workspace: { bytes: after.length, sha256: sha(after), internalChecksumVerified: true },
  download: { listenerTimedOut: true, timeoutMilliseconds: 15000, actualFileFoundAndVerified: true, retries: 0 },
  evidence: privateFiles,
  scope: {
    actualWalletNetworkSwitched: false, actualWalletAccountSwitched: false,
    sepoliaWalletAcceptanceCompleted: false, newBalanceReadPerformed: false,
    fullCandidateServerMigrationCompleted: false, nativeFilePickerUsed: false,
    independentAudit: false, signedOrSubmittedTransactions: 0, secretKeysRead: false,
    original4231ServerRestarted: false, originalServerPid: 2108,
    browserExtensionUiEnded: 'Native browser automation could not establish the current URL; no native input was sent.',
    sourceScope: 'Existing client assets; original running server modules preserved.',
    provenance: 'Developer-observed UI steps with retained local screenshots and real files; this script checks recorded data and does not authenticate observations.'
  }
};
await writeFile(join(privateDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
const name = 'live-context-acceptance-summary.json';
await writeFile(join(evidence, name), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
const method = 'live-context-acceptance-record-method.mjs';
await writeFile(join(evidence, method), await readFile(new URL(import.meta.url)), { flag: 'wx' });
const manifestPath = join(evidence, 'SHA256SUMS.txt');
let manifest = await readFile(manifestPath, 'utf8');
for (const filename of [name, method]) {
  assert(!manifest.split(/\r?\n/).some(line => line.endsWith('  ' + filename)));
  manifest += sha(await readFile(join(evidence, filename))) + '  ' + filename + '\n';
}
await writeFile(manifestPath, manifest);
console.log(JSON.stringify({ recorded: name, privateDir, workspaceByteIdentical: true, bytes: after.length, sha256: sha(after), nativeUiBlocked: true }));
