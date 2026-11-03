import { parseSecurityJson } from '../src/security-json.js';
import { validatePublicUsdcRequest } from '../src/public-usdc-request.js';
import { readPublicUsdc } from '../src/public-usdc-reader.js';
const MAX_BODY=1024;
/** Invoked only after the shared local-request boundary. No caller-selected RPC or contract. */
export function createPublicUsdcHandler(fetchImpl=globalThis.fetch){
 let active=0;
 return async(request,response)=>{
  const send=(status,value)=>{if(response.destroyed||response.writableEnded)return;response.writeHead(status,{'content-type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));};
  const error=(status,code)=>send(status,{error:code});
  if(request.method!=='POST'||request.headers.origin!=='http://'+request.headers.host||request.headers['content-type']!=='application/json'){error(403,'USDC_ORIGIN');return;}
  if(active>=2){error(429,'USDC_BUSY');return;}
  const length=request.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY)){error(413,'USDC_REQUEST_SIZE');return;}
  active++;const controller=new AbortController(),close=()=>controller.abort();response.once('close',close);
  const timer=setTimeout(()=>{controller.abort();error(408,'USDC_REQUEST_TIMEOUT');request.destroy();},5000);
  try{
   let size=0;const chunks=[];
   for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY){error(413,'USDC_REQUEST_SIZE');return;}if(controller.signal.aborted)return;chunks.push(chunk);}
   clearTimeout(timer);let data;
   try{data=validatePublicUsdcRequest(parseSecurityJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),{bytes:MAX_BODY,depth:3,nodes:10,stringCharacters:120}));}catch{error(400,'USDC_REQUEST');return;}
   if(controller.signal.aborted)return;
   const observation=await readPublicUsdc({...data,blockNumber:data.blockNumber??undefined,fetchImpl,signal:controller.signal});
   if(!controller.signal.aborted)send(200,observation);
  }catch{error(controller.signal.aborted?504:502,'USDC_UNAVAILABLE');}
  finally{clearTimeout(timer);controller.abort();response.removeListener('close',close);active--;}
 };
}
