import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const work='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work',dat=work+'/token-dependency-repair-DAT-20261102';
const evidence=work+'/threecore-wallet-operation-rehearsal-20261029/docs/evidence/2026-11-02-token-dependency-review';
const output='C:/Users/aseet/Downloads/ThreeCore-sepolia-deployment-check-20261102-v2';
const lowerBound=46500000n;
await mkdir(output);
const require=createRequire(dat+'/package.json'),{createPublicClient,getContractAddress,keccak256,stringToHex}=require('viem'),solc=require('solc');
const {createReadOnlyHttp}=await import(pathToFileURL(dat+'/src/read-only-http.js'));
const client=createPublicClient({transport:createReadOnlyHttp('https://sepolia.base.org')});
const saved=JSON.parse(await readFile(evidence+'/runtime-public-comparison.json','utf8')).observations.find(x=>x.chainId===84532);
const inputs=JSON.parse(await readFile(evidence+'/source-reconstruction-inputs.json','utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(solc.version(),inputs.compilerVersion);assert.equal(sha(await readFile(require.resolve('solc/soljson.js'))),inputs.soljsonSha256);
const hash=x=>{assert.match(x,/^0x[0-9a-f]{64}$/i);return x.toLowerCase();},address=x=>{assert.match(x,/^0x[0-9a-f]{40}$/i);return x.toLowerCase();};
const quantity=x=>{assert.match(x,/^0x(?:0|[1-9a-f][0-9a-f]*)$/i);return BigInt(x);};
const hex=n=>'0x'+n.toString(16),raw=[],headers=new Map();
async function request(method,params){assert(['eth_chainId','eth_getCode','eth_getBlockByNumber','eth_getTransactionReceipt'].includes(method));assert(raw.length<140);const entry={method,params};raw.push(entry);try{entry.result=await client.request({method,params});return entry.result;}catch(error){entry.error={name:error.name,message:error.shortMessage||error.message,details:error.details,code:error.code};throw error;}}
async function header(number){const k=hex(number);if(!headers.has(k)){const h=await request('eth_getBlockByNumber',[k,false]);assert(h);assert.equal(quantity(h.number),number);hash(h.hash);headers.set(k,h);}return headers.get(k);}
const report={startedAt:new Date().toISOString(),chainId:84532,endpoint:'https://sepolia.base.org',rows:[],lowerBoundBlock:lowerBound.toString(),readOnly:true,signatureCreated:false,transactionSent:false,searchAssumption:'Locate a code-absent/code-present boundary, then require a matching direct CREATE transaction and successful mint receipt at that exact block.'};
try{
 assert.equal(quantity(await request('eth_chainId',[])),84532n);
 const latest=await request('eth_getBlockByNumber',['latest',false]);assert(latest);const high=quantity(latest.number);hash(latest.hash);headers.set(hex(high),latest);
 for(const token of ['EMA','CAWELON']){
  const known=saved.rows.find(r=>r.token===token);assert(known);const contract=known.contract;
  const searches=[];
  async function codeAt(n){const h=await header(n);const code=await request('eth_getCode',[contract,{blockHash:h.hash,requireCanonical:true}]);assert.match(code,/^0x(?:[0-9a-f]{2})*$/i);assert(code.length<=2+256*1024*2);if(code!=='0x')assert.equal(keccak256(code),known.onchainRuntimeKeccak256);searches.push({blockNumber:n.toString(),blockHash:hash(h.hash),codePresent:code!=='0x',codeKeccak256:keccak256(code)});return code!=='0x';}
  assert.equal(await codeAt(lowerBound),false);assert.equal(await codeAt(high),true);
  let lo=lowerBound,hi=high,steps=0;
  while(hi-lo>1n){assert(++steps<=27);const mid=(lo+hi)/2n;if(await codeAt(mid))hi=mid;else lo=mid;}
  assert.equal(await codeAt(lo),false);assert.equal(await codeAt(hi),true);
  const full=await request('eth_getBlockByNumber',[hex(hi),true]);assert.equal(hash(full.hash),hash((await header(hi)).hash));assert.equal(quantity(full.number),hi);assert(Array.isArray(full.transactions));
  const matches=full.transactions.filter(tx=>tx.to===null&&getContractAddress({from:tx.from,nonce:quantity(tx.nonce)}).toLowerCase()===contract);assert.equal(matches.length,1);const tx=matches[0];
  assert.equal(quantity(tx.chainId),84532n);assert.equal(quantity(tx.blockNumber),hi);assert.equal(hash(tx.blockHash),hash(full.hash));assert.equal(quantity(tx.value),0n);
  const index=quantity(tx.transactionIndex);assert(index<100000n);assert.equal(hash(full.transactions[Number(index)].hash),hash(tx.hash));
  const receipt=await request('eth_getTransactionReceipt',[hash(tx.hash)]);assert(receipt);assert.equal(quantity(receipt.status),1n);assert.equal(address(receipt.contractAddress),contract);assert.equal(receipt.to,null);assert.equal(address(receipt.from),address(tx.from));
  assert.equal(hash(receipt.transactionHash),hash(tx.hash));assert.equal(quantity(receipt.transactionIndex),index);assert.equal(quantity(receipt.blockNumber),hi);assert.equal(hash(receipt.blockHash),hash(full.hash));
  const entry=inputs.inputs.find(e=>e.token===token),bytes=await readFile(evidence+'/'+entry.file);assert.equal(sha(bytes),entry.sha256);const input=JSON.parse(bytes);
  input.sources=Object.fromEntries(Object.entries(input.sources).map(([p,v])=>[p.replace('npm/@openzeppelin/contracts@5.6.1/','@openzeppelin/contracts/').replace(/^project\//,''),v]));delete input.settings.remappings;input.settings.outputSelection={'*':{'*':['evm.bytecode.object']}};
  const built=JSON.parse(solc.compile(JSON.stringify(input)));assert.deepEqual((built.errors||[]).filter(e=>e.severity==='error'),[]);const creation='0x'+built.contracts['contracts/'+token+'Core.sol'][token+'Core'].evm.bytecode.object;
  assert.match(tx.input,/^0x(?:[0-9a-f]{2})+$/i);assert.equal(tx.input.length,creation.length+64);assert.equal(tx.input.slice(0,-64).toLowerCase(),creation);
  const argument=tx.input.slice(-64).toLowerCase();assert.equal(argument.slice(0,24),'0'.repeat(24));const holder=address('0x'+argument.slice(24));assert.notEqual(holder,'0x'+'0'.repeat(40));
  const supply=token==='EMA'?'777000000000000000000000000':'420000000000000000000000000000000';
  assert(Array.isArray(receipt.logs));assert.equal(receipt.logs.length,1);const log=receipt.logs[0];assert.equal(address(log.address),contract);assert.equal(log.removed,false);assert.equal(hash(log.transactionHash),hash(tx.hash));assert.equal(quantity(log.transactionIndex),index);assert.equal(quantity(log.blockNumber),hi);assert.equal(hash(log.blockHash),hash(full.hash));
  assert.deepEqual(log.topics.map(hash),[keccak256(stringToHex('Transfer(address,address,uint256)')),'0x'+'0'.repeat(64),'0x'+argument]);assert.match(log.data,/^0x[0-9a-f]{64}$/i);assert.equal(BigInt(log.data).toString(),supply);
  const after=await request('eth_getBlockByNumber',[hex(hi),false]);assert.equal(hash(after.hash),hash(full.hash));assert.equal(quantity(after.number),hi);assert.equal(hash(after.transactions[Number(index)]),hash(tx.hash));
  report.rows.push({token,contract,transaction:hash(tx.hash),blockNumber:hi.toString(),blockHash:hash(full.hash),deployer:address(tx.from),initialHolder:holder,initialSupply:supply,codeAbsentAtPrecedingBlock:true,codeMatchesSavedRuntime:true,directCreateAddressMatches:true,fullCreationBytecodeMatches:true,initialMintMatches:true,canonicalHeaderRechecked:true,searches});
  console.log(JSON.stringify({token,creationBlock:hi.toString(),transaction:hash(tx.hash),fullCreationBytecodeMatches:true,initialMintMatches:true,requests:raw.length}));
 }
 const end=await request('eth_getBlockByNumber',[latest.number,false]);assert.equal(hash(end.hash),hash(latest.hash));assert.equal(quantity(await request('eth_chainId',[])),84532n);report.chainAndObservationHeaderRechecked=true;
}catch(error){report.error={name:error.name,message:error.shortMessage||error.message};process.exitCode=1;console.error(JSON.stringify(report.error));}
report.finishedAt=new Date().toISOString();report.requests=raw.length;const rawBytes=Buffer.from(JSON.stringify(raw,null,2)+'\n');report.rawSha256=sha(rawBytes);
await writeFile(output+'/raw-rpc.json',rawBytes,{flag:'wx'});await writeFile(output+'/results.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
