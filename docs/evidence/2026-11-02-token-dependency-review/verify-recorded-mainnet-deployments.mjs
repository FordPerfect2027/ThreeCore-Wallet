#!/usr/bin/env node
// Offline check of recorded RPC responses and recompiled creation inputs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
if(process.argv.length!==3)throw Error('Usage: node verify-recorded-mainnet-deployments.mjs <token-checkout-with-solc-and-viem>');
const dir=dirname(fileURLToPath(import.meta.url)),read=name=>readFileSync(join(dir,name));
const require=createRequire(join(resolve(process.argv[2]),'package.json'));
const solc=require('solc'),{getContractAddress,keccak256,stringToHex}=require('viem');
const sha=b=>createHash('sha256').update(b).digest('hex');
const inputs=JSON.parse(read('source-reconstruction-inputs.json'));
assert.equal(solc.version(),inputs.compilerVersion);assert.equal(sha(readFileSync(require.resolve('solc/soljson.js'))),inputs.soljsonSha256);
const receipt=JSON.parse(read('mainnet-deployment-results.json')),rawBytes=read('mainnet-deployment-rpc.json');
assert.equal(sha(rawBytes),receipt.rawSha256);assert.equal(receipt.error,undefined);assert.equal(receipt.chainId,8453);assert.equal(receipt.rows.length,3);
const raw=JSON.parse(rawBytes);assert.equal(raw.length,14);
const holder='0xfbe494b465efe6d0daff80dc715302d0fa0ac5d9';
const expected={
 DAT:{contract:'0x6c83dd253f2f882b9884fd1ac3a7754ed6405de5',transaction:'0x49cb417f0231eb149d60bcc471d0676a0643eb5cfc319741d8452c6e5d9cb589',supply:'1000000000000000000000000000'},
 EMA:{contract:'0xbae0933d509b83b7bbab3aab9fed413504382a76',transaction:'0x781f30ca91c974e60853d9dd1b8e71700bfd835eddffbd2b7222f0846f1208aa',supply:'777000000000000000000000000'},
 CAWELON:{contract:'0xb4654b5a4617fe2c27a0dd6eaee98f8aa941b895',transaction:'0x13ff6cae2e986d729aa76bf348f04186dff1bd80aae6fc8d684b0d559be8fd28',supply:'420000000000000000000000000000000'}
};
const address=v=>{assert.match(v,/^0x[0-9a-f]{40}$/i);return v.toLowerCase();};
const hash=v=>{assert.match(v,/^0x[0-9a-f]{64}$/i);return v.toLowerCase();};
const quantity=v=>{assert.match(v,/^0x(?:0|[1-9a-f][0-9a-f]*)$/i);return BigInt(v);};
function split(code){assert.match(code,/^0x(?:[a-f0-9]{2})+$/);const n=parseInt(code.slice(-4),16)+2;assert(n>2&&n<(code.length-2)/2);const metadata='0x'+code.slice(-n*2);assert.match(metadata,/^0xa2646970667358221220[0-9a-f]{64}64736f6c63430008220033$/);return {executable:code.slice(0,-n*2),metadata};}
function verify(item,fixture,compiled){
 const {tx,receipt:r,before,after}=fixture;
 assert.equal(hash(tx.hash),item.transaction);assert.equal(hash(r.transactionHash),item.transaction);
 assert.equal(address(tx.from),holder);assert.equal(address(r.from),holder);assert.equal(tx.to,null);assert.equal(r.to,null);
 assert.equal(address(r.contractAddress),item.contract);assert.equal(quantity(tx.value),0n);assert.equal(quantity(r.status),1n);
 assert.equal(quantity(tx.chainId),8453n);assert.equal(quantity(tx.blockNumber),quantity(r.blockNumber));assert.equal(hash(tx.blockHash),hash(r.blockHash));
 const index=quantity(tx.transactionIndex);assert(index<100000n);assert.equal(index,quantity(r.transactionIndex));
 assert.equal(getContractAddress({from:tx.from,nonce:quantity(tx.nonce)}).toLowerCase(),item.contract);
 for(const header of [before,after]){assert.equal(hash(header.hash),hash(tx.blockHash));assert.equal(quantity(header.number),quantity(tx.blockNumber));assert.equal(hash(header.transactions[Number(index)]),item.transaction);}
 assert.match(tx.input,/^0x(?:[a-f0-9]{2})+$/i);assert(tx.input.length<=2+256*1024*2);
 assert.equal(tx.input.slice(-64).toLowerCase(),holder.slice(2).padStart(64,'0'));
 assert(Array.isArray(r.logs));assert.equal(r.logs.length,1);const log=r.logs[0];
 assert.equal(address(log.address),item.contract);assert.equal(log.removed,false);assert.equal(hash(log.blockHash),hash(tx.blockHash));assert.equal(quantity(log.blockNumber),quantity(tx.blockNumber));assert.equal(hash(log.transactionHash),item.transaction);assert.equal(quantity(log.transactionIndex),index);
 assert.deepEqual(log.topics.map(hash),[keccak256(stringToHex('Transfer(address,address,uint256)')),'0x'+'0'.repeat(64),'0x'+holder.slice(2).padStart(64,'0')]);
 assert.match(log.data,/^0x[a-f0-9]{64}$/i);assert.equal(BigInt(log.data).toString(),item.supply);
 const creation=tx.input.slice(0,-64).toLowerCase();
 assert.equal(split(creation).executable,split(compiled).executable);
 const full=creation===compiled;assert.equal(full,item.token!=='DAT');
 return {token:item.token,contract:item.contract,transaction:item.transaction,blockNumber:quantity(tx.blockNumber).toString(),blockHash:hash(tx.blockHash),
  initialHolder:holder,initialSupply:item.supply,initialMintMatches:true,constructorArgumentMatches:true,addressDerivationMatches:true,canonicalRecordedHeadersMatch:true,
  fullCreationBytecodeMatches:full,creationExecutableMatches:true,metadataMatches:split(creation).metadata===split(compiled).metadata};
}
let cursor=0;
function consume(method,params){const item=raw[cursor++];assert.equal(item.method,method);assert.deepEqual(item.params,params);return item.result;}
assert.equal(quantity(consume('eth_chainId',[])),8453n);
const rows=[],controlKinds=new Set();
for(const token of ['DAT','EMA','CAWELON']){
 const item={token,...expected[token]},entry=inputs.inputs.find(x=>x.token===token);assert(entry);
 const bytes=read(entry.file);assert.equal(sha(bytes),entry.sha256);const input=JSON.parse(bytes);
 input.sources=Object.fromEntries(Object.entries(input.sources).map(([path,value])=>[path.replace('npm/@openzeppelin/contracts@5.6.1/','@openzeppelin/contracts/').replace(/^project\//,''),value]));
 delete input.settings.remappings;input.settings.outputSelection={'*':{'*':['evm.bytecode.object']}};
 const built=JSON.parse(solc.compile(JSON.stringify(input)));assert.deepEqual((built.errors||[]).filter(e=>e.severity==='error'),[]);
 const compiled='0x'+built.contracts['contracts/'+token+'Core.sol'][token+'Core'].evm.bytecode.object;
 const tx=consume('eth_getTransactionByHash',[item.transaction]),r=consume('eth_getTransactionReceipt',[item.transaction]);
 const before=consume('eth_getBlockByNumber',[tx.blockNumber,false]),after=consume('eth_getBlockByNumber',[tx.blockNumber,false]);
 const fixture={tx,receipt:r,before,after};rows.push(verify(item,fixture,compiled));
 const mutations={
  sender:f=>{f.tx.from='0x'+'11'.repeat(20);},
  constructor:f=>{f.tx.input=f.tx.input.slice(0,-64)+'0'.repeat(64);},
  failedReceipt:f=>{f.receipt.status='0x0';},
  wrongCreatedContract:f=>{f.receipt.contractAddress='0x'+'11'.repeat(20);},
  removedLog:f=>{f.receipt.logs[0].removed=true;},
  wrongMintSupply:f=>{f.receipt.logs[0].data='0x'+'0'.repeat(64);},
  wrongMintRecipient:f=>{f.receipt.logs[0].topics[2]='0x'+'0'.repeat(64);},
  changedCanonicalHeader:f=>{f.after.hash='0x'+'11'.repeat(32);},
  wrongTransactionPosition:f=>{f.before.transactions[Number(quantity(f.tx.transactionIndex))]='0x'+'11'.repeat(32);},
  wrongChain:f=>{f.tx.chainId='0x14a34';},
  wrongCreationOpcode:f=>{f.tx.input='0xff'+f.tx.input.slice(4);}
 };
 for(const[kind,mutate]of Object.entries(mutations)){const changed=structuredClone(fixture);mutate(changed);assert.throws(()=>verify(item,changed,compiled),undefined,kind);controlKinds.add(kind);}
}
assert.equal(quantity(consume('eth_chainId',[])),8453n);assert.equal(cursor,raw.length);
console.log(JSON.stringify({offline:true,rows,initialMintAndConstructorChecksPassed:3,completeCreationBytecodeMatches:2,
 remainingMetadataMismatches:['DAT / Base Mainnet'],negativeControlKinds:[...controlKinds],currentChainReverified:false,currentHolderBalanceVerified:false,independentAudit:false},null,2));
