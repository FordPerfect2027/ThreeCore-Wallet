import { validateProposalAllowanceRequest, validateProposalAllowance, failAllowance as fail } from './proposal-allowance.js';
import { fetchStateRpcResponse, readStateRpcJson } from './state-rpc-http.js';
import { subscribeReadAbort } from './security-abort.js';
export async function requestProposalAllowance(input,{fetchImpl=globalThis.fetch,signal,timeoutMs=125000}={}) {
 const data=validateProposalAllowanceRequest(input);
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>125000)fail('ALLOWANCE_CLIENT_TIMEOUT');
 const controller=new AbortController();let subscription,timer;
 try {
  subscription=subscribeReadAbort(signal,()=>controller.abort());if(controller.signal.aborted)fail('ALLOWANCE_CANCELLED');
  timer=setTimeout(()=>controller.abort(),timeoutMs);
  const response=await fetchStateRpcResponse(fetchImpl,'/rpc/proposal-allowance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
  const observation=validateProposalAllowance(await readStateRpcJson(response,{signal:controller.signal}));
  if(controller.signal.aborted)fail('ALLOWANCE_CANCELLED');
  if(Object.keys(data).some(key=>data[key]!==observation[key]))fail('ALLOWANCE_RESPONSE_CONTEXT');
  return observation;
 } finally { clearTimeout(timer);subscription?.dispose();controller.abort(); }
}
