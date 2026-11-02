import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,existsSync}from'node:fs';
import {createHash}from'node:crypto';
import {execFileSync}from'node:child_process';
const repo='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029';
const token=repo+'/docs/evidence/2026-11-02-token-dependency-review';
const release=repo+'/docs/evidence/2026-11-02-release-regression';
const privateDir='C:/Users/aseet/Downloads/ThreeCore-private-network-check-20261102-iDmoKM';
const sha=b=>createHash('sha256').update(b).digest('hex');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,windowsHide:true,encoding:'utf8'}).trim();
assert.equal(head,'307ed11a13706c71954dfa6b6f12d7710b05bae9');
const observation=JSON.parse(readFileSync(privateDir+'/network-state.json'));
assert(observation.visibleAccountConfirmation.includes('ネットワーク: Base Mainnet'));
assert(observation.visibleAccountConfirmation.includes('許可済みアドレス数: 1'));
const layout=JSON.parse(readFileSync(privateDir+'/address-wrap-layout.json'));
assert.equal(layout.metrics.clientWidth,296);assert.equal(layout.metrics.scrollWidth,296);
const summary={schema:'threecore.account-probe-layout.v1',applicationRevision:head,
 observedAt:layout.observedAt,trigger:'Authorized-account details overflowed the DAT card at the current narrow window width',
 change:'Apply existing pre-wrap / overflow-wrap:anywhere / 13px detail styling to account-probe-details',
 observedClientWidth:296,observedScrollWidth:296,fullAddressVisibleInNewTab:true,
 networkRead:'Base Mainnet',permittedAccountCount:1,accountInputChanged:false,walletNetworkChanged:false,
 balanceRequested:false,walletConnected:false,originalTabReloaded:false,originalServerRestartIssued:false,
 temporaryWalletStoppedAndClosed:true,temporaryRehearsalClosed:true,originalTabRetained:true,
 privateArtifacts:['network-state.json','network-state.png','address-wrap-layout.json','address-wrap-after.png'].map(name=>({name,sha256:sha(readFileSync(privateDir+'/'+name))})),
 privateAccountOrScreenshotPublished:false,fullRegressionRerun:false,validation:'Actual Edge UI and rendered element width; CSS-only change'};
function appendFiles(dir,files){
 let text=readFileSync(dir+'/SHA256SUMS.txt','utf8');
 for(const[from,to]of files){assert(!existsSync(dir+'/'+to));assert(!text.includes('  '+to));copyFileSync(from,dir+'/'+to);text+=(text.endsWith('\n')?'':'\n')+sha(readFileSync(dir+'/'+to))+'  '+to+'\n';}
 writeFileSync(dir+'/SHA256SUMS.txt',text);
}
writeFileSync('C:/Users/aseet/Downloads/ThreeCore-account-probe-layout-summary-20261102.json',JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
appendFiles(release,[
 ['C:/Users/aseet/Downloads/ThreeCore-account-probe-layout-summary-20261102.json','account-probe-layout-summary.json'],
 [import.meta.filename,'account-probe-layout-record-method.mjs']
]);
appendFiles(token,[
 ['C:/Users/aseet/Downloads/ThreeCore-zod-boundary-export-probe-20261102.json','zod-size-gate-probe.json'],
 ['C:/Users/aseet/AppData/Local/Temp/threecore-zod-boundary-export-probe-20261102.mjs','zod-size-gate-probe-method.mjs']
]);
console.log(JSON.stringify({recordedFiles:4,applicationRevision:head,layoutFits:true,actualWalletNetwork:'Base Mainnet'}));
