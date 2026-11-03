import {parseSecurityJson} from '../src/security-json.js';
import {validateProposalFeeReadRequest} from '../src/proposal-fee-request.js';
import {readProposalFeeReview} from '../src/proposal-fee-reader.js';
const MAX_BODY=1048576;
export function createProposalFeeHandler(fetchImpl=globalThis.fetch, read=readProposalFeeReview){
 let active=0;
 return async(request,response)=>{
  const send=(status,value)=>{if(response.destroyed||response.writableEnded)return;response.writeHead(status,{'content-type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));};
  const error=(status,code)=>send(status,{error:code});
  if(request.method!=='POST'||request.headers.origin!=='http://'+request.headers.host||request.headers['content-type']!=='application/json'){error(403,'FEE_ORIGIN');return;}
  if(active>=2){error(429,'FEE_BUSY');return;}
  const length=request.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY)){error(413,'FEE_REQUEST_SIZE');return;}
  active++;const controller=new AbortController(),close=()=>controller.abort();response.once('close',close);
  const timer=setTimeout(()=>{controller.abort();error(408,'FEE_REQUEST_TIMEOUT');request.destroy();},5000);
  try{
   let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY){error(413,'FEE_REQUEST_SIZE');return;}if(controller.signal.aborted)return;chunks.push(chunk);}
   clearTimeout(timer);let data;
   try{data=validateProposalFeeReadRequest(parseSecurityJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),{bytes:MAX_BODY,depth:3,nodes:10,stringCharacters:524288}));}catch{error(400,'FEE_REQUEST');return;}
   if(controller.signal.aborted)return;const result=await read(data.simulationPlanFile,{fetchImpl,signal:controller.signal});
   if(!controller.signal.aborted)send(200,{reviewFile:result.review.text});
  }catch{error(controller.signal.aborted?504:502,'FEE_UNAVAILABLE');}
  finally{clearTimeout(timer);controller.abort();response.removeListener('close',close);active--;}
 };
}
