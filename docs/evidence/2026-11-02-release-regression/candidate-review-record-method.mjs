import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const repo = 'C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029';
const downloads = 'C:/Users/aseet/Downloads';
const evidence = join(repo, 'docs/evidence/2026-11-02-release-regression');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: repo, windowsHide: true }).toString().trim();
const scopeBytes = await readFile(join(downloads, 'ThreeCore-candidate-review-scope-20261102.json'));
const scope = JSON.parse(scopeBytes);
assert.equal(git(['rev-parse', 'HEAD']), scope.head);
assert.equal(git(['diff', '--name-only', '--', 'src', 'examples', 'scripts', 'test', 'integration', '.github']), '');
assert.deepEqual(scope.totals, { files: 17, added: 123, deleted: 54 });
for (const file of scope.files) assert.equal(hash(await readFile(join(repo, file.path))), file.sha256);
const remoteBytes = await readFile(join(downloads, 'ThreeCore-public-pr4-recheck-20261102.json'));
const remote = JSON.parse(remoteBytes);
assert.equal(remote.length, 2);
assert(remote.every(entry => entry.status === 200));
assert.equal(remote[0].data.state, 'open');
assert.equal(remote[0].data.draft, true);
assert.equal(remote[0].data.head.sha, scope.base);
assert.equal(remote[1].data.total_count, 5);
assert.equal(remote[1].data.jobs.length, 5);
assert(remote[1].data.jobs.every(job => job.status === 'completed' && job.conclusion === 'success' && job.head_sha === scope.base));
const document = await readFile(join(repo, 'docs/RELEASE_HANDOFF_2026-11-02.md'), 'utf8');
const localLinks = [];
for (const match of document.matchAll(/\]\(([^)]+)\)/g)) {
  const target = match[1];
  if (/^https?:/.test(target)) continue;
  const file = target.split('#')[0];
  // Two new evidence files are written immediately below; validate them separately.
  if (file.endsWith('/candidate-review-scope.json') || file.endsWith('/public-pr4-recheck.json')) continue;
  await access(resolve(repo, 'docs', file)); localLinks.push(file);
}
const receipt = {
  ...scope, publicReadAt: remote.map(item => item.observedAt),
  publicJobsAllPassedAtRecordedHead: true, localChangesCoveredByPublicJobs: false,
  findings: [{ kind: 'documentation', issue: 'Handoff labelled older 34d1731 source and 16,451 passes as current and omitted the inclusive RPC range change.', resolution: 'Replaced chronology with the exact current source/evidence map, scoped review table, package pins and remaining acceptance requirements.' }],
  newImplementationDefectEstablished: false, productSourceChanged: false, testsRerun: false,
  independentReviewCompleted: false, privateAccountFilesCopied: false,
  handoffLocalLinkFilesChecked: localLinks.length,
  reviewLimits: ['Changed Wallet implementation lines and related context only; not every unchanged source line.', 'Selected existing test assertions inspected, not a new execution.', 'No real account/network switch or independent audit completed.']
};
const files = [
  ['public-pr4-recheck.json', remoteBytes],
  ['candidate-review-scope.json', Buffer.from(JSON.stringify(receipt, null, 2) + '\n')],
  ['candidate-review-record-method.mjs', await readFile(new URL(import.meta.url))],
];
let manifest = await readFile(join(evidence, 'SHA256SUMS.txt'), 'utf8');
for (const [name, bytes] of files) {
  assert(!manifest.split(/\r?\n/).some(line => line.endsWith('  ' + name)));
  await writeFile(join(evidence, name), bytes, { flag: 'wx' });
  manifest += hash(bytes) + '  ' + name + '\n';
}
await writeFile(join(evidence, 'SHA256SUMS.txt'), manifest);
console.log(JSON.stringify({ head: scope.head, reviewedImplementationFiles: scope.files.length, publicJobs: 5, localLinkFiles: localLinks.length, evidenceFilesRecorded: files.length }));
