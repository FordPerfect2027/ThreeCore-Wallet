import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const paths=JSON.parse(readFileSync('C:/Users/aseet/Downloads/ThreeCore-runtime-installation-20261102/paths.json','utf8'));
const repoRoot='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const rows=[];
for(const token of ['DAT','EMA','CAWELON']){
 const repo=repoRoot+'token-dependency-repair-'+token+'-20261102';
 const fresh=join(paths.owned,token==='DAT'?'minimal':token+'-minimal');
 const logName=token==='DAT'?'minimal-readonly-regression.log':token+'-minimal-readonly.log';
 const installName=token==='DAT'?'minimal-production-install.log':token+'-minimal-install.log';
 const text=readFileSync(join(paths.output,logName),'utf8');
 const counts={};for(const name of ['tests','pass','fail','cancelled','skipped','todo']){
  const match=text.match(new RegExp('^(?:#|ℹ) '+name+' (\\d+)\\s*$','m'));assert(match,'Missing '+name+' '+token);counts[name]=Number(match[1]);
 }
 assert.deepEqual(counts,{tests:213,pass:213,fail:0,cancelled:0,skipped:0,todo:0});
 assert.match(readFileSync(join(paths.output,installName),'utf8'),/added 19 packages/);
 const installed=Object.entries(JSON.parse(readFileSync(join(fresh,'node_modules/.package-lock.json'),'utf8')).packages).map(([name,p])=>({name,version:p.version}));assert.equal(installed.length,19);
 for(const name of ['hardhat','solc','typescript','zod']){assert(!installed.some(p=>p.name.endsWith('/'+name)));assert(!existsSync(join(fresh,'node_modules',name)));}
 const fingerprints={};for(const name of ['package.json','package-lock.json']){
  assert.deepEqual(JSON.parse(readFileSync(join(fresh,name),'utf8')),JSON.parse(readFileSync(join(repo,name),'utf8')),token+' tested package mismatch');
  fingerprints[name]=hash(readFileSync(join(repo,name)));
 }
 const git=args=>execFileSync('git',args,{cwd:repo,windowsHide:true,encoding:'utf8'}).trim();
 assert.equal(git(['diff','--name-only','HEAD','--','src','scripts','test','contracts','hardhat.config.ts']),'');
 rows.push({token,baseCommit:git(['rev-parse','HEAD']),sourcePackageSha256:fingerprints,readOnlySuite:counts,rawRegressionLog:logName,rawInstallLog:installName,rawRegressionSha256:hash(readFileSync(join(paths.output,logName))),installedPackages:installed});
}
const record={recordedAt:new Date().toISOString(),node:process.version,npm:'11.17.0',platform:process.platform,verification:'Fresh isolated source exports with their own npm ci installations; no shared node_modules',installation:'npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund',tokens:rows,packageVersionsAndResolvedIntegrityUnchanged:true,fullGraphPackagesExcludingRoot:141,minimalInstalledPackages:19,ordinaryOmitDevInstalledPackages:21,ordinaryOmitDevStillInstallsZodAndTypescript:true,fullDevelopmentZodAdvisoryRemainsOpen:true,installLifecycleScripts:false,testsUseLoopbackFixturesOnly:true,realWallet:false,publicRpc:false,transactions:false,collectorNote:'Initial collectors required TAP-style # summaries, but Node emitted spec-style ℹ summaries. All three test subprocesses exited successfully before this summary-format assertion. Raw output and the collector failures are retained; corrected collection accepts either format without rerunning or changing the tests.'};
writeFileSync(join(paths.output,'verified-three-token-results.json'),JSON.stringify(record,null,2)+'\n');
const doc=`# Read-only runtime installation — November 2, 2026

The read-only tools imported viem, but the package declared it only as a
development dependency. A fresh DAT installation with npm ci --omit=dev
completed successfully while inspect-transfers.js failed at startup with
ERR_MODULE_NOT_FOUND for viem, before validating its public-address argument.

viem 2.56.6 is now a runtime dependency in DAT, EMA and CAWELON. npm regenerated
only dependency-classification flags in the lock. All 141 package entries keep
their versions, resolved URLs, integrity values and other package metadata.
Solidity, deployment configuration, readers and their test sources are unchanged.

## Reproduce the runtime profile

Use a separate, fresh checkout intended only for the read-only commands.
npm ci replaces that checkout's installed dependencies; keep the full development
checkout separate if you still need contract compilation and local-EVM tests.

\`\`\`text
npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=2 test/*.test.mjs
\`\`\`

The minimal profile installs 19 packages, including viem, while excluding Hardhat,
solc, TypeScript and Zod from the installed tree. It supports the existing identity,
public balance/allowance, reference-quote, Transfer and Approval read-only tools.
Public-read commands still use their documented public addresses and RPC rules.
The regression command instead uses local fixtures and makes no public RPC call.

Simply using --omit=dev installs 21 packages under the verified lock and npm
version: optional TypeScript and Zod peers remain. The explicit --omit=optional
is therefore part of this profile. It is not an advisory fix. The complete
development installation retains Zod 3.25.76 and its previously recorded
GHSA-mrhx-c7xc-m3w5 finding; compatible remediation and review remain open.
--no-audit here separates installation from the separately recorded dependency
review and is not a claim of a clean audit. No package version was forced or hidden.

## Verification

All three tokens passed the existing 213 read-only cases in independently installed
fresh directories on Windows with Node 24.19.0 and npm 11.17.0. These include actual
child-process/HTTP command tests with positive Transfer/Approval observations,
canonical-state results, input refusals, network/block changes and redacted errors.
There are no new test cases in this change; the earlier 213-case checkpoint overlaps.

The initial evidence collector expected TAP summary markers while Node selected
the spec reporter. The test subprocesses passed, but the collector then rejected
their summary format. Both the passing raw logs and collector failures are retained;
the corrected collection recognizes both formats. No tests were changed to pass.

A separate CI job now prepares this runtime profile and runs the same suite on
Node 22 and 24. The workflow is prepared locally; this record does not claim those
remote jobs ran. The full contract/build jobs remain in place. Contract tests and
Wallet browser suites were not rerun for this metadata-only change.

No real wallet, signature, transfer or private credential is used. This installation
correction does not complete real-wallet UI acceptance or independent security review.
The Wallet evidence collection retains before/after logs, the installed package lists,
source fingerprints and the three regression outputs.

npm option reference: https://docs.npmjs.com/cli/v11/commands/npm-ci/
`;
for(const row of rows){
 const repo=repoRoot+'token-dependency-repair-'+row.token+'-20261102';
 writeFileSync(repo+'/docs/READ_ONLY_RUNTIME_2026-11-02.md',doc);
 const file=repo+'/README.md',before=readFileSync(file,'utf8');assert(!before.includes('## Read-only runtime installation (November 2, 2026)'));
 const newline=before.includes('\r\n')?'\r\n':'\n';
 const extra='\n\n## Read-only runtime installation (November 2, 2026)\n\nThe [runtime installation correction](docs/READ_ONLY_RUNTIME_2026-11-02.md) makes viem an explicit runtime dependency. A fresh installation with development and optional dependencies omitted passes all 213 read-only cases for this token. This smaller profile does not include contract compilation tools; the full development Zod finding remains open.\n';
 writeFileSync(file,before+extra.replace(/\n/g,newline));
}
console.log(JSON.stringify({verifiedTokens:rows.map(row=>row.token),passedEach:213,installedEach:19,contractsAndRuntimeSourceUnchanged:true}));
