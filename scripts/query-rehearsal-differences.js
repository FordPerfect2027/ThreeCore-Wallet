#!/usr/bin/env node
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {webcrypto} from "node:crypto";
import {RehearsalError} from "../src/operation-rehearsal.js";
import {readRehearsalReportFile} from "./verify-rehearsal-report.js";
import {readRehearsalEvidenceFile} from "./verify-rehearsal-evidence.js";
import {encodeRehearsalDifferenceQuery,reviewRehearsalReport,reviewRehearsalEvidence,validateRehearsalDifferenceQuery,
  queryReviewedRehearsalDifferences,queryRehearsalEvidenceReceiptDifferences} from "../src/operation-rehearsal-report-review.js";

export function parseRehearsalDifferenceQueryArgs(args) {
  if (!Array.isArray(args)||args.length<1||args.length>10||
      args.some(value=>typeof value!=="string")||!args[0]||args[0].startsWith("--"))
    throw new RehearsalError("CLI_ARGUMENTS");
  const options=new Map();
  for(let i=1;i<args.length;){
    const flag=args[i++];
    if(!["--path","--kind","--page","--evidence","--all"].includes(flag)||options.has(flag))throw new RehearsalError("CLI_ARGUMENTS");
    if(flag==="--all"){options.set(flag,true);continue;}
    if(i===args.length)throw new RehearsalError("CLI_ARGUMENTS");
    options.set(flag,args[i++]);
  }
  if(options.has("--all")&&options.has("--page"))throw new RehearsalError("CLI_ARGUMENTS");
  const page=options.get("--page")??"1",evidence=options.get("--evidence")??null;
  if(!/^[1-9]\d{0,7}$/.test(page)||(evidence!==null&&!["receipt","source"].includes(evidence)))throw new RehearsalError("CLI_ARGUMENTS");
  const query=validateRehearsalDifferenceQuery({path:options.get("--path")??"",kind:options.get("--kind")??"all"});
  return Object.freeze({file:args[0],page:Number(page),evidence,query,...(options.has("--all")?{all:true}:{})});
}

export async function runRehearsalDifferenceQuery(args,output=process.stdout,errors=process.stderr) {
  try {
    if(Array.isArray(args)&&args.length===1&&args[0]==="--help"){
      output.write("Usage: node scripts/query-rehearsal-differences.js report.json [--path text] [--kind all|missing|unexpected|type|value|array-length] [--page N | --all] [--evidence receipt|source]\n");
      return 0;
    }
    const request=parseRehearsalDifferenceQueryArgs(args),offset=(request.page-1)*40;
    let report, page, evidenceReview, matchesReceipt=null;
    if(request.evidence){
      const checked=await reviewRehearsalEvidence(await readRehearsalEvidenceFile(request.file),{subtle:webcrypto.subtle});
      report=checked.reportReview;evidenceReview=checked;matchesReceipt=checked.matchesReceipt;
      if(!request.all)page=request.evidence==="receipt"?queryRehearsalEvidenceReceiptDifferences(checked,request.query,offset)
        :queryReviewedRehearsalDifferences(report,request.query,offset);
    }else{
      report=await reviewRehearsalReport(await readRehearsalReportFile(request.file),{subtle:webcrypto.subtle});
      if(!request.all)page=queryReviewedRehearsalDifferences(report,request.query,offset);
    }
    if(request.all){
      output.write(encodeRehearsalDifferenceQuery(evidenceReview??report,request.query,request.evidence?"evidence-"+request.evidence:"report"));
      return matchesReceipt!==false&&report.matchesRecomputation&&report.checksumMatches!==false?0:2;
    }
    if(request.page>page.totalPages)throw new RehearsalError("REVIEW_DIFFERENCE_PAGE_OUT_OF_RANGE");
    output.write(JSON.stringify({schema:"threecore.operation-rehearsal-difference-query.v1",simulationOnly:true,
      sourceVerified:false,authorizesExecution:false,target:request.evidence?"evidence-"+request.evidence:"report",
      sourceSha256:report.sha256,summary:{matchesReceipt,matchesRecomputation:report.matchesRecomputation,
        checksumMatches:report.checksumMatches,reportOutcome:report.reportOutcome??null},...page},null,2)+"\n");
    return matchesReceipt!==false&&report.matchesRecomputation&&report.checksumMatches!==false?0:2;
  }catch(error){
    errors.write("Rehearsal difference query failed: "+(error?.code??"FILE_READ_FAILED")+"\n");return 1;
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  process.exitCode=await runRehearsalDifferenceQuery(process.argv.slice(2));
