import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readPortfolioSnapshot } from "../src/portfolio-snapshot.js";

const TOKEN="0x"+"22".repeat(20), ACCOUNT="0x"+"11".repeat(20), HASH="0x"+"ab".repeat(32);
function fixture(replace=()=>undefined){
  const state={agent:"DAT",account:ACCOUNT,chainId:8453,connectionEpoch:1,siteOrigin:"https://example.test",connected:true,canSign:false,canSendTransactions:false,canBridge:false};
  const calls=[];
  const reply=(kind,value)=>{calls.push(kind);return replace(kind,value,state)??value;};
  const session={state,getBlockSnapshot:async()=>reply("block",{number:"0x2a",hash:HASH}),
    getNativeBalance:async()=>reply("native",7n),getContractCode:async address=>reply("code",{address,deployed:true}),
    getTokenBalance:async()=>reply("balance",7n)};
  return {session,state,calls};
}
test("portfolio option accessor is rejected without executing it",async()=>{
  let gets=0;const f=fixture();
  await assert.rejects(readPortfolioSnapshot(f.session,{get tokens(){gets++;return [TOKEN];}}),{code:"INVALID_OPTIONS"});
  assert.equal(gets,0);assert.equal(f.calls.length,0);
});
test("portfolio options use own data without live property traps",async()=>{
  let gets=0;const f=fixture();
  const options=new Proxy({tokens:[TOKEN]},{get(){gets++;throw Error("live options");}});
  const result=await readPortfolioSnapshot(f.session,options);assert.equal(result.holdings[0].address,TOKEN);assert.equal(gets,0);
});
test("portfolio token accessor is rejected without executing it",async()=>{
  let gets=0;const f=fixture();const tokens=[];
  Object.defineProperty(tokens,"0",{enumerable:true,configurable:true,get(){gets++;return TOKEN;}});
  await assert.rejects(readPortfolioSnapshot(f.session,{tokens}),{code:"INVALID_TOKENS"});assert.equal(gets,0);assert.equal(f.calls.length,0);
});
test("portfolio token list uses captured slots instead of live properties",async()=>{
  let gets=0;const f=fixture();
  const tokens=new Proxy([TOKEN],{get(){gets++;throw Error("live array");}});
  const result=await readPortfolioSnapshot(f.session,{tokens});assert.equal(result.holdings[0].address,TOKEN);assert.equal(gets,0);
});
test("portfolio token list cannot replace its own mapping method",async()=>{
  let maps=0;const f=fixture(),tokens=[TOKEN];tokens.map=()=>{maps++;return [];};
  await assert.rejects(readPortfolioSnapshot(f.session,{tokens}),{code:"INVALID_TOKENS"});assert.equal(maps,0);assert.equal(f.calls.length,0);
});
for(const kind of ["block","code"]){
  const errorCode=kind==="block"?"INVALID_BLOCK":"INVALID_CODE_RESULT";
  test(`portfolio ${kind} accessor is rejected without execution`,async()=>{
    let gets=0;const field=kind==="block"?"hash":"deployed";
    const f=fixture((method,value)=>method===kind?Object.defineProperty({...value},field,{enumerable:true,configurable:true,get(){gets++;return value[field];}}):undefined);
    await assert.rejects(readPortfolioSnapshot(f.session,{tokens:[TOKEN]}),{code:errorCode});assert.equal(gets,0);
    assert.equal(f.calls.includes(kind==="block"?"native":"balance"),false);
  });
  test(`portfolio ${kind} uses own captured data`,async()=>{
    let gets=0;
    const f=fixture((method,value)=>method===kind?new Proxy(value,{get(target,key){if(key==="then")return undefined;gets++;throw Error("live record");}}):undefined);
    const result=await readPortfolioSnapshot(f.session,{tokens:[TOKEN]});assert.equal(result.holdings[0].balanceBaseUnits,"7");assert.equal(gets,0);
  });
  test(`portfolio ${kind} inaccessible descriptors give bounded errors`,async()=>{
    const f=fixture((method,value)=>method===kind?new Proxy(value,{getOwnPropertyDescriptor(){throw Error("synthetic inaccessible");}}):undefined);
    await assert.rejects(readPortfolioSnapshot(f.session,{tokens:[TOKEN]}),{code:errorCode});
  });
  for(const change of ["cancel","account"]){
    test(`portfolio ${kind} reflection ${change} prevents subsequent reads`,async()=>{
      const abort=new AbortController();
      const f=fixture((method,value,state)=>method===kind?new Proxy(value,{getOwnPropertyDescriptor(target,key){
        if(change==="cancel")abort.abort();else state.account=TOKEN;
        return Reflect.getOwnPropertyDescriptor(target,key);
      }}):undefined);
      await assert.rejects(readPortfolioSnapshot(f.session,{tokens:[TOKEN],signal:abort.signal}),{code:change==="cancel"?"ABORTED":"SESSION_CHANGED"});
      assert.equal(f.calls.includes(kind==="block"?"native":"balance"),false);
    });
  }
}
test("portfolio malformed asynchronous progress rejection is contained",()=>{
  const url=new URL("../src/portfolio-snapshot.js",import.meta.url).href;
  const child=spawnSync(process.execPath,["--unhandled-rejections=strict","--input-type=module","-e",`
    import {readPortfolioSnapshot} from ${JSON.stringify(url)};
    const TOKEN=${JSON.stringify(TOKEN)},HASH=${JSON.stringify(HASH)};
    const session={state:{agent:'DAT',account:${JSON.stringify(ACCOUNT)},chainId:8453,connectionEpoch:1,siteOrigin:'https://example.test',connected:true,canSign:false,canSendTransactions:false,canBridge:false},
      getBlockSnapshot:async()=>({number:'0x2a',hash:HASH}),getNativeBalance:async()=>7n,
      getContractCode:async address=>({address,deployed:true}),getTokenBalance:async()=>7n};
    await readPortfolioSnapshot(session,{tokens:[TOKEN],onProgress:()=>({async then(){throw Error('synthetic');}})});
    setTimeout(()=>console.log('contained'),15);
  `],{timeout:10000,encoding:"utf8",windowsHide:true});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),"contained");
});
