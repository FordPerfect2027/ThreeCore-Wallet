import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {readBoundedVaultPath} from '../scripts/check-transfer-vault.js';
import {inspectIdentityFiles} from '../scripts/check-token-identity.js';
import {inspectAllowanceFiles} from '../scripts/check-allowance-file.js';
import {inspectTransferFiles} from '../scripts/check-transfer-file.js';
import {readRehearsalInputFile} from '../scripts/check-rehearsal.js';
import {readBoundedRehearsalText} from '../scripts/read-bounded-rehearsal-file.js';
import {inspectWorkspaceBackup} from '../scripts/check-workspace-backup.js';
import {inspectCheckpointCollection} from '../scripts/check-checkpoint-collection.js';
import {inspectEncryptedLibraryFile} from '../scripts/check-encrypted-library.js';
function fakeHandle({after={},size=2,contents='{}',failRead=false}={}){
 const bytes=new TextEncoder().encode(contents);let position=0,stats=0,closed=0,reads=0;
 const original={isFile:()=>true,size,mtimeNs:1000000n,ctimeNs:2000000n,ino:2n**60n+1n,dev:4n};
 return {handle:{async stat(options){const value={...original,...(++stats>1?after:{})};assert.equal(options?.bigint,true);for(const name of ['size','mtimeNs','ctimeNs','ino','dev'])value[name]=BigInt(value[name]);return value;},
 async read(target,offset,length,where){reads++;if(failRead)throw Error('read failure');const start=where??position,count=Math.max(0,Math.min(length,bytes.length-start));target.set(bytes.subarray(start,start+count),offset);position=start+count;return {bytesRead:count};},
 async close(){closed++;}},metrics:()=>({stats,closed,reads})};
}
async function withFile(t,options,run){const f=fakeHandle(options);let opened=0;const mock=t.mock.method(fs,'open',async()=>{opened++;return f.handle;});syncBuiltinESMExports();try{await run(f,()=>opened);}finally{mock.mock.restore();syncBuiltinESMExports();}}
for(const [field,value] of [['mtimeNs',1000001n],['ctimeNs',2000001n],['ino',2n**60n+2n],['dev',5n],['size',3n]])test('offline bounded read rejects a changed '+field+' after reading',async t=>withFile(t,{after:{[field]:value}},async f=>{
 await assert.rejects(readBoundedVaultPath('synthetic.json',10),/VAULT_CLI_FILE_CHANGED/);assert.equal(f.metrics().closed,1);
}));
for(const limit of [Infinity,NaN,0,-1,1.5,'10',96*1024*1024+1])test('offline bounded read rejects invalid limit before opening: '+String(limit),async t=>withFile(t,{},async(_f,opened)=>{
 await assert.rejects(readBoundedVaultPath('synthetic.json',limit),/VAULT_CLI_FILE_LIMIT/);assert.equal(opened(),0);
}));
test('stable offline file retains exact text and closes its handle',async t=>withFile(t,{},async f=>{
 assert.equal(await readBoundedVaultPath('synthetic.json',10),'{}');assert.equal(f.metrics().closed,1);
}));
test('offline growth is rejected before returning a truncated success',async t=>withFile(t,{contents:'{}x'},async f=>{
 await assert.rejects(readBoundedVaultPath('synthetic.json',10),/VAULT_CLI_FILE_CHANGED/);assert.equal(f.metrics().closed,1);
}));
test('offline read failure still closes its handle',async t=>withFile(t,{failRead:true},async f=>{
 await assert.rejects(readBoundedVaultPath('synthetic.json',10),/read failure/);assert.equal(f.metrics().closed,1);
}));
for(const [name,read,code]of[
 ['identity',()=>inspectIdentityFiles({file:'synthetic.json'}),'IDENTITY_FILE_SIZE'],
 ['allowance',()=>inspectAllowanceFiles({file:'synthetic.json'}),'ALLOWANCE_FILE_SIZE'],
 ['transfer',()=>inspectTransferFiles({file:'synthetic.json'}),'TRANSFER_FILE_SIZE'],
 ['transfer archive',()=>inspectTransferFiles({file:'synthetic.json',archive:true}),'TRANSFER_FILE_SIZE'],
 ['rehearsal input',()=>readRehearsalInputFile('synthetic.json'),'FILE_CHANGED_OR_TOO_LARGE'],
 ['rehearsal workspace',()=>readRehearsalInputFile('synthetic.json',null,true),'FILE_CHANGED_OR_TOO_LARGE'],
 ['rehearsal text',()=>readBoundedRehearsalText('synthetic.json',100),'FILE_CHANGED_OR_TOO_LARGE'],
])test(name+': changed file is rejected before interpreting its contents',async t=>withFile(t,{after:{ctimeNs:2000001n}},async f=>{
 await assert.rejects(read(),{code});assert.equal(f.metrics().closed,1);
}));
for(const [name,read,pattern]of[['backup',()=>inspectWorkspaceBackup('synthetic.json'),/Backup file changed/],['checkpoints',()=>inspectCheckpointCollection('synthetic.json'),/File changed during/]])test(name+' rejects a nanosecond change before parsing',async t=>withFile(t,{after:{mtimeNs:1000001n}},async f=>{await assert.rejects(read(),pattern);assert.equal(f.metrics().closed,1);}));
test('encrypted archive reports a metadata conflict without decrypting',async t=>withFile(t,{after:{ctimeNs:2000001n}},async f=>{assert.deepEqual(await inspectEncryptedLibraryFile('synthetic.json'),{ok:false,code:'LIBRARY_CONFLICT'});assert.equal(f.metrics().closed,1);}));
test('native file changed between reads is rejected without modifying it again',async t=>{
 const root=resolve(tmpdir()),folder=await fs.mkdtemp(join(root,'threecore-inspection-race-')),path=join(folder,'sample.json');
 const original='x'.repeat(128*1024),replacement='y'.repeat(original.length);let mutated=false,closed=false;
 await fs.writeFile(path,original);await fs.utimes(path,new Date('2000-01-01'),new Date('2000-01-01'));
 const open=fs.open,hook=t.mock.method(fs,'open',async(...args)=>{const handle=await open(...args),read=handle.read.bind(handle),close=handle.close.bind(handle);
   handle.read=async(...readArgs)=>{const result=await read(...readArgs);if(!mutated){mutated=true;await fs.writeFile(path,replacement);}return result;};
   handle.close=async()=>{closed=true;return close();};return handle;});syncBuiltinESMExports();
 try{await assert.rejects(readBoundedVaultPath(path,original.length),/VAULT_CLI_FILE_CHANGED/);assert.equal(mutated,true);assert.equal(closed,true);assert.equal(await fs.readFile(path,'utf8'),replacement);}
 finally{hook.mock.restore();syncBuiltinESMExports();const target=resolve(folder);assert.ok(target.startsWith(root+sep)&&target!==root);await fs.rm(target,{recursive:true,force:true});}
});
