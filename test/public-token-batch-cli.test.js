import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname,basename,resolve} from "node:path";
import {runPublicTokenBatch,parsePublicTokenBatchArgs} from "../scripts/public-token-batch.js";
import {publicBatchFixture} from "./helpers/public-batch-fixture.js";
import {decodePublicTokenBatchFile} from "../src/public-token-batch-model.js";
test("public batch command validates before reading and never overwrites an existing file",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"threecore-public-batch-"));try{
  const file=join(dir,"batch.json"),batch=publicBatchFixture();let calls=0,out="",err="";
  const options={collect:async()=>{calls++;return batch;},output:{write:s=>{out+=s;}},errors:{write:s=>{err+=s;}}};
  const args=["--network","sepolia","--account",batch.account,"--block","42","--output",file];
  assert.equal(await runPublicTokenBatch(args,options),0);assert.equal(calls,1);
  const original=await readFile(file,"utf8");assert.deepEqual((await decodePublicTokenBatchFile(original)).batch,batch);
  assert.equal(await runPublicTokenBatch(args,options),1);assert.equal(calls,1);assert.equal(await readFile(file,"utf8"),original);assert.match(err,/OUTPUT_EXISTS/);
  out="";assert.equal(await runPublicTokenBatch(["--check",file],options),0);assert.equal(calls,1);
  assert.equal(JSON.parse(out).networkRequests,0);assert.equal(JSON.parse(out).walletConnected,false);
  await writeFile(file,"bad");assert.equal(await runPublicTokenBatch(["--check",file],options),1);
  const count=calls;assert.equal(await runPublicTokenBatch(["--help"],options),0);
  for(const invalid of [[],["--network","sepolia"],["--network","mainnet","--account","private phrase"],[...args,"--block","43"],[...args,"--unrecognized","x"]])
   assert.equal(await runPublicTokenBatch(invalid,options),1);
  assert.equal(calls,count);assert.doesNotMatch(err,/private phrase|threecore-public-batch-/);
 }finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith("threecore-public-batch-"));await rm(dir,{recursive:true});}
});
test("failed acquisition never emits a file or a fabricated partial observation",async()=>{
 let output="";const errors=[];assert.equal(await runPublicTokenBatch(["--network","sepolia","--account",publicBatchFixture().account],{
  collect:async()=>{throw Error("untrusted diagnostic");},output:{write:s=>{output+=s;}},errors:{write:s=>{errors.push(s);}}}),1);
 assert.equal(output,"");assert.doesNotMatch(errors.join(""),/untrusted diagnostic/);
 assert.equal(parsePublicTokenBatchArgs(["--network","mainnet","--account",publicBatchFixture().account]).chainId,8453);
});
