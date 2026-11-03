#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile, lstat } from "node:fs/promises";
import { readBoundedLocalBytes } from "./read-bounded-local-file.js";
import { readPublicTokenBatch } from "../src/public-token-batch-reader.js";
import { PublicTokenBatchError, failPublicTokenBatch as fail, PUBLIC_TOKEN_BATCH_FILE_LIMIT,
  preparePublicTokenBatchFile, decodePublicTokenBatchFile } from "../src/public-token-batch-model.js";
import { identityAddress, identityUnits } from "../src/token-identity-codec.js";
const USAGE = "tokens:read -- --network sepolia|mainnet --account 0xPUBLIC_ADDRESS [--block DECIMAL_HEIGHT] [--output NEW_FILE.json]\nOffline: tokens:read -- --check SAVED_FILE.json\n";
export function parsePublicTokenBatchArgs(args) {
  if (!Array.isArray(args) || !args.every(a => typeof a === "string")) fail("CLI_ARGUMENTS");
  if (args.length === 1 && args[0] === "--help") return { help: true };
  if (args.length === 2 && args[0] === "--check" && args[1] && !args[1].startsWith("--")) return { check: resolve(args[1]) };
  const fields = {};
  for (let i=0;i<args.length;i+=2) {
    const key=args[i],value=args[i+1];
    if (!["--network","--account","--block","--output"].includes(key) || Object.hasOwn(fields,key) || !value || value.startsWith("--")) fail("CLI_ARGUMENTS");
    fields[key]=value;
  }
  if (!["sepolia","mainnet"].includes(fields["--network"])) fail("CLI_ARGUMENTS");
  let account,blockNumber;
  try { account=identityAddress(fields["--account"]); if(fields["--block"]!==undefined)blockNumber=identityUnits(fields["--block"]); }
  catch { fail("CLI_ARGUMENTS"); }
  return { chainId:fields["--network"]==="sepolia"?84532:8453,account,blockNumber,
    outputPath:fields["--output"]===undefined?undefined:resolve(fields["--output"]) };
}
export async function runPublicTokenBatch(args,{output=process.stdout,errors=process.stderr,collect=readPublicTokenBatch,signal}={}) {
  try {
    const parsed=parsePublicTokenBatchArgs(args);
    if(parsed.help){output.write(USAGE);return 0;}
    if(parsed.check){
      const b=await readBoundedLocalBytes(parsed.check,PUBLIC_TOKEN_BATCH_FILE_LIMIT,{fail,sizeCode:"BATCH_FILE_SIZE",changedCode:"FILE_CHANGED"});
      let text;try{text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(b);}catch{fail("INVALID_UTF8");}
      const result=await decodePublicTokenBatchFile(text,{signal});output.write(JSON.stringify({...result,networkRequests:0,walletRequests:0,filesModified:0},null,2)+"\n");return 0;
    }
    if(parsed.outputPath){
      try{await lstat(parsed.outputPath);fail("OUTPUT_EXISTS");}catch(error){if(error.code!=="ENOENT")throw error;}
    }
    const batch=await collect({chainId:parsed.chainId,account:parsed.account,blockNumber:parsed.blockNumber,signal});
    const file=await preparePublicTokenBatchFile(batch,{signal});
    if(parsed.outputPath){await writeFile(parsed.outputPath,file.text,{flag:"wx"});output.write(JSON.stringify({saved:true,byteLength:file.byteLength,digest:file.digest,blockNumber:batch.blockNumber,walletConnected:false})+"\n");}
    else output.write(file.text);
    return 0;
  }catch(error){errors.write("Public token batch failed: "+(error instanceof PublicTokenBatchError?error.code:"READ_OR_VALIDATION_FAILED")+"\n");return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  process.exitCode=await runPublicTokenBatch(process.argv.slice(2));
