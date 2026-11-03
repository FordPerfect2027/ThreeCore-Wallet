import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const work='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work',dat=work+'/token-dependency-repair-DAT-20261102';
const evidence=work+'/threecore-wallet-operation-rehearsal-20261029/docs/evidence/2026-11-02-token-dependency-review';
const output='C:/Users/aseet/Downloads/ThreeCore-mainnet-deployment-check-20261102';
await mkdir(output);
const require=createRequire(dat+'/package.json'),{createPublicClient,getContractAddress,keccak256,stringToHex}=require('viem');
const {createReadOnlyHttp}=await import(pathToFileURL(dat+'/src/read-only-http.js'));
const client=createPublicClient({transport:createReadOnlyHttp('https://mainnet.base.org',{responseBytes:1024*1024})});
const records=[
 {token:'DAT',contract:'0x6c83dd253f2f882b9884fd1ac3a7754ed6405de5',transaction:'0x49cb417f0231eb149d60bcc471d0676a0643eb5cfc319741d8452c6e5d9cb589',supply:'1000000000000000000000000000'},
 {token:'EMA',contract:'0xbae0933d509b83b7bbab3aab9fed413504382a76',transaction:'0x781f30ca91c974e60853d9dd1b8e71700bfd835eddffbd2b7222f0846f1208aa',supply:'777000000000000000000000000'},
 {token:'CAWELON',contract:'0xb4654b5a4617fe2c27a0dd6eaee98f8aa941b895',transaction:'0x13ff6cae2e986d729aa76bf348f04186dff1bd80aae6fc8d684b0d559be8fd28',supply:'420000000000000000000000000000000'}
];
const holder='0xfbe494b465efe6d0daff80dc715302d0fa0ac5d9';
const sourceRows=JSON.parse(await readFile(evidence+'/runtime-public-comparison.json','utf8')).observations.find(o=>o.chainId===8453).rows;
for(const r of records)assert.equal(sourceRows.find(s=>s.token===r.token).contract,r.contract);
const methods=[],raw=[];
async function request(method,params){assert(['eth_chainId','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBlockByNumber'].includes(method));methods.push(method);const result=await client.request({method,params});raw.push({method,params,result});return result;}
const address=v=>{assert.match(v,/^0x[0-9a-f]{40}$/i);return v.toLowerCase();};
const hash=v=>{assert.match(v,/^0x[0-9a-f]{64}$/i);return v.toLowerCase();};
const quantity=v=>{assert.match(v,/^0x(?:0|[1-9a-f][0-9a-f]*)$/i);return BigInt(v);};
const report={startedAt:new Date().toISOString(),chainId:8453,endpoint:'https://mainnet.base.org',rows:[],methods,readOnly:true,signatureCreated:false,transactionSent:false};
try{
 assert.equal(quantity(await request('eth_chainId',[])),8453n);
 for(const item of records){
  const tx=await request('eth_getTransactionByHash',[item.transaction]),receipt=await request('eth_getTransactionReceipt',[item.transaction]);assert(tx&&receipt);
  assert.equal(hash(tx.hash),item.transaction);assert.equal(hash(receipt.transactionHash),item.transaction);
  assert.equal(address(tx.from),holder);assert.equal(address(receipt.from),holder);assert.equal(tx.to,null);assert.equal(receipt.to,null);
  assert.equal(address(receipt.contractAddress),item.contract);assert.equal(quantity(tx.value),0n);assert.equal(quantity(receipt.status),1n);
  assert.equal(quantity(tx.chainId),8453n);assert.equal(quantity(tx.blockNumber),quantity(receipt.blockNumber));assert.equal(hash(tx.blockHash),hash(receipt.blockHash));
  assert.equal(quantity(tx.transactionIndex),quantity(receipt.transactionIndex));assert(quantity(tx.transactionIndex)<100000n);
  assert.equal(getContractAddress({from:tx.from,nonce:quantity(tx.nonce)}).toLowerCase(),item.contract);
  const before=await request('eth_getBlockByNumber',[tx.blockNumber,false]);assert.equal(hash(before.hash),hash(tx.blockHash));assert.equal(quantity(before.number),quantity(tx.blockNumber));
  assert.equal(hash(before.transactions[Number(quantity(tx.transactionIndex))]),item.transaction);
  assert.match(tx.input,/^0x(?:[a-f0-9]{2})+$/i);assert(tx.input.length<=2+256*1024*2);
  const argument=tx.input.slice(-64).toLowerCase();assert.equal(argument,holder.slice(2).padStart(64,'0'));
  assert(Array.isArray(receipt.logs));assert.equal(receipt.logs.length,1);
  const log=receipt.logs[0];assert.equal(address(log.address),item.contract);assert.equal(log.removed,false);assert.equal(hash(log.blockHash),hash(tx.blockHash));assert.equal(quantity(log.blockNumber),quantity(tx.blockNumber));assert.equal(hash(log.transactionHash),item.transaction);assert.equal(quantity(log.transactionIndex),quantity(tx.transactionIndex));
  assert.deepEqual(log.topics.map(hash),[keccak256(stringToHex('Transfer(address,address,uint256)')),'0x'+'0'.repeat(64),'0x'+holder.slice(2).padStart(64,'0')]);
  assert.match(log.data,/^0x[a-f0-9]{64}$/i);assert.equal(BigInt(log.data).toString(),item.supply);
  const after=await request('eth_getBlockByNumber',[tx.blockNumber,false]);assert.equal(hash(after.hash),hash(before.hash));assert.equal(quantity(after.number),quantity(before.number));
  report.rows.push({...item,blockNumber:quantity(tx.blockNumber).toString(),blockHash:hash(tx.blockHash),initialHolder:holder,creationAddressFromSenderAndNonceMatches:true,constructorAddressArgumentMatches:true,initialMintMatches:true,receiptSucceeded:true,canonicalHeaderRechecked:true,creationInputBytes:(tx.input.length-2)/2,completeCreationBytecodeCompared:false});
  console.log(JSON.stringify({token:item.token,block:quantity(tx.blockNumber).toString(),initialMintMatches:true,constructorAddressArgumentMatches:true}));
 }
 assert.equal(quantity(await request('eth_chainId',[])),8453n);report.chainRechecked=true;
}catch(error){report.error={name:error.name,message:error.shortMessage||error.message};process.exitCode=1;}
report.finishedAt=new Date().toISOString();
const rawBytes=Buffer.from(JSON.stringify(raw,null,2)+'\n');report.rawSha256=createHash('sha256').update(rawBytes).digest('hex');
await writeFile(output+'/raw-rpc.json',rawBytes,{flag:'wx'});await writeFile(output+'/results.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
if(report.error)console.error(JSON.stringify(report.error));
