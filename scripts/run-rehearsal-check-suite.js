#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedRehearsalText } from "./read-bounded-rehearsal-file.js";
import { RehearsalError } from "../src/operation-rehearsal.js";
import { decodeRehearsalCheckSuite, encodeRehearsalCheckReport, pageRehearsalCheckDifferences, REHEARSAL_CHECK_DIFFERENCES, REHEARSAL_CHECK_SUITE_LIMIT } from "../src/operation-rehearsal-check-suite.js";
export async function runCheckSuite(args,output=process.stdout,errors=process.stderr){
  try{
    if(!Array.isArray(args)||![1,3,5].includes(args.length)||args.some(value=>typeof value!=="string"||!value)||args[0].startsWith("--")||
      (args.length>=3&&(args[1]!=="--case"||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(args[2])))||
      (args.length===5&&(args[3]!=="--page"||!/^[1-9][0-9]{0,7}$/.test(args[4]))))throw new RehearsalError("CLI_ARGUMENTS");
    const text=await readBoundedRehearsalText(args[0],REHEARSAL_CHECK_SUITE_LIMIT);
    const input=decodeRehearsalCheckSuite(text),report=encodeRehearsalCheckReport(input),summary=JSON.parse(report).summary;
    if(args.length===1)output.write(report);
    else{
      const requestedPage=args.length===5?Number(args[4]):1,page=pageRehearsalCheckDifferences(input,args[2],(requestedPage-1)*REHEARSAL_CHECK_DIFFERENCES);
      const pages=Math.max(1,Math.ceil(page.totalDifferences/REHEARSAL_CHECK_DIFFERENCES));
      if(requestedPage>pages)throw new RehearsalError("DIFFERENCE_PAGE_NOT_FOUND");
      const item=input.inputs.cases.find(entry=>entry.id===args[2]);
      output.write(JSON.stringify({schema:"threecore.offline-rehearsal-difference-page.v1",simulationOnly:true,sourceVerified:false,authorizesExecution:false,
        caseId:item.id,label:item.label,agent:item.before.agent,asset:item.before.asset,summary,pageNumber:requestedPage,totalPages:pages,page,
        networkRequests:0,walletRequests:0,filesModified:0},null,2)+"\n");
    }
    return summary.allMatched?0:2;
  }catch(error){errors.write("Rehearsal expected-outcome check failed: "+(error?.code??"FILE_READ_FAILED")+"\n");return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runCheckSuite(process.argv.slice(2));
