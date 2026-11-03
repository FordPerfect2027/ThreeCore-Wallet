import { makeAcceptanceFixture, AGENTS, assert, until, checked } from '/test/browser/acceptance-fixture.js';
import { decodeWorkspaceFile } from '/src/workspace-file.js';
import { workspaceFromDraft } from '/src/workspace-format.js';
const parameters=new URLSearchParams(location.search),phase=Number(parameters.get('phase'));
assert([1,2].includes(phase),'Invalid phase');
const reply=await fetch('/test/browser/private-data/'+parameters.get('private')+'.json');assert(reply.ok,'Fixture unavailable');
const files=await reply.json(),observations=[],unexpected=[];
addEventListener('error',event=>unexpected.push({kind:'error',message:String(event.message)}));
addEventListener('unhandledrejection',event=>unexpected.push({kind:'unhandledrejection',message:String(event.reason?.message??event.reason)}));
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
function snapshot(f){
 return workspaceFromDraft(AGENTS.map((agent,index)=>{
  f.card(index,'.history-export').click();
  return {agent,account:f.card(index,'.account').value,chainId:Number(f.card(index,'.chain').value),tokenAddress:f.card(index,'.token').value,tokens:f.card(index,'.portfolio-tokens').value,history:f.card(index,'.history-json').value};
 }));
}
function visibleState(f){ return JSON.stringify(AGENTS.map((_,i)=>({account:f.card(i,".account").value,chain:f.card(i,".chain").value,token:f.card(i,".token").value,tokens:f.card(i,".portfolio-tokens").value,history:f.card(i,".history-list").textContent}))); }
async function selectFile(f,text){
 const transfer=new DataTransfer();transfer.items.add(new File([text],'actual-backup.json',{type:'application/json'}));
 const file=f.q('.workspace-file');file.files=transfer.files;file.dispatchEvent(new Event('change',{bubbles:true}));
 await until(()=>!file.disabled&&f.q('.workspace-status').textContent.includes('破損確認が一致'),'Actual workspace checksum did not validate');
}
let passed=0,failed=0;
for(const source of files){
 let f;const item=document.createElement('li');
 try{
  assert(await digest(source.text)===source.sha256,'Source bytes changed');
  const expected=(await decodeWorkspaceFile(new TextEncoder().encode(source.text))).workspace;
  f=makeAcceptanceFixture(source.database);
  const empty=snapshot(f), emptyVisible=visibleState(f);assert(empty.entries.every(row=>row.account===null&&row.history.reports.length===0),'Initial page restored data implicitly');
  assert(f.calls.length===0,'Mount requested a wallet');
  if(phase===1){
   await selectFile(f,source.text);f.q('.workspace-preview').click();
   assert(visibleState(f)===emptyVisible,'Preview changed cards');
   f.q('.workspace-cancel').click();assert(f.q('.workspace-apply').disabled,'Cancel left apply enabled');
   assert(visibleState(f)===emptyVisible,'Cancel changed cards');
   await selectFile(f,source.text);f.q('.workspace-preview').click();checked(f.q('.workspace-confirmed'));f.q('.workspace-apply').click();
   assert(JSON.stringify(snapshot(f))===JSON.stringify(expected),'Restored settings or full histories differ');
   assert(f.calls.length===0,'File restore requested wallet access');
   await f.save();
   observations.push({phase,sourceSha256:source.sha256,configuredCards:expected.entries.filter(x=>x.account).length,historyReports:expected.entries.reduce((sum,x)=>sum+x.history.reports.length,0),previewAndCancelPreservedInitialPage:true,fullRestoredContentsMatch:true,nativeCheckpointSaved:true,walletRequests:0});
  }else{
   await f.stageSaved();
   assert(visibleState(f)===emptyVisible,'Saved checkpoint preview changed cards');
   f.applySaved();
   assert(JSON.stringify(snapshot(f))===JSON.stringify(expected),'Full contents differ after browser restart and explicit restore');
   await selectFile(f,source.text);assert(!f.q('.workspace-compare').disabled,'Comparison is unavailable');f.q('.workspace-compare').click();
   assert(f.q('.workspace-comparison-detail').textContent.includes('全3カードの設定・トークン一覧・保存履歴が一致'),'Comparison did not match every field');
   assert(f.calls.length===0,'Reopen or restore contacted a wallet');
   assert(AGENTS.every((_,i)=>f.card(i,'.read').disabled),'Restore reinstated a live wallet connection');
   observations.push({phase,sourceSha256:source.sha256,fullContentsMatchAfterBrowserRestart:true,explicitRestoreRequired:true,fileComparisonReportsExactMatch:true,walletRequests:0,connectionPermissionsRestored:false});
  }
  item.textContent='PASS — actual workspace '+source.sha256.slice(0,12)+' phase '+phase;passed++;
 }catch(error){item.textContent='FAIL — actual workspace phase '+phase+': '+error.message;failed++;}
 finally{f?.dispose();document.querySelector('#results').append(item);}
}
await new Promise(resolve=>setTimeout(resolve,0));
Object.assign(document.body.dataset,{suiteStatus:failed||unexpected.length?'failed':'passed',testsCount:String(files.length),testsPassed:String(passed),testsFailed:String(failed),unexpectedErrors:String(unexpected.length),errorKinds:unexpected.map(x=>x.kind).join(','),injectedFault:''});
document.querySelector('#summary').textContent=passed+' passed / '+failed+' failed / '+unexpected.length+' unexpected errors';
const result=document.createElement('pre');result.id='private-recovery-result';result.textContent=JSON.stringify({phase,observations,unexpected,fileInputMode:'Native File/FileReader through input.files; OS file chooser not exercised',actualDownloadedFileBytes:true,nativeIndexedDb:true,providerFixturesPresentButNeverCalled:true,userWalletUsed:false,originalUserProfileUsed:false});document.body.append(result);
await fetch('/test/browser/ci-result/'+parameters.get('ci-report'),{method:'POST',headers:{'Content-Type':'text/html'},body:document.documentElement.outerHTML});
