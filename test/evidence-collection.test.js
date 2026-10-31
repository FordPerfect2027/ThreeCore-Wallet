import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, unlink, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename, relative, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyEvidenceCollection } from '../scripts/evidence-collection.js';
import { runEvidenceCollectionVerification } from '../scripts/verify-evidence-collection.js';
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(action) {
  const root = await realpath(tmpdir()), container = await mkdtemp(join(root, 'threecore-evidence-collection-'));
  const repo = join(container, 'repo'), hooks = join(container, 'empty-hooks'); await mkdir(repo); await mkdir(hooks);
  function git(...args) {
    const result = spawnSync('git', ['-c', 'core.hooksPath=' + hooks, '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false',
      '-c', 'commit.gpgsign=false', '-c', 'user.name=ThreeCore fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 524288 });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  }
  try {
    git('init', '-q');
    for (const name of ['a', 'b']) {
      const dir = join(repo, 'docs', name); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'evidence.log'), name.repeat(4));
      await writeFile(join(dir, 'SHA256SUMS.txt'), hash(name.repeat(4)) + '  evidence.log\n');
    }
    git('add', 'docs'); git('commit', '-q', '-m', 'Synthetic evidence fixtures');
    await action({ container, repo, git });
  } finally {
    assert.equal(dirname(resolve(container)), root); assert.ok(basename(container).startsWith('threecore-evidence-collection-'));
    assert.equal(await realpath(container), resolve(container)); await rm(container, { recursive: true });
  }
}
async function moveFixtureDirectory(container, from, to) {
  for (const path of [from, to]) { const rel = relative(container, resolve(path)); assert.ok(rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)); }
  assert.equal(await realpath(from), resolve(from)); await rename(from, to);
}
async function run(args) { let output = '', errors = ''; const code = await runEvidenceCollectionVerification(args, { write: s => { output += s; } }, { write: s => { errors += s; } }); return { code, output, errors }; }

test('collection verifies tracked working files, ignores untracked lists and leaves Git unchanged', () => fixture(async ({ repo, git }) => {
  const untracked = join(repo, 'untracked'); await mkdir(untracked); await writeFile(join(untracked, 'SHA256SUMS.txt'), 'invalid untracked data');
  const status = git('status', '--porcelain=v1'), head = git('rev-parse', 'HEAD').trim(), result = await verifyEvidenceCollection(repo);
  assert.equal(result.allMatched, true); assert.equal(result.headRevision, head); assert.equal(result.workingTreeFiles, true);
  assert.deepEqual(result.summary, { manifests: 2, matchedManifests: 2, failedManifests: 0, files: 2,
    mismatchedFiles: 0, unreadableFiles: 0, verifiedBytes: 8, admittedBytes: 8 });
  assert.equal(git('status', '--porcelain=v1'), status); assert.equal(git('rev-parse', 'HEAD').trim(), head);
  assert.equal(result.authenticatesOrigin, false); assert.ok(Object.isFrozen(result.manifests));
}));
test('collection CLI reports working-tree corruption with exit two without changing HEAD or the file', () => fixture(async ({ repo, git }) => {
  const file = join(repo, 'docs/a/evidence.log'), head = git('rev-parse', 'HEAD'); await writeFile(file, 'changed');
  const result = await run([repo]); assert.equal(result.code, 2); assert.equal(result.errors, '');
  const data = JSON.parse(result.output); assert.equal(data.summary.mismatchedFiles, 1); assert.equal(data.summary.matchedManifests, 1);
  assert.equal(await readFile(file, 'utf8'), 'changed'); assert.equal(git('rev-parse', 'HEAD'), head);
}));
test('missing tracked manifest is explicit while other evidence remains checkable', () => fixture(async ({ repo }) => {
  await unlink(join(repo, 'docs/b/SHA256SUMS.txt'));
  const result = await run([repo]); assert.equal(result.code, 1); const data = JSON.parse(result.output);
  assert.equal(data.summary.matchedManifests, 1); assert.equal(data.summary.failedManifests, 1);
  assert.equal(data.manifests[1].error, 'MANIFEST_READ_FAILED');
}));
test('missing artifact and invalid checksum list cannot be counted as a match', () => fixture(async ({ repo }) => {
  await unlink(join(repo, 'docs/a/evidence.log')); await writeFile(join(repo, 'docs/b/SHA256SUMS.txt'), 'invalid private content');
  const result = await run([repo]); assert.equal(result.code, 1); const data = JSON.parse(result.output);
  assert.equal(data.summary.failedManifests, 2); assert.equal(data.summary.unreadableFiles, 1); assert.equal(data.allMatched, false);
  assert.doesNotMatch(result.output, /private content/);
}));
test('one total admission budget is shared by all manifests', () => fixture(async ({ repo }) => {
  const result = await verifyEvidenceCollection(repo, { maxTotalBytes: 5 });
  assert.equal(result.summary.matchedManifests, 1); assert.equal(result.summary.admittedBytes, 4);
  assert.equal(result.manifests[1].result.files[0].code, 'TOTAL_SIZE_LIMIT'); assert.equal(result.allMatched, false);
}));
test('a nested path never silently expands to the whole repository', () => fixture(async ({ repo }) => {
  await assert.rejects(verifyEvidenceCollection(join(repo, 'docs')), { code: 'EVIDENCE_REPOSITORY_ROOT_REQUIRED' });
}));
test('a tracked directory replaced by a junction outside the repository is rejected', () => fixture(async ({ repo, container }) => {
  const outside = join(container, 'outside'); await mkdir(outside);
  await writeFile(join(outside, 'SHA256SUMS.txt'), hash('outside') + '  evidence.log\n'); await writeFile(join(outside, 'evidence.log'), 'outside');
  const target = join(repo, 'docs/a'); await moveFixtureDirectory(container, target, join(container, 'held-a'));
  await symlink(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await verifyEvidenceCollection(repo);
  assert.equal(result.manifests[0].error, 'MANIFEST_OUTSIDE_REPOSITORY'); assert.equal(result.summary.matchedManifests, 1);
}));
test('duplicate resolved manifest aliases cannot inflate matched counts', () => fixture(async ({ repo, container }) => {
  const target = join(repo, 'docs/b'); await moveFixtureDirectory(container, target, join(container, 'held-b'));
  await symlink(join(repo, 'docs/a'), target, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await verifyEvidenceCollection(repo);
  assert.equal(result.manifests[1].error, 'MANIFEST_ALIAS_DUPLICATE'); assert.equal(result.summary.matchedManifests, 1);
}));
test('absence of tracked manifests is not reported as a successful empty check', () => fixture(async ({ repo, git }) => {
  git('rm', '--cached', 'docs/a/SHA256SUMS.txt', 'docs/b/SHA256SUMS.txt');
  const result = await run([repo]); assert.equal(result.code, 1); assert.equal(result.output, ''); assert.match(result.errors, /NO_TRACKED_EVIDENCE_MANIFESTS/);
}));
test('invalid options and CLI arguments cannot start repository inspection', async () => {
  let calls = 0;
  for (const options of [null, [], { unknown: 0 }, { maxTotalBytes: -1 }, { maxTotalBytes: 536870913 },
    { get maxTotalBytes() { calls++; return 1; } }])
    await assert.rejects(verifyEvidenceCollection('not-read', options), { code: 'INVALID_EVIDENCE_COLLECTION_ARGUMENTS' });
  assert.equal(calls, 0);
  for (const args of [[], [null], ['--help'], ['path', '--write']]) {
    const result = await run(args); assert.equal(result.code, 1); assert.equal(result.output, '');
  }
});
