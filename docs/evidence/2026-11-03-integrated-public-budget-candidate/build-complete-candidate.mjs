import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, copyFile, readdir, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A reproducible local delivery assembly. Does not publish or modify a checkout.
const evidenceRoot = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceRoot, '../../..');
const previous = 'C:/Users/aseet/Downloads/ThreeCore-complete-4dfa300-20261103';
const destination = 'C:/Users/aseet/Downloads/ThreeCore-complete-cd7f7ed-20261103-r1';
const { verifyPackage } = await import(pathToFileURL(resolve(previous, 'verify-package.mjs')));
const previousVerification = await verifyPackage(previous);
const receipt = JSON.parse(await readFile(resolve(previous, 'update/update-receipt.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
const revision = git(repo, 'rev-parse', 'cd7f7ed^{commit}');
assert.equal(git(repo, 'rev-parse', 'HEAD'), revision, 'Candidate changed: review the pinned revision before building');
const nodeLog = await readFile(resolve(evidenceRoot, 'full-wallet-tests.tap'));
assert.match(nodeLog.toString('utf8'), /# fail 0\r?\n/);
assert.match(nodeLog.toString('utf8'), /# cancelled 0\r?\n/);
assert.match(nodeLog.toString('utf8'), /# duration_ms [\d.]+\s*$/);
const browser = JSON.parse(await readFile(resolve(evidenceRoot, 'browser-result.json'), 'utf8'));
assert.equal(browser.status, 'passed');
assert.equal(browser.failures.length, 0);
assert(browser.completed > 0);
for (const source of receipt.sources.slice(1)) {
  const tokenRepo = resolve(repo, `../token-toolchain-empty-data-${source.name}-20261102`);
  assert.equal(git(tokenRepo, 'rev-parse', 'HEAD'), source.revision);
  assert.equal(git(tokenRepo, 'rev-parse', 'HEAD^{tree}'), source.tree);
  assert.equal(git(tokenRepo, 'status', '--porcelain'), '');
}
await mkdir(destination); // Must be new: never overwrite an earlier delivery.
await cp(resolve(previous, 'base'), resolve(destination, 'base'), { recursive: true, errorOnExist: true, force: false });
await mkdir(resolve(destination, 'update'));
for (const name of ['restore-latest.mjs', 'verify-package.mjs']) {
  await copyFile(resolve(previous, name), resolve(destination, name));
}
for (const name of ['restore-update.mjs', 'verify-package.mjs', 'dat.bundle', 'ema.bundle', 'cawelon.bundle']) {
  await copyFile(resolve(previous, 'update', name), resolve(destination, 'update', name));
}
const wallet = receipt.sources[0];
wallet.revision = revision;
wallet.tree = git(repo, 'rev-parse', `${revision}^{tree}`);
// Git bundle needs a named positive ref. HEAD was checked against the fixed revision above.
git(repo, 'bundle', 'create', resolve(destination, 'update/wallet.bundle'), 'HEAD', `^${wallet.base}`);
const bundle = await readFile(resolve(destination, 'update/wallet.bundle'));
wallet.bytes = bundle.length;
wallet.sha256 = hash(bundle);
receipt.recordedAt = new Date().toISOString();
await writeFile(resolve(destination, 'update/update-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
await mkdir(resolve(destination, 'validation'));
for (const name of ['full-wallet-tests.tap', 'concurrent-full-wallet-tests.tap', 'evidence-collection-isolated.tap', 'browser-result.json']) {
  await copyFile(resolve(evidenceRoot, name), resolve(destination, 'validation', name));
}
await copyFile(resolve(repo, 'docs/WHOLE_PROJECT_SCOPE_2026-11-03.md'), resolve(destination, 'validation/whole-project-scope.md'));
await copyFile(resolve(repo, 'README.md'), resolve(destination, 'validation/current-capability-description.md'));
const scope = {
  recordedAt: new Date().toISOString(), walletRevision: revision, walletTree: wallet.tree,
  previousPackageVerification: previousVerification,
  fullWalletNodeRun: { sha256: hash(nodeLog), command: 'node --test --test-concurrency=2 --test-reporter=tap test/*.test.js integration/*-server.test.mjs integration/local-navigation-help.test.mjs' },
  browserRun: browser,
  retainedFirstRun: 'Concurrent Node/browser execution: 16584 passed, zero failed assertions, one test cancelled at its 60-second deadline. The affected evidence-collection file then passed all 11 tests separately without source or timeout changes. Both original logs are retained; the final full run is recorded separately.',
  tokenSources: 'Unchanged pinned sources; prior token validation remains historical, not rerun in this delivery.',
  scope: 'Integrated read-only Wallet, rehearsal, token/ETH budgets, shared-account budgets and public same-block reads. Not overall project completion or a mainnet launch approval.',
  externalEffects: 'No user-wallet signatures, transactions, secrets, GitHub publication or deployment.'
};
await writeFile(resolve(destination, 'validation/scope.json'), JSON.stringify(scope, null, 2) + '\n');
await writeFile(resolve(destination, 'START_HERE.txt'), [
  'ThreeCore local integrated candidate — cd7f7ed — 2026-11-03',
  '',
  '1. Verify this entire extracted directory:',
  '   node verify-package.mjs',
  '2. Restore all four source repositories into a NEW directory outside this package:',
  '   node restore-latest.mjs C:/your/new-directory',
  '3. In new-directory/Wallet, start the local read-only demo with Node.js 22 or later:',
  '   node examples/dev-server.js',
  '   Use THREECORE_DEMO_PORT to choose an unused port; preserve existing servers.',
  '',
  'Pages: / (Wallet), /rehearsal/, /tokens/read/, /budget/, /budget/shared/, /budget/evidence/.',
  'Public reading uses an explicitly entered public address and fixed Base public providers.',
  'Budget source import requires reviewing the account, network and block before applying balances.',
  'An imported balance is a recorded snapshot; fee completeness and budget sufficiency remain separate.',
  'Retain original source files beside calculated evidence. No wallet signature or transaction is implemented here.',
  '',
  'validation/ contains the integrated Wallet test results for the pinned source.',
  'Its current capability and whole-project scope descriptions are later documentation supplements.',
  'base/ is an unchanged historical recovery package. Its older results are not claims about this newer source.',
  'update/update-receipt.json pins Wallet, DAT, EMA and CAWELON commits and trees.',
  'The source bundles contain code and records, not installed dependencies.',
  'This package does not claim 90% completion, an independent audit, or mainnet release approval.',
  ''
].join('\n'));

async function manifest(root) {
  const rows = [];
  async function walk(prefix = '') {
    for (const entry of (await readdir(resolve(root, prefix), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name;
      assert(!entry.isSymbolicLink());
      if (entry.isDirectory()) await walk(name + '/');
      else {
        assert(entry.isFile());
        if (name === 'SHA256SUMS.txt') continue;
        const target = resolve(root, name), info = await lstat(target), bytes = await readFile(target);
        assert.equal(info.size, bytes.length);
        rows.push(`${hash(bytes)}  ${name}`);
      }
    }
  }
  await walk();
  await writeFile(resolve(root, 'SHA256SUMS.txt'), rows.sort().join('\n') + '\n');
}
await manifest(resolve(destination, 'update'));
await verifyPackage(resolve(destination, 'update'));
await manifest(destination);
console.log(JSON.stringify({ destination, sources: receipt.sources, verification: await verifyPackage(destination) }, null, 2));
