import test from "node:test";
import assert from "node:assert/strict";
import {request as httpRequest,createServer} from "node:http";
import {connect} from "node:net";
import {createProposalHttpHost} from "../server/proposal-http-host.mjs";
import {createAgentProposalService} from "../server/agent-proposal-service.mjs";
import {createAgentReadPolicyRegistry} from "../src/agent-read-policy-registry.js";
const NOW=1800000000000,address=n=>"0x"+String(n).repeat(40);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(t,options={}) {
  let calls=0,origin,service;const registry=createAgentReadPolicyRegistry(),states=new Map();
  const host=createProposalHttpHost({enabled:true,...options,createService:({origin:local})=>{
    origin=local;service=createAgentProposalService({origin,enabled:true,now:()=>NOW,timeoutMs:1000,maxRequests:4});
    return options.wrap?options.wrap(service):service;
  }});t.after(()=>host.close());
  await host.start();
  function register(agent="DAT",chainId=84532,propose) {
    const account=address({DAT:1,EMA:2,CAWELON:3}[agent]);
    const state={agent,account,chainId,siteOrigin:origin,connected:true,connectionEpoch:1,canSign:false,canSendTransactions:false,canBridge:false};states.set(agent,state);
    const policy=registry.set(agent,JSON.stringify({schema:"threecore-agent-read-config-v1",agent,account,chainId,siteOrigin:origin,
      maxProposalAgeMs:60000,targets:[{tokenAddress:address(4),spenderAddress:address(5)}]}));
    const result=()=>({status:"unexecuted-model-proposal",executed:false,grantsAuthority:false,review:{},proposalText:JSON.stringify({
      schema:"threecore-agent-read-proposal-v1",id:agent+"-read",agent,account,chainId,siteOrigin:origin,connectionEpoch:1,
      policyRevision:policy.revision,createdAtMs:NOW,expiresAtMs:NOW+60000,rationale:"Synthetic local read only",
      action:{kind:"inspect-spender",tokenAddress:address(4),spenderAddress:address(5)}})});
    const grant=host.register({agent,expiresAtMs:NOW+120000,readContext:()=>({policyText:registry.readPolicyText(agent),sessionState:state}),
      propose:input=>{calls++;return propose?propose(input,result):result();}});
    return {grant,result,init:{method:"POST",headers:{origin,"content-type":"application/json",authorization:`Bearer ${grant.token}`},
      body:JSON.stringify({agent,requestId:"request-1",objective:"Read configured target"})}};
  }
  return {host,origin,register,states,calls:()=>calls};
}
async function expected(response,status,code){assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:code,executed:false});}
function raw(origin,headers,target="/api/agent/proposal",body="{}",host=new URL(origin).host) {
  return new Promise((resolve,reject)=>{
    const socket=connect(Number(new URL(origin).port),"127.0.0.1");let text="";
    socket.setTimeout(2000,()=>socket.destroy(Error("raw test timed out")));socket.on("error",reject);
    socket.on("data",b=>text+=b);socket.on("end",()=>resolve(text));
    socket.on("connect",()=>socket.end(`POST ${target} HTTP/1.1\r\nHost: ${host}\r\n${headers.join("\r\n")}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`));
  });
}
test("default host does not bind or invoke factory; start and close are explicit",async()=>{
  let calls=0;const host=createProposalHttpHost({createService:()=>{calls++;}});
  assert.equal(host.state.status,"idle");assert.equal(host.state.origin,null);
  await assert.rejects(host.start(),/HTTP_HOST_DISABLED/);assert.equal(calls,0);await host.close();assert.equal(host.state.status,"closed");
});
for(const patch of [{port:-1},{port:65536},{port:"4230"},{enabled:"yes"},{maxConnections:65},{maxConcurrentRequests:0},{requestTimeoutMs:0},{createService:null}])
test("invalid host configuration fails before binding",()=>assert.throws(()=>createProposalHttpHost({createService:()=>{},...patch}),/INVALID_HTTP_HOST_CONFIG/));
for(const agent of ["DAT","EMA","CAWELON"])for(const chain of [8453,84532])test(`${agent}/${chain}: real loopback host delivers and caches without wallet operations`,async t=>{
  const f=await fixture(t),{grant,init}=f.register(agent,chain);assert.equal(f.calls(),0);
  const r=await fetch(grant.endpoint,init);assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"no-store");
  assert.equal(r.headers.get("set-cookie"),null);assert.equal(r.headers.get("access-control-allow-origin"),null);
  const first=await r.json();assert.equal(first.review.agent,agent);assert.equal(first.review.chainId,chain);assert.equal(first.executed,false);
  assert.deepEqual(await(await fetch(grant.endpoint,init)).json(),first);assert.equal(f.calls(),1);
  assert.ok(!JSON.stringify(f.host.state).includes(grant.token));
  f.host.revoke(agent);await expected(await fetch(grant.endpoint,init),401,"SESSION_REQUIRED");
});
for(const [name,patch,status,code] of [
  ["missing origin",{origin:""},403,"ORIGIN_DENIED"],
  ["foreign origin",{origin:"https://evil.example"},403,"ORIGIN_DENIED"],["cross site",{"sec-fetch-site":"cross-site"},403,"ORIGIN_DENIED"],
  ["same site",{"sec-fetch-site":"same-site"},403,"ORIGIN_DENIED"],["no token",{authorization:""},401,"SESSION_REQUIRED"],
  ["non JSON",{"content-type":"text/plain"},415,"JSON_REQUIRED"],["compressed body",{"content-encoding":"gzip"},415,"ENCODING_REJECTED"],
])test(`reject ${name} before service work`,async t=>{
  const f=await fixture(t),{grant,init}=f.register();await expected(await fetch(grant.endpoint,{...init,headers:{...init.headers,...patch}}),status,code);assert.equal(f.calls(),0);
});
test("actual Host alias is rejected before service (native fetch normalizes Host)",async t=>{
  const f=await fixture(t),{init}=f.register();
  const r=await raw(f.origin,Object.entries(init.headers).map(([k,v])=>`${k}: ${v}`),undefined,init.body,"localhost:1");
  assert.match(r,/403 Forbidden/);assert.match(r,/ORIGIN_DENIED/);assert.equal(f.calls(),0);
});
for(const path of ["/","/api/agent/register","/api/agent/proposal?x=1","/server/openai-read-proposer.mjs","/.env.local"])
test(`no alternate route or source disclosure: ${path}`,async t=>{const f=await fixture(t),{init}=f.register();await expected(await fetch(f.origin+path,init),404,"NOT_FOUND");assert.equal(f.calls(),0);});
test("body cap applies before service including chunked uploads",async t=>{
  const f=await fixture(t),{grant,init}=f.register();await expected(await fetch(grant.endpoint,{...init,body:"x".repeat(8193)}),413,"REQUEST_TOO_LARGE");
  const result=await new Promise((resolve,reject)=>{const req=httpRequest(grant.endpoint,{method:"POST",headers:init.headers},res=>{
    let body="";res.on("data",b=>body+=b);res.on("end",()=>resolve({status:res.statusCode,body}));});req.on("error",reject);req.write("x".repeat(4096));req.end("x".repeat(4097));});
  assert.equal(result.status,413);assert.equal(JSON.parse(result.body).error,"REQUEST_TOO_LARGE");assert.equal(f.calls(),0);
});
for(const name of ["Origin","Authorization","Content-Type"])
test(`duplicate ${name} is rejected`,async t=>{
  const f=await fixture(t),{init}=f.register();const headers=Object.entries(init.headers).map(([k,v])=>`${k}: ${v}`);
  const value=init.headers[name.toLowerCase()];headers.push(`${name}: ${value}`);
  const r=await raw(f.origin,headers);assert.match(r,/400 Bad Request/);assert.match(r,/AMBIGUOUS_HEADERS/);assert.equal(f.calls(),0);
});
test("Expect:100-continue is rejected without sending provisional acceptance",async t=>{
  const f=await fixture(t);const r=await raw(f.origin,["Expect: 100-continue"]);assert.match(r,/417/);assert.ok(!r.includes("100 Continue"));
});
test("global admission stays occupied by a service ignoring cancellation",async t=>{
  const gate=deferred();let signal;const f=await fixture(t,{maxConcurrentRequests:1,requestTimeoutMs:40,
    wrap:s=>({...s,handle:req=>{signal=req.signal;return gate.promise;}})});const {grant,init}=f.register();
  const first=await fetch(grant.endpoint,init);await expected(first,504,"HOST_REQUEST_TIMEOUT");assert.equal(signal.aborted,true);
  assert.equal(f.host.state.activeRequests,1);await expected(await fetch(grant.endpoint,init),429,"HOST_BUSY");
  gate.resolve(new Response("{}",{headers:{"content-type":"application/json"}}));await tick();assert.equal(f.host.state.activeRequests,0);
});
test("client disconnect cancels service and explicit close settles without late delivery",async t=>{
  const started=deferred(),finish=deferred();let signal;const f=await fixture(t,{wrap:s=>({...s,handle:r=>{signal=r.signal;started.resolve();return finish.promise;}})});
  const {grant,init}=f.register();const abort=new AbortController();const work=fetch(grant.endpoint,{...init,signal:abort.signal}).catch(()=>null);
  await started.promise;abort.abort();await work;
  await f.host.close();assert.equal(signal.aborted,true);assert.equal(f.host.state.status,"closed");
  await assert.rejects(f.host.start(),/HTTP_HOST_CLOSED/);assert.throws(()=>f.host.register({}),/HTTP_HOST_NOT_READY/);
  finish.resolve(new Response("{}",{headers:{"content-type":"application/json"}}));await tick();assert.equal(f.host.state.activeRequests,0);
});
test("bind collision is sanitized and does not replace another server",async t=>{
  const existing=createServer((_q,r)=>r.end("preserved"));await new Promise(r=>existing.listen(0,"127.0.0.1",r));t.after(()=>new Promise(r=>existing.close(r)));
  let calls=0;const host=createProposalHttpHost({enabled:true,port:existing.address().port,createService:()=>{calls++;}});t.after(()=>host.close());
  await assert.rejects(host.start(),/HTTP_BIND_FAILED/);assert.equal(calls,0);
  assert.equal(await(await fetch(`http://127.0.0.1:${existing.address().port}`)).text(),"preserved");
});
test("async factory is refused and late resource disposed",async()=>{
  let disposed=0;const host=createProposalHttpHost({enabled:true,createService:async()=>({dispose:()=>disposed++})});
  await assert.rejects(host.start(),/HTTP_START_FAILED/);await tick();assert.equal(disposed,1);await host.close();
});
test("close during start never creates a service or accepts work",async()=>{
  let calls=0;const host=createProposalHttpHost({enabled:true,createService:()=>{calls++;}});
  const start=host.start();const close=host.close();await assert.rejects(start,/HTTP_HOST_CLOSED/);await close;assert.equal(calls,0);assert.equal(host.state.status,"closed");
});
test("repeated start shares one listener and one service; repeated close is idempotent",async t=>{
  let creations=0;const f=await fixture(t,{wrap:s=>{creations++;return s;}});
  const [a,b]=await Promise.all([f.host.start(),f.host.start()]);assert.equal(a.origin,b.origin);assert.equal(creations,1);
  const first=f.host.close(),second=f.host.close();assert.equal(first,second);await first;assert.equal(f.host.state.status,"closed");
});
test("invalid synchronous factory cleans up its resource and bound socket",async()=>{
  let disposed=0;const host=createProposalHttpHost({enabled:true,createService:()=>({dispose:()=>disposed++})});
  await assert.rejects(host.start(),/HTTP_START_FAILED/);assert.equal(disposed,1);await host.close();assert.equal(host.state.status,"closed");
});
test("service exceptions are fixed-code errors without secret prose",async t=>{
  const f=await fixture(t,{wrap:s=>({...s,handle:()=>{throw Error("PRIVATE HOST SECRET");}})}),{grant,init}=f.register();
  await expected(await fetch(grant.endpoint,init),502,"HTTP_HOST_ERROR");assert.equal(f.host.state.activeRequests,0);
});
for(const agent of ["DAT","EMA","CAWELON"])for(const shape of ["prototype-trap","revoked-proxy","code-getter","forged-code"]) {
  test(`${agent}: opaque service exception ${shape} is contained and next request recovers`,async t=>{
    let broken=true,accesses=0,problem;
    if(shape==="prototype-trap")problem=new Proxy({}, {getPrototypeOf(){accesses++;throw Error("PRIVATE DETAIL");}});
    if(shape==="revoked-proxy"){const pair=Proxy.revocable({},{});pair.revoke();problem=pair.proxy;}
    if(shape==="code-getter")problem={get code(){accesses++;throw Error("PRIVATE DETAIL");}};
    if(shape==="forged-code")problem={code:"PRIVATE DETAIL",status:200};
    const f=await fixture(t,{wrap:s=>({...s,handle:r=>{if(broken)throw problem;return s.handle(r);}})});
    const {grant,init}=f.register(agent);
    await expected(await fetch(grant.endpoint,init),502,"HTTP_HOST_ERROR");
    assert.equal(accesses,0);assert.equal(f.host.state.activeRequests,0);assert.equal(f.calls(),0);
    broken=false;
    const recovered=await fetch(grant.endpoint,init);
    assert.equal(recovered.status,200);assert.equal((await recovered.json()).executed,false);
    assert.equal(f.calls(),1);assert.equal(f.host.state.activeRequests,0);
  });
}
test("one agent adapter failure neither revokes nor repeats the other two agents' work",async t=>{
  const pair=Proxy.revocable({},{});pair.revoke();let broken=true;
  let failedToken;
  const f=await fixture(t,{wrap:s=>({...s,handle:r=>{
    if(broken&&r.headers.get("authorization")===`Bearer ${failedToken}`)throw pair.proxy;
    return s.handle(r);
  }})});
  const registrations=["DAT","EMA","CAWELON"].map(agent=>f.register(agent));
  failedToken=registrations[0].grant.token;
  const responses=await Promise.all(registrations.map(({grant,init})=>fetch(grant.endpoint,init)));
  await expected(responses[0],502,"HTTP_HOST_ERROR");
  for(let i=1;i<3;i++) {
    assert.equal(responses[i].status,200);
    assert.equal((await responses[i].json()).review.agent,["DAT","EMA","CAWELON"][i]);
  }
  assert.equal(f.calls(),2);assert.equal(f.host.state.activeRequests,0);
  broken=false;
  for(const {grant,init} of registrations) {
    const response=await fetch(grant.endpoint,init);
    assert.equal(response.status,200);assert.equal((await response.json()).executed,false);
  }
  assert.equal(f.calls(),3,"Recovering DAT must not repeat cached EMA/CAWELON work");
  assert.equal(f.host.state.activeRequests,0);
});
test("hanging service response body is bounded and remains within admission limit",async t=>{
  let cancelled=0;const f=await fixture(t,{maxConcurrentRequests:1,requestTimeoutMs:40,wrap:s=>({...s,handle:()=>new Response(new ReadableStream({
    pull:()=>new Promise(()=>{}),cancel:()=>{cancelled++;}}),{headers:{"content-type":"application/json"}})})}),{grant,init}=f.register();
  await expected(await fetch(grant.endpoint,init),504,"HOST_REQUEST_TIMEOUT");await tick();assert.equal(cancelled,1);assert.equal(f.host.state.activeRequests,0);
});
for(const kind of ["oversize","wrong-type","not-response"])test(`unsafe service response ${kind} is not forwarded`,async t=>{
  const f=await fixture(t,{wrap:s=>({...s,handle:()=>kind==="not-response"?{}:new Response(kind==="oversize"?"x".repeat(131073):"x",
    {headers:{"content-type":kind==="wrong-type"?"text/html":"application/json"}})})}),{grant,init}=f.register();
  await expected(await fetch(grant.endpoint,init),502,"INVALID_SERVICE_RESPONSE");
});
test("slow partial body times out without invoking the service",async t=>{
  const f=await fixture(t,{requestTimeoutMs:40}),{grant,init}=f.register();
  const result=await new Promise((resolve,reject)=>{
    const req=httpRequest(grant.endpoint,{method:"POST",headers:{...init.headers,"content-length":"50"}},res=>{
      let body="";res.on("data",b=>body+=b);res.on("end",()=>{resolve({status:res.statusCode,body});req.destroy();});});
    req.on("error",reject);req.write("{");
  });
  assert.equal(result.status,504);assert.equal(JSON.parse(result.body).error,"HOST_REQUEST_TIMEOUT");assert.equal(f.calls(),0);
});
test("late streamed service response is cancelled, never delivered after deadline",async t=>{
  const gate=deferred();let cancelled=0;
  const f=await fixture(t,{requestTimeoutMs:40,wrap:s=>({...s,handle:()=>gate.promise})}),{grant,init}=f.register();
  await expected(await fetch(grant.endpoint,init),504,"HOST_REQUEST_TIMEOUT");
  gate.resolve(new Response(new ReadableStream({cancel:()=>{cancelled++;}}),{headers:{"content-type":"application/json"}}));
  await tick();assert.equal(cancelled,1);assert.equal(f.host.state.activeRequests,0);
});
test("shutdown disposes a successfully constructed service exactly once",async t=>{
  let count=0;const f=await fixture(t,{wrap:s=>({...s,dispose:()=>{count++;s.dispose();}})});
  await f.host.close();await f.host.close();assert.equal(count,1);
});
