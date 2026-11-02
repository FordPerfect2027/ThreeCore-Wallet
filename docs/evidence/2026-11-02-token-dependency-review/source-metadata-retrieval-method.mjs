import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029';
const output='C:/Users/aseet/Downloads/ThreeCore-deployed-metadata-20261102';
await mkdir(output);
const input=await readFile(root+'/docs/evidence/2026-11-02-token-dependency-review/runtime-public-comparison.json');
const report=JSON.parse(input),sha=b=>createHash('sha256').update(b).digest('hex');
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes){let n=BigInt('0x'+bytes.toString('hex')),s='';while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}for(const b of bytes){if(b!==0)break;s='1'+s;}return s;}
const records=[];
for(const observation of report.observations)for(const row of observation.rows){
 const m=row.onchainMetadata.match(/^0xa264697066735822(1220[0-9a-f]{64})64736f6c63430008220033$/);assert(m);
 records.push({token:row.token,chainId:observation.chainId,blockNumber:observation.blockNumber,blockHash:observation.blockHash,contract:row.contract,cid:base58(Buffer.from(m[1],'hex')),metadataAlreadyMatches:row.metadataMatches});
}
const start=new Date().toISOString();
for(let i=0;i<records.length;i+=2)await Promise.all(records.slice(i,i+2).map(async row=>{
 const url='https://ipfs.io/ipfs/'+row.cid,started=Date.now();row.url=url;
 try{
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{accept:'application/json'}});row.status=response.status;
  if(!response.ok){await response.body?.cancel();throw Error('HTTP_'+response.status);}
  assert(response.body);const reader=response.body.getReader(),parts=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>256*1024){await reader.cancel();throw Error('METADATA_SIZE_LIMIT');}parts.push(Buffer.from(value));}
  const bytes=Buffer.concat(parts),metadata=JSON.parse(bytes.toString('utf8'));
  row.bytes=bytes.length;row.sha256=sha(bytes);row.compiler=metadata.compiler;row.sourcePaths=Object.keys(metadata.sources||{});row.settings=metadata.settings;
  row.file=row.token+'-'+row.chainId+'-metadata.json';await writeFile(output+'/'+row.file,bytes,{flag:'wx'});row.retrieved=true;
 }catch(error){row.retrieved=false;row.error=error.name+': '+error.message;}finally{row.elapsedMs=Date.now()-started;console.log(JSON.stringify({token:row.token,chainId:row.chainId,retrieved:row.retrieved,status:row.status,error:row.error}));}
}));
await writeFile(output+'/retrieval.json',JSON.stringify({startedAt:start,finishedAt:new Date().toISOString(),inputSha256:sha(input),gateway:'https://ipfs.io',requests:records.length,credentialsUsed:false,chainStateRechecked:false,metadataAuthenticated:false,records},null,2)+'\n',{flag:'wx'});
