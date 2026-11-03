import {writeFile} from 'node:fs/promises';
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
const result={at:new Date().toISOString(),endpoint:'https://sepolia.base.org',request:{jsonrpc:'2.0',id:1,method:'eth_getBlockByNumber',params:['0x0',false]}};
try{const response=await fetch(result.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(result.request),signal:controller.signal,redirect:'error'});result.httpStatus=response.status;const text=await response.text();if(text.length>65536)throw Error('Response too large');result.response=JSON.parse(text);}
catch(error){result.error={name:error.name,message:error.message};}finally{clearTimeout(timer);}
await writeFile('C:/Users/aseet/Downloads/ThreeCore-sepolia-deployment-check-20261102/genesis-diagnostic.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({httpStatus:result.httpStatus,responseError:result.response?.error,error:result.error}));
