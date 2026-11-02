import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const repo = 'C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029';
const baseDir = 'C:/Users/aseet/Downloads/ThreeCore-review-23d0a35-20261102';
const out = 'C:/Users/aseet/Downloads/ThreeCore-review-supplement-9c8c81b-20261102';
const base = '23d0a35b129c32be581bf1a3ffad57e228b9b65c';
const target = '9c8c81bfd2cdefa8f9419815b5de79f490e02fc0';
const hash = b => createHash('sha256').update(b).digest('hex');
const git = (cwd, args) => execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], maxBuffer: 48 * 1024 * 1024 });
const ensure = (ok, msg) => { if (!ok) throw Error(msg); };
ensure(git(repo,['rev-parse','HEAD']).trim() === target, 'Unexpected source HEAD');
ensure(!git(repo,['status','--porcelain']).trim(), 'Source checkout must be clean');
ensure(!existsSync(out), 'Output already exists; do not overwrite');
const unchanged = ['src','examples','scripts','test','integration','package.json','package-lock.json'];
ensure(!git(repo,['diff','--name-only',base,target,'--',...unchanged]).trim(), 'Runtime/test input changed since base');
const baseBundle = join(baseDir,'ThreeCore-Wallet-review.bundle');
const rootManifest = readFileSync(join(baseDir,'SHA256SUMS.txt'),'utf8');
const baseLine = rootManifest.split(/\r?\n/).find(l => l.endsWith('  ThreeCore-Wallet-review.bundle'));
ensure(baseLine && /^[a-f0-9]{64}  /.test(baseLine), 'Base bundle manifest entry missing');
const baseHash = hash(readFileSync(baseBundle));
ensure(baseHash === baseLine.slice(0,64), 'Base bundle checksum mismatch');
mkdirSync(out);
const delta = join(out, 'ThreeCore-Wallet-23d0a35-to-9c8c81b.bundle');
git(repo,['bundle','create',delta,'HEAD','^'+base]);
const heads = git(repo,['bundle','list-heads',delta]).trim();
ensure(heads === target+' HEAD', 'Unexpected incremental bundle refs');
const restored = mkdtempSync(join(tmpdir(),'threecore-supplement-restore-'));
git(restored,['init']);
git(restored,['config','core.autocrlf','true']);
const negative = spawnSync('git',['bundle','verify',delta],{cwd:restored,windowsHide:true,encoding:'utf8'});
ensure(negative.status !== 0 && /prerequisite/i.test(negative.stderr), 'Delta must reject a checkout without base history');
const logs = ['Before base (expected rejection):',negative.stderr];
logs.push(git(restored,['fetch',baseBundle,'HEAD']));
git(restored,['checkout','--detach','FETCH_HEAD']);
ensure(git(restored,['rev-parse','HEAD']).trim() === base, 'Wrong base restored');
const verified = spawnSync('git',['bundle','verify',delta],{cwd:restored,windowsHide:true,encoding:'utf8'});
ensure(verified.status === 0, 'Incremental bundle did not verify with base');
logs.push('After base (must pass):',verified.stdout,verified.stderr);
logs.push(git(restored,['fetch',delta,'HEAD']));
git(restored,['checkout','--detach','FETCH_HEAD']);
ensure(git(restored,['rev-parse','HEAD']).trim() === target, 'Wrong final restored revision');
const history = git(restored,['rev-list','HEAD']);
ensure(history === git(repo,['rev-list',target]), 'Restored history differs');
ensure(!git(restored,['remote']).trim(), 'Restored checkout unexpectedly has a remote');
ensure(!git(restored,['status','--porcelain']).trim(), 'Restored working tree not clean');
const evidenceText = execFileSync(process.execPath,['scripts/verify-evidence-collection.js','.'],{cwd:restored,windowsHide:true,encoding:'utf8',maxBuffer:48*1024*1024});
writeFileSync(join(out,'evidence-verification.json'),evidenceText);
const evidence = JSON.parse(evidenceText);
ensure(evidence.allMatched && evidence.summary.failedManifests===0, 'Evidence checks failed');
const historicalText = execFileSync(process.execPath,['docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs'],{cwd:restored,windowsHide:true,encoding:'utf8',maxBuffer:1024*1024});
writeFileSync(join(out,'historical-verification.json'),historicalText);
const historical = JSON.parse(historicalText);
ensure(historical.verified===true, 'Historical check failed');
writeFileSync(join(out,'bundle-verification.txt'),logs.join('\n'));
copyFileSync(join(restored,'docs/RELEASE_HANDOFF_2026-11-02.md'),join(out,'RELEASE_HANDOFF_2026-11-02.md'));
const changes = git(repo,['diff','--name-status',base,target]).trim();
writeFileSync(join(out,'changed-files.txt'),changes+'\n');
const receipt = {
 schema:'threecore.review-supplement.v1',recordedAt:new Date().toISOString(),
 baseRevision:base,targetRevision:target,
 applicationRevision:'96b59459a0f593246c60f0bed4b52052211a464a',
 regressionRevision:'e5841f0d1b412b516b3e3eb4a81d75eabaf81edd',
 requiresBaseBundle:true,
 baseBundle:{file:'ThreeCore-Wallet-review.bundle',bytes:statSync(baseBundle).size,sha256:baseHash},
 deltaBundle:{file:delta.split(/[\\/]/).at(-1),bytes:statSync(delta).size,sha256:hash(readFileSync(delta))},
 absentBaseRejected:true,baseThenDeltaRestorePassed:true,completeHistoryMatches:true,
 historyCommits:history.trim().split('\n').length,restoredWorkingTreeClean:true,
 autocrlf:true,remoteConfigured:false,changedFileCount:changes.split('\n').length,
 unchangedRuntimeAndTestPaths:unchanged,evidenceSummary:evidence.summary,historicalVerification:historical,
 fullRegressionRerun:false,readOnlyRpcUsed:false,realWalletUsed:false,
 originalServerRestarted:false,githubChanged:false,
 independentReviewCompleted:false,releaseReadinessPercentageCalculated:false
};
writeFileSync(join(out,'supplement-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
writeFileSync('C:/Users/aseet/Downloads/ThreeCore-supplement-build-paths-20261102.json',JSON.stringify({out,restored,target},null,2)+'\n');
console.log(JSON.stringify({out,restored,receipt},null,2));
