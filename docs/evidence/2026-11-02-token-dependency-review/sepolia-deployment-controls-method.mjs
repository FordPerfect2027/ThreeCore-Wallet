import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const source='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029/docs/evidence/2026-11-02-token-dependency-review';
const token='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/token-dependency-repair-DAT-20261102';
const target='C:/Users/aseet/AppData/Local/Temp/threecore sepolia replay '+randomUUID();await mkdir(target);
const files=['verify-recorded-sepolia-deployments.mjs','sepolia-deployment-rpc.json','sepolia-deployment-results.json','runtime-public-comparison.json','source-reconstruction-inputs.json','source-reconstruction-DAT-input.json','source-reconstruction-EMA-input.json','source-reconstruction-CAWELON-input.json'];
const original=JSON.parse(await readFile(source+'/sepolia-deployment-rpc.json','utf8')),receipt=JSON.parse(await readFile(source+'/sepolia-deployment-results.json','utf8'));
const rows=[];
const controls={
 baseline:()=>{},
 wrongMint:raw=>{raw.find(r=>r.method==='eth_getTransactionReceipt').result.logs[0].data='0x'+'0'.repeat(64);},
 wrongCreation:raw=>{const tx=raw.find(r=>r.method==='eth_getBlockByNumber'&&r.params[1]===true).result.transactions.find(t=>t.hash===receipt.rows[0].transaction);tx.input='0xff'+tx.input.slice(4);},
 falseAbsentCode:raw=>{raw.find(r=>r.method==='eth_getCode'&&r.result==='0x').result='0xdeadbeef';},
 changedCanonicalHeader:raw=>{const number='0x'+BigInt(receipt.rows[0].blockNumber).toString(16);const entry=raw.filter(r=>r.method==='eth_getBlockByNumber'&&r.params[0]===number&&r.params[1]===false).at(-1);entry.result.hash='0x'+'11'.repeat(32);}
};
for(const[name,mutate]of Object.entries(controls)){
 const dir=join(target,name);await mkdir(dir);for(const file of files)await copyFile(join(source,file),join(dir,file));
 const raw=structuredClone(original);mutate(raw);const bytes=Buffer.from(JSON.stringify(raw,null,2)+'\n');const updated=structuredClone(receipt);updated.rawSha256=createHash('sha256').update(bytes).digest('hex');
 await writeFile(join(dir,'sepolia-deployment-rpc.json'),bytes);await writeFile(join(dir,'sepolia-deployment-results.json'),JSON.stringify(updated,null,2)+'\n');
 const result=spawnSync(process.execPath,[join(dir,'verify-recorded-sepolia-deployments.mjs'),token],{windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
 assert(!result.error);assert.equal(result.signal,null);assert.equal(result.status===0,name==='baseline',name);
 if(name==='baseline'){const output=JSON.parse(result.stdout);assert.equal(output.creationAndInitialMintMatches,2);assert.equal(output.recordedRequestsReplayed,96);await writeFile('C:/Users/aseet/Downloads/ThreeCore-sepolia-deployment-offline-replay-20261102.json',result.stdout);}
 rows.push({case:name,exitCode:result.status,signal:result.signal,rawDigestUpdated:true,expectedResultObserved:true});console.log(JSON.stringify(rows.at(-1)));
}
await writeFile('C:/Users/aseet/Downloads/ThreeCore-sepolia-deployment-controls-20261102.json',JSON.stringify({source,ownedTarget:target,offline:true,networkRequests:0,rows},null,2)+'\n',{flag:'wx'});
