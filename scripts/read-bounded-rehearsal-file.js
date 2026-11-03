import { readBoundedLocalBytes } from "./read-bounded-local-file.js";
import { resolve } from "node:path";
import { RehearsalError } from "../src/operation-rehearsal.js";

export async function readBoundedRehearsalText(file,limit){
  if(!Number.isSafeInteger(limit)||limit<1||limit>2097152)throw new RehearsalError("INVALID_FILE_LIMIT");
  const bytes=await readBoundedLocalBytes(resolve(file),limit,{
    fail:code=>{throw new RehearsalError(code);},sizeCode:"FILE_TOO_LARGE",changedCode:"FILE_CHANGED_OR_TOO_LARGE",
  });
  try{return new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch{throw new RehearsalError("INVALID_UTF8");}
}
