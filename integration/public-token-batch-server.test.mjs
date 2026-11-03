import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";
import { publicBatchFixture } from "../test/helpers/public-batch-fixture.js";
import { validatePublicTokenBatch } from "../src/public-token-batch-model.js";
const sample=publicBatchFixture(),input={chainId:84532,account:sample.account,blockNumber:null};
async function serve(fetchImpl){const server=createDemoServer({publicBatchFetch:fetchImpl});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const origin="http://127.0.0.1:"+server.address().port;
 return{server,origin,post:(data=input,headers={})=>fetch(origin+"/rpc/public-token-batch",{method:"POST",headers:{origin,"content-type":"application/json",...headers},body:JSON.stringify(data)}),
 close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};}
function transport(){const calls=[];return{calls,fetchImpl:async(url,options)=>{
  assert.equal(url,"https://sepolia.base.org");const q=JSON.parse(options.body);calls.push(q);let result;
  if(q.method==="eth_chainId")result="0x14a34";else if(q.method==="eth_blockNumber")result="0x2a";
  else if(q.method==="eth_getBlockByNumber")result={number:q.params[0],hash:sample.blockHash};
  else if(q.method==="eth_getBalance")result="0x0";else if(q.method==="eth_getCode")result="0x";
  else throw Error("Unexpected method");return Response.json({jsonrpc:"2.0",id:q.id,result});}};}
test("page/module routes exist and same-origin batch reads return validated data without a generic RPC proxy",async()=>{
 const t=transport(),s=await serve(t.fetchImpl);try{
  for(const path of ["/tokens/read/","/examples/public-token-batch-page.js","/src/public-token-batch-client.js","/src/public-token-batch-request.js"]){const r=await fetch(s.origin+path);assert.equal(r.status,200);assert.match(r.headers.get("content-security-policy"),/connect-src 'self'/);await r.text();}
  assert.equal((await fetch(s.origin+"/examples/public-token-batch-http.js")).status,404);
  const response=await s.post();assert.equal(response.status,200);const batch=validatePublicTokenBatch(await response.json());assert.equal(batch.tokens.length,3);
  assert.ok(batch.tokens.every(t=>t.balanceBaseUnits===null));assert.equal(t.calls.length,8);assert.equal(batch.walletConnected,false);
 }finally{await s.close();}
});
test("wrong origin, cross-site fetch, unknown fields, invalid amounts and oversized bodies cannot reach upstream",async()=>{
 let calls=0;const s=await serve(async()=>{calls++;throw Error();});try{
  for(const [data,headers,status] of [[input,{origin:"http://evil.invalid"},403],[input,{"sec-fetch-site":"cross-site"},403],
    [input,{"content-type":"text/plain"},403],[{...input,rpcUrl:"https://evil.invalid"},{},400],
    [{...input,method:"eth_sendTransaction"},{},400],[{...input,account:"seed"},{},400],[{...input,chainId:1},{},400],
    [{...input,blockNumber:"01"},{},400],[{...input,account:"x".repeat(2000)},{},413]]){
     const r=await s.post(data,headers);assert.equal(r.status,status);await r.text();
  }
  assert.equal((await fetch(s.origin+"/rpc/public-token-batch")).status,403);assert.equal(calls,0);
 }finally{await s.close();}
});
test("upstream failure sends only a bounded generic error without partial results or upstream secrets",async()=>{
 const s=await serve(async()=>{throw Error("upstream private detail");});try{
  const r=await s.post();assert.equal(r.status,502);assert.deepEqual(await r.json(),{error:"BATCH_UNAVAILABLE"});
 }finally{await s.close();}
});
test("disconnect aborts ongoing upstream and releases batch capacity for the next request",async()=>{
 let calls=0,firstSignal,entered;const started=new Promise(resolve=>{entered=resolve;});const t=transport();
 const s=await serve(async(url,options)=>{if(++calls===1){firstSignal=options.signal;entered();return new Promise(()=>{});}return t.fetchImpl(url,options);});
 try{
  const r=httpRequest(s.origin+"/rpc/public-token-batch",{method:"POST",headers:{origin:s.origin,"content-type":"application/json"}});r.on("error",()=>{});r.end(JSON.stringify(input));
  await started;r.destroy();for(let i=0;i<100&&!firstSignal.aborted;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(firstSignal.aborted,true);
  const response=await s.post();assert.equal(response.status,200);await response.text();
 }finally{await s.close();}
});
test("only three simultaneous batch jobs are admitted; cancelled requests release all slots",async()=>{
 const signals=[],t=transport();let held=true;const s=await serve(async(url,options)=>{if(!held)return t.fetchImpl(url,options);signals.push(options.signal);return new Promise(()=>{});});const requests=[];
 try{
  for(let i=0;i<3;i++){const r=httpRequest(s.origin+"/rpc/public-token-batch",{method:"POST",headers:{origin:s.origin,"content-type":"application/json"}});r.on("error",()=>{});r.end(JSON.stringify(input));requests.push(r);}
  for(let i=0;i<200&&signals.length<3;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(signals.length,3);
  const rejected=await s.post();assert.equal(rejected.status,429);await rejected.text();requests.forEach(r=>r.destroy());
  for(let i=0;i<100&&!signals.every(s=>s.aborted);i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(signals.every(s=>s.aborted));
  held=false;const resumed=await Promise.all([s.post(),s.post(),s.post()]);assert.deepEqual(resumed.map(r=>r.status),[200,200,200]);await Promise.all(resumed.map(r=>r.text()));
 }finally{requests.forEach(r=>r.destroy());await s.close();}
});
test("missing POST origin, duplicate JSON keys and invalid UTF-8 fail before any upstream read",async()=>{
 let calls=0;const s=await serve(async()=>{calls++;throw Error();});try{
  const noOrigin=await fetch(s.origin+"/rpc/public-token-batch",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
  assert.equal(noOrigin.status,403);await noOrigin.text();
  for(const body of ['{"chainId":84532,"chainId":8453,"account":"'+sample.account+'","blockNumber":null}',new Uint8Array([0xc3,0x28])]){
    const r=await fetch(s.origin+"/rpc/public-token-batch",{method:"POST",headers:{origin:s.origin,"content-type":"application/json"},body});assert.equal(r.status,400);await r.text();
  }assert.equal(calls,0);
 }finally{await s.close();}
});
