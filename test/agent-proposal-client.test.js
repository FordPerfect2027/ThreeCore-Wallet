import test from "node:test";
import assert from "node:assert/strict";
import { createAgentProposalClient } from "../src/agent-proposal-client.js";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";
const ORIGIN="http://127.0.0.1:4230",NOW=1800000000000,TOKEN="a".repeat(64);
const address=n=>"0x"+n.repeat(40);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const response=(body,init={})=>new Response(JSON.stringify(body),{headers:{"content-type":"application/json"},...init});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const stop of ["cancel", "revoke", "dispose", "replace"]) {
    test(`${agent}: ${stop} during validation prevents transport and preserves state`, async () => {
      let f, armed = false;
      f = fixture({ agent, accept: false, client: { readContext: () => {
        if (armed) {
          armed = false;
          if (stop === "replace") assert.equal(f.client.acceptGrant({ ...f.grant, token: "b".repeat(64) }), true);
          else f.client[stop]();
        }
        return f.readContext();
      } } });
      assert.equal(f.client.acceptGrant(f.grant), true);
      armed = true;
      assert.equal((await f.run()).status, "rejected");
      assert.equal(f.calls.length, 0);
      assert.equal(f.staged.length, 0);
      assert.equal(f.client.state.status, { cancel: "cancelled", revoke: "revoked", dispose: "disposed", replace: "ready" }[stop]);
      assert.equal(f.client.state.attempts, 0);
      if (stop === "replace" || stop === "cancel") assert.equal((await f.run()).status, "staged");
    });
  }
  for (const hook of ["readContext", "now"]) {
    test(`${agent}: ${hook} cannot reenter request validation`, async () => {
      let f, armed = false, nested;
      const callback = () => {
        if (armed) {
          armed = false;
          nested = f.run({ requestId: "nested-request" });
        }
        return hook === "now" ? NOW : f.readContext();
      };
      f = fixture({ agent, accept: false, client: { [hook]: callback } });
      assert.equal(f.client.acceptGrant(f.grant), true);
      armed = true;
      assert.equal((await f.run()).status, "staged");
      assert.equal((await nested).errorCode, "CLIENT_BUSY");
      assert.equal(f.calls.length, 1);
      assert.equal(f.staged.length, 1);
      assert.equal(f.client.state.attempts, 1);
    });
  }
}
function fixture(options={}) {
  let time=NOW;const agent=options.agent??"DAT",registry=createAgentReadPolicyRegistry(),calls=[],staged=[],states=[];
  const state={agent,account:address({DAT:"1",EMA:"2",CAWELON:"3"}[agent]),chainId:options.chainId??84532,siteOrigin:ORIGIN,
    connectionEpoch:1,connected:true,canSign:false,canSendTransactions:false,canBridge:false};
  registry.set(agent,JSON.stringify({schema:"threecore-agent-read-config-v1",agent,account:state.account,chainId:state.chainId,
    siteOrigin:ORIGIN,maxProposalAgeMs:60000,targets:[{tokenAddress:address("4"),spenderAddress:address("5")}] }));
  const readContext=()=>({sessionState:{...state},policyText:registry.readPolicyText(agent)});
  const result=()=>({status:"unexecuted-model-proposal",executed:false,grantsAuthority:false,review:{untrusted:true},
    proposalText:JSON.stringify({schema:"threecore-agent-read-proposal-v1",id:"proposal-1",agent,account:state.account,
      chainId:state.chainId,siteOrigin:ORIGIN,connectionEpoch:1,policyRevision:JSON.parse(registry.readPolicyText(agent)).revision,
      createdAtMs:NOW,expiresAtMs:NOW+60000,action:{kind:"inspect-spender",tokenAddress:address("4"),spenderAddress:address("5")},rationale:"Read target"})});
  const client=createAgentProposalClient({agent,origin:ORIGIN,enabled:true,readContext,stageProposal:text=>{staged.push(text);return true;},
    now:()=>time,onChange:s=>states.push(s),fetchImpl:async(...args)=>{calls.push(args);return response(result());},...options.client});
  const grant={agent,endpoint:ORIGIN+"/api/agent/proposal",token:TOKEN,expiresAtMs:NOW+120000};
  if(options.accept!==false)assert.equal(client.acceptGrant(grant),true);
  return {agent,client,grant,state,registry,calls,staged,states,result,readContext,setTime:t=>{time=t;},
    run:input=>client.request({requestId:"request-1",objective:"Inspect configured target",...input})};
}
for(const agent of ["DAT","EMA","CAWELON"])for(const hook of ["fetchImpl","stageProposal"])
for(const shape of ["prototype-trap","revoked-proxy","code-getter"])
test(`${agent}: opaque ${hook} ${shape} settles and permits explicit recovery`,async()=>{
  let f,broken=true,accesses=0,requests=0,delivered=0,problem;
  if(shape==="prototype-trap")problem=new Proxy({}, {getPrototypeOf(){accesses++;throw Error("PRIVATE DETAIL");}});
  if(shape==="code-getter")problem={get code(){accesses++;throw Error("PRIVATE DETAIL");}};
  if(shape==="revoked-proxy"){const pair=Proxy.revocable({},{});pair.revoke();problem=pair.proxy;}
  f=fixture({agent,client:{fetchImpl:()=>{requests++;if(broken&&hook==="fetchImpl")throw problem;return response(f.result());},
    stageProposal:()=>{if(broken&&hook==="stageProposal")throw problem;delivered++;return true;}}});
  try {
    assert.deepEqual(await f.run(),{status:"rejected",errorCode:"CLIENT_REQUEST_FAILED",executed:false});
    assert.equal(f.client.state.status,"rejected");assert.equal(accesses,0);assert.equal(requests,1);assert.equal(delivered,0);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,1,"No automatic retry");
    broken=false;
    assert.equal((await f.run()).status,"staged");assert.equal(requests,2);assert.equal(delivered,1);
  } finally {f.client.dispose();}
});
for(const agent of ["DAT","EMA","CAWELON"])for(const chainId of [8453,84532])test(`${agent}/${chainId}: grant acceptance is inert; request stages once without authority`,async()=>{
  const f=fixture({agent,chainId});assert.equal(f.calls.length,0);assert.equal(f.staged.length,0);
  assert.deepEqual(await f.run(),{status:"staged",requestId:"request-1",executed:false});
  assert.equal(f.staged.length,1);assert.equal(f.calls.length,1);
  const [url,init]=f.calls[0];assert.equal(url,f.grant.endpoint);assert.equal(init.credentials,"omit");assert.equal(init.redirect,"error");
  assert.equal(init.mode,"same-origin");assert.equal(init.headers.authorization,`Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(init.body),{agent,requestId:"request-1",objective:"Inspect configured target"});
  assert.equal(init.headers.origin,undefined); // browser generates Origin, not application input
  assert.ok(!JSON.stringify(f.states).includes(TOKEN));assert.equal(f.client.state.status,"staged");
});
test("transport cannot brand its own errors with a captured client error constructor", async () => {
  let ErrorType;
  assert.throws(() => createAgentProposalClient({ origin: ORIGIN }), error => {
    ErrorType = error.constructor;
    return error.code === "INVALID_CLIENT_CONFIG";
  });
  let f, broken = true;
  f = fixture({ client: { fetchImpl: async (_url, init) => {
    if (broken) throw new ErrorType(init.headers.authorization);
    return response(f.result());
  } } });
  try {
    assert.deepEqual(await f.run(), { status: "rejected", errorCode: "CLIENT_REQUEST_FAILED", executed: false });
    assert.equal(f.client.state.errorCode, "CLIENT_REQUEST_FAILED");
    assert.equal(f.staged.length, 0);
    broken = false;
    assert.equal((await f.run()).status, "staged");
  } finally { f.client.dispose(); }
});
test("disabled and ungranted clients never request context or transport",async()=>{
  let calls=0;const client=createAgentProposalClient({agent:"DAT",origin:ORIGIN,readContext:()=>{calls++;},stageProposal:()=>{calls++;},fetchImpl:()=>{calls++;}});
  assert.equal(client.acceptGrant({}),false);assert.equal((await client.request({})).errorCode,"CLIENT_UNAVAILABLE");assert.equal(calls,0);
  const f=fixture({accept:false});assert.equal((await f.run()).errorCode,"CLIENT_UNAVAILABLE");assert.equal(f.calls.length,0);
});
test("matching policy/session from a different origin cannot authorize this endpoint",()=>{
  const f=fixture({accept:false});f.state.siteOrigin="https://other.example";
  const p=f.registry.read(f.agent);f.registry.set(f.agent,JSON.stringify({schema:"threecore-agent-read-config-v1",
    agent:f.agent,account:p.account,chainId:p.chainId,siteOrigin:f.state.siteOrigin,maxProposalAgeMs:p.maxProposalAgeMs,targets:p.targets}));
  assert.equal(f.client.acceptGrant(f.grant),false);assert.equal(f.calls.length,0);
});
for(const patch of [{agent:"EMA"},{endpoint:"https://evil.example/api/agent/proposal"},{endpoint:ORIGIN+"/api/agent/proposal?token=x"},
  {endpoint:ORIGIN+"/api/agent/register"},{expiresAtMs:NOW},{expiresAtMs:NOW+600001},{token:"sk-secret"},{extra:true}])
  test("invalid grant replacement preserves existing scope without a request",async()=>{
    const f=fixture();assert.equal(f.client.acceptGrant({...f.grant,...patch}),false);assert.equal(f.calls.length,0);assert.equal((await f.run()).status,"staged");
  });
for(const input of [{objective:""},{objective:"x".repeat(2049)},{objective:"a\nb"},{objective:TOKEN},
  {requestId:""},{requestId:TOKEN},{requestId:"x".repeat(97)},{endpoint:"https://evil.example"},{policyText:"replace"}])
  test("malformed request cannot send a capability",async()=>{const f=fixture();const r=await f.run(input);assert.equal(r.status,"rejected");assert.equal(f.calls.length,0);assert.ok(!JSON.stringify(f.states).includes(TOKEN));});

test("grant revoked during ready notification is not reported as accepted",()=>{
  let client;const f=fixture({accept:false,client:{onChange:s=>{if(s.status==="ready")client.revoke();}}});client=f.client;
  assert.equal(client.acceptGrant(f.grant),false);assert.equal(client.state.status,"revoked");assert.equal(f.calls.length,0);
});
for(const status of ["staged","pending","abstained"])test(`revocation during ${status} notification cannot report success`,async()=>{
  let client,f;f=fixture({client:{onChange:s=>{if(s.status===status)client.revoke();},fetchImpl:async()=>
    status==="pending"?response({status:"pending",requestId:"request-1",executed:false},{status:202}):
    status==="abstained"?response({status:"abstained",rationale:"No read",proposalText:null,executed:false,grantsAuthority:false}):response(f.result())}});
  client=f.client;assert.equal((await f.run()).status,"rejected");assert.equal(client.state.status,"revoked");
});
test("same ID can be explicitly rechecked; changing its objective is rejected",async()=>{
  const f=fixture();await f.run();await f.run();assert.equal(f.calls.length,2);
  assert.equal((await f.run({objective:"changed"})).errorCode,"CLIENT_REQUEST_CONFLICT");assert.equal(f.calls.length,2);
});
test("bounded local attempt cap is not refunded on timeout",async()=>{
  const f=fixture({client:{maxRequests:1,timeoutMs:10,fetchImpl:()=>new Promise(()=>{})}});
  assert.equal((await f.run()).errorCode,"CLIENT_TIMEOUT");assert.equal((await f.run()).errorCode,"CLIENT_REQUEST_LIMIT");
});
test("cancel unresponsive fetch settles and leaves late reply unstaged",async()=>{
  const started=deferred(),finish=deferred();const f=fixture({client:{fetchImpl:()=>{started.resolve();return finish.promise;}}});
  const work=f.run();await started.promise;f.client.cancel();assert.equal((await work).status,"rejected");
  assert.equal(f.client.state.status,"cancelled");finish.resolve(response(f.result()));await new Promise(r=>setImmediate(r));assert.equal(f.staged.length,0);
});
for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const stop of ["cancel", "revoke", "dispose", "replace", "timeout"]) {
    test(`${agent}: ${stop} releases a late response body without staging or retry`, async () => {
      const started = deferred(), finish = deferred();
      let calls = 0, cancelled = 0;
      const f = fixture({ agent, client: { timeoutMs: stop === "timeout" ? 30 : 15000,
        fetchImpl: () => { calls++; started.resolve(); return finish.promise; } } });
      const work = f.run();
      await started.promise;
      if (stop === "replace") assert.equal(f.client.acceptGrant({ ...f.grant, token: "b".repeat(64) }), true);
      else if (stop !== "timeout") f.client[stop]();
      assert.equal((await work).status, "rejected");
      const finalState = f.client.state;
      finish.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }),
        { headers: { "content-type": "application/json" } }));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(cancelled, 1, "Late transport body must be cancelled exactly once");
      assert.equal(calls, 1); assert.equal(f.staged.length, 0);
      assert.strictEqual(f.client.state, finalState, "Late cleanup must not republish state");
    });
  }
}
test("overlap rejected; replacement grant cancels old request without staging",async()=>{
  const started=deferred(),finish=deferred();const f=fixture({client:{fetchImpl:()=>{started.resolve();return finish.promise;}}});
  const work=f.run();await started.promise;assert.equal((await f.run()).errorCode,"CLIENT_BUSY");
  assert.equal(f.client.acceptGrant({...f.grant,token:"b".repeat(64)}),true);
  assert.equal((await work).status,"rejected");finish.resolve(response(f.result()));assert.equal(f.staged.length,0);assert.equal(f.client.state.status,"ready");
});
for (const cleanup of ["throw", "reject", "hang"]) test(`late body ${cleanup} cleanup cannot revive a disposed client`, async () => {
  const started = deferred(), finish = deferred(); let cancelled = 0;
  const f = fixture({ client: { fetchImpl: () => { started.resolve(); return finish.promise; } } });
  const work = f.run(); await started.promise; f.client.dispose(); await work;
  finish.resolve(new Response(new ReadableStream({ cancel() {
    cancelled++;
    if (cleanup === "throw") throw Error("private cleanup details");
    if (cleanup === "reject") return Promise.reject(Error("private cleanup details"));
    return new Promise(() => {});
  } }), { headers: { "content-type": "application/json" } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1); assert.equal(f.staged.length, 0);
  assert.equal(f.client.state.status, "disposed");
  assert.ok(!JSON.stringify(f.states).includes("private cleanup details"));
});
test("late old body cleanup cannot cancel a successful replacement request", async () => {
  const started = deferred(), finish = deferred(); let calls = 0, cancelled = 0, f;
  f = fixture({ client: { fetchImpl: () => {
    if (++calls === 1) { started.resolve(); return finish.promise; }
    return response(f.result());
  } } });
  const old = f.run(); await started.promise; f.client.cancel(); await old;
  assert.equal((await f.run()).status, "staged");
  const finalState = f.client.state;
  finish.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1); assert.equal(calls, 2); assert.equal(f.staged.length, 1);
  assert.strictEqual(f.client.state, finalState);
});
for(const [name,change] of [["account",f=>{f.state.account=address("9");}],["epoch",f=>{f.state.connectionEpoch++;}],
  ["disconnected",f=>{f.state.connected=false;}],["policy",f=>f.registry.revoke(f.agent)],["grant expiry",f=>f.setTime(NOW+120000)],
  ["clock rollback",f=>f.setTime(NOW-1)]])test(`${name} prevents stale staging and revokes client`,async()=>{
    const started=deferred(),finish=deferred();const f=fixture({client:{fetchImpl:()=>{started.resolve();return finish.promise;}}});
    const result=f.result(),work=f.run();await started.promise;change(f);finish.resolve(response(result));
    assert.equal((await work).status,"rejected");assert.equal(f.staged.length,0);assert.equal(f.client.state.status,"revoked");
  });
test("expired proposal fails local gate even with a valid server capability",async()=>{
  const f=fixture();f.setTime(NOW+60000);assert.equal((await f.run()).status,"rejected");assert.equal(f.staged.length,0);
});
test("pending response never triggers polling or staging",async()=>{
  let calls=0;const f=fixture({client:{fetchImpl:async()=>{calls++;return response({status:"pending",requestId:"request-1",executed:false},{status:202});}}});
  assert.equal((await f.run()).status,"pending");assert.equal(calls,1);assert.equal(f.staged.length,0);
});
test("abstention is not a proposal or wallet read",async()=>{
  const f=fixture({client:{fetchImpl:async()=>response({status:"abstained",rationale:"No read",proposalText:null,executed:false,grantsAuthority:false})}});
  assert.equal((await f.run()).status,"abstained");assert.equal(f.staged.length,0);
});
for(const [name,make] of [
  ["non-JSON",()=>new Response("secret page")],
  ["declared length",()=>new Response("{}",{headers:{"content-type":"application/json","content-length":"131073"}})],
  ["stream size",()=>new Response("x".repeat(131073),{headers:{"content-type":"application/json"}})],
  ["invalid UTF8",()=>new Response(new Uint8Array([255]),{headers:{"content-type":"application/json"}})],
  ["duplicate keys",()=>new Response('{"status":"pending","status":"abstained"}',{headers:{"content-type":"application/json"}})],
  ["extra authority",r=>response({...r,canSign:true})],
  ["executed",r=>response({...r,executed:true})],
  ["token reflection",r=>response({...r,proposalText:r.proposalText.replace("Read target",TOKEN)})],
  ["escaped token reflection",r=>new Response(JSON.stringify({...r,proposalText:r.proposalText.replace("Read target",TOKEN)}).replace(TOKEN,"\\u0061".repeat(64)),{headers:{"content-type":"application/json"}})],
  ["unknown server error",()=>response({error:"PRIVATE_SERVER_SECRET",executed:false},{status:500})],
  ["wrong pending ID",()=>response({status:"pending",requestId:"other",executed:false},{status:202})],
])test(`reject hostile ${name} without displaying server content`,async()=>{
  let f;f=fixture({client:{fetchImpl:async()=>make(f.result())}});const result=await f.run();assert.equal(result.status,"rejected");
  assert.equal(f.staged.length,0);assert.ok(!JSON.stringify(f.client.state).includes("PRIVATE_SERVER_SECRET"));
});
test("known safe error code is retained, arbitrary provider details are not",async()=>{
  const f=fixture({client:{fetchImpl:async()=>response({error:"DURABLE_ATTEMPT_LIMIT",executed:false},{status:429})}});
  assert.equal((await f.run()).errorCode,"DURABLE_ATTEMPT_LIMIT");
});
for(const code of ["HOST_BUSY","HOST_REQUEST_TIMEOUT","SERVICE_UNAVAILABLE","HTTP_HOST_ERROR"])
test(`fixed HTTP host error ${code} remains distinguishable without retry`,async()=>{
  let calls=0;const f=fixture({client:{fetchImpl:async()=>{calls++;return response({error:code,executed:false},{status:503});}}});
  assert.equal((await f.run()).errorCode,code);assert.equal(calls,1);assert.equal(f.staged.length,0);
});
test("response stream timeout cancels without waiting for hung cleanup",async()=>{
  let cancelled=false;const f=fixture({client:{timeoutMs:10,fetchImpl:async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{}),cancel(){cancelled=true;return new Promise(()=>{});}}),{headers:{"content-type":"application/json"}})}});
  assert.equal((await f.run()).errorCode,"CLIENT_TIMEOUT");assert.equal(cancelled,true);
});
test("asynchronous delivery failure is observed, not reported as staged",async()=>{
  const f=fixture({client:{stageProposal:async()=>{throw Error("private callback");}}});assert.equal((await f.run()).errorCode,"CLIENT_DELIVERY_REJECTED");
});
test("notification cancellation before fetch prevents transmission",async()=>{
  let client;const f=fixture({client:{onChange:s=>{if(s.status==="requesting")client.cancel();}}});client=f.client;
  assert.equal((await f.run()).status,"rejected");assert.equal(f.calls.length,0);
});
test("refresh/revoke/dispose perform no requests and cannot auto-reconnect",async()=>{
  const f=fixture();assert.equal(f.client.refresh(),true);f.state.connectionEpoch++;assert.equal(f.client.refresh(),false);
  assert.equal(f.calls.length,0);assert.equal((await f.run()).errorCode,"CLIENT_UNAVAILABLE");
  f.client.dispose();assert.equal(f.client.acceptGrant(f.grant),false);assert.equal(f.client.state.status,"disposed");
});
