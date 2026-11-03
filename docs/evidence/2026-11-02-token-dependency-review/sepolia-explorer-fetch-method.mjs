import{mkdirSync,writeFileSync}from'node:fs';
const url='https://base-sepolia.blockscout.com/api/v2/smart-contracts/0x2474A062Ec669C1912Ed41Bc491E8a97db4743D4';
const out='C:/Users/aseet/Downloads/ThreeCore-sepolia-artifact-diagnosis-20261102';mkdirSync(out,{recursive:true});
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
try{
 const response=await fetch(url,{signal:controller.signal});
 if(!response.ok)throw Error('HTTP_'+response.status);
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4*1024*1024){await reader.cancel();throw Error('SOURCE_SIZE_LIMIT');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=Buffer.concat(chunks),data=JSON.parse(bytes);writeFileSync(out+'/explorer-source.json',bytes);
 const summary={recordedAt:new Date().toISOString(),url,bytes:size,keys:Object.keys(data),compiler_version:data.compiler_version,optimization_enabled:data.optimization_enabled,evm_version:data.evm_version,file_path:data.file_path,verified_at:data.verified_at,additional_source_count:data.additional_sources?.length,compiler_settings:data.compiler_settings};
 writeFileSync(out+'/explorer-summary.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}catch(error){const result={recordedAt:new Date().toISOString(),url,error:error.name==='AbortError'?'TIMEOUT':error.message};writeFileSync(out+'/explorer-fetch-error.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exitCode=1;}finally{clearTimeout(timer);}
