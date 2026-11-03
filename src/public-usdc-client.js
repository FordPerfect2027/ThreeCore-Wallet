import { validatePublicUsdcRequest } from './public-usdc-request.js';
import { validatePublicUsdc,failPublicUsdc as fail } from './public-usdc-model.js';
import { fetchStateRpcResponse,readStateRpcJson } from './state-rpc-http.js';
import { subscribeReadAbort } from './security-abort.js';
export async function requestPublicUsdc(input,{fetchImpl=globalThis.fetch,signal,timeoutMs=125000}={}){
 const data=validatePublicUsdcRequest(input);
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>125000)fail('USDC_CLIENT_TIMEOUT');
 const controller=new AbortController();let cancellation,timer;
 try{
  cancellation=subscribeReadAbort(signal,()=>controller.abort());if(controller.signal.aborted)fail('USDC_CANCELLED');
  timer=setTimeout(()=>controller.abort(),timeoutMs);
  const response=await fetchStateRpcResponse(fetchImpl,'/rpc/public-usdc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
  const observation=validatePublicUsdc(await readStateRpcJson(response,{signal:controller.signal}));
  if(controller.signal.aborted)fail('USDC_CANCELLED');
  if(observation.account!==data.account||(data.blockNumber!==null&&observation.blockNumber!==data.blockNumber))fail('USDC_RESPONSE_CONTEXT');
  return observation;
 }finally{clearTimeout(timer);cancellation?.dispose();controller.abort();}
}
