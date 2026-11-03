import test from "node:test";
import assert from "node:assert/strict";
import { createTokenPlan,validateTokenPlan,tokenPlanLinesForContext } from "../src/token-plan.js";
import { validateWalletSetup,captureWalletFields,WALLET_SETUP_SCHEMA } from "../src/wallet-setup.js";

const address="0x"+"ab".repeat(20);
const tokenPlan={schema:"threecore-token-plan-v1",agent:"DAT",chainId:84532,tokens:[address]};
const rows=()=>["DAT","EMA","CAWELON"].map((agent,index)=>({agent,chainId:84532,account:"0x"+String(index+1).repeat(40)}));
const noGet=value=>new Proxy(value,{get(){throw Error("Unexpected live property read");}});

test("token plans capture root own data without invoking live get traps",()=>{
  assert.deepEqual(validateTokenPlan(noGet(tokenPlan)),validateTokenPlan(tokenPlan));
});
test("token-plan identity is captured before validation and returned unchanged",()=>{
  assert.deepEqual(createTokenPlan(noGet({agent:"DAT",chainId:84532}),address),validateTokenPlan(tokenPlan));
});
test("a context trap cannot make an EMA plan apply to own-data DAT selection",()=>{
  let reads=0;
  const selected=new Proxy({agent:"DAT",chainId:84532},{get(target,key,receiver){
    if(key==="agent")return ++reads===1?"DAT":"EMA";
    return Reflect.get(target,key,receiver);
  }});
  assert.throws(()=>tokenPlanLinesForContext({...tokenPlan,agent:"EMA"},selected),{code:"PLAN_CONTEXT_MISMATCH"});
  assert.equal(reads,0);
});
test("a token array with a changing length trap cannot become an empty valid plan",()=>{
  let reads=0;
  const tokens=new Proxy([address],{get(target,key,receiver){
    if(key==="length")return ++reads<=2?1:0;
    return Reflect.get(target,key,receiver);
  }});
  assert.deepEqual(validateTokenPlan({...tokenPlan,tokens}).tokens,[address]);assert.equal(reads,0);
});
for(const property of ["metadata",Symbol("extra"),"toJSON"])test("token arrays reject non-index own data "+String(property),()=>{
  const tokens=[address];Object.defineProperty(tokens,property,{value:true});
  assert.throws(()=>validateTokenPlan({...tokenPlan,tokens}),{code:"INVALID_TOKENS"});
});
test("saved wallet setup captures both its envelope and all card rows",()=>{
  const entries=rows(),expected=validateWalletSetup({schema:WALLET_SETUP_SCHEMA,entries});
  assert.deepEqual(validateWalletSetup(noGet({schema:WALLET_SETUP_SCHEMA,entries:noGet(entries.map(noGet))})),expected);
});
test("capturing raw wallet fields never reads live card values after checking descriptors",()=>{
  const input=rows();assert.deepEqual(captureWalletFields(noGet(input.map(noGet))),captureWalletFields(input));
});
test("wallet setup cannot validate one chain and then publish another through a live get trap",()=>{
  let reads=0;
  const entries=rows();entries[0]=new Proxy(entries[0],{get(target,key,receiver){
    if(key==="chainId")return ++reads===1?84532:1;
    return Reflect.get(target,key,receiver);
  }});
  const result=validateWalletSetup({schema:WALLET_SETUP_SCHEMA,entries});
  assert.equal(result.entries[0].chainId,84532);assert.equal(reads,0);
});
test("setup row accessors remain rejected before execution",()=>{
  let calls=0;const entries=rows();Object.defineProperty(entries[0],"account",{get(){calls++;return address;}});
  assert.throws(()=>validateWalletSetup({schema:WALLET_SETUP_SCHEMA,entries}),{code:"SETUP_SHAPE"});
  assert.equal(calls,0);
});
