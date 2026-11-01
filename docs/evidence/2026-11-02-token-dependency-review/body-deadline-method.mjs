import { readFileSync, writeFileSync, copyFileSync, realpathSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const base='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/';
const downloads='C:/Users/aseet/Downloads/';
const wallet=base+'threecore-wallet-operation-rehearsal-20261029';
const folder='docs/evidence/2026-11-02-token-dependency-review';
const target=wallet+'/'+folder+'/';
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024}).trim();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=path=>readFileSync(path,'utf8');
const tokens=['DAT','EMA','CAWELON'];
const expectedParents=['6c455914df26d52de75bd2c6d3ae0aefb1215d29','c027e68cd1974dc31f2619d04b4fb9059843424f','b77a6b31af135c0461dd66d95bc837c8e7d9e88f'];
const changed=['README.md','docs/RPC_BODY_DEADLINE_2026-11-02.md','src/read-only-http.js','test/read-only-http.test.mjs','test/read-only-http-cli.test.mjs',...['verify-base-mainnet','inspect-wallet-readiness','quote-dex','inspect-transfers','inspect-approvals'].map(n=>'scripts/'+n+'.js')];
const names=git(wallet,['status','--porcelain']);assert.equal(names,'');
function summary(text){const result={};for(const key of ['tests','pass','fail','cancelled','skipped']){const match=text.match(new RegExp('^# '+key+' (\\d+)$','m'));assert(match,key);result[key]=Number(match[1]);}return result;}
for(const token of tokens){const s=summary(read(downloads+'ThreeCore-rpc-body-deadline-'+token+'-serial-20261102.log'));assert.equal(s.tests,227);assert.equal(s.pass,227);assert.equal(s.fail+s.cancelled+s.skipped,0);}
const originalManifest=read(target+'SHA256SUMS.txt');
const manifest=new Map(originalManifest.trim().split(/\r?\n/).map(row=>{const m=row.match(/^([0-9a-f]{64})  (.+)$/);assert(m);assert.equal(sha(readFileSync(target+m[2])),m[1],m[2]);return [m[2],m[1]];}));
const receipt={recordedAt:new Date().toISOString(),node:process.version,scope:'Five operational read-only mainnet CLIs; native HTTP body deadline and size handling',tokens:[],baseline:JSON.parse(read(downloads+'ThreeCore-rpc-body-deadline-baseline-method-20261102.json')),baselineResult:summary(read(downloads+'ThreeCore-rpc-body-deadline-baseline-v2-20261102.log')),bodyDeadlineMs:12000,responseBytes:10485760,publicRpc:false,realWallet:false,transactions:false,contractRebuild:false,remotePublication:false,independentReview:false,dependencyVersionsChanged:false,originalServerRestarted:false};
for(let i=0;i<tokens.length;i++){
  const token=tokens[i],root=base+'token-dependency-repair-'+token+'-20261102';
  assert.equal(git(root,['rev-parse','HEAD']),expectedParents[i]);
  const trackedDiff=git(root,['diff','--name-only']).split(/\r?\n/).filter(Boolean);assert(trackedDiff.every(name=>changed.includes(name)));
  assert.equal(git(root,['diff','--cached','--name-only']),'');
  const doc=root+'/docs/RPC_BODY_DEADLINE_2026-11-02.md';
  writeFileSync(doc,read(doc)+'\n## Full local regression\n\nAll 227 TAP entries passed on Node 24.19.0 using the existing dependency\ninstallation. The three repositories were checked sequentially, with one test\nfile active per repository. The 213 existing entries overlap earlier checkpoints;\nthe 14 new entries include one parent grouping. Contract/build and browser suites\nwere not rerun because their sources and dependencies did not change.\n\nThe first simultaneous full runs reported watchdog failures (DAT 1, EMA 4,\nCAWELON 4). The same source passed the complete sequential reruns. These were\nexisting child-process startup deadlines under combined load, including an input\nrefusal that makes no RPC request. Assertions and those old watchdogs were not\nrelaxed. Both initial and final logs remain in the combined evidence collection.\n');
  git(root,['add','--',...changed]);
  git(root,['-c','core.whitespace=cr-at-eol','diff','--cached','--check']);
  const sourceHashes=Object.fromEntries(changed.map(name=>[name,sha(execFileSync('git',['show',':'+name],{cwd:root,windowsHide:true,maxBuffer:1024*1024}))]));
  git(root,['commit','-m','Bound read-only RPC waits through response body consumption']);
  assert.equal(git(root,['status','--porcelain']),'');
  const commit=git(root,['rev-parse','HEAD']);
  const prefix='body-deadline-'+token;
  writeFileSync(target+prefix+'.patch',execFileSync('git',['diff','--binary',expectedParents[i],commit,'--',...changed],{cwd:root,windowsHide:true,maxBuffer:1024*1024}));
  for(const [suffix,sourceSuffix] of [['initial.log','-20261102.log'],['serial.log','-serial-20261102.log']])copyFileSync(downloads+'ThreeCore-rpc-body-deadline-'+token+sourceSuffix,target+prefix+'-'+suffix);
  const serial=read(target+prefix+'-serial.log');
  receipt.tokens.push({token,parent:expectedParents[i],commit,sourceHashes,dependencies:realpathSync(root+'/node_modules'),initial:summary(read(target+prefix+'-initial.log')),serial:summary(serial),bodyObservedToExitMs:[...serial.matchAll(/Response body observed to process exit: (\d+) ms/g)].map(m=>Number(m[1])),unchangedLockSha256:sha(readFileSync(root+'/package-lock.json'))});
}
for(const [dest,source] of [
 ['preliminary-before.log','ThreeCore-rpc-body-deadline-before-20261102.log'],
 ['preliminary-focused.log','ThreeCore-rpc-body-deadline-focused-20261102.log'],
 ['diagnosis.log','ThreeCore-rpc-body-deadline-diagnosis-20261102.log'],
 ['focused.log','ThreeCore-rpc-body-deadline-focused-v2-20261102.log'],
 ['baseline.log','ThreeCore-rpc-body-deadline-baseline-v2-20261102.log'],
 ['baseline-method.json','ThreeCore-rpc-body-deadline-baseline-method-20261102.json'],
])copyFileSync(downloads+source,target+'body-deadline-'+dest);
receipt.installedViemSources=Object.fromEntries(['utils/rpc/http.js','utils/promise/withTimeout.js','clients/transports/http.js'].map(file=>[file,sha(readFileSync(base+'token-dependency-repair-DAT-20261102/node_modules/viem/_esm/'+file))]));
writeFileSync(target+'body-deadline-results.json',JSON.stringify(receipt,null,2)+'\n');
copyFileSync(new URL(import.meta.url),target+'body-deadline-method.mjs');
copyFileSync('C:/Users/aseet/AppData/Local/Temp/threecore-body-deadline-debug-20261102.mjs',target+'body-deadline-diagnosis.mjs');
writeFileSync(target+'BODY_DEADLINE.md',`# Response-body deadline evidence\n\nSee [the correction and scope](../../RPC_BODY_DEADLINE_2026-11-02.md).\n\n- body-deadline-results.json: fixed token commits, changed-source hashes, runtime, initial failures and final complete results.\n- body-deadline-*-serial.log: full 227-entry passing run for each token, including actual 12-second command checks.\n- body-deadline-*-initial.log: simultaneous runs retained with existing child-process watchdog failures.\n- body-deadline-*.patch: complete committed changes against each token included in the prior verified distribution.\n- body-deadline-baseline.log and baseline-method.json: unchanged DAT source, corrected test harness, all five stalled commands stopped by the test watchdog.\n- body-deadline-preliminary-*.log: original process-startup timing assumption; these preliminary failures are not used as proof of the body defect.\n- body-deadline-diagnosis.log and .mjs: single-child timing observation used to distinguish startup from the request deadline.\n- body-deadline-focused.log: successful focused transport and actual CLI tests after the harness correction.\n- body-deadline-method.mjs: local collection/commit orchestration snapshot; it is not a general-purpose replay command.\n\nExisting installed dependencies were reused; EMA and CAWELON resolve to the DAT dependency directory. No fresh installation, contract build, real wallet, public RPC, remote CI, independent review or publication is claimed. The older Sepolia deployment-artifact verifier is outside this five-command correction.\n`);
writeFileSync(target+'README.md',read(target+'README.md')+'\n[The response-body deadline correction](BODY_DEADLINE.md) records a stalled-body reproduction and the five-command fix across all three token repositories.\n');
for(const name of readdirSync(target).filter(n=>n.startsWith('body-deadline-')||['BODY_DEADLINE.md','README.md'].includes(n)))manifest.set(name,sha(readFileSync(target+name)));
writeFileSync(target+'SHA256SUMS.txt',[...manifest].sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,hash])=>hash+'  '+name).join('\n')+'\n');
let workflow=read(wallet+'/.github/workflows/ci.yml');
receipt.tokens.forEach(t=>{assert(workflow.includes(t.parent));workflow=workflow.replace(t.parent,t.commit);});
writeFileSync(wallet+'/.github/workflows/ci.yml',workflow);
writeFileSync(wallet+'/docs/RPC_BODY_DEADLINE_2026-11-02.md',`# Read-only RPC body deadline — November 2, 2026

Five operational token commands could wait past their configured 12-second limit
when a provider sent headers and then stopped partway through a tiny JSON body.
The installed viem 2.56.6 implementation clears its fetch timer when its fetch
callback returns; ordinary native fetch returns at the headers. Source fingerprints
and before/after observations are retained in the evidence receipt.

The three tokens now share the same bounded transport implementation. The deadline
remains active through body consumption, cancels native fetch on expiry, and
preserves caller cancellation. A caller signal cannot disable the deadline.
The existing 10 MiB response cap is enforced before parsing both declared and
streamed bodies. The transport retains normal status/error and UTF-8 handling,
uses no retries, and adds no signing, transaction or fallback methods.

## Fixed sources and results

| Token | Local commit | Complete read-only regression |
| --- | --- | --- |
${receipt.tokens.map(t=>'| '+t.token+' | `'+t.commit+'` | 227 passed / 0 failed |').join('\n')}

The five command checks use real child processes with normal 12-second settings
and real HTTP over test-owned loopback endpoints. Every command exits unsuccessfully
without a result, subsequent request, retry or provider details. The eight transport
checks cover body cancellation, fresh deadlines, caller signals, response limits,
split UTF-8 and HTTP JSON-RPC errors. Including one parent group gives 14 new TAP
entries; the pre-existing 213 entries overlap prior runs. These totals are not
features, completion percentages or independent security reviews.

The original DAT source at \`6c455914df26d52de75bd2c6d3ae0aefb1215d29\` fails all
five corrected command checks and needs the test's 15-second body watchdog.
The initial harness instead counted process startup in a 17-second watchdog;
its failures are retained but are not proof of the body defect. A diagnostic
single-child run and the corrected before/after harness separate startup from
network waiting. The focused corrected run exits about 11.6–11.8 seconds after
the server begins the body, with the request deadline starting slightly earlier.

Initial simultaneous full regressions hit existing child-process watchdogs:
DAT 1 failure, EMA 4, CAWELON 4. The same source passes all complete sequential
runs, with one test file active at a time in each repository. No assertion or old
watchdog was relaxed. Both failed and successful outputs are retained.

## Scope and limits

This affects verify-base-mainnet, inspect-wallet-readiness, quote-dex,
inspect-transfers and inspect-approvals. The older verify-base-sepolia deployment-
artifact verifier is outside this five-command correction. Twelve seconds is a
per-request bound, not an end-to-end command duration or a wall-clock scheduling
guarantee. Existing dependencies were reused; EMA/CAWELON use the DAT installation
through junctions. No fresh install, contract rebuild, Wallet browser suite, real
wallet, public RPC, remote CI or publication was performed. Contracts, deployment
code, dependency versions and locks are unchanged. The open Zod advisory remains.

The prepared Wallet CI pins reference the new local token commits. They retain
the token-before-Wallet publication order. The verified d904442 delivery ZIP
predates this correction; the recorded source patches are relative to its token
commits. It must not be described as including this later fix.

[Raw results, full source patches and source hashes](evidence/2026-11-02-token-dependency-review/BODY_DEADLINE.md)
allow the change and failed attempts to be inspected separately from the earlier
distribution, canonical-read and dependency-installation checkpoints.
`);
const readiness=wallet+'/docs/RELEASE_READINESS_2026-11-01.md';
const marker='The latest [verified combined delivery]';
const readinessText=read(readiness);assert(readinessText.includes(marker));
writeFileSync(readiness,readinessText.replace(marker,'The later [RPC response-body deadline correction](RPC_BODY_DEADLINE_2026-11-02.md)\nfixes five operational read-only commands in each token. All three complete\n227-entry read-only suites pass in sequential local runs; initial failed runs\nare retained. This source change is newer than the verified delivery below.\nIt does not complete real-wallet or independent-review gates.\n\n'+marker));
const handoff=wallet+'/docs/RELEASE_HANDOFF_2026-11-02.md';
writeFileSync(handoff,read(handoff)+'\n## Later RPC body-deadline correction\n\n[The fixed token sources and reproduction](RPC_BODY_DEADLINE_2026-11-02.md)\nrecord the five-command timeout correction, complete sequential regressions,\ninitial failures, and exact patches relative to the prior distribution. The\nverified d904442 ZIP predates this change. The prepared CI pins are local only;\nreal-wallet and independent-review acceptance remain open.\n');
writeFileSync(downloads+'ThreeCore-rpc-body-deadline-source-checkpoint-20261102.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({tokens:receipt.tokens.map(t=>({token:t.token,commit:t.commit,result:t.serial,bodyObservedToExitMs:t.bodyObservedToExitMs})),manifestEntries:manifest.size}));
