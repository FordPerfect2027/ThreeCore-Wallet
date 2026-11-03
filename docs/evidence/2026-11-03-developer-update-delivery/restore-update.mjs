import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPackage } from './verify-package.mjs';

const [baseArgument, targetArgument] = process.argv.slice(2);
assert(process.argv.length === 4, 'Usage: node restore-update.mjs <extracted-base-package> <new-directory>');
const updateRoot = dirname(fileURLToPath(import.meta.url));
const baseRoot = await realpath(resolve(baseArgument));
const targetRoot = resolve(targetArgument);
const updateVerification = await verifyPackage(updateRoot);
const baseVerification = await verifyPackage(baseRoot);
const receipt = JSON.parse(await readFile(resolve(updateRoot, 'update-receipt.json'), 'utf8'));
assert.equal(receipt.schema, 'threecore.developer-review-update.v1');
assert.deepEqual(receipt.sources.map(source => source.name), ['Wallet', 'DAT', 'EMA', 'CAWELON']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
for (const source of receipt.sources) {
  for (const key of ['base', 'revision', 'tree']) assert.match(source[key], /^[a-f0-9]{40}$/);
  assert.equal(source.updateBundle, source.name.toLowerCase() + '.bundle');
  assert.equal(source.baseBundle, source.name === 'Wallet' ? 'wallet/history.bundle' : `tokens/${source.name}/history.bundle`);
  assert.equal(digest(await readFile(resolve(updateRoot, source.updateBundle))), source.sha256);
  assert.equal(digest(await readFile(resolve(baseRoot, source.baseBundle))), source.baseBundleSha256);
}
// This directory must not exist. Never update a user's existing checkout.
await mkdir(targetRoot);
const observations = [];
function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
for (const source of receipt.sources) {
  const target = resolve(targetRoot, source.name);
  git(targetRoot, 'clone', '--no-checkout', resolve(baseRoot, source.baseBundle), target);
  git(target, 'config', 'core.autocrlf', 'false');
  git(target, 'remote', 'remove', 'origin');
  git(target, 'checkout', '--detach', source.base);
  assert.equal(git(target, 'rev-parse', 'HEAD'), source.base);
  git(target, 'bundle', 'verify', resolve(updateRoot, source.updateBundle));
  git(target, 'fetch', resolve(updateRoot, source.updateBundle), source.revision);
  git(target, 'checkout', '--detach', source.revision);
  assert.equal(git(target, 'rev-parse', 'HEAD'), source.revision);
  assert.equal(git(target, 'rev-parse', 'HEAD^{tree}'), source.tree);
  assert.equal(git(target, 'status', '--porcelain'), '');
  assert.equal(git(target, 'remote'), '');
  git(target, 'fsck', '--full', '--no-reflogs');
  observations.push({ name: source.name, revision: source.revision, tree: source.tree,
    clean: true, noRemotes: true, objectIntegrityVerified: true });
}
const result = { recordedAt: new Date().toISOString(), updateVerification, baseVerification, observations };
await writeFile(resolve(targetRoot, 'restoration-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
