import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const evidence = resolve(process.argv[2]), work = resolve(process.argv[3]);
const read = name => readFileSync(resolve(evidence, name), 'utf8').replace(/^\uFEFF/, '');
const json = name => JSON.parse(read(name));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pins = json('token-commits.json'), rows = [];
const normalizedLock = value => {
  const copy = structuredClone(value);
  delete copy.name; delete copy.version;
  delete copy.packages[''].name; delete copy.packages[''].version;
  return copy;
};
const datRoot = resolve(work, 'token-toolchain-empty-data-DAT-20261102');
const datPackage = JSON.parse(readFileSync(resolve(datRoot, 'package.json')));
const datLock = JSON.parse(readFileSync(resolve(datRoot, 'package-lock.json')));
assert.deepEqual(normalizedLock(datLock), normalizedLock(json('clean-install/package-lock.json')));
assert.equal(json('baseline-pure-probe.json').emptyDataPreserved, false);
assert.equal(json('corrected-pure-probe.json').emptyDataPreserved, true);
assert.equal(json('clean-install-pure-probe.json').emptyDataPreserved, true);
assert.match(read('initial-candidate-test.log'), /fail 1/);
const counts = (name, expected) => {
  const text = read(name);
  assert.deepEqual([...text.matchAll(/ℹ pass (\d+)/g)].map(match => Number(match[1])), expected, name);
  assert.deepEqual([...text.matchAll(/ℹ fail (\d+)/g)].map(match => Number(match[1])), expected.map(() => 0), name);
};
for (const {token, commit} of pins) {
  const lower = token.toLowerCase(), candidate = resolve(work, `token-toolchain-empty-data-${token}-20261102`);
  const baseline = resolve(work, `token-dependency-repair-${token}-20261102`);
  const git = args => execFileSync('git', args, {cwd:candidate, encoding:'utf8', windowsHide:true}).trim();
  assert.equal(git(['rev-parse','HEAD']), commit);
  assert.equal(git(['status','--porcelain']), '');
  const pkg = JSON.parse(readFileSync(resolve(candidate,'package.json')));
  const lock = JSON.parse(readFileSync(resolve(candidate,'package-lock.json')));
  assert.deepEqual(pkg.dependencies, datPackage.dependencies);
  assert.deepEqual(pkg.devDependencies, datPackage.devDependencies);
  assert.deepEqual(pkg.overrides, datPackage.overrides);
  assert.deepEqual(normalizedLock(lock), normalizedLock(datLock));
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:baseline,encoding:'utf8',windowsHide:true}).trim(),'');
  counts(`${lower}-toolchain-final.log`, [2]);
  counts(`${lower}-wallet-compatibility.log`, [50]);
  let standardLogs;
  if (token === 'DAT') {
    counts('candidate-source-test.log',[7]);
    counts('candidate-read-only-test.log',[251]);
    counts('dat-history-test.log',[10]);
    assert.match(read('dat-contract-test.log'), /37 passing/);
    standardLogs = ['candidate-source-test.log','dat-toolchain-final.log','candidate-compile.log',
      'dat-contract-test.log','candidate-typecheck.log','candidate-read-only-test.log','dat-history-test.log'];
  } else {
    counts(`${lower}-check.log`,[7,2,227,10]);
    assert.match(read(`${lower}-check.log`), /39 passing/);
    standardLogs = [`${lower}-check.log`, `${lower}-toolchain-final.log`];
  }
  const snapshots = {};
  for(const path of ['package.json','package-lock.json','integration/toolchain-data.test.mjs']) {
    const bytes = execFileSync('git',['show',`${commit}:${path}`],{cwd:candidate,windowsHide:true});
    const output = `${lower}-${path.replaceAll('/','-')}`;
    writeFileSync(resolve(evidence,output),bytes);
    snapshots[path] = {file:output,sha256:hash(bytes)};
  }
  writeFileSync(resolve(evidence,`${lower}-changes.patch`),execFileSync('git',['diff','--binary','HEAD^','HEAD'],{cwd:candidate,windowsHide:true}));
  rows.push({token,parent:git(['rev-parse','HEAD^']),commit,clean:true,originalWorktreeClean:true,
    tests:{sourceAndRouting:7,toolchain:2,contracts:token==='DAT'?37:39,readOnly:token==='DAT'?251:227,localHistory:10,walletCompatibility:50},
    standardPipeline:token==='DAT'?'All individual standard check components executed':'npm run check completed through final local-history stage',
    finalTestResolution:'The pure regression resolves dependencies from Hardhat itself; all three final reruns passed.',
    logs:[...standardLogs,`${lower}-wallet-compatibility.log`],snapshots});
}
for(const name of ['toolchain-final-receipts.json','wallet-compatibility-receipts.json','offline-workflow-receipts.json']) {
  for(const row of json(name)) assert.equal(row.exitCode,0,name);
}
for(const name of ['clean-install-receipt.json','clean-install-test-receipt.json','cawelon-check-receipt.json']) assert.equal(json(name).exitCode,0,name);
const advisory = json('candidate-audit.json');
const roots = [...new Set(Object.values(advisory.vulnerabilities).flatMap(value=>value.via.filter(v=>typeof v==='object').map(v=>v.url)))];
assert.equal(roots.length,1);
assert.match(roots[0],/GHSA-mrhx-c7xc-m3w5$/);
const result = {schema:'threecore.toolchain-empty-data-review.v1',recordedAt:new Date().toISOString(),node:process.version,
  walletSource:'ed32d7cd2593f8fc73b5a46ac27b6b1b2454d6c2',tokens:rows,
  installation:{primary:'One DAT dependency installation, shared by junction with EMA and CAWELON; three independent token sources/artifacts were tested.',
    cleanReproduction:'A separate initially empty installation reproduced the corrected lock and pure regression. Existing npm cache was reused; install scripts were disabled.',
    cleanInstallLog:'clean-install.log',cleanInstallTestLog:'clean-install-toolchain-test.log'},
  artifactComparison:'artifact-comparisons.json',upstream:['https://github.com/NomicFoundation/hardhat/pull/8765','https://github.com/NomicFoundation/hardhat/issues/8790'],
  remainingAudit:{rootAdvisories:roots,packageEntries:Object.keys(advisory.vulnerabilities).length,resolved:false},
  scope:'Local Windows development-toolchain repair. Contract/history compatibility uses synthetic in-process EVM fixtures, including synthetic transactions/signatures. No user wallet, public transaction, private key or seed was accessed.',
  exclusions:['No new live-wallet switching result','No independent review','No deployment or release approval','No remote publication or CI rerun','Not a readiness percentage']};
writeFileSync(resolve(evidence,'results.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({tokens:rows.map(row=>({token:row.token,commit:row.commit,tests:row.tests})),remainingAudit:result.remainingAudit},null,2));
