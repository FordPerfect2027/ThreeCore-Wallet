import test from "node:test";
import assert from "node:assert/strict";
import { createAgentProposalService } from "../server/agent-proposal-service.mjs";
import { createOpenAIReadProposer } from "../server/openai-read-proposer.mjs";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";
import { openProposalAttemptJournal, proposalAttemptJournalSupport } from "../server/proposal-attempt-journal.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Native Request/Response, synthetic identities and transport. No env or network.
const ORIGIN = "http://127.0.0.1:4230";
const NOW = 1800000000000;
const address = n => "0x" + n.repeat(40);
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const journalTest=(name,fn)=>test(name,{skip:!proposalAttemptJournalSupport().supported&&"Optional journal unavailable on this runtime/platform"},fn);
function fixture(options = {}) {
  let time = NOW, calls = 0;
  const registry = createAgentReadPolicyRegistry();
  const agent = options.agent ?? "DAT";
  const state = { agent, account: address({DAT:"a",EMA:"b",CAWELON:"c"}[agent]),
    chainId: options.chainId ?? 84532, siteOrigin: ORIGIN, connected: true, connectionEpoch: 1,
    canSign: false, canSendTransactions: false, canBridge: false };
  registry.set(agent, JSON.stringify({schema:"threecore-agent-read-config-v1", agent,
    account:state.account,chainId:state.chainId,siteOrigin:ORIGIN,maxProposalAgeMs:60000,
    targets:[{tokenAddress:address("1"),spenderAddress:address("2")}] }));
  const readContext = () => ({policyText:registry.readPolicyText(agent),sessionState:{...state}});
  const result = () => ({status:"unexecuted-model-proposal",executed:false,grantsAuthority:false,review:{untrusted:true},
    proposalText:JSON.stringify({schema:"threecore-agent-read-proposal-v1",id:"synthetic-proposal",agent,
      account:state.account,chainId:state.chainId,siteOrigin:ORIGIN,connectionEpoch:1,
      policyRevision:JSON.parse(readContext().policyText).revision,createdAtMs:NOW,expiresAtMs:NOW+60000,
      action:{kind:"inspect-spender",tokenAddress:address("1"),spenderAddress:address("2")},rationale:"Read only"})});
  const service = createAgentProposalService({origin:ORIGIN,enabled:true,now:()=>time,...options.service});
  const registration = {agent,readContext,expiresAtMs:NOW+120000,
    propose: async input => { calls++; return options.propose ? options.propose(input,result) : result(); }};
  const grant = service.register(registration);
  const request = (data = {}, init = {}) => {
    const headers = {origin:ORIGIN,"content-type":"application/json",authorization:`Bearer ${grant.token}`,...init.headers};
    return new Request(init.url ?? grant.endpoint, {method:"POST",body:JSON.stringify({agent,requestId:"request-1",objective:"Inspect configured target",...data}),
      ...init,headers});
  };
  return {service,state,registry,grant,registration,request,result,readContext,
    calls:()=>calls,setTime:v=>{time=v;},run:(data,init)=>service.handle(request(data,init))};
}
async function error(response,code,status) {
  assert.equal(response.status,status);
  assert.deepEqual(await response.json(),{error:code,executed:false});
}
function opaqueFailure(shape, accessed) {
  if(shape==="prototype-trap")return new Proxy({}, {getPrototypeOf(){accessed();throw Error("PRIVATE DETAIL");}});
  if(shape==="code-getter")return {get code(){accessed();throw Error("PRIVATE DETAIL");}};
  const pair=Proxy.revocable({},{});pair.revoke();return pair.proxy;
}
for(const agent of ["DAT","EMA","CAWELON"])for(const shape of ["prototype-trap","code-getter","revoked-proxy"])
test(`${agent}: opaque model failure ${shape} remains failed without duplicate work`,async()=>{
  let accesses=0,broken=true;
  const problem=opaqueFailure(shape,()=>accesses++);
  const f=fixture({agent,service:{maxRequests:2},propose:(_input,result)=>{if(broken)throw problem;return result();}});
  try {
    await error(await f.run(),"PROPOSAL_SERVICE_ERROR",502);
    assert.equal(accesses,0);assert.equal(f.calls(),1);
    broken=false;
    await error(await f.run(),"PREVIOUS_REQUEST_FAILED",409);
    assert.equal(f.calls(),1);
    assert.equal((await f.run({requestId:"explicit-new-attempt"})).status,200);
    assert.equal(f.calls(),2);
  } finally { f.service.dispose(); }
});
for(const operation of ["reserve","settle"])for(const shape of ["prototype-trap","code-getter","revoked-proxy"])
test(`journal ${operation} opaque ${shape} fails closed without evaluating exception hooks`,async()=>{
  let accesses=0;
  const problem=opaqueFailure(shape,()=>accesses++);
  const attemptJournal={
    reserve(){if(operation==="reserve")throw problem;return {status:"reserved",outcome:"reserved",reservation:"a".repeat(64)};},
    settle(){throw problem;},
  };
  const f=fixture({service:{attemptJournal}});
  try {
    await error(await f.run(),"JOURNAL_UNAVAILABLE",503);
    assert.equal(accesses,0);assert.equal(f.calls(),operation==="reserve"?0:1);
    await error(await f.run(),"PREVIOUS_REQUEST_FAILED",409);
    assert.equal(f.calls(),operation==="reserve"?0:1);
  } finally {f.service.dispose();}
});
function journalFixture(t,maxAttempts=3) {
  const directory=mkdtempSync(join(tmpdir(),"threecore-service-journal-")),journals=[];
  const config={filename:join(directory,"attempts.sqlite"),scope:"service-test",maxAttempts,now:()=>NOW};
  const open=(create=false)=>{const journal=openProposalAttemptJournal({...config,create});journals.push(journal);return journal;};
  t.after(()=>{for(const j of journals)j.close();rmSync(directory,{recursive:true,force:true});});
  return {open};
}

