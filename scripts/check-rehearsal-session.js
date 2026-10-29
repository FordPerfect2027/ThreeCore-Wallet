#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { readBoundedRehearsalText } from "./read-bounded-rehearsal-file.js";
import { decodeRehearsalSession,REHEARSAL_SESSION_LIMIT } from "../src/operation-rehearsal-session.js";
import { reportRehearsalWorkspace } from "../src/operation-rehearsal-workspace.js";
import { reportRehearsalScenarioSet } from "../src/operation-rehearsal-scenario-set.js";
import { RehearsalError } from "../src/operation-rehearsal.js";
export async function checkRehearsalSession(args,output=process.stdout,errors=process.stderr){try{
  if(!Array.isArray(args)||args.length!==1||typeof args[0]!=="string"||!args[0]||args[0].startsWith("--"))throw new RehearsalError("CLI_ARGUMENTS");
  const text=await readBoundedRehearsalText(args[0],REHEARSAL_SESSION_LIMIT),data=decodeRehearsalSession(text);
  const result={schema:"threecore.operation-rehearsal-session-inspection.v1",simulationOnly:true,sourceVerified:false,authorizesExecution:false,
    byteLength:new TextEncoder().encode(text).length,sha256:createHash("sha256").update(text,"utf8").digest("hex"),activeAgent:data.workspace.activeAgent,
    workspace:reportRehearsalWorkspace(data.workspace).rows.map(row=>({agent:row.agent,present:row.present,recordCount:row.recordCount,
      rejectedRecords:row.report?row.report.rows.filter(item=>!item.withinEnteredLimits).length:null})),
    cases:reportRehearsalScenarioSet(data.cases).rows.map(row=>({id:row.id,label:row.label,agent:row.agent,chainId:row.chainId,account:row.account,asset:row.asset,
      beforeRecords:row.beforeRecords,afterRecords:row.afterRecords,summary:row.summary}))};
  output.write(JSON.stringify(result,null,2)+"\n");return 0;
}catch(error){errors.write("Rehearsal session inspection failed: "+(error?.code??"FILE_READ_FAILED")+"\n");return 1;}}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await checkRehearsalSession(process.argv.slice(2));
