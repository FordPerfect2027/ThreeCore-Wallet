import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPortfolioController } from "../src/portfolio-controller.js";
import { deferred } from "./helpers/transfer-fixtures.js";

const result=()=>Object.freeze({readOnly:true,securityAudit:false,holdings:Object.freeze([])});
test("portfolio controller observer cancellation is bounded",async()=>{
  let calls=0,reads=0;const controller=createPortfolioController({reader:async()=>{reads++;return result();}});
  controller.subscribe(()=>{if(++calls<16)controller.cancel();});
  assert.equal((await controller.refresh({})).accepted,false);assert.equal(reads,0);assert.ok(calls<=2,`received ${calls} notifications`);
});
test("portfolio controller malformed async observer rejection is contained",()=>{
  const url=new URL("../src/portfolio-controller.js",import.meta.url).href;
  const child=spawnSync(process.execPath,["--unhandled-rejections=strict","--input-type=module","-e",`
    import {createPortfolioController} from ${JSON.stringify(url)};
    const controller=createPortfolioController({reader:async()=>Object.freeze({readOnly:true,securityAudit:false,holdings:[]})});
    controller.subscribe(()=>({async then(){throw Error('synthetic');}}));
    if(!(await controller.refresh({})).accepted)throw Error('read failed');
    setTimeout(()=>console.log('contained'),15);
  `],{timeout:10000,encoding:"utf8",windowsHide:true});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),"contained");
});
test("portfolio removed observer is not delivered from a stale listener list",async()=>{
  const controller=createPortfolioController({reader:async()=>result()});let late=0,remove;
  controller.subscribe(()=>remove());remove=controller.subscribe(()=>late++);
  assert.equal((await controller.refresh({})).accepted,true);assert.equal(late,0);
});
test("portfolio disposing observer prevents delivery to later observers",async()=>{
  const controller=createPortfolioController({reader:async()=>result()});let late=0;
  controller.subscribe(()=>controller.dispose());controller.subscribe(()=>late++);
  assert.equal((await controller.refresh({})).accepted,false);assert.equal(late,0);assert.equal(controller.state.status,"disposed");
});
test("portfolio option accessor is rejected before observer or reader calls",async()=>{
  let gets=0,reads=0,views=0;const controller=createPortfolioController({reader:async()=>{reads++;return result();}});
  controller.subscribe(()=>views++);
  await assert.rejects(controller.refresh({},{get tokens(){gets++;return [];}}),TypeError);
  assert.equal(gets,0);assert.equal(reads,0);assert.equal(views,0);
});
test("portfolio controller captures option data without property traps",async()=>{
  let gets=0,seen;const controller=createPortfolioController({reader:async(session,options)=>{seen=options.tokens;return result();}});
  const options=new Proxy({tokens:["synthetic"]},{get(){gets++;throw Error('live options');}});
  assert.equal((await controller.refresh({},options)).accepted,true);assert.deepEqual(seen,["synthetic"]);assert.equal(gets,0);
});
test("portfolio controller does not execute token slot accessors",async()=>{
  let gets=0,reads=0;const tokens=[];Object.defineProperty(tokens,"0",{enumerable:true,get(){gets++;return "synthetic";}});
  const controller=createPortfolioController({reader:async()=>{reads++;return result();}});
  await assert.rejects(controller.refresh({},{tokens}),TypeError);assert.equal(gets,0);assert.equal(reads,0);
});
for(const action of ["cancel","dispose"]){
  test(`portfolio ${action} during option capture prevents a new read`,async()=>{
    let reads=0,once=false;const controller=createPortfolioController({reader:async()=>{reads++;return result();}});
    const options=new Proxy({},{getOwnPropertyDescriptor(target,key){if(!once){once=true;controller[action]();}return Reflect.getOwnPropertyDescriptor(target,key);}});
    assert.equal((await controller.refresh({},options)).accepted,false);assert.equal(reads,0);
  });
}
test("portfolio result accessors are rejected without execution",async()=>{
  let gets=0;
  const controller=createPortfolioController({reader:async()=>Object.freeze({get readOnly(){gets++;return true;},securityAudit:false,holdings:[]})});
  assert.equal((await controller.refresh({})).accepted,false);assert.equal(gets,0);assert.equal(controller.state.errorCode,"INVALID_SNAPSHOT");
});
test("portfolio result capture cancellation cannot restore a ready state",async()=>{
  let controller,once=false;
  controller=createPortfolioController({reader:async()=>new Proxy(result(),{getOwnPropertyDescriptor(target,key){if(!once){once=true;controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);}})});
  assert.equal((await controller.refresh({})).accepted,false);assert.equal(controller.state.status,"cancelled");assert.equal(controller.state.result,null);
});
test("portfolio error accessor is not executed",async()=>{
  let gets=0;const controller=createPortfolioController({reader:async()=>{throw {get code(){gets++;return "WRONG_CHAIN";}};}});
  assert.equal((await controller.refresh({})).accepted,false);assert.equal(gets,0);assert.equal(controller.state.errorCode,"SNAPSHOT_FAILED");
});
test("portfolio cancelled diagnostic reflection cannot publish an old error",async()=>{
  let controller;
  const error=new Proxy({code:"WRONG_CHAIN"},{getOwnPropertyDescriptor(target,key){controller.cancel();return Reflect.getOwnPropertyDescriptor(target,key);}});
  controller=createPortfolioController({reader:async()=>{throw error;}});
  assert.equal((await controller.refresh({})).accepted,false);assert.equal(controller.state.status,"cancelled");assert.equal(controller.state.errorCode,null);
});
test("portfolio abort callback owns the newer refresh and its stop handle",async()=>{
  let controller,nested;const gates=[deferred(),deferred(),deferred()],signals=[];
  controller=createPortfolioController({reader(session,options){const index=signals.length;signals.push(options.signal);if(index===0)options.signal.addEventListener("abort",()=>{nested=controller.refresh({});});return gates[index].promise;}});
  const first=controller.refresh({}),superseded=controller.refresh({});
  assert.equal(signals.length,2);assert.equal((await superseded).accepted,false);
  controller.cancel();assert.equal(signals[1].aborted,true);
  gates.forEach(g=>g.resolve(result()));assert.equal((await first).accepted,false);assert.equal((await nested).accepted,false);
});
