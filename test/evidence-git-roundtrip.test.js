import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { verifyEvidenceCollection } from '../scripts/evidence-collection.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

for (const autocrlf of ['false', 'true']) {
  test(`Git checkout preserves original evidence bytes with core.autocrlf=${autocrlf}`, async () => {
    const temp = await realpath(tmpdir());
    const container = await mkdtemp(join(temp, 'threecore-evidence-git-'));
    const seed = join(container, 'seed'), clone = join(container, 'clone'), hooks = join(container, 'hooks');
    const attributesFile = join(container, 'empty-global-attributes');
    const git = (cwd, ...args) => {
      const result = spawnSync('git', ['-c', 'core.hooksPath=' + hooks, '-c', 'core.fsmonitor=false',
        '-c', 'core.attributesFile=' + attributesFile, '-c', 'commit.gpgsign=false',
        '-c', 'user.name=ThreeCore fixture', '-c', 'user.email=fixture@example.invalid', ...args],
      { cwd, windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 524288 });
      assert.equal(result.status, 0, result.stderr); return result.stdout;
    };
    try {
      await mkdir(seed); await mkdir(hooks); await writeFile(attributesFile, '');
      const evidence = join(seed, 'docs/evidence/roundtrip/nested');
      await mkdir(evidence, { recursive: true });
      const files = new Map([
        ['result.json', Buffer.from('{"fixture":true,"events":0}\n')],
        ['exit.txt', Buffer.from('0\n')],
        ['README.md', Buffer.from('# Synthetic evidence\nNo wallet operations.\n')],
        ['native.log', Buffer.from('first\r\nsecond\r\n')],
        ['mixed.txt', Buffer.from('first\nsecond\r\n')],
        ['image.bin', Buffer.from([0, 255, 13, 10, 10, 0])]
      ]);
      for (const [name, bytes] of files) await writeFile(join(evidence, name), bytes);
      const manifest = Buffer.from([...files].map(([name, bytes]) => hash(bytes) + '  ' + name + '\n').join(''));
      await writeFile(join(evidence, 'SHA256SUMS.txt'), manifest);
      const source = 'export const fixture = true;\n';
      await writeFile(join(seed, 'source.js'), source);
      // Exercise the actual repository policy. Missing policy must expose the true-mode regression.
      const policy = await readFile(new URL('../.gitattributes', import.meta.url)).catch(error => {
        if (error.code !== 'ENOENT') throw error; return Buffer.alloc(0);
      });
      await writeFile(join(seed, '.gitattributes'), policy);
      git(seed, 'init', '-q'); git(seed, 'config', 'core.autocrlf', 'false');
      git(seed, 'add', '.'); git(seed, 'commit', '-q', '-m', 'Synthetic exact-byte evidence');
      git(container, 'clone', '--quiet', '--no-local', '-c', 'core.autocrlf=' + autocrlf, seed, clone);
      assert.equal(git(clone, 'config', '--get', 'core.autocrlf').trim(), autocrlf);
      assert.equal(git(clone, 'rev-parse', 'HEAD'), git(seed, 'rev-parse', 'HEAD'));
      // This control proves ordinary source still follows the selected checkout conversion.
      assert.equal(await readFile(join(clone, 'source.js'), 'utf8'), autocrlf === 'true' ? source.replaceAll('\n', '\r\n') : source);
      const before = git(clone, 'status', '--porcelain=v1');
      assert.equal(before, '');
      const result = await verifyEvidenceCollection(clone);
      assert.equal(result.allMatched, true, JSON.stringify(result.summary));
      assert.equal(result.summary.files, files.size);
      for (const [name, bytes] of [...files, ['SHA256SUMS.txt', manifest]]) {
        assert.deepEqual(await readFile(join(clone, 'docs/evidence/roundtrip/nested', name)), bytes, name);
      }
      assert.equal(git(clone, 'status', '--porcelain=v1'), before);
    } finally {
      assert.equal(dirname(resolve(container)), temp);
      assert.ok(basename(container).startsWith('threecore-evidence-git-'));
      assert.equal(await realpath(container), resolve(container));
      await rm(container, { recursive: true });
    }
  });
}
