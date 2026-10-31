import { createHash } from 'node:crypto';
import { open, realpath, lstat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { readBoundedLocalBytes } from './read-bounded-local-file.js';

export const EVIDENCE_MANIFEST_LIMIT = 256 * 1024;
export const EVIDENCE_ENTRY_LIMIT = 1024;
export const EVIDENCE_INSPECTION_LIMITS = Object.freeze({ maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024 });
export class EvidenceManifestError extends Error {
  constructor(code, line = null) { super(code); this.name = 'EvidenceManifestError'; this.code = code; this.line = line; }
}
const fail = (code, line) => { throw new EvidenceManifestError(code, line); };

/** Portable SHA-256 sum rows. Names are data, never commands or absolute paths. */
export function parseEvidenceManifest(text) {
  if (typeof text !== 'string' || text.length > EVIDENCE_MANIFEST_LIMIT || Buffer.byteLength(text) > EVIDENCE_MANIFEST_LIMIT)
    fail('MANIFEST_SIZE');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length || lines.length > EVIDENCE_ENTRY_LIMIT) fail('MANIFEST_ENTRY_LIMIT');
  const seen = new Set();
  return Object.freeze(lines.map((line, index) => {
    const matched = /^([a-fA-F0-9]{64}) ([ *])(.+)$/.exec(line);
    if (!matched) fail('MANIFEST_ROW', index + 1);
    const path = matched[3].replaceAll('\\', '/'), parts = path.split('/');
    if (!path || path.length > 1024 || path.startsWith('/') || parts.length > 16 || parts.some(part =>
      !part || part === '.' || part === '..' || part.length > 255 || /[. ]$/.test(part) ||
      /[<>:"|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('MANIFEST_PATH', index + 1);
    const identity = path.normalize('NFC').toLowerCase();
    if (seen.has(identity)) fail('MANIFEST_DUPLICATE_PATH', index + 1);
    seen.add(identity);
    return Object.freeze({ path, expectedSha256: matched[1].toLowerCase() });
  }));
}

function inspectionLimits(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))) fail('INVALID_INSPECTION_LIMITS');
  const limits = { ...EVIDENCE_INSPECTION_LIMITS };
  for (const name of Reflect.ownKeys(options)) {
    const descriptor = Object.getOwnPropertyDescriptor(options, name);
    if (!Object.hasOwn(limits, name) || !descriptor || !Object.hasOwn(descriptor, 'value') ||
        !Number.isSafeInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > limits[name]) fail('INVALID_INSPECTION_LIMITS');
    limits[name] = descriptor.value;
  }
  return Object.freeze(limits);
}
function contained(root, path) {
  const name = relative(root, path);
  return Boolean(name) && name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name);
}
const metadataKeys = ['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'];
const sameFile = (before, after) => after.isFile() && metadataKeys.every(name => before[name] === after[name]);
function errorCode(error) {
  if (error instanceof EvidenceManifestError) return error.code;
  if (error?.code === 'ENOENT') return 'FILE_MISSING';
  if (['EACCES', 'EPERM'].includes(error?.code)) return 'FILE_ACCESS_DENIED';
  return 'FILE_READ_FAILED';
}

/** Inspect only local files below the real parent of this manifest. Never write or fetch. */
export async function verifyEvidenceManifest(file, options = {}) {
  const limits = inspectionLimits(options);
  if (typeof file !== 'string' || !file) fail('INVALID_MANIFEST_PATH');
  const requested = resolve(file), manifestInfo = await lstat(requested);
  if (!manifestInfo.isFile()) fail('MANIFEST_NOT_REGULAR');
  const manifestPath = await realpath(requested), root = dirname(manifestPath);
  const bytes = await readBoundedLocalBytes(manifestPath, EVIDENCE_MANIFEST_LIMIT,
    { fail, sizeCode: 'MANIFEST_SIZE', changedCode: 'MANIFEST_CHANGED' });
  async function manifestUnchanged() {
    if (await realpath(requested) !== manifestPath || !sameFile(manifestInfo, await lstat(manifestPath))) fail('MANIFEST_CHANGED');
  }
  await manifestUnchanged();
  const manifestSha256 = createHash('sha256').update(bytes).digest('hex');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail('MANIFEST_ENCODING'); }
  const entries = parseEvidenceManifest(text), results = [], targets = new Set(); let reservedBytes = 0, verifiedBytes = 0;
  for (const entry of entries) {
    try {
      const candidate = resolve(root, ...entry.path.split('/')), actual = await realpath(candidate);
      if (!contained(root, actual)) fail('OUTSIDE_EVIDENCE_DIRECTORY');
      if (relative(manifestPath, actual) === '') fail('MANIFEST_SELF_REFERENCE');
      const identity = process.platform === 'win32' ? actual.toLowerCase() : actual;
      if (targets.has(identity)) fail('FILE_ALIAS_DUPLICATE');
      targets.add(identity);
      const info = await lstat(actual);
      if (!info.isFile()) fail('FILE_NOT_REGULAR');
      const handle = await open(actual, 'r');
      let actualSha256, size;
      try {
        const before = await handle.stat(); size = before.size;
        if (!before.isFile() || !Number.isSafeInteger(size) || size < 0) fail('FILE_NOT_REGULAR');
        if (!sameFile(info, before)) fail('FILE_CHANGED');
        if (size > limits.maxFileBytes) fail('FILE_SIZE_LIMIT');
        if (size > limits.maxTotalBytes - reservedBytes) fail('TOTAL_SIZE_LIMIT');
        reservedBytes += size;
        const hash = createHash('sha256'), buffer = new Uint8Array(Math.min(65536, Math.max(1, size)));
        let offset = 0;
        while (offset < size) {
          const length = Math.min(buffer.length, size - offset), { bytesRead } = await handle.read(buffer, 0, length, offset);
          if (!Number.isSafeInteger(bytesRead) || bytesRead < 1 || bytesRead > length) fail('FILE_CHANGED');
          hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
        }
        const extra = await handle.read(new Uint8Array(1), 0, 1, size), after = await handle.stat();
        if (extra.bytesRead !== 0 || !sameFile(before, after) || await realpath(candidate) !== actual ||
            !sameFile(before, await lstat(actual))) fail('FILE_CHANGED');
        actualSha256 = hash.digest('hex'); verifiedBytes += size;
      } finally { await handle.close(); }
      results.push(Object.freeze({ ...entry, status: actualSha256 === entry.expectedSha256 ? 'matched' : 'mismatch', bytes: size, actualSha256 }));
    } catch (error) { results.push(Object.freeze({ ...entry, status: 'unreadable', code: errorCode(error) })); }
  }
  await manifestUnchanged();
  const summary = Object.freeze({ files: entries.length, matched: results.filter(row => row.status === 'matched').length,
    mismatched: results.filter(row => row.status === 'mismatch').length, unreadable: results.filter(row => row.status === 'unreadable').length,
    verifiedBytes, admittedBytes: reservedBytes });
  return Object.freeze({ schema: 'threecore.local-evidence-verification.v1', readOnly: true, authenticatesOrigin: false,
    manifestSha256, allMatched: summary.matched === summary.files, limits, summary, files: Object.freeze(results) });
}
