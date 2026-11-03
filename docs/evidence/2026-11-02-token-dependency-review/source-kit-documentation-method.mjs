import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const old='C:/Users/aseet/Downloads/ThreeCore-source-verification-9838e5b-20261102-v2';
const target='C:/Users/aseet/Downloads/ThreeCore-source-verification-9838e5b-20261102-final';
const sha=b=>createHash('sha256').update(b).digest('hex');
const receipt=JSON.parse(await readFile(old+'-receipt.json','utf8'));assert.equal(sha(await readFile(old+'.zip')),receipt.sha256);
await mkdir(target);
const lines=(await readFile(old+'/SHA256SUMS.txt','utf8')).trim().split(/\r?\n/),names=[];
for(const line of lines){const name=line.slice(66);assert(!name.includes('..'));const bytes=await readFile(join(old,name));assert.equal(sha(bytes),line.slice(0,64));const path=join(target,name);await mkdir(join(path,'..'),{recursive:true});await writeFile(path,bytes,{flag:'wx'});names.push(name);}
const report=await readFile(target+'/REPORT.md','utf8');assert(report.includes('evidence/2026-11-02-token-dependency-review/'));
await writeFile(target+'/REPORT.md',report.replace('# Deployment source reconstruction — November 2, 2026','# Deployment source reconstruction — November 2, 2026\n\nFor this standalone kit, use the commands in はじめに_README.txt. Repository\ncommands below retain their original checkout paths.').replaceAll('(evidence/2026-11-02-token-dependency-review/)','(evidence/)'));
const sums=[];for(const name of names)sums.push(sha(await readFile(join(target,name)))+'  '+name);await writeFile(target+'/SHA256SUMS.txt',sums.join('\n')+'\n',{flag:'wx'});
execFileSync('tar.exe',['-a','-cf',target+'.zip','-C',target,'.'],{windowsHide:true,timeout:120000});
const restored='C:/Users/aseet/AppData/Local/Temp/threecore source final '+randomUUID();await mkdir(restored);execFileSync('tar.exe',['-xf',target+'.zip','-C',restored],{windowsHide:true,timeout:120000});
async function list(root,prefix=''){let files=[];for(const e of await readdir(join(root,prefix),{withFileTypes:true})){const n=prefix+e.name;if(e.isDirectory())files=files.concat(await list(root,n+'/'));else{assert(e.isFile());files.push(n);}}return files.sort();}
assert.deepEqual((await list(restored)).filter(n=>n!=='SHA256SUMS.txt'),names.toSorted());
for(const line of sums)assert.equal(sha(await readFile(join(restored,line.slice(66)))),line.slice(0,64));
const zip=await readFile(target+'.zip');const final={...receipt,zip:target+'.zip',bytes:zip.length,sha256:sha(zip),documentationLinksAdjusted:true,originalVerificationZipSha256:receipt.sha256,verificationCodeAndDataUnchanged:true};
await writeFile(target+'-receipt.json',JSON.stringify(final,null,2)+'\n',{flag:'wx'});await writeFile(target+'.zip.sha256',final.sha256+'  '+final.zip.split('/').pop()+'\n',{flag:'wx'});
console.log(JSON.stringify(final));
