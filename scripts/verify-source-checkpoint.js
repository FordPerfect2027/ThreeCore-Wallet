#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEvidenceManifest } from './evidence-manifest.js';

const LIMITS = Object.freeze({ files: 10000, fileBytes: 64 * 1024 * 1024, totalBytes: 256 * 1024 * 1024 });
class CheckpointError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new CheckpointError(code); };
function git(root, args) {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: root, windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail('SOURCE_GIT_READ_FAILED');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(result.stdout); }
  catch { fail('SOURCE_PATH_ENCODING'); }
}
const same = (a, b) => b.isFile() && ['size','mtimeNs','ctimeNs','ino','dev'].every(key => a[key] === b[key]);
function inside(root, file) {
  const name = relative(root, file);
  return name && name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name);
}
function treeEntries(text) {
  const rows = text.split('\0').filter(Boolean);
  if (!rows.length || rows.length > LIMITS.files) fail('SOURCE_FILE_COUNT');
  const identities = new Set();
  return rows.map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/.exec(row);
    if (!match) fail('SOURCE_ENTRY_TYPE');
    const [, mode, objectId, path] = match;
    let parsed;
    try { [parsed] = parseEvidenceManifest('0'.repeat(64) + '  ' + path + '\n'); }
    catch { fail('SOURCE_UNSAFE_PATH'); }
    if (parsed.path !== path || path.split('/').some(part => part.toLowerCase() === '.git')) fail('SOURCE_UNSAFE_PATH');
    const identity = path.normalize('NFC').toLowerCase();
    if (identities.has(identity)) fail('SOURCE_PATH_COLLISION');
    identities.add(identity);
    return { path, mode, objectId };
  });
}
async function inventory(root) {
  const paths = [], queue = ['']; let count = 0;
  while (queue.length) {
    const directory = queue.pop();
    if (directory.split('/').length > 16) fail('CHECKPOINT_DIRECTORY_DEPTH');
    const absolute = resolve(root, directory);
    const info = await lstat(absolute);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(absolute) !== absolute) fail('CHECKPOINT_UNSAFE_DIRECTORY');
    for (const name of await readdir(absolute)) {
      if (++count > LIMITS.files * 2) fail('CHECKPOINT_ENTRY_COUNT');
      const path = directory ? directory + '/' + name : name, target = resolve(root, path);
      if (!inside(root, target)) fail('CHECKPOINT_UNSAFE_PATH');
      const item = await lstat(target);
      if (item.isDirectory() && !item.isSymbolicLink()) queue.push(path);
      else paths.push(path);
    }
  }
  return paths.sort();
}
async function hashFile(root, entry, budget) {
  const file = resolve(root, entry.path), info = await lstat(file, { bigint: true });
  if (!inside(root, file) || !info.isFile() || info.isSymbolicLink() || await realpath(file) !== file) fail('CHECKPOINT_FILE_TYPE');
  if (info.size < 0n || info.size > BigInt(LIMITS.fileBytes)) fail('CHECKPOINT_FILE_SIZE');
  const size = Number(info.size);
  if (size > LIMITS.totalBytes - budget.bytes) fail('CHECKPOINT_TOTAL_SIZE');
  budget.bytes += size;
  const handle = await open(file, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    if (!same(info, before)) fail('CHECKPOINT_FILE_CHANGED');
    const objectHash = createHash(entry.objectId.length === 40 ? 'sha1' : 'sha256').update('blob ' + size + '\0');
    const sha256 = createHash('sha256'), buffer = new Uint8Array(65536); let offset = 0;
    while (offset < size) {
      const length = Math.min(buffer.length, size - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead < 1 || bytesRead > length) fail('CHECKPOINT_FILE_CHANGED');
      const bytes = buffer.subarray(0, bytesRead); objectHash.update(bytes); sha256.update(bytes); offset += bytesRead;
    }
    const extra = await handle.read(new Uint8Array(1), 0, 1, size);
    if (extra.bytesRead !== 0 || !same(before, await handle.stat({ bigint: true })) ||
        !same(before, await lstat(file, { bigint: true })) || await realpath(file) !== file) fail('CHECKPOINT_FILE_CHANGED');
    return { bytes: size, sha256: sha256.digest('hex'), matches: objectHash.digest('hex') === entry.objectId };
  } finally { await handle.close(); }
}

/** Compare a plain source export with an explicitly selected local Git commit. No writes, network, checkout or execution. */
export async function verifySourceCheckpoint(repository, revision, exportedDirectory) {
  if (typeof repository !== 'string' || !repository || typeof exportedDirectory !== 'string' || !exportedDirectory ||
      typeof revision !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)) fail('CHECKPOINT_ARGUMENTS');
  const repo = await realpath(resolve(repository));
  if (await realpath(git(repo, ['rev-parse', '--show-toplevel']).trim()) !== repo) fail('SOURCE_REPOSITORY_ROOT_REQUIRED');
  if (git(repo, ['cat-file', '-t', revision]).trim() !== 'commit') fail('SOURCE_COMMIT_REQUIRED');
  const entries = treeEntries(git(repo, ['ls-tree', '-rz', '--full-tree', revision]));
  const requested = resolve(exportedDirectory), root = await realpath(requested);
  if (!(await lstat(requested)).isDirectory() || (await lstat(requested)).isSymbolicLink()) fail('CHECKPOINT_DIRECTORY_REQUIRED');
  if (root === repo || inside(repo, root) || inside(root, repo)) fail('CHECKPOINT_SEPARATE_DIRECTORY_REQUIRED');
  const originalPaths = await inventory(root), expected = new Set(entries.map(item => item.path));
  const unexpected = originalPaths.filter(path => !expected.has(path)), files = [], budget = { bytes: 0 };
  for (const entry of entries) {
    try {
      const result = await hashFile(root, entry, budget);
      files.push({ path: entry.path, status: result.matches ? 'matched' : 'mismatched', bytes: result.bytes, sha256: result.sha256 });
    } catch (error) {
      files.push({ path: entry.path, status: 'unreadable', code: error instanceof CheckpointError ? error.code : error?.code === 'ENOENT' ? 'CHECKPOINT_FILE_MISSING' : 'CHECKPOINT_READ_FAILED' });
    }
  }
  if (root !== await realpath(requested) || JSON.stringify(originalPaths) !== JSON.stringify(await inventory(root))) fail('CHECKPOINT_CONTENTS_CHANGED');
  const summary = { files: files.length, matched: files.filter(row => row.status === 'matched').length,
    mismatched: files.filter(row => row.status === 'mismatched').length, unreadable: files.filter(row => row.status === 'unreadable').length,
    unexpected: unexpected.length, inspectedBytes: budget.bytes };
  return { schema: 'threecore.source-checkpoint-verification.v1', sourceRevision: revision, readOnly: true,
    authenticatesPublisher: false, verifiesExecutableMode: false, pointInTime: true, limits: LIMITS,
    allMatched: summary.matched === summary.files && !summary.unexpected, summary, unexpected, files };
}

export async function runSourceCheckpointVerification(args, output = process.stdout, errors = process.stderr) {
  try {
    if (!Array.isArray(args) || args.length !== 3) fail('CHECKPOINT_ARGUMENTS');
    const result = await verifySourceCheckpoint(...args); output.write(JSON.stringify(result, null, 2) + '\n');
    return result.summary.unreadable ? 1 : result.allMatched ? 0 : 2;
  } catch (error) {
    errors.write('Source checkpoint verification failed: ' + (error instanceof CheckpointError ? error.code : 'CHECKPOINT_READ_FAILED') + '\n');
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runSourceCheckpointVerification(process.argv.slice(2));