for (const agent of ["DAT","EMA","CAWELON"]) for (const chainId of [8453,84532]) {
  test(`${agent}/${chainId}: application grant delivers data only; duplicate is cached`,async()=>{
    const f=fixture({agent,chainId}); const first=await f.run();
    assert.equal(first.status,200); assert.equal(first.headers.get("cache-control"),"no-store");
    assert.equal(first.headers.get("access-control-allow-origin"),null);
    const body=await first.json(); assert.equal(body.review.agent,agent); assert.equal(body.review.chainId,chainId);
    assert.equal(body.executed,false); assert.equal(body.grantsAuthority,false); assert.equal(body.review.untrusted,undefined);
    assert.deepEqual(await (await f.run()).json(),body); assert.equal(f.calls(),1);
    await error(await f.run({requestId:"second"}),"REQUEST_LIMIT_REACHED",429);
    assert.ok(!JSON.stringify(body).includes(f.grant.token));
  });
}
test("proposer cannot brand its own status and diagnostics with a captured service error constructor", async () => {
  let ErrorType;
  assert.throws(() => createAgentProposalService({ origin: ORIGIN, maxRequests: 0 }), error => {
    ErrorType = error.constructor;
    return error.code === "INVALID_SERVICE_CONFIG";
  });
  let broken = true;
  const f = fixture({ service: { maxRequests: 2 }, propose: (_input, result) => {
    if (broken) throw new ErrorType("Synthetic private diagnostics", 418);
    return result();
  } });
  try {
    await error(await f.run(), "PROPOSAL_SERVICE_ERROR", 502);
    broken = false;
    await error(await f.run(), "PREVIOUS_REQUEST_FAILED", 409);
    assert.equal(f.calls(), 1);
    assert.equal((await f.run({ requestId: "explicit-new-attempt" })).status, 200);
  } finally { f.service.dispose(); }
});
test("default disabled and disposed never issue grants",async()=>{
  const s=createAgentProposalService({origin:ORIGIN});
  assert.throws(()=>s.register({}),/SERVICE_DISABLED/);
  await error(await s.handle(new Request(ORIGIN)),"SERVICE_DISABLED",503);
  const f=fixture();f.service.dispose();
  await error(await f.run(),"SERVICE_DISABLED",503);
  assert.throws(()=>f.service.register(f.registration),/SERVICE_DISABLED/);assert.equal(f.calls(),0);
});
test("a consistent context for another site cannot register on this service origin",()=>{
  const f=fixture();f.state.siteOrigin="https://other.example";
  const p=f.registry.read("DAT");f.registry.set("DAT",JSON.stringify({schema:"threecore-agent-read-config-v1",agent:"DAT",
    account:p.account,chainId:p.chainId,siteOrigin:f.state.siteOrigin,maxProposalAgeMs:p.maxProposalAgeMs,targets:p.targets}));
  assert.throws(()=>f.service.register(f.registration),/CONTEXT_INVALID/);assert.equal(f.calls(),0);f.service.dispose();
});
for(const config of [{maxRequests:0},{maxRequests:17},{timeoutMs:0},{timeoutMs:60001},{enabled:"true"},{now:null}]){
  test(`configuration rejected ${JSON.stringify(config)}`,()=>assert.throws(()=>createAgentProposalService({origin:ORIGIN,...config}),/INVALID_SERVICE_CONFIG/));
}
for(const [name,init,code,status] of [
  ["origin",{headers:{origin:"https://hostile.example"}},"ORIGIN_DENIED",403],
  ["null origin",{headers:{origin:"null"}},"ORIGIN_DENIED",403],
  ["cross-site",{headers:{"sec-fetch-site":"cross-site"}},"ORIGIN_DENIED",403],
  ["no bearer",{headers:{authorization:""}},"SESSION_REQUIRED",401],
  ["cookie only",{headers:{authorization:"",cookie:"session=secret"}},"SESSION_REQUIRED",401],
  ["wrong token",{headers:{authorization:`Bearer ${"0".repeat(64)}`}},"SESSION_REQUIRED",401],
  ["bad type",{headers:{"content-type":"text/plain"}},"JSON_REQUIRED",415],
  ["preflight",{method:"OPTIONS"},"METHOD_NOT_ALLOWED",405],
  ["other route",{url:ORIGIN+"/api/agent/register"},"NOT_FOUND",404],
  ["query token",{url:ORIGIN+"/api/agent/proposal?token=secret"},"NOT_FOUND",404],
  ["other host",{url:"http://localhost:4230/api/agent/proposal"},"NOT_FOUND",404],
  ["oversized declared",{headers:{"content-length":"8193"}},"REQUEST_TOO_LARGE",413],
  ["invalid length",{headers:{"content-length":"-1"}},"REQUEST_TOO_LARGE",413],
  ["no body",{body:null},"INVALID_REQUEST",400],
  ["malformed JSON",{body:"{"},"INVALID_REQUEST",400],
  ["duplicate keys",{body:'{"agent":"EMA","agent":"DAT","requestId":"a","objective":"x"}'},"INVALID_REQUEST",400],
  ["invalid UTF8",{body:new Uint8Array([255])},"INVALID_REQUEST",400],
  ["oversized stream",{body:"x".repeat(8193)},"REQUEST_TOO_LARGE",413],
]){
  test(`reject ${name} before model`,async()=>{const f=fixture(); await error(await f.run({},init),code,status);assert.equal(f.calls(),0);});
}
for(const data of [{objective:""},{objective:"a\nb"},{objective:"x".repeat(2049)},{requestId:""},
  {requestId:"a".repeat(97)},{requestId:"a b"},{policyText:"replace"},{canSign:true},{endpoint:"https://evil.example"}]){
  test(`reject body shape ${JSON.stringify(data).slice(0,75)}`,async()=>{const f=fixture();await error(await f.run(data),"INVALID_REQUEST",400);assert.equal(f.calls(),0);});
}
test("cross-agent request cannot reuse grant",async()=>{const f=fixture();await error(await f.run({agent:"EMA"}),"AGENT_MISMATCH",403);assert.equal(f.calls(),0);});
for(const field of ["requestId","objective"])test(`capability cannot be echoed through ${field} or forwarded to a model`,async()=>{
  const f=fixture();await error(await f.run({[field]:f.grant.token}),"INVALID_REQUEST",400);assert.equal(f.calls(),0);f.service.dispose();
});
test("same request ID with different objective does not replay or spend",async()=>{
  const f=fixture();await f.run();await error(await f.run({objective:"Different"}),"REQUEST_ID_CONFLICT",409);assert.equal(f.calls(),1);
});
test("pending duplicate returns 202; unrelated overlap blocked",async()=>{
  const started=deferred(),finish=deferred();
  const f=fixture({propose:()=>{started.resolve();return finish.promise;},service:{maxRequests:2}});
  const first=f.run();await started.promise;
  const pending=await f.run();assert.equal(pending.status,202);assert.equal((await pending.json()).status,"pending");
  await error(await f.run({requestId:"other"}),"SESSION_BUSY",409);
  finish.resolve(f.result());assert.equal((await first).status,200);assert.equal(f.calls(),1);
});
test("adapter failure is sanitized and consumed; same ID never retried",async()=>{
  const f=fixture({propose:()=>{throw new Error("sk-secret-provider-error");}});
  await error(await f.run(),"PROPOSAL_SERVICE_ERROR",502);
  await error(await f.run(),"PREVIOUS_REQUEST_FAILED",409);
  await error(await f.run({requestId:"other"}),"REQUEST_LIMIT_REACHED",429);assert.equal(f.calls(),1);
});
test("timeout of noncooperative transport stays busy until actual settlement",async()=>{
  const finish=deferred();let signal;
  const f=fixture({propose:input=>{signal=input.signal;return finish.promise;},service:{timeoutMs:20,maxRequests:2}});
  await error(await f.run(),"REQUEST_TIMEOUT",504);assert.equal(signal.aborted,true);
  await error(await f.run(),"PREVIOUS_REQUEST_FAILED",409);
  await error(await f.run({requestId:"other"}),"SESSION_BUSY",409);
  finish.resolve(f.result());await finish.promise;await new Promise(resolve=>setImmediate(resolve));
  // Failed ID stays failed even after a late response.
  await error(await f.run(),"PREVIOUS_REQUEST_FAILED",409);assert.equal(f.calls(),1);
});
test("request cancellation consumes attempt, drops late reply",async()=>{
  const started=deferred(),finish=deferred(),abort=new AbortController();
  const f=fixture({propose:()=>{started.resolve();return finish.promise;}});
  const work=f.run({}, {signal:abort.signal});await started.promise;abort.abort();
  await error(await work,"REQUEST_CANCELLED",499);finish.resolve(f.result());
  await error(await f.run(),"PREVIOUS_REQUEST_FAILED",409);
});
test("already cancelled request never invokes model",async()=>{
  const f=fixture(),abort=new AbortController();abort.abort();await error(await f.run({}, {signal:abort.signal}),"REQUEST_CANCELLED",499);assert.equal(f.calls(),0);
});
test("slow body is bounded and cancelled without model invocation",async()=>{
  let cancelled=false;
  const f=fixture({service:{timeoutMs:20}});
  const body=new ReadableStream({start(){},cancel(){cancelled=true;}});
  await error(await f.run({}, {body,duplex:"half"}),"REQUEST_TIMEOUT",504);
  assert.equal(cancelled,true);assert.equal(f.calls(),0);
});
for(const [name,change,code,status] of [
  ["account",f=>{f.state.account=address("f");},"CONTEXT_CHANGED",409],
  ["epoch",f=>{f.state.connectionEpoch++;},"CONTEXT_CHANGED",409],
  ["connected",f=>{f.state.connected=false;},"CONTEXT_CHANGED",409],
  ["signing",f=>{f.state.canSign=true;},"CONTEXT_CHANGED",409],
  ["policy revoked",f=>f.registry.revoke("DAT"),"CONTEXT_INVALID",409],
  ["expired session",f=>f.setTime(NOW+120000),"SESSION_EXPIRED",401],
  ["clock rollback",f=>f.setTime(NOW-1),"CLOCK_INVALID",503],
]){
  test(`${name} invalidates grant before model`,async()=>{
    const f=fixture();change(f);await error(await f.run(),code,status);assert.equal(f.calls(),0);
    await error(await f.run(),"SESSION_REQUIRED",401);
  });
}
test("changed context during model response is not delivered",async()=>{
  const started=deferred(),finish=deferred();const f=fixture({propose:()=>{started.resolve();return finish.promise;}});
  const work=f.run();await started.promise;f.state.connectionEpoch++;finish.resolve(f.result());
  await error(await work,"CONTEXT_CHANGED",409);await error(await f.run(),"SESSION_REQUIRED",401);
});
test("cached proposal expiry does not become refreshed",async()=>{
  const f=fixture();await f.run();f.setTime(NOW+60000);
  await error(await f.run(),"PROPOSAL_NO_LONGER_ELIGIBLE",409);assert.equal(f.calls(),1);
});
test("explicit revoke aborts in flight and replacement rejects old token",async()=>{
  const started=deferred(),finish=deferred();const f=fixture({propose:()=>{started.resolve();return finish.promise;}});
  const work=f.run();await started.promise;f.service.revoke("DAT");await error(await work,"REQUEST_CANCELLED",499);
  const second=f.service.register(f.registration);assert.notEqual(second.token,f.grant.token);
  await error(await f.run(),"SESSION_REQUIRED",401);finish.resolve(f.result());
});
test("invalid registration leaves existing valid grant intact",async()=>{
  const f=fixture();for(const patch of [{agent:"X"},{expiresAtMs:NOW},{expiresAtMs:NOW+600001},{readContext:async()=>f.readContext()},
    {readContext:()=>({...f.readContext(),extra:1})},{propose:null}]) assert.throws(()=>f.service.register({...f.registration,...patch}));
  assert.equal((await f.run()).status,200);
});
test("abstention has no proposal and is idempotent",async()=>{
  const f=fixture({propose:()=>({status:"abstained",rationale:"No useful read",proposalText:null,executed:false,grantsAuthority:false})});
  const one=await (await f.run()).json();assert.equal(one.status,"abstained");assert.equal(one.proposalText,null);
  assert.deepEqual(await (await f.run()).json(),one);assert.equal(f.calls(),1);
});
for(const [name,change] of [
  ["authority",r=>({...r,grantsAuthority:true})],["execution",r=>({...r,executed:true})],
  ["extra field",r=>({...r,secret:"server-secret"})],
  ["accessor",r=>Object.defineProperty(r,"proposalText",{get(){throw new Error("must not access");}})],
  ["invalid status",r=>({...r,status:"executed"})],
]){
  test(`reject unsafe proposer ${name}`,async()=>{const f=fixture({propose:(_,result)=>change(result())});await error(await f.run(),"INVALID_PROPOSER_RESULT",502);});
}
test("model cannot substitute a transfer even with a valid grant",async()=>{
  const f=fixture({propose:(_,result)=>{const r=result(),p=JSON.parse(r.proposalText);p.action.kind="transfer";return {...r,proposalText:JSON.stringify(p)};}});
  await error(await f.run(),"PROPOSAL_NO_LONGER_ELIGIBLE",409);
});
test("real proposer adapter through service uses mocked transport once",async()=>{
  let requests=0;const f=fixture();
  const adapter=createOpenAIReadProposer({enabled:true,apiKey:"sk-synthetic-not-real",model:"synthetic",now:()=>NOW,
    newId:()=>"mock-model-proposal",fetchImpl:async()=>{requests++;return new Response(JSON.stringify({status:"completed",output:[
      {type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify({decision:"inspect",targetIndex:0,rationale:"Read configured target"})}]}]}),{headers:{"content-type":"application/json"}});}});
  const grant=f.service.register({...f.registration,propose:input=>adapter.propose(input)});
  const init={headers:{authorization:`Bearer ${grant.token}`}};
  const response=await f.run({},init);assert.equal(response.status,200);assert.equal((await response.json()).executed,false);
  assert.equal((await f.run({},init)).status,200);assert.equal(requests,1);assert.equal(adapter.status().attempts,1);
});

