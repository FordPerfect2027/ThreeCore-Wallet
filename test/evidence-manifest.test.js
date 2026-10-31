import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { parseEvidenceManifest, verifyEvidenceManifest, EVIDENCE_MANIFEST_LIMIT, EVIDENCE_ENTRY_LIMIT } from '../scripts/evidence-manifest.js';
import { runEvidenceManifestVerification } from '../scripts/verify-evidence-manifest.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const line = (path, value = '') => hash(value) + '  ' + path;
async function fixture(action) {
  const root = await realpath(tmpdir()), dir = await mkdtemp(join(root, 'threecore-manifest-'));
  const evidence = join(dir, 'evidence'), manifest = join(evidence, 'SHA256SUMS.txt');
  await mkdir(evidence);
  try { await action({ dir, evidence, manifest }); }
  finally {
    assert.equal(dirname(resolve(dir)), root); assert.ok(basename(dir).startsWith('threecore-manifest-'));
    assert.equal(await realpath(dir), resolve(dir)); await rm(dir, { recursive: true });
  }
}
async function run(args) { let output = '', errors = ''; const code = await runEvidenceManifestVerification(args, { write: text => { output += text; } }, { write: text => { errors += text; } }); return { code, output, errors }; }

test('manifest accepts standard text/binary sums, CRLF, BOM and portable relative names', () => {
  const result = parseEvidenceManifest('\uFEFF' + hash('a').toUpperCase() + ' *nested\\a.log\r\n' + line('日本語の記録.txt') + '\r\n');
  assert.deepEqual(result, [{ path: 'nested/a.log', expectedSha256: hash('a') }, { path: '日本語の記録.txt', expectedSha256: hash('') }]);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result[0]));
});
for (const path of ['../outside', 'a/../outside', '/absolute', '\\server\share\file', 'C:/outside', 'C:relative', 'a:stream',
  '.', '..', 'a//b', 'a/./b', 'a/', 'ending.', 'ending ', 'nul', 'CON.txt', 'COM1.log', 'lpt9', 'a?b', 'a*b', 'a|b',
  'a<b', 'a"b', 'a\u0000b', 'a\tb', 'a\u202eb', 'a'.repeat(256), Array(18).fill('a').join('/')])
  test('manifest rejects unsafe or ambiguous path ' + JSON.stringify(path), () => {
    assert.throws(() => parseEvidenceManifest(line(path)), { code: 'MANIFEST_PATH', line: 1 });
  });
for (const names of [['a.log', 'a.log'], ['A.log', 'a.log'], ['a/b.log', 'a\\b.log'], ['é.log', 'e\u0301.log']])
  test('manifest rejects duplicate portable identity ' + JSON.stringify(names), () => {
    assert.throws(() => parseEvidenceManifest(names.map(name => line(name)).join('\n')), { code: 'MANIFEST_DUPLICATE_PATH', line: 2 });
  });
