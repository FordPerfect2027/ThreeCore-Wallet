import test from "node:test";
import assert from "node:assert/strict";
import { readPublicTokenBatch } from "../src/public-token-batch-reader.js";
import { validatePublicTokenBatch, publicBatchObservations, preparePublicTokenBatchFile, decodePublicTokenBatchFile,
  PUBLIC_TOKEN_BATCH_FILE_LIMIT } from "../src/public-token-batch-model.js";
import { catalogToken } from "../src/token-catalog.js";
import { METADATA_FIELDS } from "../src/token-identity-codec.js";
import { abiText, word, ACCOUNT, HASH } from "./helpers/identity-fixtures.js";

export function batchTransport({ chainId = 84532, edit = () => {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body); calls.push(request);
    assert.equal(url, chainId === 84532 ? "https://sepolia.base.org" : "https://mainnet.base.org");
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
    let result;
    if (request.method === "eth_chainId") result = "0x" + chainId.toString(16);
    else if (request.method === "eth_blockNumber") result = "0x2a";
    else if (request.method === "eth_getBlockByNumber") result = { number: request.params[0], hash: HASH };
    else if (request.method === "eth_getBalance") result = "0x2386f26fc10000";
    else if (request.method === "eth_getCode") result = "0x6000";
    else if (request.method === "eth_call") {
      const token = ["DAT", "EMA", "CAWELON"].map(agent => catalogToken({agent,chainId})).find(t => t.address === request.params[0].to);
      assert.ok(token); const selector = request.params[0].data.slice(0,10);
      if(selector === METADATA_FIELDS.name) result=abiText(token.name);
      else if(selector === METADATA_FIELDS.symbol) result=abiText(token.symbol);
      else if(selector === METADATA_FIELDS.decimals) result=word(token.decimals);
      else if(selector === METADATA_FIELDS.totalSupply) result=word(token.initialSupply);
      else if(selector === "0x70a08231") result=word(10n**18n);
      else throw Error("Unexpected call");
    } else throw Error("Unexpected method");
    const response={jsonrpc:"2.0",id:request.id,result};await edit(request,response,calls,options);
    return Response.json(response);
  };
  return {calls,fetchImpl};
}
for(const chainId of [8453,84532])test("public batch pins all three tokens and native balance to one hash on "+chainId,async()=>{
  const f=batchTransport({chainId}),r=await readPublicTokenBatch({chainId,account:ACCOUNT,fetchImpl:f.fetchImpl});
  assert.equal(r.blockNumber,"42");assert.equal(r.blockHash,HASH);assert.equal(r.walletConnected,false);assert.equal(r.tokens.length,3);
  assert.deepEqual(r.tokens.map(t=>t.agent),["DAT","EMA","CAWELON"]);assert.ok(publicBatchObservations(r).every(o=>o.identityMatches));
  assert.equal(f.calls.length,23);assert.equal(f.calls.filter(c=>c.method==="eth_getBalance").length,1);
  for(const c of f.calls.filter(c=>["eth_getBalance","eth_getCode","eth_call"].includes(c.method)))
    assert.deepEqual(c.params[1],{blockHash:HASH,requireCanonical:true});
  const headers=f.calls.filter(c=>c.method==="eth_getBlockByNumber");assert.deepEqual(headers.map(c=>c.params),[["0x2a",false],["0x2a",false]]);
  assert.ok(Object.isFrozen(r.tokens[0].metadata));
});
test("explicit historical height avoids latest and rechecks the exact same height",async()=>{
  const f=batchTransport(),r=await readPublicTokenBatch({chainId:84532,account:ACCOUNT,blockNumber:"53413786",fetchImpl:f.fetchImpl});
  assert.equal(r.blockNumber,"53413786");assert.equal(f.calls.some(c=>c.method==="eth_blockNumber"),false);
  assert.ok(f.calls.filter(c=>c.method==="eth_getBlockByNumber").every(c=>BigInt(c.params[0])===53413786n));
});
test("chain mismatch, changed canonical block and rejected hash selectors yield no partial batch or fallback",async()=>{
  for(const [edit,expected] of [
    [(q,r)=>{if(q.method==="eth_chainId")r.result="0x1";},"BATCH_NETWORK_MISMATCH"],
    [(q,r,c)=>{if(q.method==="eth_getBlockByNumber"&&c.length>4)r.result.hash="0x"+"3".repeat(64);},"BATCH_BLOCK_CHANGED"],
    [(q,r)=>{if(q.method==="eth_getBalance"){delete r.result;r.error={code:-32602,message:"unsupported"};}},"INVALID_RPC_RESPONSE"]]){
    const f=batchTransport({edit});await assert.rejects(readPublicTokenBatch({chainId:84532,account:ACCOUNT,fetchImpl:f.fetchImpl}),{code:expected});
    assert.equal(f.calls.filter(c=>c.method==="eth_getBalance").length,expected==="BATCH_NETWORK_MISMATCH"?0:1);
    assert.ok(f.calls.every(c=>!c.params.includes("latest")));
  }
});
test("missing code preserves unknown token balance and skips metadata and balance calls for that token",async()=>{
  const missing=catalogToken({agent:"EMA",chainId:84532}).address;
  const f=batchTransport({edit(q,r){if(q.method==="eth_getCode"&&q.params[0]===missing)r.result="0x";}});
  const r=await readPublicTokenBatch({chainId:84532,account:ACCOUNT,fetchImpl:f.fetchImpl});
  assert.equal(r.tokens[1].metadata,null);assert.equal(r.tokens[1].balanceBaseUnits,null);
  assert.equal(publicBatchObservations(r)[1].identityMatches,false);
  assert.equal(f.calls.filter(q=>q.method==="eth_call"&&q.params[0].to===missing).length,0);
});
test("malformed uint and metadata responses fail without manufacturing known balances",async()=>{
  for(const edit of [(q,r)=>{if(q.method==="eth_getBalance")r.result="0x01";},
    (q,r)=>{if(q.method==="eth_call")r.result="0x";}]){
    const f=batchTransport({edit});await assert.rejects(readPublicTokenBatch({chainId:84532,account:ACCOUNT,fetchImpl:f.fetchImpl}));
    assert.ok(f.calls.length<23);
  }
});
test("cancel and total deadline prevent late completion and further reads",async()=>{
  for(const cancel of [true,false]){
    const controller=new AbortController();let entered,release;const gate=new Promise(resolve=>{entered=resolve;});
    const f=batchTransport({edit:async(q)=>{if(q.method==="eth_getBalance"){entered();await new Promise(resolve=>{release=resolve;});}}});
    const pending=readPublicTokenBatch({chainId:84532,account:ACCOUNT,fetchImpl:f.fetchImpl,signal:controller.signal,timeoutMs:cancel?1000:100});
    const rejected=assert.rejects(pending,{code:cancel?"BATCH_CANCELLED":"BATCH_TIMEOUT"});await gate;if(cancel)controller.abort();await rejected;
    const count=f.calls.length;release();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,count);
  }
});
test("invalid options, account, block and pre-aborted signals never contact the endpoint",async()=>{
  let calls=0;const fetchImpl=()=>{calls++;throw Error();},base={chainId:84532,account:ACCOUNT,fetchImpl};
  for(const change of [{chainId:1},{account:"secret phrase"},{blockNumber:"01"},{timeoutMs:0},{requestTimeoutMs:1}])await assert.rejects(readPublicTokenBatch({...base,...change}));
  const controller=new AbortController();controller.abort();await assert.rejects(readPublicTokenBatch({...base,signal:controller.signal}),{code:"BATCH_CANCELLED"});
  assert.equal(calls,0);
});
test("file binds canonical public batch without pretending a wallet connection; corruption fails",async()=>{
  const f=batchTransport(),r=await readPublicTokenBatch({chainId:84532,account:ACCOUNT,fetchImpl:f.fetchImpl});
  const file=await preparePublicTokenBatchFile(r),loaded=await decodePublicTokenBatchFile(file.text);
  assert.deepEqual(loaded.batch,r);assert.equal(loaded.authenticated,false);assert.equal(loaded.walletConnected,false);
  const modified=JSON.parse(file.text);modified.batch.nativeBalanceBaseUnits="1";
  await assert.rejects(decodePublicTokenBatchFile(JSON.stringify(modified)),{code:"BATCH_FILE_CHECKSUM"});
  assert.throws(()=>validatePublicTokenBatch({...r,walletConnected:true}),{code:"BATCH_CONTEXT"});
  assert.throws(()=>validatePublicTokenBatch({...r,tokens:[r.tokens[0],r.tokens[0],r.tokens[2]]}),{code:"BATCH_DUPLICATE_AGENT"});
  await assert.rejects(decodePublicTokenBatchFile(" ".repeat(PUBLIC_TOKEN_BATCH_FILE_LIMIT+1)),{code:"BATCH_FILE_SIZE"});
  await assert.rejects(decodePublicTokenBatchFile("\ufeff"+file.text),{code:"BATCH_FILE_STRUCTURE"});
});