test("throwing or asynchronous clock fails closed and revokes grants",async()=>{
  for(const failure of [()=>{throw Error("private clock details");},async()=>{throw Error("private async clock details");}]) {
    let broken=false;
    const f=fixture({service:{now:()=>broken?failure():NOW}});broken=true;
    await error(await f.run(),"CLOCK_INVALID",503);
    await error(await f.run(),"SESSION_REQUIRED",401);assert.equal(f.calls(),0);
  }
});
test("three agent capabilities are independent and cannot read one another's jobs",async()=>{
  const fixtures=["DAT","EMA","CAWELON"].map(agent=>fixture({agent}));
  const service=createAgentProposalService({origin:ORIGIN,enabled:true,now:()=>NOW});
  const grants=fixtures.map(f=>service.register(f.registration));
  assert.equal(new Set(grants.map(g=>g.token)).size,3);
  for(let i=0;i<fixtures.length;i++) {
    const f=fixtures[i],headers={authorization:`Bearer ${grants[i].token}`};
    assert.equal((await service.handle(f.request({}, {headers}))).status,200);
    await error(await service.handle(f.request({agent:fixtures[(i+1)%3].state.agent},{headers})),"AGENT_MISMATCH",403);
  }
  service.revoke("DAT");
  for(let i=0;i<fixtures.length;i++) {
    const response=await service.handle(fixtures[i].request({}, {headers:{authorization:`Bearer ${grants[i].token}`}}));
    assert.equal(response.status,i===0?401:200);assert.equal(fixtures[i].calls(),1);
  }
  service.dispose();
});
test("invalid abstention cannot smuggle a proposal",async()=>{
  const f=fixture({propose:()=>({status:"abstained",rationale:"No read",proposalText:"injected",executed:false,grantsAuthority:false})});
  await error(await f.run(),"INVALID_PROPOSER_RESULT",502);
});
test("late rejected transport after timeout is observed, not retried",async()=>{
  const finish=deferred();const f=fixture({service:{timeoutMs:20},propose:()=>finish.promise});
  await error(await f.run(),"REQUEST_TIMEOUT",504);finish.reject(Error("private late failure"));
  await new Promise(resolve=>setImmediate(resolve));
  await error(await f.run(),"PREVIOUS_REQUEST_FAILED",409);assert.equal(f.calls(),1);
});

