import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile, copyFile, mkdir, readdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const folder='C:/Users/aseet/Downloads/ThreeCore-review-128ee11-20261103',zip=folder+'.zip';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(await readFile(join(folder,'package-receipt.json'),'utf8'));
assert.equal(receipt.sourceRevision,'128ee11fefc263a11e36c026fbf786655c4cf8f6');
assert(receipt.walletImplementationAndTestFilesUnchangedSinceRegression);
assert.equal(receipt.evidenceSummary.mismatchedFiles,0);assert.equal(receipt.tokenSources.length,3);
for(const token of receipt.tokenSources)assert(token.completeHistoryVerified&&token.restoredWorkingTreeClean);
await copyFile(fileURLToPath(import.meta.url),join(folder,'seal-method.mjs'));
async function list(root,prefix=''){const names=[];for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())names.push(...await list(root,name+'/'));else {assert(entry.isFile());names.push(name);}}return names;}
const lines=[];for(const name of (await list(folder)).filter(n=>n!=='SHA256SUMS.txt').sort())lines.push(sha(await readFile(join(folder,name)))+'  '+name);
await writeFile(join(folder,'SHA256SUMS.txt'),lines.join('\n')+'\n');
const {verifyPackage}=await import(pathToFileURL(join(folder,'verify-package.mjs')));
const before=await verifyPackage(folder);
let exists=false;try{await access(zip);exists=true;}catch(error){assert.equal(error.code,'ENOENT');}assert(!exists,'Do not replace an existing ZIP');
async function tar(args){await new Promise((done,reject)=>{const child=spawn('tar.exe',args,{windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';const timer=setTimeout(()=>child.kill(),240000);child.stderr.on('data',bytes=>stderr+=bytes);child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);code===0?done():reject(Error('tar failed '+code+' '+stderr));});});}
await tar(['-a','-cf',zip,'-C',folder,'.']);
const extracted='C:/Users/aseet/AppData/Local/Temp/threecore review zip '+randomUUID();await mkdir(extracted);
await tar(['-xf',zip,'-C',extracted]);const after=await verifyPackage(extracted);assert.deepEqual(after,before);
const original=await readFile(join(extracted,'START_HERE.txt'));
await appendFile(join(extracted,'START_HERE.txt'),'\nverification-control\n');
let alteredFileRejected=false;
try{await verifyPackage(extracted);}catch(error){assert.match(error.message,/CHECKSUM_MISMATCH: START_HERE.txt/);alteredFileRejected=true;}
assert(alteredFileRejected);await writeFile(join(extracted,'START_HERE.txt'),original);
assert.deepEqual(await verifyPackage(extracted),before);
const bytes=await readFile(zip);
const result={recordedAt:new Date().toISOString(),sourceRevision:receipt.sourceRevision,zip,bytes:bytes.length,sha256:sha(bytes),
  before,after,outerZipFreshlyExtracted:true,alteredFileRejected,alteredFileRestoredAndReverified:true,
  fullGitHistoryRestoredFor:['Wallet','DAT','EMA','CAWELON'],newPublicRpcReads:false,newUserWalletOperations:false,
  original4231Restarted:false,candidate4232Restarted:false,githubWrites:false,releaseApproved:false};
await writeFile(zip+'.sha256',result.sha256+'  ThreeCore-review-128ee11-20261103.zip\n');
await writeFile('C:/Users/aseet/Downloads/ThreeCore-review-128ee11-zip-receipt.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
