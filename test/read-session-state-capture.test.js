import test from "node:test";import assert from "node:assert/strict";
import {readPortfolioSnapshot} from "../src/portfolio-snapshot.js";
import {readTokenIdentity} from "../src/token-identity-reader.js";
import {readAllowanceSnapshot} from "../src/allowance-reader.js";
import {readTransferSnapshot} from "../src/transfer-reader.js";
import {collectPeriod} from "../src/period-reader.js";
import {readerSession} from "./helpers/identity-fixtures.js";
import {fakeReader,targets} from "./helpers/allowance-fixtures.js";
import {readerFixture,REQUEST} from "./helpers/transfer-fixtures.js";
import {periodSession,plan} from "./helpers/period-fixtures.js";
const readers=[
 {name:"portfolio",fixture:readerSession,run:f=>readPortfolioSnapshot(f.session,{tokens:[f.row.tokenAddress]}),invalid:"INVALID_SESSION",capability:"UNSAFE_CAPABILITIES"},
 {name:"identity",fixture:readerSession,run:f=>readTokenIdentity(f.session),invalid:"IDENTITY_SESSION",capability:"IDENTITY_CAPABILITIES"},
 {name:"allowance",fixture:fakeReader,run:f=>readAllowanceSnapshot(f.session,targets()),invalid:"ALLOWANCE_SESSION",capability:"ALLOWANCE_CAPABILITIES"},
 {name:"transfer",fixture:readerFixture,run:f=>readTransferSnapshot(f.session,REQUEST),invalid:"TRANSFER_SESSION",capability:"TRANSFER_CAPABILITIES"},
 {name:"period",fixture:periodSession,run:f=>collectPeriod(f.session,plan()),invalid:"PERIOD_SESSION",capability:"PERIOD_CAPABILITIES"}
];
for(const reader of readers){
 test(reader.name+" rejects state field accessors before any provider call",async()=>{
  const f=reader.fixture(),state={...f.state};let reads=0;Object.defineProperty(state,"connected",{enumerable:true,get(){reads++;return true;}});
  Object.defineProperty(f.session,"state",{configurable:true,get:()=>state});
  await assert.rejects(reader.run(f),{code:reader.invalid});assert.equal(reads,0);assert.equal(f.calls.length,0);
 });
 test(reader.name+" uses captured capabilities instead of a misleading get trap",async()=>{
  const f=reader.fixture(),state={...f.state,canSign:true};let reads=0;
  const proxy=new Proxy(state,{get(target,key){reads++;return key==="canSign"?false:Reflect.get(target,key);}});
  Object.defineProperty(f.session,"state",{configurable:true,get:()=>proxy});
  await assert.rejects(reader.run(f),{code:reader.capability});assert.equal(reads,0);assert.equal(f.calls.length,0);
 });
 test(reader.name+" captures valid descriptors without executing property-read traps",async()=>{
  const f=reader.fixture();let reads=0;const proxy=new Proxy({...f.state},{get(){reads++;throw Error("PRIVATE_STATE");}});
  Object.defineProperty(f.session,"state",{configurable:true,get:()=>proxy});await reader.run(f);assert.equal(reads,0);assert.ok(f.calls.length>0);
 });
 test(reader.name+" maps a throwing state adapter to its public error",async()=>{
  const f=reader.fixture();Object.defineProperty(f.session,"state",{configurable:true,get(){throw Error("PRIVATE_STATE");}});
  await assert.rejects(reader.run(f),error=>error.code===reader.invalid&&!error.message.includes("PRIVATE_STATE"));assert.equal(f.calls.length,0);
 });
 test(reader.name+" permits unrelated state metadata without reading its accessor",async()=>{
  const f=reader.fixture(),state={...f.state};let reads=0;Object.defineProperty(state,"extraMetadata",{get(){reads++;throw Error("unused");}});
  Object.defineProperty(f.session,"state",{configurable:true,get:()=>state});await reader.run(f);assert.equal(reads,0);
 });
}
