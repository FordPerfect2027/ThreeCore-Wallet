import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createDemoServer} from '../examples/dev-server.js';
import {usdcFixture,usdcRpc} from '../test/helpers/usdc-fixture.js';
import {validatePublicUsdc} from '../src/public-usdc-model.js';
const input={account:usdcFixture().account,blockNumber:'42'};
async function serve(fetchImpl){const server=createDemoServer({usdcFetch:fetchImpl});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 return{origin,post:(data=input,headers={})=>fetch(origin+'/rpc/public-usdc',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(data)}),close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};}
test('USDC page and browser dependencies are served; server reader is private; fixed RPC returns canonical data',async()=>{
 const rpc=usdcRpc(),s=await serve(rpc.fetchImpl);try{
  for(const path of ['/usdc/read/','/examples/public-usdc-page.js','/src/public-usdc-client.js','/src/public-usdc-request.js','/src/public-usdc-model.js']){const r=await fetch(s.origin+path);assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/);await r.text();}
  assert.equal((await fetch(s.origin+'/examples/public-usdc-http.js')).status,404);assert.equal((await fetch(s.origin+'/src/public-usdc-reader.js')).status,404);
  const r=await s.post();assert.equal(r.status,200);const o=validatePublicUsdc(await r.json());assert.equal(o.account,input.account);assert.equal(o.chainId,8453);assert.equal(rpc.calls.length,11);
 }finally{await s.close();}
});
test('origin, body, extra fields and UTF-8 checks reject unsafe requests before upstream',async()=>{
 let calls=0;const s=await serve(async()=>{calls++;throw Error();});try{
  for(const [data,headers,status] of [[input,{origin:'http://evil.invalid'},403],[input,{'sec-fetch-site':'cross-site'},403],[input,{'content-type':'text/plain'},403],[{...input,rpcUrl:'https://evil.invalid'},{},400],[{...input,chainId:1},{},400],[{...input,account:'seed'},{},400],[{...input,blockNumber:'01'},{},400],[{...input,account:'x'.repeat(2000)},{},413]]){const r=await s.post(data,headers);assert.equal(r.status,status);await r.text();}
  assert.equal((await fetch(s.origin+'/rpc/public-usdc')).status,403);
  for(const body of ['{"account":"'+input.account+'","account":"'+input.account+'","blockNumber":null}',new Uint8Array([255])]){const r=await fetch(s.origin+'/rpc/public-usdc',{method:'POST',headers:{origin:s.origin,'content-type':'application/json'},body});assert.equal(r.status,400);await r.text();}
  assert.equal(calls,0);
 }finally{await s.close();}
});
test('only two jobs run together; disconnect aborts requests and releases capacity',async()=>{
 const signals=[],rpc=usdcRpc();let held=true;const s=await serve(async(url,options)=>{if(!held)return rpc.fetchImpl(url,options);signals.push(options.signal);return new Promise(()=>{});}),jobs=[];
 try{
  for(let i=0;i<2;i++){const r=httpRequest(s.origin+'/rpc/public-usdc',{method:'POST',headers:{origin:s.origin,'content-type':'application/json'}});r.on('error',()=>{});r.end(JSON.stringify(input));jobs.push(r);}
  for(let i=0;i<200&&signals.length<2;i++)await new Promise(r=>setTimeout(r,5));assert.equal(signals.length,2);
  const limited=await s.post();assert.equal(limited.status,429);await limited.text();jobs.forEach(r=>r.destroy());
  for(let i=0;i<100&&!signals.every(s=>s.aborted);i++)await new Promise(r=>setTimeout(r,5));assert(signals.every(s=>s.aborted));held=false;
  const response=await s.post();assert.equal(response.status,200);await response.text();
 }finally{jobs.forEach(r=>r.destroy());await s.close();}
});
test('upstream error produces no partial balance or private error text',async()=>{
 const s=await serve(async()=>{throw Error('private-detail');});try{const r=await s.post();assert.equal(r.status,502);assert.deepEqual(await r.json(),{error:'USDC_UNAVAILABLE'});}finally{await s.close();}
});
