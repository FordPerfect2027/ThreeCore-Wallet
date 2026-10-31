import test from "node:test";import assert from "node:assert/strict";
import {validateHistoryQuery,queryPortfolioHistory,exportFilteredHistory} from "../src/history-query.js";
import {reconciliationCoverage} from "../src/reconciliation-engine.js";
import {archive,observation,ACCOUNT,OTHER} from "./helpers/history-fixtures.js";
test("history filters use their captured own values when a property trap offers another account",()=>{
 const text=archive([observation("2"),observation("3",{account:OTHER})]);let reads=0;
 const query=new Proxy({account:ACCOUNT},{get(target,key){reads++;return key==="account"?OTHER:Reflect.get(target,key);}});
 const result=queryPortfolioHistory(text,query);assert.equal(result.rows[0].snapshot.account,ACCOUNT);assert.equal(result.matchCount,1);assert.equal(reads,0);
 const output=exportFilteredHistory(text,query);assert.equal(queryPortfolioHistory(output.text).rows[0].snapshot.account,ACCOUNT);assert.equal(reads,0);
});
test("history filter reflection failure is a public query error",()=>{
 const {proxy,revoke}=Proxy.revocable({},{});revoke();assert.throws(()=>validateHistoryQuery(proxy),{code:"INVALID_HISTORY_QUERY"});
 const disappearing=new Proxy({order:"newest"},{getOwnPropertyDescriptor(){return undefined;}});assert.throws(()=>validateHistoryQuery(disappearing),{code:"INVALID_HISTORY_QUERY"});
});
test("coverage rejects an array-provided map before it can substitute different ranges",()=>{
 let calls=0;const ranges=[{fromBlock:"11",toBlock:"12"}];ranges.map=()=>{calls++;return[{from:11n,to:20n}];};
 assert.throws(()=>reconciliationCoverage("10","20",ranges),{code:"RECONCILIATION_RANGES"});assert.equal(calls,0);
});
test("coverage captures range fields without property-read traps",()=>{
 let reads=0;const range=new Proxy({fromBlock:"11",toBlock:"12"},{get(){reads++;return "20";}});
 const value=reconciliationCoverage("10","20",[range]);assert.equal(value.coveredBlocks,"2");assert.equal(value.missingBlocks,"8");assert.equal(reads,0);
});
test("coverage rejects accessor slots, accessor endpoints and revoked arrays with public errors",()=>{
 let reads=0;const slots=[{fromBlock:"11",toBlock:"12"}];Object.defineProperty(slots,"0",{get(){reads++;return{fromBlock:"11",toBlock:"20"};}});
 const endpoint={toBlock:"20",get fromBlock(){reads++;return "11";}};const {proxy,revoke}=Proxy.revocable([],{});revoke();
 for(const value of[slots,[endpoint],proxy])assert.throws(()=>reconciliationCoverage("10","20",value),{code:"RECONCILIATION_RANGES"});assert.equal(reads,0);
});