journalTest("journal claim commits before model callback; completed attempt survives a fresh service",async t=>{
  const store=journalFixture(t),journal=store.open(true),observer=store.open();
  const f=fixture({service:{attemptJournal:journal},propose:(_,result)=>{
    assert.equal(observer.summary().reserved,1);return result();
  }});
  assert.equal((await f.run()).status,200);assert.equal(journal.summary().completed,1);
  assert.equal((await f.run()).status,200);assert.equal(f.calls(),1);
  f.service.dispose();journal.close();
  const restarted=fixture({service:{attemptJournal:store.open()}});
  await error(await restarted.run(),"PREVIOUS_ATTEMPT_RECORDED",409);assert.equal(restarted.calls(),0);
});
journalTest("changed objective or binding conflicts with durable ID after re-registration",async t=>{
  const store=journalFixture(t),journal=store.open(true),f=fixture({service:{attemptJournal:journal}});
  await f.run();f.service.dispose();
  const changed=fixture({service:{attemptJournal:journal}});
  await error(await changed.run({objective:"Different objective"}),"DURABLE_REQUEST_CONFLICT",409);assert.equal(changed.calls(),0);
  const newChain=fixture({chainId:8453,service:{attemptJournal:journal}});
  await error(await newChain.run(),"DURABLE_REQUEST_CONFLICT",409);assert.equal(newChain.calls(),0);
});
journalTest("durable quota cannot reset by replacing a capability or service",async t=>{
  const store=journalFixture(t,1),journal=store.open(true),f=fixture({service:{attemptJournal:journal}});
  await f.run();const grant=f.service.register(f.registration);
  await error(await f.run({requestId:"second"},{headers:{authorization:`Bearer ${grant.token}`}}),"DURABLE_ATTEMPT_LIMIT",429);
  f.service.dispose();journal.close();
  const next=fixture({agent:"EMA",service:{attemptJournal:store.open()}});
  await error(await next.run(),"DURABLE_ATTEMPT_LIMIT",429);assert.equal(next.calls(),0);
});
journalTest("cancelled provider result is recorded as failed without refund and cannot rerun after restart",async t=>{
  const store=journalFixture(t),journal=store.open(true),started=deferred(),finish=deferred(),abort=new AbortController();
  const f=fixture({service:{attemptJournal:journal},propose:()=>{started.resolve();return finish.promise;}});
  const work=f.run({}, {signal:abort.signal});await started.promise;abort.abort();
  await error(await work,"REQUEST_CANCELLED",499);assert.equal(journal.summary().failed,1);
  f.service.dispose();journal.close();finish.resolve(f.result());
  const restarted=fixture({service:{attemptJournal:store.open()}});
  await error(await restarted.run(),"PREVIOUS_ATTEMPT_RECORDED",409);assert.equal(restarted.calls(),0);
});
journalTest("unavailable or asynchronous journal cannot invoke model",async t=>{
  const store=journalFixture(t),closed=store.open(true);closed.close();
  for(const attemptJournal of [closed,{reserve:async()=>{throw Error("private storage failure");},settle(){}},
    {reserve(){throw Error("private storage failure");},settle(){}},
    {reserve:()=>({status:"reserved",outcome:"reserved",reservation:"not-a-claim"}),settle(){}}]) {
    const f=fixture({service:{attemptJournal}});await error(await f.run(),"JOURNAL_UNAVAILABLE",503);assert.equal(f.calls(),0);
  }
});
journalTest("settlement storage failure does not report success or retry completed model work",async t=>{
  const store=journalFixture(t),journal=store.open(true);
  const failing={reserve:input=>journal.reserve(input),settle(){throw Error("disk failure private path");}};
  const f=fixture({service:{attemptJournal:failing}});
  await error(await f.run(),"JOURNAL_UNAVAILABLE",503);assert.equal(f.calls(),1);assert.equal(journal.summary().reserved,1);
  await error(await f.run(),"PREVIOUS_REQUEST_FAILED",409);assert.equal(f.calls(),1);
  f.service.dispose();journal.close();
  const next=fixture({service:{attemptJournal:store.open()}});
  await error(await next.run(),"PREVIOUS_ATTEMPT_RECORDED",409);assert.equal(next.calls(),0);
});
journalTest("expiry during settlement never delivers an expired result",async t=>{
  const store=journalFixture(t),journal=store.open(true);let f;
  const delayed={reserve:input=>journal.reserve(input),settle(input){const result=journal.settle(input);f.setTime(NOW+60000);return result;}};
  f=fixture({service:{attemptJournal:delayed}});
  await error(await f.run(),"PROPOSAL_NO_LONGER_ELIGIBLE",409);assert.equal(f.calls(),1);
  assert.equal(journal.summary().completed,1); // generation completed, NOT delivered/executed
});
