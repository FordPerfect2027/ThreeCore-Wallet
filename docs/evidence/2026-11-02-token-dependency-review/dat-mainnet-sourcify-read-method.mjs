import{mkdir,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
const dir='C:/Users/aseet/Downloads/ThreeCore-DAT-sourcify-20261102';
const url='https://sourcify.dev/server/v2/contract/8453/0x6c83dd253f2f882b9884fd1ac3a7754ed6405de5?fields=all';
await mkdir(dir);
const record={startedAt:new Date().toISOString(),url,method:'GET',credentialsUsed:false,submission:false};
try{
 const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{accept:'application/json'}});
 record.status=r.status;record.contentType=r.headers.get('content-type');
 const reader=r.body.getReader(),parts=[];let size=0;
 for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw Error('Response exceeds 2 MiB');}parts.push(Buffer.from(value));}
 const raw=Buffer.concat(parts);await writeFile(dir+'/response.json',raw,{flag:'wx'});
 record.bytes=raw.length;record.sha256=createHash('sha256').update(raw).digest('hex');
 const body=JSON.parse(raw);record.keys=Object.keys(body);record.match=body.match;record.runtimeMatch=body.runtimeMatch;record.creationMatch=body.creationMatch;record.compiler=body.compilation?.compiler;
 record.metadataAvailable=!!body.metadata;record.sources=body.sources?Object.keys(body.sources):[];
}catch(e){record.error=e.message;}
record.finishedAt=new Date().toISOString();
await writeFile(dir+'/receipt.json',JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({dir,record},null,2));
