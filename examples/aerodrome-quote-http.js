import { parseSecurityJson } from '../src/security-json.js';
import { validateAerodromeQuoteRequest } from '../src/aerodrome-quote-request.js';
import { readAerodromeQuote } from '../src/aerodrome-quote-reader.js';
const MAX_BODY=1024;
/** Runs after inspectLocalRequest; accepts no URL, RPC method, wallet or credentials. */
export function createAerodromeQuoteHandler(fetchImpl=globalThis.fetch){
 let active=0;
 return async(request,response)=>{
  const send=(status,value)=>{if(response.destroyed||response.writableEnded)return;response.writeHead(status,{'content-type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));};
  const error=(status,code)=>send(status,{error:code});
  if(request.method!=='POST'||request.headers.origin!=='http://'+request.headers.host||request.headers['content-type']!=='application/json'){error(403,'QUOTE_ORIGIN');return;}
  if(active>=2){error(429,'QUOTE_BUSY');return;}
  const length=request.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY)){error(413,'QUOTE_REQUEST_SIZE');return;}
  active++;const controller=new AbortController(),close=()=>controller.abort();response.once('close',close);
  const timer=setTimeout(()=>{controller.abort();error(408,'QUOTE_REQUEST_TIMEOUT');request.destroy();},5000);
  try{let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY){error(413,'QUOTE_REQUEST_SIZE');return;}if(controller.signal.aborted)return;chunks.push(chunk);}
   clearTimeout(timer);let data;try{data=validateAerodromeQuoteRequest(parseSecurityJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),{bytes:MAX_BODY,depth:3,nodes:12,stringCharacters:100}));}catch{error(400,'QUOTE_REQUEST');return;}
   if(controller.signal.aborted)return;
   const quote=await readAerodromeQuote({...data,blockNumber:data.blockNumber??undefined,fetchImpl,signal:controller.signal});
   if(!controller.signal.aborted)send(200,quote);
  }catch{error(controller.signal.aborted?504:502,'QUOTE_UNAVAILABLE');}
  finally{clearTimeout(timer);controller.abort();response.removeListener('close',close);active--;}
 };
}
