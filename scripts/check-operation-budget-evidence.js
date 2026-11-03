#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { readBoundedLocalBytes } from "./read-bounded-local-file.js";
import { OperationBudgetError } from "../src/operation-budget.js";
import { BUDGET_EVIDENCE_LIMIT, decodeBudgetEvidence, inspectBudgetEvidence } from "../src/operation-budget-evidence.js";
export async function runBudgetEvidenceCheck(args,output=process.stdout,errors=process.stderr){
  const fail=code=>{throw new OperationBudgetError(code);};
  try{
    if(!Array.isArray(args)||args.length!==1||typeof args[0]!=="string"||!args[0]||args[0].startsWith("--"))fail("CLI_ARGUMENTS");
    const bytes=await readBoundedLocalBytes(resolve(args[0]),BUDGET_EVIDENCE_LIMIT,{fail,sizeCode:"FILE_TOO_LARGE",changedCode:"FILE_CHANGED"});
    let text;try{text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail("INVALID_UTF8");}
    const result=await inspectBudgetEvidence(decodeBudgetEvidence(text));
    output.write(JSON.stringify({sha256:createHash("sha256").update(bytes).digest("hex"),byteLength:bytes.length,networkRequests:0,walletRequests:0,filesModified:0,result},null,2)+"\n");
    return result.consistent&&result.budgetResult.constraintsSatisfied?0:2;
  }catch(error){errors.write("Budget evidence check failed: "+(error instanceof OperationBudgetError?error.code:"SOURCE_VALIDATION_OR_READ_FAILED")+"\n");return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runBudgetEvidenceCheck(process.argv.slice(2));
