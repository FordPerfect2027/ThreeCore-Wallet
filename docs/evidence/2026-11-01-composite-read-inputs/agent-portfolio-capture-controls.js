import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readAgentPortfolios } from "../src/agent-portfolios.js";
import { readPortfolioSnapshot } from "../src/portfolio-snapshot.js";
import { periodSession, plan, context } from "./helpers/period-fixtures.js";

function fixture() {
  const fixtures = ["DAT", "EMA", "CAWELON"].map((agent, index) => periodSession(plan({}, context(agent, 8453, "0x" + String(index + 1).repeat(40)))));
  return { fixtures, entries: fixtures.map(f => ({ agent: f.state.agent, session: f.session, tokens: [f.token.address] })),
    calls: () => fixtures.reduce((sum,f) => sum + f.calls.length,0) };
}
const output = promise => promise.then(value => ({value}), error => ({code:error.code}));

for (const field of ["timeoutMs","signal","reader"]) test(`agent plan: options accessor ${field} is not invoked`, async () => {
  const f=fixture(); let gets=0;
  const options=Object.defineProperty({},field,{enumerable:true,get(){gets++;return undefined;}});
  await assert.rejects(readAgentPortfolios(f.entries,options),{code:"INVALID_OPTIONS"});
  assert.equal(gets,0); assert.equal(f.calls(),0);
});
for (const field of ["agent","session","tokens"]) test(`agent plan: entry accessor ${field} is not invoked`, async () => {
  const f=fixture(); let gets=0; const original=f.entries[1][field];
  Object.defineProperty(f.entries[1],field,{enumerable:true,get(){gets++;return original;}});
  await assert.rejects(readAgentPortfolios(f.entries),{code:"INVALID_AGENT_PLAN"});
  assert.equal(gets,0); assert.equal(f.calls(),0);
});
for (const field of ["agent","account","chainId","connected","canSign","connectionEpoch","siteOrigin"]) test(`agent plan: returned state accessor ${field} is not invoked`, async () => {
  const f=fixture(); let gets=0; const value=f.fixtures[2].state[field];
  Object.defineProperty(f.fixtures[2].session,"state",{get(){return Object.defineProperty({...f.fixtures[2].state},field,{enumerable:true,get(){gets++;return value;}});}});
  await assert.rejects(readAgentPortfolios(f.entries),{code:"INVALID_AGENT_SESSION"});
  assert.equal(gets,0); assert.equal(f.calls(),0);
});
for (const target of ["entries","tokens"]) test(`agent plan: caller-owned ${target} mapping cannot fabricate an empty result`, async () => {
  const f=fixture(); let maps=0;
  (target==="entries"?f.entries:f.entries[0].tokens).map=()=>{maps++;return [];};
  await assert.rejects(readAgentPortfolios(f.entries),{code:"INVALID_AGENT_PLAN"});
  assert.equal(maps,0); assert.equal(f.calls(),0);
});
for (const target of ["entries","tokens"]) test(`agent plan: ${target} slot accessor fails before readers`, async () => {
  const f=fixture(); let gets=0; const array=target==="entries"?f.entries:f.entries[0].tokens,value=array[0];
  Object.defineProperty(array,"0",{enumerable:true,get(){gets++;return value;}});
  await assert.rejects(readAgentPortfolios(f.entries),{code:"INVALID_AGENT_PLAN"});
  assert.equal(gets,0); assert.equal(f.calls(),0);
});
test("agent plan: own descriptors are used without live option, array, entry or state reads",async()=>{
  const f=fixture(); let gets=0;const wrap=value=>new Proxy(value,{get(){gets++;throw Error("live input");}});
  for(const entry of f.entries){entry.tokens=wrap(entry.tokens);const state=entry.session.state;Object.defineProperty(entry.session,"state",{get:()=>wrap(state)});}
  const result=await readAgentPortfolios(wrap(f.entries.map(wrap)),wrap({timeoutMs:1000}));
  assert.equal(result.portfolios.length,3);assert.equal(gets,0);
});
test("agent plan: a later entry cannot replace an already captured session",async()=>{
  const f=fixture(), original=f.entries[0].session;
  f.entries[1]=new Proxy(f.entries[1],{getOwnPropertyDescriptor(target,key){f.entries[0].session={};return Reflect.getOwnPropertyDescriptor(target,key);}});
  const result=await readAgentPortfolios(f.entries);
  assert.equal(result.portfolios.length,3);assert(f.fixtures[0].calls.length>0);assert.notEqual(f.entries[0].session,original);
});
test("agent plan: state changes during plan reflection stop before first reader",async()=>{
  const f=fixture();
  f.entries[2]=new Proxy(f.entries[2],{getOwnPropertyDescriptor(target,key){f.fixtures[0].state.connected=false;return Reflect.getOwnPropertyDescriptor(target,key);}});
  await assert.rejects(readAgentPortfolios(f.entries),{code:"SESSION_CHANGED"});assert.equal(f.calls(),0);
});
for(const mode of ["single","coordinated"]) {
  const run=(f,options)=>mode==="single"?readPortfolioSnapshot(f.entries[0].session,{tokens:f.entries[0].tokens,...options}):readAgentPortfolios(f.entries,options);
  test(`portfolio cancellation ${mode}: native state and cleanup ignore own overrides`,async()=>{
    const f=fixture(),controller=new AbortController();let gets=0;
    for(const field of ["aborted","addEventListener","removeEventListener"])Object.defineProperty(controller.signal,field,{get(){gets++;throw Error("private override");}});
    assert((await output(run(f,{signal:controller.signal,timeoutMs:1000}))).value);assert.equal(gets,0);
    assert.equal(getEventListeners(controller.signal,"abort").length,0);
    controller.abort();const calls=f.calls();await assert.rejects(run(f,{signal:controller.signal}),{code:"ABORTED"});assert.equal(f.calls(),calls);
  });
  test(`portfolio cancellation ${mode}: artificial event does not consume later abort`,async()=>{
    const f=fixture(),controller=new AbortController();let reads=0;
    const original=f.entries[0].session.getBlockSnapshot;
    f.entries[0].session.getBlockSnapshot=async(...args)=>{reads++;controller.signal.dispatchEvent(new Event("abort"));return original(...args);};
    await run(f,{signal:controller.signal});assert(reads>0);
    f.entries[0].session.getBlockSnapshot=async(...args)=>{controller.abort();return original(...args);};
    await assert.rejects(run(f,{signal:controller.signal}),{code:"ABORTED"});assert.equal(getEventListeners(controller.signal,"abort").length,0);
  });
  test(`portfolio cancellation ${mode}: revoked signal refuses before provider call`,async()=>{
    const f=fixture(),proxy=Proxy.revocable(new AbortController().signal,{});proxy.revoke();
    await assert.rejects(run(f,{signal:proxy.proxy}),{code:"INVALID_SIGNAL"});assert.equal(f.calls(),0);
  });
}
