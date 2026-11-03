import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = new URL('../src/file-read-status.js', import.meta.url).href;
const setup = readFileSync(new URL('../docs/evidence/2026-11-01-wallet-workspace-legacy-guides/sources/setup.json', import.meta.url), 'utf8');
const period = readFileSync(new URL('../docs/evidence/2026-11-01-wallet-file-batch/first.json', import.meta.url), 'utf8');

// An owned child has a real delayed ESM import, without modifying production imports.
for (const mode of ['files', 'texts']) for (const stop of ['cancelled', 'timed-out']) {
  test(`saved ${mode} batch releases a delayed decoder import on ${stop}, retaining its checked prefix`, { timeout: 20000 }, async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'threecore-batch-import-'));
    const marker = join(scratch, 'waiting');
    let child, close;
    try {
      writeFileSync(join(scratch, 'sources.json'), JSON.stringify([setup, period, period]));
      writeFileSync(join(scratch, 'loader.mjs'), `
import { writeFileSync } from 'node:fs';
export async function load(url, context, nextLoad) {
  if (url.endsWith('/src/period-file.js')) {
    writeFileSync(${JSON.stringify(marker)}, 'waiting');
    await new Promise(() => {});
  }
  return nextLoad(url, context);
}
`);
      writeFileSync(join(scratch, 'child.mjs'), `
import { readFileSync } from 'node:fs';
const { inspectWalletSavedFileBatch, inspectWalletSavedTextBatch, encodeWalletSavedTextBatch } = await import(${JSON.stringify(moduleUrl)});
const texts = JSON.parse(readFileSync(new URL('./sources.json', import.meta.url), 'utf8'));
const abort = new AbortController(), progress = []; let reads = 0;
process.stdin.on('data', () => abort.abort());
const input = texts.map((text, i) => ({ name: 'source-' + i + '.json', ${mode === 'files' ? 'byteLength: Buffer.byteLength(text)' : 'text'} }));
const options = { signal: abort.signal, timeoutMs: ${stop === 'timed-out' ? '3000' : '120000'}, onProgress: value => progress.push(value.checked) };
const result = await ${mode === 'files' ? 'inspectWalletSavedFileBatch(input, index => { reads++; return texts[index]; }, options)' : 'inspectWalletSavedTextBatch(input, options)'};
const receipt = encodeWalletSavedTextBatch(result), completedProgress = JSON.stringify(progress);
process.stdout.write('RESULT ' + JSON.stringify({ phase: result.phase, checked: result.summary.checked, pending: result.summary.pending, statuses: result.files.map(row => row.status), reads, progress }) + String.fromCharCode(10));
await new Promise(resolve => setTimeout(resolve, 100));
process.stdout.write('STABLE ' + JSON.stringify({ unchanged: receipt === encodeWalletSavedTextBatch(result), progressUnchanged: completedProgress === JSON.stringify(progress), reads }) + String.fromCharCode(10), () => process.exit(0));
`);
      let stdout = '', stderr = '', reached = false, cancelled = false, expired = false;
      child = spawn(process.execPath, ['--experimental-loader', pathToFileURL(join(scratch, 'loader.mjs')).href, join(scratch, 'child.mjs')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      close = new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolveExit({ code, signal })); });
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', value => { stdout += value; });
      child.stderr.on('data', value => { stderr += value; });
      const timer = setTimeout(() => { expired = true; child.kill(); }, 12000);
      const poll = setInterval(() => {
        if (!reached && existsSync(marker)) {
          reached = true;
          if (stop === 'cancelled') { cancelled = true; child.stdin.write('cancel\n'); }
        }
      }, 10);
      let exit;
      try { exit = await close; } finally { clearTimeout(timer); clearInterval(poll); }
      assert.equal(expired, false, 'the owned child should finish before its watchdog: ' + JSON.stringify({ reached, cancelled, stdout, stderr }));
      assert.equal(reached, true, 'the real decoder import must actually have been delayed');
      assert.equal(cancelled, stop === 'cancelled');
      assert.equal(exit.code, 0, stderr);
      const lines = stdout.trim().split('\n');
      assert.equal(lines.length, 2, stdout);
      const result = JSON.parse(lines[0].slice('RESULT '.length));
      assert.equal(result.phase, stop);
      assert.equal(result.checked, 1);
      assert.equal(result.pending, 2);
      assert.deepEqual(result.statuses, ['validated-structure', 'pending', 'pending']);
      assert.deepEqual(result.progress, [0, 1]);
      assert.equal(result.reads, mode === 'files' ? 2 : 0);
      assert.deepEqual(JSON.parse(lines[1].slice('STABLE '.length)), { unchanged: true, progressUnchanged: true, reads: result.reads });
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await close; }
      if (!resolve(scratch).startsWith(resolve(tmpdir()) + sep)) throw Error('Unexpected scratch path');
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}
