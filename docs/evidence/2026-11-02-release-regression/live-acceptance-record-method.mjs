import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash, webcrypto} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029';
const downloads='C:/Users/aseet/Downloads';
const privateFolder=join(downloads,'ThreeCore-private-live-acceptance-20261102');
const evidence=join(repo,'docs/evidence/2026-11-02-release-regression');
const revision='e5841f0d1b412b516b3e3eb4a81d75eabaf81edd';
const applicationRevision='96b59459a0f593246c60f0bed4b52052211a464a';
const prior='3961b5151bec3cadca44bf732628c2c6addabeac';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',args,{cwd:repo,windowsHide:true,maxBuffer:16*1024*1024});
assert.equal(git(['rev-parse','HEAD']).toString().trim(),revision);
assert.equal(git(['diff','--name-only',prior,revision]).toString().trim(),'test/secure-backup-native-lifecycle.test.js');
const {decodeWorkspaceFile}=await import(pathToFileURL(join(repo,'src/workspace-file.js')));
const {decodeTokenIdentityFile}=await import(pathToFileURL(join(repo,'src/token-identity-report.js')));
const {encodeRehearsalComparison}=await import(pathToFileURL(join(repo,'src/operation-rehearsal-comparison.js')));
const account='0xfa1a71c1b76985ad9f4945340d929cba63884c71';
const sourceBackup=await readFile(join(downloads,'ThreeCore-workspace-backup (9).json'));
const decoded=await decodeWorkspaceFile(sourceBackup,{subtle:webcrypto.subtle});
assert(decoded.checksumVerified);assert.equal(decoded.workspace.entries.length,3);
const expectedPortfolioBlocks=['53395700','53395743','53395754'];
for(const [i,entry]of decoded.workspace.entries.entries()){
 assert.equal(entry.account,account);assert.equal(entry.chainId,8453);assert.equal(entry.tokens.length,1);
 assert.equal(entry.history.reports.length,1);const snapshot=entry.history.reports[0].snapshot;
 assert.equal(snapshot.blockNumber,expectedPortfolioBlocks[i]);assert.equal(snapshot.holdings.length,1);
 assert.equal(snapshot.holdings[0].balanceBaseUnits,'0');assert(snapshot.holdings[0].hasCode);
}
for(const suffix of ['10','11'])assert(sourceBackup.equals(await readFile(join(downloads,`ThreeCore-workspace-backup (${suffix}).json`))));
const rehearsal=await readFile(join(downloads,'ThreeCore-operation-workspace.json'));
assert(rehearsal.equals(await readFile(join(downloads,'ThreeCore-operation-workspace (21).json'))));
const comparison=JSON.parse(await readFile(join(downloads,'ThreeCore-workspace-comparison (1).json'),'utf8'));
assert.equal(comparison.inputs.before.ledgers.length,0);assert.deepEqual(comparison.inputs.after,JSON.parse(rehearsal));
assert.deepEqual(JSON.parse(encodeRehearsalComparison(comparison.inputs.before,comparison.inputs.after)),comparison);
const privateFiles=['ThreeCore-operation-workspace.json','ThreeCore-operation-workspace (21).json','ThreeCore-workspace-comparison (1).json',
 'ThreeCore-workspace-backup (9).json','ThreeCore-workspace-backup (10).json','ThreeCore-workspace-backup (11).json',
 'ThreeCore-workspace-overview.txt','ThreeCore-rehearsal-restored-20261102.jpg','ThreeCore-mainnet-three-cards-20261102.jpg',
 'ThreeCore-three-cards-restored-match-20261102.jpg','ThreeCore-mainnet-stop-status-20261102.json'];
