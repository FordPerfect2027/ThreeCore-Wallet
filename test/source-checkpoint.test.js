import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, unlink, rename, symlink, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename, relative, isAbsolute, sep } from 'node:path';
import { verifySourceCheckpoint, runSourceCheckpointVerification } from '../scripts/verify-source-checkpoint.js';

async function fixture(action) {
  const temp = await realpath(tmpdir()), container = await mkdtemp(join(temp, 'threecore-source-checkpoint-'));
  const repo = join(container, 'repo'), exported = join(container, 'exported'), hooks = join(container, 'hooks');
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=' + hooks, '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false',
      '-c', 'commit.gpgsign=false', '-c', 'user.name=ThreeCore fixture', '-c', 'user.email=fixture@example.invalid', ...args],
      { cwd: repo, windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  try {
    await mkdir(repo); await mkdir(exported); await mkdir(hooks);
    for (const root of [repo, exported]) {
      await mkdir(join(root, 'src'));
      await writeFile(join(root, 'src', 'main.js'), 'original\n');
      await writeFile(join(root, 'empty.txt'), '');
      await writeFile(join(root, '日本語.bin'), Buffer.from([0,255,13,10,1]));
    }
    git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'Checkpoint fixture');
    await action({ container, repo, exported, git, revision: git('rev-parse', 'HEAD').trim() });
  } finally {
    assert.equal(dirname(resolve(container)), temp); assert.ok(basename(container).startsWith('threecore-source-checkpoint-'));
    assert.equal(await realpath(container), resolve(container)); await rm(container, { recursive: true });
  }
}
async function run(args) {
  let output = '', errors = '';
  const code = await runSourceCheckpointVerification(args, { write: value => { output += value; } }, { write: value => { errors += value; } });
  return { code, output, errors };
}

test('a plain export verifies exact Git blob bytes including empty and binary files, without changing either directory', () => fixture(async ({ repo, revision, exported, git }) => {
  const before = git('status', '--porcelain=v1'), result = await verifySourceCheckpoint(repo, revision, exported);
  assert.equal(result.allMatched, true); assert.equal(result.sourceRevision, revision);
  assert.deepEqual(result.summary, { files: 3, matched: 3, mismatched: 0, unreadable: 0, unexpected: 0, inspectedBytes: 14 });
  assert.equal(result.authenticatesPublisher, false); assert.equal(result.verifiesExecutableMode, false);
  assert.equal(result.readOnly, true); assert.equal(git('status', '--porcelain=v1'), before);
  assert.equal(await readFile(join(exported, 'src/main.js'), 'utf8'), 'original\n');
}));

test('comparison stays bound to the selected commit when developer files or HEAD change', () => fixture(async ({ repo, revision, exported, git }) => {
  await writeFile(join(repo, 'src/main.js'), 'new implementation\n'); git('add', '.'); git('commit', '-q', '-m', 'Later source');
  await writeFile(join(repo, '.env'), 'PRIVATE-FIXTURE-DO-NOT-EXPORT');
  const result = await run([repo, revision, exported]);
  assert.equal(result.code, 0); assert.equal(JSON.parse(result.output).sourceRevision, revision);
  assert.doesNotMatch(result.output + result.errors, /PRIVATE-FIXTURE/);
  assert.notEqual(git('rev-parse', 'HEAD').trim(), revision);
}));

test('same-length tampering and a missing file are both reported instead of a partial success', () => fixture(async ({ repo, revision, exported }) => {
  await writeFile(join(exported, 'src/main.js'), 'tampered\n'); await unlink(join(exported, 'empty.txt'));
  const result = await run([repo, revision, exported]), data = JSON.parse(result.output);
  assert.equal(result.code, 1); assert.equal(data.allMatched, false);
  assert.equal(data.summary.mismatched, 1); assert.equal(data.summary.unreadable, 1);
  assert.equal(data.files.find(row => row.path === 'empty.txt').code, 'CHECKPOINT_FILE_MISSING');
  assert.equal(await readFile(join(exported, 'src/main.js'), 'utf8'), 'tampered\n');
}));

test('unexpected exported files prevent success without printing their contents', () => fixture(async ({ repo, revision, exported }) => {
  await writeFile(join(exported, '.env'), 'PRIVATE-FIXTURE-DO-NOT-READ');
  const result = await run([repo, revision, exported]), data = JSON.parse(result.output);
  assert.equal(result.code, 2); assert.equal(data.allMatched, false); assert.deepEqual(data.unexpected, ['.env']);
  assert.equal(data.summary.matched, 3); assert.doesNotMatch(result.output + result.errors, /PRIVATE-FIXTURE/);
}));

test('comparison rejects a checkout or a nested export and does not alter Git state', () => fixture(async ({ repo, revision, git, exported }) => {
  const status = git('status', '--porcelain=v1');
  const same = await run([repo, revision, repo]); assert.match(same.errors, /CHECKPOINT_SEPARATE_DIRECTORY_REQUIRED/);
  await mkdir(join(repo, 'nested'));
  assert.match((await run([repo, revision, join(repo, 'nested')])).errors, /CHECKPOINT_SEPARATE_DIRECTORY_REQUIRED/);
  assert.equal(git('status', '--porcelain=v1'), status);
  assert.match((await run([join(repo, 'src'), revision, exported])).errors, /SOURCE_REPOSITORY_ROOT_REQUIRED/);
}));

test('CLI requires a full commit ID and rejects refs, abbreviations and blob IDs', () => fixture(async ({ repo, revision, exported, git }) => {
  for (const ref of ['HEAD', revision.slice(0, 7), '--help']) {
    const result = await run([repo, ref, exported]); assert.equal(result.code, 1); assert.match(result.errors, /CHECKPOINT_ARGUMENTS/);
  }
  const blob = git('rev-parse', revision + ':src/main.js').trim();
  assert.match((await run([repo, blob, exported])).errors, /SOURCE_COMMIT_REQUIRED/);
  assert.match((await run([])).errors, /CHECKPOINT_ARGUMENTS/);
}));

test('an oversized exported file is rejected before reading its contents', () => fixture(async ({ repo, revision, exported }) => {
  const handle = await open(join(exported, 'empty.txt'), 'w');
  try { await handle.truncate(64 * 1024 * 1024 + 1); } finally { await handle.close(); }
  const result = await verifySourceCheckpoint(repo, revision, exported);
  assert.equal(result.allMatched, false);
  assert.equal(result.files.find(row => row.path === 'empty.txt').code, 'CHECKPOINT_FILE_SIZE');
  assert.equal(result.summary.inspectedBytes, 14);
}));

test('exported directory junctions cannot redirect reads outside the checkpoint', () => fixture(async ({ container, repo, revision, exported }) => {
  const from = join(exported, 'src'), held = join(container, 'held-source');
  for (const target of [from, held]) {
    const name = relative(container, resolve(target)); assert.ok(name && name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name));
  }
  assert.equal(await realpath(from), resolve(from)); await rename(from, held);
  await symlink(held, from, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await run([repo, revision, exported]);
  assert.equal(result.code, 1); const data = JSON.parse(result.output);
  assert.equal(data.allMatched, false); assert.equal(data.files.find(row => row.path === 'src/main.js').code, 'CHECKPOINT_FILE_TYPE');
  assert.deepEqual(data.unexpected, ['src']);
}));
