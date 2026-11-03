import { validateAerodromeQuoteRequest } from './aerodrome-quote-request.js';
import { validateAerodromeQuote,failAerodromeQuote as fail } from './aerodrome-quote-model.js';
import { fetchStateRpcResponse,readStateRpcJson } from './state-rpc-http.js';
import { subscribeReadAbort } from './security-abort.js';
export async function requestAerodromeQuote(input,{fetchImpl=globalThis.fetch,signal,timeoutMs=125000}={}){
 const data=validateAerodromeQuoteRequest(input);if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>125000)fail('QUOTE_CLIENT_TIMEOUT');
 const controller=new AbortController();let cancellation,timer;
 try{cancellation=subscribeReadAbort(signal,()=>controller.abort());if(controller.signal.aborted)fail('QUOTE_CANCELLED');timer=setTimeout(()=>controller.abort(),timeoutMs);
  const response=await fetchStateRpcResponse(fetchImpl,'/rpc/aerodrome-quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
  const quote=validateAerodromeQuote(await readStateRpcJson(response,{signal:controller.signal}));
  if(controller.signal.aborted)fail('QUOTE_CANCELLED');
  if(quote.agent!==data.agent||quote.direction!==data.direction||quote.inputBaseUnits!==data.inputBaseUnits||quote.slippageBps!==data.slippageBps||(data.blockNumber!==null&&quote.blockNumber!==data.blockNumber))fail('QUOTE_RESPONSE_CONTEXT');
  return quote;
 }finally{clearTimeout(timer);cancellation?.dispose();controller.abort();}
}
