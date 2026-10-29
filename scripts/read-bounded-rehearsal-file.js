import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { RehearsalError } from "../src/operation-rehearsal.js";

export async function readBoundedRehearsalText(file,limit){
  if(!Number.isSafeInteger(limit)||limit<1||limit>2097152)throw new RehearsalError("INVALID_FILE_LIMIT");
  const handle=await open(resolve(file),"r");
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size<1||stat.size>limit)throw new RehearsalError("FILE_TOO_LARGE");
    const bytes=new Uint8Array(limit+1);let total=0;
    while(total<bytes.length){const {bytesRead}=await handle.read(bytes,total,bytes.length-total,total);if(!bytesRead)break;total+=bytesRead;}
    if(total!==stat.size||total>limit)throw new RehearsalError("FILE_CHANGED_OR_TOO_LARGE");
    try{return new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,total));}
    catch{throw new RehearsalError("INVALID_UTF8");}
  }finally{await handle.close();}
}
