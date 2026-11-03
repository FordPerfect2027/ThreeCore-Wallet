import test from "node:test";
import assert from "node:assert/strict";
import { readTransferSnapshot } from "../src/transfer-reader.js";
import { periodFailureCode } from "../src/period-reader.js";
import { libraryErrorCode } from "../src/period-library-view.js";
import { reportErrorCode } from "../src/period-report-view.js";
import { historyErrorCode } from "../src/report-history-view.js";
import { setErrorCode } from "../src/report-set-view.js";
import { readerFixture, REQUEST, OTHER } from "./helpers/transfer-fixtures.js";

test("transfer code response accessor is rejected without executing it",async()=>{
  let getters=0;
  const f=readerFixture({override:async(method,args)=>method==="code"?{address:args[0],get deployed(){getters++;return true;}}:undefined});
  await assert.rejects(readTransferSnapshot(f.session,REQUEST),error=>error.code==="TRANSFER_TOKEN_UNAVAILABLE");
  assert.equal(getters,0);
  assert.equal(f.calls.some(call=>["metadata","events"].includes(call.method)),false);
});
test("transfer code response uses its captured own values",async()=>{
  let gets=0;
  const f=readerFixture({override:async(method,args)=>method==="code"?new Proxy({address:args[0],deployed:true},{get(target,key){if(key==="then")return undefined;gets++;throw Error("live code read");}}):undefined});
  const result=await readTransferSnapshot(f.session,REQUEST);
  assert.equal(result.readOnly,true);assert.equal(gets,0);
});
for(const change of ["cancel","account"]){
  test(`transfer code reflection ${change} prevents metadata and events`,async()=>{
    const abort=new AbortController();
    const f=readerFixture({override:async(method,args,state)=>method==="code"?new Proxy({address:args[0],deployed:true},{getOwnPropertyDescriptor(target,key){
      if(change==="cancel")abort.abort();else state.account=OTHER;
      return Reflect.getOwnPropertyDescriptor(target,key);
    }}):undefined});
    await assert.rejects(readTransferSnapshot(f.session,REQUEST,{signal:abort.signal}),error=>error.code===(change==="cancel"?"TRANSFER_CANCELLED":"TRANSFER_SESSION_CHANGED"));
    assert.equal(f.calls.some(call=>["metadata","events"].includes(call.method)),false);
  });
}
test("transfer inaccessible code result uses a bounded public error",async()=>{
  const f=readerFixture({override:async(method,args)=>method==="code"?new Proxy({address:args[0],deployed:true},{getOwnPropertyDescriptor(){throw Error("synthetic inaccessible code");}}):undefined});
  await assert.rejects(readTransferSnapshot(f.session,REQUEST),error=>error.code==="TRANSFER_TOKEN_UNAVAILABLE");
  assert.equal(f.calls.some(call=>["metadata","events"].includes(call.method)),false);
});

const classifiers=[
  ["period",periodFailureCode,"PERIOD_READ_FAILED"],
  ["library",libraryErrorCode,"PERIOD_LIBRARY_FAILED"],
  ["report",reportErrorCode,"PERIOD_REPORT_FAILED"],
  ["history",historyErrorCode,"PERIOD_HISTORY_FAILED"],
  ["set",setErrorCode,"PERIOD_SET_FAILED"],
];
for(const [name,classify,fallback] of classifiers){
  test(`${name} diagnostic accessor is never executed`,()=>{
    let gets=0;
    assert.equal(classify({get code(){gets++;return "PERIOD_SYNTHETIC";}}),fallback);
    assert.equal(gets,0);
  });
  test(`${name} diagnostic uses own data without a live property trap`,()=>{
    const value=new Proxy({code:"PERIOD_SYNTHETIC"},{get(){throw Error("live diagnostic read");}});
    assert.equal(classify(value),"PERIOD_SYNTHETIC");
  });
  test(`${name} diagnostic handles inaccessible records`,()=>{
    const revoked=Proxy.revocable({},{});revoked.revoke();
    assert.equal(classify(revoked.proxy),fallback);
  });
  test(`${name} diagnostic retains ordinary own error codes`,()=>{
    assert.equal(classify(Object.assign(new Error("private text"),{code:"PERIOD_SYNTHETIC"})),"PERIOD_SYNTHETIC");
  });
}
