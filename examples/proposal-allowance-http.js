import { parseSecurityJson } from '../src/security-json.js';
import { validateProposalAllowanceRequest } from '../src/proposal-allowance.js';
import { readProposalAllowance } from '../src/proposal-allowance-reader.js';
const MAX_BODY=1024;
/** Shared local boundary runs first. Only fixed Base contracts and read methods. */
export function createProposalAllowanceHandler(fetchImpl=globalThis.fetch) {
 let active=0;
 return async(request,response)=>{
  const send=(status,value)=>{if(response.destroyed||response.writableEnded)return;response.writeHead(status,{'content-type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));};
  const error=(status,code)=>send(status,{error:code});
  if(request.method!=='POST'||request.headers.origin!=='http://'+request.headers.host||request.headers['content-type']!=='application/json'){error(403,'ALLOWANCE_ORIGIN');return;}
  if(active>=2){error(429,'ALLOWANCE_BUSY');return;}
  const length=request.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY)){error(413,'ALLOWANCE_REQUEST_SIZE');return;}
  active++;const controller=new AbortController(),close=()=>controller.abort();response.once('close',close);
  const timer=setTimeout(()=>{controller.abort();error(408,'ALLOWANCE_REQUEST_TIMEOUT');request.destroy();},5000);
  try {
   let size=0;const chunks=[];
   for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY){error(413,'ALLOWANCE_REQUEST_SIZE');return;}if(controller.signal.aborted)return;chunks.push(chunk);}
   clearTimeout(timer);let data;
   try { data=validateProposalAllowanceRequest(parseSecurityJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),{bytes:MAX_BODY,depth:3,nodes:20,stringCharacters:240})); } catch { error(400,'ALLOWANCE_REQUEST');return; }
   if(controller.signal.aborted)return;
   const observation=await readProposalAllowance(data,{fetchImpl,signal:controller.signal});
   if(!controller.signal.aborted)send(200,observation);
  } catch { error(controller.signal.aborted?504:502,'ALLOWANCE_UNAVAILABLE'); }
  finally { clearTimeout(timer);controller.abort();response.removeListener('close',close);active--; }
 };
}
