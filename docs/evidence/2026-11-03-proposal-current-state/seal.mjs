import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dir = new URL('.', import.meta.url), root = fileURLToPath(new URL('../../../', dir));
const hash = b => createHash('sha256').update(b).digest('hex');
const source = ['src/base-fee-reader.js','src/proposal-state-review.js','src/proposal-state-reader.js','src/proposal-state-client.js','examples/dev-server.js','examples/proposal-fee-http.js','examples/proposal-fee.html','examples/proposal-state.html','examples/proposal-state-page.js','scripts/read-proposal-state.js','test/helpers/proposal-state-rpc-fixture.js','test/proposal-state.test.js','test/proposal-state-page.test.js','test/proposal-state-transport.test.js','test/proposal-state-cli.test.js'];
const sourceFiles = await Promise.all(source.map(async path => { const bytes = await readFile(new URL('../../../' + path, dir)); return { path, bytes: bytes.length, sha256: hash(bytes) }; }));
const servers = await Promise.all([4231,4232,4233,4260].map(async port => { const response = await fetch('http://127.0.0.1:' + port + '/'); await response.text(); if(response.status !== 200) throw Error('SERVER_CHANGED'); return { port, status: response.status }; }));
const zip = await readFile('C:/Users/aseet/Downloads/ThreeCore-complete-288efc3-20261103-r1.zip');
if(hash(zip) !== 'de2028b902abfa0925fbeb0aaaf1080d3f53a66a4d842bf03c56b54330b57f1b') throw Error('PRIOR_ZIP_CHANGED');
const tap = await readFile(new URL('final-tests.tap',dir),'utf8'), serverTap = await readFile(new URL('server-regression.tap',dir),'utf8');
if(!/# tests 183\r?\n/.test(tap)||!/# fail 0\r?\n/.test(tap)||!/# tests 2\r?\n/.test(serverTap)||!/# fail 0\r?\n/.test(serverTap)) throw Error('TEST_SUMMARY');
const summary = { sourceBaseCommit: execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), sourceFiles, publicReadBlock:'53463194', actualBrowserReadBlock:'53463239',
  tests:{related:183,ordinaryServer:2,failed:0,earlierFocusedRunOverlaps:true}, originalServers:servers, priorZipUnchanged:true,
  publicSwapSuccessClaimed:false, sourceAuthorityAuthenticated:false, currentStateGuaranteed:false, userWalletSigned:false, transactionBroadcast:false, githubPublished:false };
await writeFile(new URL('summary.json',dir),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
const names=(await readdir(dir)).filter(n=>n!=='SHA256SUMS').sort(), lines=[];
for(const name of names) lines.push(hash(await readFile(new URL(name,dir)))+'  '+name);
await writeFile(new URL('SHA256SUMS',dir),lines.join('\n')+'\n',{flag:'wx'});
console.log(JSON.stringify({sealedFiles:names.length,tests:summary.tests,priorZipUnchanged:true,servers}));
