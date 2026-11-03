const privateParameters = new URLSearchParams(location.search);
const phase = Number(privateParameters.get('phase'));
if (![1,2].includes(phase)) throw Error('Invalid private recovery phase');
const sourceReply = await fetch('/test/browser/private-data/' + privateParameters.get('private') + '.json');
if (!sourceReply.ok) throw Error('Private fixture unavailable');
const privateFiles = await sourceReply.json();
const observations = [], unexpected = [];
addEventListener('error', event => unexpected.push({kind:'error',message:String(event.message)}));
addEventListener('unhandledrejection', event => unexpected.push({kind:'unhandledrejection',message:String(event.reason?.message ?? event.reason)}));
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
let passed = 0, failed = 0;
for (const source of privateFiles) {
 const item = document.createElement('li');
 const storage = createVaultStorage({indexedDB,name:source.database,openTimeoutMs:5000});
 let f;
 try {
  assert(await digest(source.text)===source.sha256,'Loaded source bytes differ');
  const expected = await decodeVaultCollection(source.text);
  f = panel(storage);
  const emptyWorking = f.q('overview').textContent;
  if (phase === 1) {
   assert((await storage.read()).entries.length===0,'Destination did not start empty');
   await f.click('refresh');
   await f.file(source.text,'collection-file');
   assert(!f.q('collection-apply').disabled,'Reviewed original was not available for explicit import');
   assert((await storage.read()).entries.length===0,'File preview wrote storage');
   await f.click('cancel');
   assert(f.q('collection-apply').disabled,'Cancel left apply enabled');
   assert((await storage.read()).entries.length===0,'Cancel changed the empty destination');
   await f.file(source.text,'collection-file');
   await f.click('collection-apply');
   const restored=await storage.read();
   assert(restored.revision===1,'First reviewed import revision mismatch');
   assert(JSON.stringify(restored.entries)===JSON.stringify(expected.document.entries),'Restored records differ from the complete original');
   assert(f.q('overview').textContent===emptyWorking && f.stages.length===0,'Import implicitly restored a working card');
   observations.push({sourceSha256:source.sha256,phase,entries:restored.entries.length,revision:restored.revision,previewDidNotWrite:true,cancelKeptEmpty:true,reviewedImportExact:true,noImplicitCardRestore:true});
  } else {
   const persisted=await storage.read();
   assert(persisted.revision===1,'Saved revision did not survive a browser restart');
   assert(JSON.stringify(persisted.entries)===JSON.stringify(expected.document.entries),'Records changed across a browser process restart');
   await f.click('refresh');await f.click('collection-export');
   await waitFor(()=>f.downloads.length===1);
   assert(f.downloads[0].text===source.text,'Re-exported file bytes differ from original');
   await f.file(source.text,'collection-file');await f.click('collection-apply');
   const again=await storage.read();
   assert(JSON.stringify(again.entries)===JSON.stringify(expected.document.entries),'Repeated import changed or multiplied records');
   assert(f.q('overview').textContent===emptyWorking && f.stages.length===0,'Reopen/import restored cards implicitly');
   observations.push({sourceSha256:source.sha256,phase,entries:again.entries.length,persistedRevision:persisted.revision,exactAfterProcessRestart:true,reexportSha256:await digest(f.downloads[0].text),reexportBytesIdentical:true,reimportDidNotMultiply:true,noImplicitCardRestore:true});
  }
  item.textContent='PASS — actual saved collection '+source.sha256.slice(0,12)+' phase '+phase;passed++;
 } catch(error) {
  item.textContent='FAIL — actual saved collection phase '+phase+': '+error.message;failed++;
 } finally {f?.dispose();storage.close();document.querySelector('#results').append(item);}
}
await new Promise(resolve=>setTimeout(resolve,0));
Object.assign(document.body.dataset,{suiteStatus:failed||unexpected.length?'failed':'passed',testsCount:String(privateFiles.length),testsPassed:String(passed),testsFailed:String(failed),unexpectedErrors:String(unexpected.length),errorKinds:unexpected.map(x=>x.kind).join(','),injectedFault:''});
document.querySelector('#summary').textContent=passed+' passed / '+failed+' failed / '+unexpected.length+' unexpected errors';
const result=document.createElement('pre');result.id='private-recovery-result';result.textContent=JSON.stringify({phase,observations,unexpected,fileInputMode:'Native File/FileReader through input.files; OS file chooser not exercised',actualDownloadedFileBytes:true,nativeIndexedDb:true,userWalletUsed:false,originalUserProfileUsed:false});document.body.append(result);
await fetch('/test/browser/ci-result/'+privateParameters.get('ci-report'),{method:'POST',headers:{'Content-Type':'text/html'},body:document.documentElement.outerHTML});
