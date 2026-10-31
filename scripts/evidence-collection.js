import { spawnSync } from 'node:child_process';
import { realpath, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { parseEvidenceManifest, verifyEvidenceManifest, EvidenceManifestError, EVIDENCE_INSPECTION_LIMITS } from './evidence-manifest.js';
const fail = code => { throw new EvidenceManifestError(code); };
const git = (root, args) => {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 512 * 1024,
  });
  if (result.status !== 0 || result.error) fail('EVIDENCE_REPOSITORY_UNAVAILABLE');
  return result.stdout;
};
function namesFromIndex(text) {
  const names = text.split('\0').filter(Boolean).filter(name => /(^|\/)SHA256SUMS\.txt$/.test(name));
  if (!names.length) fail('NO_TRACKED_EVIDENCE_MANIFESTS');
  if (names.length > 256) fail('EVIDENCE_COLLECTION_LIMIT');
  let parsed;
  try { parsed = parseEvidenceManifest(names.map(name => '0'.repeat(64) + '  ' + name).join('\n')); }
  catch { fail('UNSAFE_TRACKED_MANIFEST_PATH'); }
  if (parsed.length !== names.length || parsed.some((entry, i) => entry.path !== names[i])) fail('UNSAFE_TRACKED_MANIFEST_PATH');
  return names;
}

/** Check current working files identified by Git's index. Does not fetch, stage or commit. */
export async function verifyEvidenceCollection(repository, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).some(key => key !== 'maxTotalBytes'))
    fail('INVALID_EVIDENCE_COLLECTION_ARGUMENTS');
  const descriptor = Object.getOwnPropertyDescriptor(options, 'maxTotalBytes');
  if (descriptor && !Object.hasOwn(descriptor, 'value')) fail('INVALID_EVIDENCE_COLLECTION_ARGUMENTS');
  const maxTotalBytes = descriptor ? descriptor.value : EVIDENCE_INSPECTION_LIMITS.maxTotalBytes;
  if (typeof repository !== 'string' || !repository || !Number.isSafeInteger(maxTotalBytes) ||
      maxTotalBytes < 0 || maxTotalBytes > EVIDENCE_INSPECTION_LIMITS.maxTotalBytes) fail('INVALID_EVIDENCE_COLLECTION_ARGUMENTS');
  const root = await realpath(resolve(repository)), actualRoot = await realpath(git(root, ['rev-parse', '--show-toplevel']).trim());
  if (root !== actualRoot) fail('EVIDENCE_REPOSITORY_ROOT_REQUIRED');
  const headRevision = git(root, ['rev-parse', 'HEAD']).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(headRevision)) fail('EVIDENCE_REPOSITORY_UNAVAILABLE');
  const listing = git(root, ['ls-files', '-z', '--', '*SHA256SUMS.txt']), names = namesFromIndex(listing);
  const manifests = [], canonicalManifests = new Set(); let admittedBytes = 0;
  for (const name of names) {
    try {
      const requested = resolve(root, ...name.split('/'));
      if (!(await lstat(requested)).isFile()) fail('MANIFEST_NOT_REGULAR');
      const canonical = await realpath(requested), within = relative(root, canonical);
      if (!within || within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) fail('MANIFEST_OUTSIDE_REPOSITORY');
      const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
      if (canonicalManifests.has(identity)) fail('MANIFEST_ALIAS_DUPLICATE');
      canonicalManifests.add(identity);
      const result = await verifyEvidenceManifest(canonical, { maxTotalBytes: maxTotalBytes - admittedBytes });
      admittedBytes += result.summary.admittedBytes;
      manifests.push(Object.freeze({ path: name, result }));
    } catch (error) {
      manifests.push(Object.freeze({ path: name, error: error instanceof EvidenceManifestError ? error.code : 'MANIFEST_READ_FAILED' }));
    }
  }
  if (git(root, ['rev-parse', 'HEAD']).trim() !== headRevision || git(root, ['ls-files', '-z', '--', '*SHA256SUMS.txt']) !== listing)
    fail('EVIDENCE_COLLECTION_CHANGED');
  const summary = Object.freeze({ manifests: names.length, matchedManifests: manifests.filter(row => row.result?.allMatched).length,
    failedManifests: manifests.filter(row => row.error || row.result.summary.unreadable > 0).length,
    files: manifests.reduce((sum, row) => sum + (row.result?.summary.files ?? 0), 0),
    mismatchedFiles: manifests.reduce((sum, row) => sum + (row.result?.summary.mismatched ?? 0), 0),
    unreadableFiles: manifests.reduce((sum, row) => sum + (row.result?.summary.unreadable ?? 0), 0),
    verifiedBytes: manifests.reduce((sum, row) => sum + (row.result?.summary.verifiedBytes ?? 0), 0), admittedBytes });
  return Object.freeze({ schema: 'threecore.local-evidence-collection-verification.v1', readOnly: true, authenticatesOrigin: false,
    workingTreeFiles: true, headRevision, maxTotalBytes, allMatched: summary.matchedManifests === names.length,
    summary, manifests: Object.freeze(manifests) });
}
