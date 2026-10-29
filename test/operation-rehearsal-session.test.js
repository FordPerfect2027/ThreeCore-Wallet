import test from "node:test";
import assert from "node:assert/strict";
import { createRehearsalSession,validateRehearsalSession,encodeRehearsalSession,decodeRehearsalSession,REHEARSAL_SESSION_LIMIT } from "../src/operation-rehearsal-session.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
const populated=()=>{const session=createRehearsalSession();const source=rehearsalExampleV2();session.workspace.reset(source);session.cases.commit(session.cases.previewPut({id:"one",label:"変更なし",before:source,after:source}));return session;};
const clone=value=>JSON.parse(JSON.stringify(value));
test("combined input round-trips all ledgers and snapshots independently",()=>{
  const session=populated();session.workspace.reset(rehearsalExampleV2("EMA","loss"));const text=encodeRehearsalSession(session.snapshot());
  const result=decodeRehearsalSession(text);assert.equal(result.workspace.ledgers.length,2);assert.equal(result.cases.cases.length,1);assert.equal(result.workspace.activeAgent,"EMA");assert.deepEqual(encodeRehearsalSession(result),text);
});
test("invalid cases cannot partially replace a valid workspace",()=>{
  const session=populated(),before=session.snapshot(),input=clone(before);input.workspace.activeAgent="EMA";input.cases.cases[0].after.account="0x"+"9".repeat(40);
  assert.throws(()=>session.preview(input));assert.deepEqual(session.snapshot(),before);
});
test("invalid workspace cannot replace valid cases",()=>{
  const session=populated(),before=session.snapshot(),input=clone(before);input.workspace.ledgers.push(input.workspace.ledgers[0]);input.cases.cases=[];
  assert.throws(()=>session.preview(input));assert.deepEqual(session.snapshot(),before);
});
test("replacement remains uncommitted until confirmed, then both stores change together with empty undo",()=>{
  const session=populated(),replacement=createRehearsalSession("EMA");replacement.workspace.reset(rehearsalExampleV2("EMA"));
  const workspaceProxy=session.workspace,casesProxy=session.cases,review=session.preview(replacement.snapshot());
  assert.equal(session.snapshot().cases.cases.length,1);session.commit(review);assert.equal(workspaceProxy.state().activeAgent,"EMA");assert.equal(casesProxy.state().current.cases.length,0);
  assert.equal(workspaceProxy.state().canUndo,false);assert.equal(casesProxy.state().canUndo,false);assert.throws(()=>session.commit(review),{code:"STALE_REVIEW"});
});
test("restoring nonempty cases does not invent an undo-to-empty history",()=>{
  const session=createRehearsalSession(),input=populated().snapshot();session.commit(session.preview(input));assert.equal(session.cases.state().current.cases.length,1);assert.equal(session.cases.state().undoCount,0);
});
test("normal per-ledger undo and per-collection undo remain independent",()=>{
  const session=populated(),source=session.workspace.state().current;
  session.workspace.commit(session.workspace.preview({id:"deposit",kind:"deposit",agent:source.agent,chainId:source.chainId,account:source.account,amount:"1"}));
  session.cases.commit(session.cases.previewRename("one","新しい名前"));session.cases.undo();assert.equal(session.workspace.state().current.events.length,3);session.workspace.undo();assert.equal(session.workspace.state().current.events.length,2);
});
for(const action of["ledger","case","cancel","invalid","dispose"])test(action+" revokes a pending combined replacement",()=>{
  const session=populated(),input=createRehearsalSession("EMA").snapshot(),review=session.preview(input);
  if(action==="ledger")session.workspace.select("EMA");if(action==="case")session.cases.previewRename("one","変更");if(action==="cancel")session.cancel();
  if(action==="invalid")assert.throws(()=>session.preview({}));if(action==="dispose")session.dispose();
  assert.throws(()=>session.commit(review));
});
test("reads do not revoke review and notification sees only a fully replaced pair",()=>{
  const session=populated(),replacement=createRehearsalSession("EMA");replacement.workspace.reset(rehearsalExampleV2("EMA"));const review=session.preview(replacement.snapshot());
  session.snapshot();session.cases.state();session.workspace.state();const seen=[];session.subscribe(()=>seen.push(session.snapshot()));session.commit(review);
  assert.equal(seen.length,1);assert.equal(seen[0].workspace.activeAgent,"EMA");assert.equal(seen[0].cases.cases.length,0);
});
test("throwing view observers cannot leave only one half restored",()=>{
  const session=populated(),target=createRehearsalSession("EMA").snapshot();session.subscribe(()=>{throw Error("View");});session.commit(session.preview(target));assert.deepEqual(session.snapshot(),target);
});
test("strict parser rejects excessive, duplicate-key, unsafe and getter bundles",()=>{
  for(const text of["{",'{"a":1,"a":2}','{"__proto__":{}}'," ".repeat(REHEARSAL_SESSION_LIMIT+1)])assert.throws(()=>decodeRehearsalSession(text));
  const input=clone(populated().snapshot());let read=false;Object.defineProperty(input,"cases",{get(){read=true;return{};}});assert.throws(()=>validateRehearsalSession(input));assert.equal(read,false);
});
test("reentrant capture invalidates a replacement prepared against older state",()=>{
  const session=populated(),target=createRehearsalSession().snapshot();let done=false;const input=new Proxy(target,{ownKeys(object){if(!done){done=true;session.workspace.select("EMA");}return Reflect.ownKeys(object);}});
  assert.throws(()=>session.preview(input),{code:"STALE_REVIEW"});assert.equal(session.workspace.state().activeAgent,"EMA");assert.equal(session.cases.state().current.cases.length,1);
});
