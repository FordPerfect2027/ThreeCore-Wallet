import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const root = 'C:/Users/aseet/AppData/Local/Temp/threecore-candidate-df9690f-20261101/expanded/ThreeCore-Wallet';
const { createDemoServer } = await import(pathToFileURL(root + '/examples/dev-server.js'));
const server = createDemoServer(), checks = [];
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = 'http://127.0.0.1:' + port;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  for (const [path, file] of [['/','examples/index.html'], ['/rehearsal/','examples/operation-rehearsal.html'],
    ['/examples/wallet-entry.js','examples/wallet-entry.js'], ['/src/wallet-session.js','src/wallet-session.js']]) {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
    const bytes = Buffer.from(await response.arrayBuffer()), expected = await readFile(root + '/' + file);
    const passed = response.status === 200 && bytes.equals(expected) && response.headers.get('cache-control') === 'no-store' && response.headers.get('x-frame-options') === 'DENY';
    checks.push({ path, status: response.status, exactSourceBytes: bytes.equals(expected), sha256: hash(bytes), passed });
  }
  for (const [path, expected, headers] of [['/.env',404,{}],['/test/browser/',404,{}],['/',403,{origin:'https://foreign.example'}]]) {
    const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(5000) });
    await response.arrayBuffer(); checks.push({ path, foreignOrigin: Boolean(headers.origin), status: response.status, passed: response.status === expected });
  }
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
const result = { sourceRevision: 'df9690f7d1b2c1d3a66e104e506a6ac8c732d86f', check: 'fresh-export-local-server-startup',
  loopbackOnly: true, externalRpcRequested: false, browserWalletUsed: false, testPort: port,
  existing4231Restarted: false, ownServerClosed: !server.listening, allPassed: checks.every(check => check.passed), checks };
await writeFile('C:/Users/aseet/AppData/Local/Temp/threecore-candidate-df9690f-20261101/startup-audit.json', JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2)); if (!result.allPassed) process.exitCode = 1;
