import {readFile,writeFile,mkdir,readdir,lstat,access,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,relative,isAbsolute} from 'node:path';
import assert from 'node:assert/strict';
const folder='C:/Users/aseet/Downloads/ThreeCore-review-d904442-20261102',zip=folder+'.zip';
const revision='d9044422820973e53fa41e0c55908f6e34217d7f';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(await readFile(join(folder,'package-receipt.json'),'utf8'));
assert.equal(receipt.sourceRevision,revision);assert.equal(receipt.startupChecksPassed,10);assert(receipt.ownServerClosed);
assert.equal(receipt.evidenceSummary.mismatchedFiles,0);assert.equal(receipt.evidenceSummary.files,2348);
for(const token of receipt.tokenPackage.tokens){assert.equal(token.restoredCliCasesPassed,30);assert.equal(token.freshRuntimeInstall,true);assert.equal(token.existingNodeModulesReused,false);assert.equal(token.npmOfflineMode,true);}
assert.equal(receipt.tokenPackage.tokens.length,3);
async function verify(root){
 const source=await readFile(join(root,'SHA256SUMS.txt'),'utf8'),names=[];let total=0;
 for(const line of source.trim().split(/\r?\n/)){
  const match=line.match(/^([a-f0-9]{64})  (.+)$/);assert(match);
  const name=match[2],file=resolve(root,name),rel=relative(root,file);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));
  const st=await lstat(file);assert(st.isFile()&&!st.isSymbolicLink());assert(st.size<=64*1024*1024);total+=st.size;assert(total<=256*1024*1024);
  assert.equal(sha(await readFile(file)),match[1],name);names.push(name);
 }
 assert.equal(new Set(names).size,names.length);
 const found=[];async function walk(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())await walk(join(dir,entry.name),name+'/');else{assert(entry.isFile());if(name!=='SHA256SUMS.txt')found.push(name);}}}
 await walk(root);assert.deepEqual(found.sort(),names.toSorted());return {entries:names.length,allMatched:true,rootManifestSha256:sha(Buffer.from(source)),totalBytes:total};
}
await verify(folder);
// Clarify the working directory before sealing the package; no source ZIP is changed.
const readmePath=join(folder,'はじめに_README.txt');
const readmeBefore=await readFile(readmePath,'utf8');
const oldInstruction='空のフォルダーで読み取り専用コマンドを準備する場合：\n';
assert(readmeBefore.includes(oldInstruction));
const readmeAfter=readmeBefore.replace(oldInstruction,'読み取り専用コマンドの準備：\nThreeCore-Tokens内で対象トークンのsource.zipを新しいフォルダーへ展開し、その展開先を作業フォルダーにして次を実行します。\n');
await writeFile(readmePath,readmeAfter);
const manifestPath=join(folder,'SHA256SUMS.txt'),manifestBefore=await readFile(manifestPath,'utf8');
const oldRow=sha(Buffer.from(readmeBefore))+'  はじめに_README.txt';assert(manifestBefore.includes(oldRow));
await writeFile(manifestPath,manifestBefore.replace(oldRow,sha(Buffer.from(readmeAfter))+'  はじめに_README.txt'));
const before=await verify(folder);
let exists=false;try{await access(zip);exists=true;}catch(error){assert.equal(error.code,'ENOENT');}assert.equal(exists,false,'Do not overwrite an existing archive');
async function tar(args){return new Promise((done,reject)=>{const child=spawn('tar.exe',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';const timer=setTimeout(()=>child.kill(),180000);child.stderr.on('data',d=>errors+=d);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);if(code===0)done();else reject(Error('tar failed '+code+' '+errors));});});}
await tar(['-a','-cf',zip,'-C',folder,'.']);
const restored='C:/Users/aseet/AppData/Local/Temp/threecore release zip '+randomUUID();await mkdir(restored);
await tar(['-xf',zip,'-C',restored]);const after=await verify(restored);assert.deepEqual(after,before);
const bytes=await readFile(zip);
const result={recordedAt:new Date().toISOString(),sourceRevision:revision,zip,bytes:bytes.length,sha256:sha(bytes),before,after,outerArchiveExtracted:true,tokenCount:3,restoredTokenCliCasesEach:30,restoredNodeModulesReused:false,preexistingNpmCacheUsed:true,npmDependenciesVendored:false,completeOfflineBuildClaimed:false,original4231Restarted:false,realWalletAcceptanceComplete:false,independentReviewComplete:false};
await writeFile('C:/Users/aseet/Downloads/ThreeCore-review-d904442-zip-receipt-20261102.json',JSON.stringify(result,null,2)+'\n');
await writeFile(zip+'.sha256',result.sha256+'  ThreeCore-review-d904442-20261102.zip\n');
console.log(JSON.stringify(result));
