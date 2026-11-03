import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const repo = 'C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029';
const downloads = 'C:/Users/aseet/Downloads';
const evidence = join(repo, 'docs/evidence/2026-11-02-release-regression');
const revision = '96b59459a0f593246c60f0bed4b52052211a464a';
const base = 'c2159aa432119e35d1c35b1d69cb702eddcce5c1';
const git = args => execFileSync('git', args, { cwd: repo, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
if (git(['rev-parse', 'HEAD']).toString().trim() !== revision) throw Error('Unexpected source revision');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const outputs = [];
for (const name of ['before', 'after', 'regression']) {
  const filename = `rpc-range-${name}.log`;
  const bytes = readFileSync(join(downloads, `ThreeCore-rpc-range-${name}-20261102.log`));
  writeFileSync(join(evidence, filename), bytes, { flag: 'wx' });
  outputs.push(filename);
}
const patch = git(['diff', '--binary', base, revision]);
writeFileSync(join(evidence, 'rpc-range-source.patch'), patch, { flag: 'wx' });
outputs.push('rpc-range-source.patch');
const files = ['src/security-rpc.js', 'src/transfer-codec.js', 'test/security-rpc.test.js',
  'test/base-state-provider.test.js', 'integration/base-state-rpc-server.test.mjs'];
const report = {
  schema: 'threecore-rpc-range-review-v1', observedAt: new Date().toISOString(), base, revision,
  issue: 'The low-level read guard and fixed Base relay accepted log spans beyond the inclusive 2000-block session/UI bound.',
  scope: ['Direct dispatch guard', 'Base state provider before HTTP', 'Actual isolated loopback HTTP relay before its stub upstream'],
  regression: { failingBefore: 3, passingAfter: 3, focusedExistingAndNewCases: 585,
    fullWalletSuiteRerun: false, realBrowserWalletTest: false },
  boundaries: { inclusiveBlocks: 2000, firstRefusedSpan: 2001, highPrecisionUint256Coverage: true,
    publicRpcRequests: 0, walletRequests: 0, serverPort: 'ephemeral loopback', existing4231ProcessModified: false },
  source: files.map(path => ({ path, sha256: hash(git(['show', `${revision}:${path}`])) })),
  sourcePatchSha256: hash(patch),
  retainedLimitations: ['Original live tabs and the existing 4231 process were not upgraded/reloaded.',
    'Previously delivered 16a0d33 ZIP predates this correction.',
    'This developer review is not independent review or a mainnet readiness percentage.']
};
writeFileSync(join(evidence, 'rpc-range-review.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
outputs.push('rpc-range-review.json');
copyFileSync(new URL(import.meta.url), join(evidence, 'rpc-range-record-method.mjs'));
outputs.push('rpc-range-record-method.mjs');
const manifestPath = join(evidence, 'SHA256SUMS.txt');
let manifest = readFileSync(manifestPath, 'utf8');
for (const file of outputs) {
  if (manifest.includes('  ' + file + '\n')) throw Error('Duplicate manifest entry');
  manifest += `${hash(readFileSync(join(evidence, file)))}  ${file}\n`;
}
writeFileSync(manifestPath, manifest);
writeFileSync(join(downloads, 'ThreeCore-rpc-range-review-20261102.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ revision, filesRecorded: outputs.length, report: 'ThreeCore-rpc-range-review-20261102.json' }) + '\n');
