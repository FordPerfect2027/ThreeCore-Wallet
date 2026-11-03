import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { resolve, relative, isAbsolute, sep } from 'node:path';

assert.equal(process.argv.length, 4, 'Usage: node verify-restored-startup.mjs <restored-Wallet> <loopback-origin>');
const root = resolve(process.argv[2]);
const origin = new URL(process.argv[3]);
assert.equal(origin.protocol, 'http:');
assert.equal(origin.hostname, '127.0.0.1');
assert(Number(origin.port) >= 1024 && Number(origin.port) <= 65535);
assert.equal(origin.href, origin.origin + '/');
const pageSources = new Map([['/', 'examples/index.html'], ['/rehearsal/', 'examples/operation-rehearsal.html'], ['/tokens/read/', 'examples/public-token-batch.html'], ['/budget/', 'examples/operation-budget.html'], ['/budget/shared/', 'examples/shared-operation-budget.html'], ['/budget/evidence/', 'examples/operation-budget-evidence.html'], ['/usdc/read/','examples/public-usdc.html'], ['/proposals/new/','examples/operation-proposal-draft.html'], ['/proposals/','examples/operation-proposal.html'], ['/quotes/','examples/aerodrome-quote.html'], ['/proposals/quote/','examples/proposal-quote.html'], ['/proposals/allowance/','examples/proposal-allowance.html'], ['/proposals/fees/','examples/proposal-fee.html']]);
const pending = [...pageSources.keys()];
const visited = new Set();
const assets = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function queue(specifier, from) {
  const url = new URL(specifier, new URL(from, origin));
  assert.equal(url.origin, origin.origin, 'Only local app assets may be inspected');
  assert(!url.search && !url.hash, 'Unexpected asset suffix');
  assert(/^\/(?:src|examples)\/[A-Za-z0-9_./-]+\.(?:js|css)$/.test(url.pathname), 'Unexpected asset path: ' + url.pathname);
  if (!visited.has(url.pathname) && !pending.includes(url.pathname)) pending.push(url.pathname);
}
while (pending.length) {
  const route = pending.shift();
  if (visited.has(route)) continue;
  assert(visited.size < 1000, 'Asset count limit');
  visited.add(route);
  const response = await fetch(new URL(route, origin), { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, route);
  assert.equal(response.headers.get('cache-control'), 'no-store', route);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', route);
  assert.equal(response.headers.get('x-frame-options'), 'DENY', route);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length < 2 * 1024 * 1024, 'Asset size limit');
  const sourcePath = pageSources.get(route) ?? route.slice(1);
  const target = resolve(root, sourcePath);
  const within = relative(root, target);
  assert(within && within !== '..' && !within.startsWith('..' + sep) && !isAbsolute(within));
  const source = await readFile(target);
  assert.equal(sha256(bytes), sha256(source), 'Served/source mismatch: ' + route);
  assets.push({ route, sourcePath, bytes: bytes.length, sha256: sha256(bytes), matched: true });
  const text = bytes.toString('utf8');
  if (route.endsWith('.js')) {
    assert.match(response.headers.get('content-type'), /^text\/javascript/);
    // This bounded graph check covers literal ESM dependencies; it does not execute JavaScript.
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)) {
      if (/^(?:\.{1,2}\/|\/)/.test(match[1])) queue(match[1], route);
    }
  } else if (route.endsWith('.css')) {
    assert.match(response.headers.get('content-type'), /^text\/css/);
  } else {
    assert.match(response.headers.get('content-type'), /^text\/html/);
    for (const match of text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) queue(match[1], route);
    for (const match of text.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["']/g)) queue(match[1], route);
  }
}
const denied = [];
for (const route of ['/test/browser/', '/test/browser/ui-tests.js', '/test/browser/acceptance-fixture.js', '/package.json']) {
  const response = await fetch(new URL(route, origin), { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 404, route);
  await response.text();
  denied.push({ route, status: response.status });
}
// Node fetch rewrites sec-fetch-mode. Use a raw HTTP client for this negative
// navigation fixture, as the existing local-navigation integration test does.
const crossOrigin = await new Promise((done, fail) => {
  const call = request(origin, { headers: { origin: 'https://example.invalid', 'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }, response => {
    const chunks = []; let size = 0;
    response.on('data', chunk => { size += chunk.length; if (size > 65536) call.destroy(new Error('Response limit')); else chunks.push(chunk); });
    response.on('end', () => done({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    response.on('error', fail);
  });
  call.on('error', fail);
  call.setTimeout(10000, () => call.destroy(new Error('Request deadline')));
  call.end();
});
assert.equal(crossOrigin.status, 403);
const help = crossOrigin.text;
assert.match(help, /ThreeCore Walletを開く/);
assert.match(help, /href="\/"/);
assert(!help.includes('http-equiv="refresh"'));
console.log(JSON.stringify({ recordedAt: new Date().toISOString(), origin: origin.origin,
  mode: 'ordinary npm run demo, no --ui-test', assetCount: assets.length,
  allServedBytesMatch: true, assets, denied, crossOriginNavigation: { status: 403, explicitLocalLink: true },
  scope: 'HTTP startup and literal module/CSS availability only. No browser rendering, wallet, external RPC or new full regression.' }, null, 2));
