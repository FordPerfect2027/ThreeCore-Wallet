import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,lstat,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,relative,isAbsolute} from 'node:path';
const folder='C:/Users/aseet/Downloads/ThreeCore-review-23d0a35-20261102';
const revision='23d0a35b129c32be581bf1a3ffad57e228b9b65c',zip=folder+'.zip';
const sha=b=>createHash('sha256').update(b).digest('hex');
const receipt=JSON.parse(await readFile(join(folder,'package-receipt.json'),'utf8'));
assert.equal(receipt.sourceRevision,revision);assert.equal(receipt.fullWalletCasesPassed,16454);assert.equal(receipt.fullSyntheticBrowserCasesPassed,1021);
assert.equal(receipt.startupChecksPassed,12);assert(receipt.ownServerClosed);
assert.equal(receipt.evidenceSummary.files,2483);assert.equal(receipt.evidenceSummary.mismatchedFiles,0);
assert.equal(receipt.tokenPackage.tokens.length,3);assert(receipt.tokenPackage.tokens.every(t=>t.bytesMatchPriorPackage&&t.validationRerunThisPackaging===false));
assert.equal(receipt.runtimeComparisonReplay.observationsChecked,6);assert.equal(receipt.runtimeComparisonReplay.metadataDifferences,5);
async function files(root,prefix=''){
 const result=[];for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){
  const name=prefix+entry.name;if(entry.isDirectory())result.push(...await files(root,name+'/'));else{assert(entry.isFile());result.push(name);}
 }return result.sort();
}
async function verify(root){
 const manifest=await readFile(join(root,'SHA256SUMS.txt')),names=[];let total=0;
 for(const line of manifest.toString().trim().split(/\r?\n/)){
  const match=line.match(/^([a-f0-9]{64})  (.+)$/);assert(match);
  const target=resolve(root,match[2]),rel=relative(root,target);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));
  const stat=await lstat(target);assert(stat.isFile()&&!stat.isSymbolicLink());assert(stat.size<=64*1024*1024);total+=stat.size;assert(total<=256*1024*1024);
  assert.equal(sha(await readFile(target)),match[1],match[2]);names.push(match[2]);
 }
 assert.equal(new Set(names).size,names.length);assert.deepEqual((await files(root)).filter(n=>n!=='SHA256SUMS.txt'),names.toSorted());
 return {entries:names.length,totalBytes:total,manifestSha256:sha(manifest),allMatched:true};
}
async function tar(args){return new Promise((done,reject)=>{
 const child=spawn('tar.exe',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';
 const timer=setTimeout(()=>child.kill(),180000);child.stderr.on('data',d=>stderr+=d);
 child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('close',(code,signal)=>{clearTimeout(timer);if(code!==0||signal)reject(Error('Archive operation failed: '+code+' '+signal+' '+stderr));else done();});
});}
const before=await verify(folder);
let present=false;try{await access(zip);present=true;}catch(error){assert.equal(error.code,'ENOENT');}assert.equal(present,false,'Never replace an existing ZIP');
await tar(['-a','-cf',zip,'-C',folder,'.']);
const restored='C:/Users/aseet/AppData/Local/Temp/threecore release zip '+randomUUID();await mkdir(restored);
await tar(['-xf',zip,'-C',restored]);const after=await verify(restored);assert.deepEqual(after,before);
const bytes=await readFile(zip),result={schema:'threecore.review-zip-receipt.v2',recordedAt:new Date().toISOString(),sourceRevision:revision,
 applicationSourceRevision:receipt.applicationSourceRevision,regressionRevision:receipt.regressionRevision,liveAcceptance:receipt.liveAcceptance,zip,bytes:bytes.length,sha256:sha(bytes),before,after,outerArchiveExtracted:true,
 sourceFiles:receipt.sourceSummary.files,evidenceFiles:receipt.evidenceSummary.files,
 fullWalletCasesPassed:receipt.fullWalletCasesPassed,fullSyntheticBrowserCasesPassed:receipt.fullSyntheticBrowserCasesPassed,
 tokenSourceUnchanged:true,tokenPackageCopiedFromVerifiedPriorZip:receipt.tokenPackage.reusedFromZipSha256,
 runtimeReplayUsesFreshMinimalInstallation:true,preexistingNpmCacheUsed:true,npmDependenciesVendored:false,
 publicHistoricalReadPerformedDuringPackaging:false,original4231Restarted:false,realWalletAcceptanceComplete:false,independentReviewComplete:false};
await writeFile('C:/Users/aseet/Downloads/ThreeCore-review-23d0a35-zip-receipt-20261102.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
await writeFile(zip+'.sha256',result.sha256+'  ThreeCore-review-23d0a35-20261102.zip\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
