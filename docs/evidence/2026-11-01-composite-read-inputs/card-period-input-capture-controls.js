import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { periodSession, plan, checkpoint } from "./helpers/period-fixtures.js";
import { periodDraftProgress } from "../src/period-draft.js";

async function fixture(t, onChange = () => {}) {
  const selected = plan(), f = periodSession(selected);
  f.session.connect = async () => { f.state.connected = true; };
  f.session.disconnect = () => { f.state.connected = false; f.state.connectionEpoch++; };
  const card = createWalletCardController({agent:"DAT",siteOrigin:f.state.siteOrigin,createSession:()=>f.session,onChange});
  t.after(()=>card.dispose());
  assert.equal(await card.connect({provider:{request(){throw Error("No live provider");}},account:f.state.account,chainId:8453}),true);
  return { f, card, selected };
}
for(const field of ["signal","draft","timeoutMs","stepTimeoutMs","onProgress","onCheckpoint"])test(`card period: refuses option accessor ${field} without starting the read`,async t=>{
  const {f,card,selected}=await fixture(t);const before=card.state;let gets=0;
  const options=Object.defineProperty({},field,{enumerable:true,get(){gets++;return undefined;}});
  await assert.rejects(card.readPeriod(selected,options),{code:"PERIOD_OPTIONS"});
  assert.equal(gets,0);assert.equal(f.calls.length,0);assert.equal(card.state,before);
});
test("card period: plan is captured before reading observer can change its block range",async t=>{
  const selected=structuredClone(plan());let changed=false;
  const {card}=await fixture(t,state=>{if(state.phase==="reading"){selected.laterBlock="43";changed=true;}});
  const result=await card.readPeriod(selected);
  assert(changed);assert.equal(result.plan.laterBlock,"42");assert.equal(result.records.at(-1).range.toBlock,"42");
});
test("card period: resumed draft is captured before the reading observer can alter observations",async t=>{
  const draft=structuredClone(checkpoint(1));
  const {card,selected}=await fixture(t,state=>{if(state.phase==="reading")draft.earlier.balanceBaseUnits="999";});
  const result=await card.readPeriod(selected,{draft});
  assert.equal(result.earlier.balanceBaseUnits,checkpoint(1).earlier.balanceBaseUnits);assert.equal(periodDraftProgress(result).complete,true);
});
test("card period: options and accepted cancellation remain stable through view callbacks",async t=>{
  const controller=new AbortController();let observed=0;
  const options={signal:controller.signal,onProgress(){observed++;}};
  const {card,selected}=await fixture(t,state=>{if(state.phase==="reading"){options.signal={};options.onProgress=()=>{throw Error("replacement");};}});
  assert.equal(periodDraftProgress(await card.readPeriod(selected,options)).complete,true);
  assert(observed>0);assert.equal(getEventListeners(controller.signal,"abort").length,0);
});
test("card period: completion observer changing original signal cannot leak its listener",async t=>{
  const controller=new AbortController(),options={signal:controller.signal,onProgress(){options.signal=undefined;}};
  const {card,selected}=await fixture(t);await card.readPeriod(selected,options);
  assert.equal(getEventListeners(controller.signal,"abort").length,0);
});
test("card period: signal overrides neither run nor replace a completed result",async t=>{
  const controller=new AbortController();let gets=0;
  for(const field of ["aborted","addEventListener","removeEventListener"])Object.defineProperty(controller.signal,field,{get(){gets++;throw Error("private adapter detail");}});
  const {card,selected}=await fixture(t);assert.equal(periodDraftProgress(await card.readPeriod(selected,{signal:controller.signal})).complete,true);
  assert.equal(gets,0);assert.equal(getEventListeners(controller.signal,"abort").length,0);
});
test("card period: native cancellation concealed by a property prevents all provider reads",async t=>{
  const controller=new AbortController();controller.abort();Object.defineProperty(controller.signal,"aborted",{value:false});
  const {f,card,selected}=await fixture(t);await assert.rejects(card.readPeriod(selected,{signal:controller.signal}),{code:"PERIOD_CANCELLED"});
  assert.equal(f.calls.length,0);assert.equal(card.state.result,null);
});
test("card period: inaccessible signal returns typed error and later explicit read works",async t=>{
  const proxy=Proxy.revocable(new AbortController().signal,{});proxy.revoke();
  const {f,card,selected}=await fixture(t);await assert.rejects(card.readPeriod(selected,{signal:proxy.proxy}),{code:"PERIOD_SIGNAL"});
  assert.equal(f.calls.length,0);assert.equal(periodDraftProgress(await card.readPeriod(selected)).complete,true);
});
test("card period: artificial abort event does not interrupt a valid complete run",async t=>{
  const controller=new AbortController();const {card,selected}=await fixture(t);
  const result=await card.readPeriod(selected,{signal:controller.signal,onProgress(){controller.signal.dispatchEvent(new Event("abort"));}});
  assert.equal(periodDraftProgress(result).complete,true);
});