test('manifest bounds bytes, entries and row syntax before reading artifacts', () => {
  for (const value of [null, {}, ' '.repeat(EVIDENCE_MANIFEST_LIMIT + 1), 'あ'.repeat(100000)])
    assert.throws(() => parseEvidenceManifest(value), { code: 'MANIFEST_SIZE' });
  for (const value of ['not a hash  file', '0'.repeat(64) + ' file', '0'.repeat(63) + '  file', 'g'.repeat(64) + '  file', line('a') + '\n\n' + line('b')])
    assert.throws(() => parseEvidenceManifest(value), { code: 'MANIFEST_ROW' });
  assert.throws(() => parseEvidenceManifest(''), { code: 'MANIFEST_ENTRY_LIMIT' });
  assert.equal(parseEvidenceManifest(Array.from({ length: EVIDENCE_ENTRY_LIMIT }, (_, i) => line('f' + i)).join('\n')).length, EVIDENCE_ENTRY_LIMIT);
  assert.throws(() => parseEvidenceManifest(Array.from({ length: EVIDENCE_ENTRY_LIMIT + 1 }, (_, i) => line('f' + i)).join('\n')), { code: 'MANIFEST_ENTRY_LIMIT' });
});
test('verification reads exact binary, empty and Unicode artifacts without modifying them', () => fixture(async ({ evidence, manifest }) => {
  const values = [['binary.bin', new Uint8Array([0, 255, 128])], ['empty.log', ''], ['日本語.txt', '検証\r\n']];
  for (const [name, data] of values) await writeFile(join(evidence, name), data);
  const text = values.map(([name, data]) => line(name, data)).join('\n') + '\n'; await writeFile(manifest, text);
  const names = await readdir(evidence), result = await verifyEvidenceManifest(manifest);
  assert.equal(result.allMatched, true); assert.equal(result.manifestSha256, hash(text));
  assert.deepEqual(result.summary, { files: 3, matched: 3, mismatched: 0, unreadable: 0, verifiedBytes: 3 + Buffer.byteLength('検証\r\n') });
  assert.equal(result.readOnly, true); assert.equal(result.authenticatesOrigin, false);
  assert.equal(await readFile(manifest, 'utf8'), text); assert.deepEqual(await readdir(evidence), names);
  for (const [name, data] of values) assert.deepEqual(await readFile(join(evidence, name)), Buffer.from(data));
}));
test('mismatched content is distinct from a missing file and preserves matches', () => fixture(async ({ evidence, manifest }) => {
  await writeFile(join(evidence, 'good'), 'good'); await writeFile(join(evidence, 'changed'), 'new');
  await writeFile(manifest, [line('good', 'good'), line('changed', 'old'), line('missing')].join('\n'));
  const result = await verifyEvidenceManifest(manifest);
  assert.deepEqual(result.files.map(row => row.status), ['matched', 'mismatch', 'unreadable']);
  assert.equal(result.files[1].actualSha256, hash('new')); assert.equal(result.files[2].code, 'FILE_MISSING');
  assert.equal(result.allMatched, false); assert.equal(result.summary.verifiedBytes, 7);
}));
test('directory entries and self-reference cannot be presented as verified files', () => fixture(async ({ evidence, manifest }) => {
  await mkdir(join(evidence, 'folder')); await writeFile(manifest, [line('folder'), line('SHA256SUMS.txt')].join('\n'));
  const result = await verifyEvidenceManifest(manifest);
  assert.deepEqual(result.files.map(row => row.code), ['FILE_NOT_REGULAR', 'MANIFEST_SELF_REFERENCE']);
  assert.equal(result.summary.verifiedBytes, 0);
}));
test('a junction outside the evidence directory is refused before producing a file hash', () => fixture(async ({ dir, evidence, manifest }) => {
  const outside = join(dir, 'outside'); await mkdir(outside); await writeFile(join(outside, 'marker'), 'synthetic outside marker');
  await symlink(outside, join(evidence, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(manifest, line('linked/marker', 'synthetic outside marker'));
  const result = await verifyEvidenceManifest(manifest);
  assert.equal(result.files[0].code, 'OUTSIDE_EVIDENCE_DIRECTORY'); assert.equal(Object.hasOwn(result.files[0], 'actualSha256'), false);
  assert.equal(await readFile(join(outside, 'marker'), 'utf8'), 'synthetic outside marker');
}));
test('two aliases of one resolved file are not counted as two independently checked paths', () => fixture(async ({ evidence, manifest }) => {
  const inside = join(evidence, 'inside'); await mkdir(inside); await writeFile(join(inside, 'marker'), 'synthetic');
  await symlink(inside, join(evidence, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(manifest, [line('inside/marker', 'synthetic'), line('linked/marker', 'synthetic')].join('\n'));
  const result = await verifyEvidenceManifest(manifest);
  assert.equal(result.files[0].status, 'matched'); assert.equal(result.files[1].code, 'FILE_ALIAS_DUPLICATE');
}));
test('per-file and aggregate budgets are enforced while empty files remain valid', () => fixture(async ({ evidence, manifest }) => {
  for (const [name, text] of [['large', '12345'], ['small', '123'], ['last', '45'], ['empty', '']]) await writeFile(join(evidence, name), text);
  await writeFile(manifest, [line('large', '12345'), line('small', '123'), line('last', '45'), line('empty')].join('\n'));
  const result = await verifyEvidenceManifest(manifest, { maxFileBytes: 4, maxTotalBytes: 4 });
  assert.deepEqual(result.files.map(row => row.code ?? row.status), ['FILE_SIZE_LIMIT', 'matched', 'TOTAL_SIZE_LIMIT', 'matched']);
  assert.equal(result.summary.verifiedBytes, 3);
}));
test('inspection limits cannot be widened or supplied through executable accessors', async () => {
  let accessed = 0;
  for (const options of [null, [], { unknown: 1 }, { maxFileBytes: -1 }, { maxTotalBytes: Infinity },
    { maxFileBytes: 67108865 }, { maxTotalBytes: 536870913 }, { get maxFileBytes() { accessed++; return 1; } }])
    await assert.rejects(verifyEvidenceManifest('not-read', options), { code: 'INVALID_INSPECTION_LIMITS' });
  assert.equal(accessed, 0);
});
test('CLI returns zero, two and one for agreement, mismatch and unreadable evidence', () => fixture(async ({ evidence, manifest }) => {
  await writeFile(join(evidence, 'sample'), 'sample'); await writeFile(manifest, line('sample', 'sample'));
  let result = await run([manifest]); assert.equal(result.code, 0); assert.equal(result.errors, ''); assert.equal(JSON.parse(result.output).allMatched, true);
  await writeFile(join(evidence, 'sample'), 'changed'); result = await run([manifest]); assert.equal(result.code, 2); assert.equal(JSON.parse(result.output).summary.mismatched, 1);
  await writeFile(manifest, line('missing')); result = await run([manifest]); assert.equal(result.code, 1); assert.equal(JSON.parse(result.output).summary.unreadable, 1);
}));
test('invalid manifests, encoding and arguments never produce partial verification', () => fixture(async ({ dir, manifest }) => {
  for (const args of [[], ['--help'], [manifest, '--write'], [null], [dir], [join(dir, 'absent')]]) {
    const result = await run(args); assert.equal(result.code, 1); assert.equal(result.output, '');
  }
  for (const content of ['invalid private details', line('../outside'), new Uint8Array([255])]) {
    await writeFile(manifest, content); const result = await run([manifest]);
    assert.equal(result.code, 1); assert.equal(result.output, ''); assert.doesNotMatch(result.errors, /private details|outside/);
  }
}));