const observations=[];
for(const [agent,block]of [['DAT','53395642'],['EMA','53395722'],['CAWELON','53395750']]){
 const filename=`ThreeCore-${agent}-identity-${block}.json`,bytes=await readFile(join(downloads,filename));
 const {observation,checksumVerified}=await decodeTokenIdentityFile(bytes,{subtle:webcrypto.subtle});
 assert(checksumVerified);assert.equal(observation.agent,agent);assert.equal(observation.account,account);assert.equal(observation.chainId,8453);
 assert.equal(observation.blockNumber,block);assert.equal(observation.balanceBaseUnits,'0');assert(observation.hasCode);
 observations.push({agent,blockNumber:block,blockHash:observation.blockHash,tokenAddress:observation.tokenAddress,
  balanceBaseUnits:observation.balanceBaseUnits,metadata:observation.metadata,sourceFileSha256:hash(bytes),checksumVerified:true});
 privateFiles.push(filename);
}
const stop=JSON.parse(await readFile(join(downloads,'ThreeCore-mainnet-stop-status-20261102.json'),'utf8'));
assert.equal(stop.statuses.filter(t=>t.startsWith('未接続\n保護のため接続を停止')).length,3);
assert.equal(stop.statuses.filter(t=>t==='一括復元から履歴を反映しました。 履歴 1件。').length,3);
assert.equal(stop.statuses.filter(t=>t==='未確認').length,3);
await mkdir(privateFolder);
const privateDigests=[];
for(const filename of privateFiles){const bytes=await readFile(join(downloads,filename));await writeFile(join(privateFolder,filename),bytes,{flag:'wx'});privateDigests.push({filename,bytes:bytes.length,sha256:hash(bytes)});}
await writeFile(join(privateFolder,'SHA256SUMS.txt'),privateDigests.map(x=>`${x.sha256}  ${x.filename}`).join('\n')+'\n',{flag:'wx'});
const summary={schema:'threecore.live-acceptance-progress.v1',recordedAt:new Date().toISOString(),sourceRevision:revision,applicationRevision,
 browser:'Microsoft Edge, existing user profile with MetaMask',origin:'http://127.0.0.1:4231',network:'Base Mainnet',chainId:8453,
 distinctPermittedAccounts:1,tokenCards:3,accountValuesRedacted:true,observations,
 stepsObserved:{existingRehearsalTabReclaimed:true,fictionalWorkspaceFileChooserRead:true,fictionalRecords:[3,2,1],fictionalReexportByteIdentical:true,
  actualMetaMaskExistingPermissionRead:true,threeCardsExplicitlyConnected:true,threeIdentityReadsSaved:true,
  realPortfolioHistoryRecords:[1,1,1],emptyDestinationTab:true,workspaceFileChooserRead:true,checksumAccepted:true,
  changesPreviewedBeforeRestore:true,existingRecordsRemoved:0,restoredCardsInitiallyDisconnected:true,
  settingsTokensAndFullHistoriesMatchInUi:true,reexportByteIdentical:true,allThreeCardsExplicitlyReconnected:true,
  datReadObservedPendingBeforeStop:true,manualStopDisconnectedAllCards:true,liveResultStayedUnconfirmedAfterStop:true,
  acceptedHistoryPreservedByByteIdenticalBackup:true,resumeControlDidNotAutomaticallyReconnect:true},
 integrity:{workspaceBytes:sourceBackup.length,workspaceSha256:hash(sourceBackup),workspaceInternalChecksum:decoded.digest,
  rehearsalBytes:rehearsal.length,rehearsalSha256:hash(rehearsal),privateEvidence:privateDigests},
 originalServer:{pid:2108,observedStartLocal:'2026-10-30T00:41:41+09:00',restarted:false,
  sourceScope:'Fresh client tabs loaded current on-disk assets; original server process and its already-imported modules were preserved. This is not a full fresh-candidate server deployment.'},
 limitations:['This live sequence used Mainnet, not Sepolia.','No actual two-account switch or chain switch was performed.',
  'File chooser was driven through the documented browser filechooser API; native OS picker traversal was not exercised.',
  'No prior-version browser migration/return or independent review was completed.','UI observations are developer evidence, not authentication of the files or token safety.',
  'Raw actual-account evidence remains in a private local folder; the redacted summary cannot replace it for independent rechecking.'],
 transactionsSigned:0,transactionsSubmitted:0,secretKeysRead:false,githubModified:false,readinessPercentageCalculated:false};
await writeFile(join(privateFolder,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
// This is a recording method for observed UI results, not a browser replayer.
const retained=[];
for(const [name,source]of [
 ['candidate-node-initial-failure.log','ThreeCore-release-3961b51-wallet-20261102.log'],
 ['native-lifecycle-unchanged-focus.log','ThreeCore-native-lifecycle-3961b51-focused-20261102.log'],
 ['native-lifecycle-event-wait.log','ThreeCore-native-lifecycle-event-wait-20261102.log'],
 ['candidate-node-complete.log','ThreeCore-release-e5841f0-wallet-20261102.log'],
 ['candidate-browser-complete.log','ThreeCore-release-e5841f0-browser-20261102.log']]){
 const bytes=await readFile(join(downloads,source));const text=bytes.toString();
 if(name==='candidate-node-initial-failure.log'){assert.match(text,/ℹ pass 16453\b/);assert.match(text,/ℹ fail 1\b/);assert.match(text,/Local async action did not settle/);}
 if(name==='candidate-node-complete.log'){assert.match(text,/ℹ pass 16454\b/);assert.match(text,/ℹ fail 0\b/);assert.match(text,/ℹ cancelled 0\b/);assert.match(text,/ℹ skipped 0\b/);}
 if(name==='candidate-browser-complete.log')assert.match(text,/1021 browser UI tests passed with a synthetic provider and no external RPC/);
 await writeFile(join(evidence,name),bytes,{flag:'wx'});retained.push(name);
}
const patch=git(['diff','--binary',prior,revision,'--','test/secure-backup-native-lifecycle.test.js']);
await writeFile(join(evidence,'native-lifecycle-event-wait.patch'),patch,{flag:'wx'});retained.push('native-lifecycle-event-wait.patch');
await writeFile(join(evidence,'live-mainnet-acceptance-summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});retained.push('live-mainnet-acceptance-summary.json');
const regression={revision,applicationRevision,fullNodePassed:16454,fullSyntheticBrowserPassed:1021,
 initialFullRun:{revision:prior,passed:16453,failed:1,reason:'Two-second busy-poll helper expired while native PBKDF2 drained after cancellation.'},
 unchangedIsolatedRunPassed:12,eventDrivenWaitFocusedPassed:12,productCryptoOrDeadlineRelaxed:false,
 changes:'Test-only drain wait subscribes to runner idle notification; finite 60-second test timeout remains.',
 fullSuitesRepeatedBecause:'New full-run failure and subsequent test-wait correction; no unchanged token suite was rerun.'};
await writeFile(join(evidence,'candidate-regression-summary.json'),JSON.stringify(regression,null,2)+'\n',{flag:'wx'});retained.push('candidate-regression-summary.json');
await copyFile(new URL(import.meta.url),join(evidence,'live-acceptance-record-method.mjs'));retained.push('live-acceptance-record-method.mjs');
const manifestPath=join(evidence,'SHA256SUMS.txt');let manifest=await readFile(manifestPath,'utf8');
for(const name of retained){assert(!manifest.split(/\r?\n/).some(line=>line.endsWith('  '+name)));manifest+=hash(await readFile(join(evidence,name)))+'  '+name+'\n';}
await writeFile(manifestPath,manifest);
console.log(JSON.stringify({privateFolder,recordedFiles:retained.length,regression,workspaceByteIdentical:true,privateEvidenceFiles:privateDigests.length}));
