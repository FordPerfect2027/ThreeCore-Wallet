import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createPublicBaseRpcReader } from '../../../src/public-base-rpc.js';
const dir=new URL('./',import.meta.url),previous=JSON.parse(await readFile(new URL('live-results.json',dir),'utf8'));
const failed=previous.rows.find(row=>row.agent==='CAWELON');assert.equal(failed.errorCode,'QUOTE_ZERO_OR_INVALID_OUTPUT');
const rpc=createPublicBaseRpcReader({rpcUrl:'https://mainnet.base.org'}),replies=[];
for(const request of failed.requests.filter(r=>r.method==='eth_call'&&['0xf140a35a','0x5509a1ac'].includes(r.params[0].data.slice(0,10)))){
  const response=await rpc(request.method,request.params);assert.match(response,/^0x[0-9a-f]+$/);assert.equal(BigInt('0x'+response.slice(-64)),0n);replies.push({request,response});
}
assert.equal(replies.length,2);await writeFile(new URL('zero-output-control.json',dir),JSON.stringify({recordedAt:new Date().toISOString(),agent:'CAWELON',inputBaseUnits:'1000000000000000000',poolAndRouterBothZero:true,readerRejectedAsExpected:true,replies},null,2)+'\n',{flag:'wx'});console.log('Pool and router independently returned zero at the original canonical hash.');
