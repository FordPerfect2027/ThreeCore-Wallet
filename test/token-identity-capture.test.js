import test from "node:test";
import assert from "node:assert/strict";
import { observation } from "./helpers/identity-fixtures.js";
import { identityObject,validateTokenMetadata } from "../src/token-identity-codec.js";
import { validateTokenObservation,assessTokenObservation } from "../src/token-identity-model.js";
import { catalogToken,tokenCatalogContext,createCatalogSelection } from "../src/token-catalog.js";
import { summarizeIdentityCards } from "../src/identity-overview.js";
const context={agent:"DAT",chainId:84532};
const noGet=value=>new Proxy(value,{get(){throw Error("Unexpected live property read");}});

test("identity records return captured data rather than a caller-owned object",()=>{
  const input={agent:"DAT",chainId:84532},captured=identityObject(input,["agent","chainId"]);
  input.agent="EMA";assert.equal(captured.agent,"DAT");assert(Object.isFrozen(captured));
});
test("revoked identity records produce a stable identity error",()=>{
  const {proxy,revoke}=Proxy.revocable(context,{});revoke();
  assert.throws(()=>identityObject(proxy,["agent","chainId"]),{code:"IDENTITY_SHAPE"});
});
test("catalog lookup uses the selected context's own values only",()=>{
  assert.deepEqual(tokenCatalogContext(noGet(context)),context);
  assert.deepEqual(catalogToken(noGet(context)),catalogToken(context));
});
test("metadata and observation validation do not invoke live get traps",()=>{
  const input=observation(),expected=validateTokenObservation(input);
  assert.deepEqual(validateTokenMetadata(noGet(input.metadata)),expected.metadata);
  assert.deepEqual(validateTokenObservation(noGet({...input,metadata:noGet(input.metadata)})),expected);
  assert.equal(assessTokenObservation(noGet(input)).status,"matched");
});
test("connection epoch is not reread after its valid value was checked",()=>{
  let reads=0;const input=observation();
  const value=new Proxy(input,{get(target,key,receiver){
    if(key==="connectionEpoch")return ++reads<3?input.connectionEpoch:-1;
    return Reflect.get(target,key,receiver);
  }});
  assert.equal(validateTokenObservation(value).connectionEpoch,input.connectionEpoch);assert.equal(reads,0);
});
test("identity overview captures rows and does not invoke custom array reads",()=>{
  const rows=["DAT","EMA","CAWELON"].map(agent=>({agent,phase:"ready",provenance:"read",observation:observation({},agent)}));
  const expected=summarizeIdentityCards(rows);
  assert.deepEqual(summarizeIdentityCards(noGet(rows.map(noGet))),expected);
});
test("invalid new catalog previews revoke an earlier confirmation token",()=>{
  for(const invalid of ["text","context"]){
    const selector=createCatalogSelection(),review=selector.preview(context,"");
    assert.throws(()=>selector.preview(invalid==="context"?{}:context,invalid==="text"?null:""));
    assert.throws(()=>selector.apply(review.id,context,""),{code:"IDENTITY_REVIEW_REQUIRED"});
  }
});
test("an invalid apply consumes its catalog review before validating external input",()=>{
  const selector=createCatalogSelection(),review=selector.preview(context,"");
  assert.throws(()=>selector.apply(review.id,{},""));
  assert.throws(()=>selector.apply(review.id,context,""),{code:"IDENTITY_REVIEW_REQUIRED"});
});
test("cancellation during catalog context capture cannot create a new review",()=>{
  const selector=createCatalogSelection();
  const value=new Proxy(context,{ownKeys(target){selector.cancel();return Reflect.ownKeys(target);}});
  assert.throws(()=>selector.preview(value,""),{code:"IDENTITY_STALE"});
});
test("a reentrant newer catalog preview cannot be overwritten by an older one",()=>{
  const selector=createCatalogSelection();let newer,entered=false;
  const value=new Proxy(context,{ownKeys(target){if(!entered){entered=true;newer=selector.preview({agent:"EMA",chainId:84532},"");}return Reflect.ownKeys(target);}});
  assert.throws(()=>selector.preview(value,""),{code:"IDENTITY_STALE"});
  assert.equal(selector.apply(newer.id,{agent:"EMA",chainId:84532},""),catalogToken({agent:"EMA",chainId:84532}).address);
});
