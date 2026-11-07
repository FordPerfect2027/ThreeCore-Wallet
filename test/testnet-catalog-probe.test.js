import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { probeTestnetCatalog } from "../scripts/probe-testnet-catalog.js";
import { TOKEN_CATALOG } from "../src/token-catalog.js";
import { METADATA_FIELDS } from "../src/token-identity-codec.js";
const HASH="0x"+"ab".repeat(32), BLOCK={number:"0x2a",hash:HASH};
const word=n=>BigInt(n).toString(16).padStart(64,"0");
const string=s=>{const bytes=Buffer.from(s);return "0x"+word(32)+word(bytes.length)+bytes.toString("hex").padEnd(Math.ceil(bytes.length/32)*64,"0");};
function fixture(change=()=>{}) {
  const calls=[];
  return {calls,fetchImpl:async(url,init)=>{
    assert.equal(url,"https://sepolia.base.org");assert.equal(init.redirect,"error");assert.equal(init.credentials,"omit");
    const q=JSON.parse(init.body);calls.push(q);let result;
    if(q.method==="eth_chainId")result="0x14a34";
    else if(q.method==="eth_getBlockByNumber")result=BLOCK;
    else if(q.method==="eth_getCode")result="0x6000";
    else if(q.method==="eth_call") {
      const token=TOKEN_CATALOG.find(t=>t.chainId===84532&&t.address===q.params[0].to);
      assert.ok(token);
      const field=Object.keys(METADATA_FIELDS).find(k=>METADATA_FIELDS[k]===q.params[0].data);
      assert.ok(field);result=["name","symbol"].includes(field)?string(token[field]):"0x"+word(field==="totalSupply"?token.initialSupply:token.decimals);
    } else assert.fail("Forbidden RPC");
    const body={jsonrpc:"2.0",id:q.id,result};change(body,q);
    return new Response(JSON.stringify(body),{headers:{"content-type":"application/json"}});
  }};
}
test("three catalog identities use one canonical block and no wallet methods",async()=>{
  const f=fixture(),r=await probeTestnetCatalog(f);
  assert.equal(r.requests,19);assert.equal(r.results.length,3);assert.equal(r.blockNumber,"42");
  assert.equal(r.walletConnected,false);assert.equal(r.transactionsExecuted,0);
  for(const q of f.calls.filter(q=>["eth_getCode","eth_call"].includes(q.method)))assert.deepEqual(q.params[1],{blockHash:HASH,requireCanonical:true});
  assert.deepEqual(f.calls.at(-2).params,["0x2a",false]);assert.ok(r.results.every(x=>x.supplyMatchesInitialReference));
});
test("supply reductions are observations, not silently changed catalog references",async()=>{
  const f=fixture((b,q)=>{if(q.method==="eth_call"&&q.params[0].data===METADATA_FIELDS.totalSupply)b.result="0x"+word(2);});
  const r=await probeTestnetCatalog(f);assert.ok(r.results.every(x=>!x.supplyMatchesInitialReference));
});
for(const stage of [1,19])test(`wrong chain at request ${stage} fails closed`,async()=>{
  const f=fixture((b,q)=>{if(q.id===stage)b.result="0x2105";});await assert.rejects(probeTestnetCatalog(f),{code:"CHAIN_MISMATCH"});assert.equal(f.calls.length,stage);
});
for(const change of ["number","hash"])test(`canonical ${change} change rejects entire report`,async()=>{
  const f=fixture((b,q)=>{if(q.id===18)b.result={...BLOCK,[change]:change==="number"?"0x2b":"0x"+"cd".repeat(32)};});
  await assert.rejects(probeTestnetCatalog(f),{code:"BLOCK_CHANGED"});assert.equal(f.calls.length,18);
});
for(const agent of ["DAT","EMA","CAWELON"])for(const field of ["name","symbol","decimals"])
test(`${agent} wrong ${field} never returns partial success`,async()=>{
  const selected=TOKEN_CATALOG.find(t=>t.agent===agent&&t.chainId===84532);
  const f=fixture((b,q)=>{if(q.method==="eth_call"&&q.params[0].to===selected.address&&q.params[0].data===METADATA_FIELDS[field])b.result=field==="decimals"?"0x"+word(6):string("wrong");});
  await assert.rejects(probeTestnetCatalog(f),{code:"CATALOG_METADATA_MISMATCH"});
});
for(const code of ["0x","0x0","garbage",null])test(`missing/malformed bytecode ${code}`,async()=>{
  const f=fixture((b,q)=>{if(q.method==="eth_getCode")b.result=code;});await assert.rejects(probeTestnetCatalog(f),{code:"CATALOG_CODE_MISSING_OR_INVALID"});
});
for(const shape of ["id","error","missing","version"])test(`invalid RPC envelope ${shape}`,async()=>{
  const f=fixture(b=>{if(shape==="id")b.id++;if(shape==="error")b.error={message:"private"};if(shape==="missing")delete b.result;if(shape==="version")b.jsonrpc="1.0";});
  await assert.rejects(probeTestnetCatalog(f),{code:"RPC_RESPONSE_INVALID"});assert.equal(f.calls.length,1);
});
for(const [body,code,type] of [["{\"jsonrpc\":\"2.0\",\"id\":1,\"id\":1,\"result\":\"0x14a34\"}","RPC_FAILED","application/json"],
  ["x".repeat(131073),"RPC_RESPONSE_TOO_LARGE","application/json"],["private","RPC_CONTENT_TYPE","text/html"]])
test(`bounded response ${code}`,async()=>{await assert.rejects(probeTestnetCatalog({fetchImpl:async()=>new Response(body,{headers:{"content-type":type}})}),{code});});
test("timeout settles even when fetch ignores cancellation; late body is cancelled",async()=>{
  let resolve,cancelled=0;const gate=new Promise(r=>resolve=r);
  await assert.rejects(probeTestnetCatalog({timeoutMs:10,fetchImpl:()=>gate}),{code:"RPC_TIMEOUT"});
  resolve(new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{"content-type":"application/json"}}));
  await new Promise(r=>setImmediate(r));assert.equal(cancelled,1);
});
test("body timeout cancels the pending stream",async()=>{
  let cancelled=0;
  await assert.rejects(probeTestnetCatalog({timeoutMs:10,fetchImpl:()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{}),cancel(){cancelled++;}}),{headers:{"content-type":"application/json"}})}),{code:"RPC_TIMEOUT"});
  assert.equal(cancelled,1);
});
for(const args of [[],["mainnet"],["--public","extra"],["https://other.example"]])test(`CLI refuses ${JSON.stringify(args)} without network`,()=>{
  const child=spawnSync(process.execPath,[fileURLToPath(new URL("../scripts/probe-testnet-catalog.js",import.meta.url)),...args],{encoding:"utf8",timeout:5000});
  assert.equal(child.status,1);assert.match(child.stderr,/Usage:/);assert.equal(child.stdout,"");
});
