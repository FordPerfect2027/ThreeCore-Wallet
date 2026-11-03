import {captureDataRecord} from './security-data.js';
import {subscribeReadAbort} from './security-abort.js';
import {fetchStateRpcResponse,readStateRpcJson} from './state-rpc-http.js';
import {validateProposalFeeReadRequest} from './proposal-fee-request.js';
import {inspectProposalFeeReviewFile} from './proposal-fee-review.js';
export async function requestProposalFeeReview(simulationPlanFile,{fetchImpl=globalThis.fetch,signal,timeoutMs=125000}={}){
 const data=validateProposalFeeReadRequest({simulationPlanFile});
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>125000)throw Error('FEE_CLIENT_TIMEOUT');
 const controller=new AbortController();let timer,subscription;
 try{
  subscription=subscribeReadAbort(signal,()=>controller.abort());if(controller.signal.aborted)throw Error('FEE_CANCELLED');timer=setTimeout(()=>controller.abort(),timeoutMs);
  const response=await fetchStateRpcResponse(fetchImpl,'/rpc/proposal-fees',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
  const packet=captureDataRecord(await readStateRpcJson(response,{signal:controller.signal,stringCharacters:2*1024*1024}),['reviewFile']);
  const checked=await inspectProposalFeeReviewFile(packet.reviewFile,{signal:controller.signal});
  if(checked.files.simulationPlanFile!==simulationPlanFile||checked.recordedResult.environment!=='public-rpc')throw Error('FEE_RESPONSE_CONTEXT');
  if(controller.signal.aborted)throw Error('FEE_CANCELLED');return packet.reviewFile;
 }finally{clearTimeout(timer);subscription?.dispose();controller.abort();}
}
