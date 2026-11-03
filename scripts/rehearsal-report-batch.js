import {createHash,webcrypto} from 'node:crypto';
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {parseEvidenceManifest,EvidenceManifestError,EVIDENCE_MANIFEST_LIMIT} from './evidence-manifest.js';
import {reviewRehearsalReport,REHEARSAL_REPORT_REVIEW_LIMIT} from '../src/operation-rehearsal-report-review.js';
import {RehearsalError} from '../src/operation-rehearsal.js';

export const REHEARSAL_BATCH_LIMITS=Object.freeze({maxReports:50,maxReportBytes:REHEARSAL_REPORT_REVIEW_LIMIT,maxTotalBytes:32*1024*1024});
export class RehearsalBatchError extends Error{constructor(code){super(code);this.name='RehearsalBatchError';this.code=code;}}
const fail=code=>{throw new RehearsalBatchError(code);},receipts=new WeakSet();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const metadata=['size','mtimeNs','ctimeNs','ino','dev'];
const same=(left,right)=>right.isFile()&&metadata.every(key=>left[key]===right[key]);
const contained=(root,path)=>{const name=relative(root,path);return Boolean(name)&&name!=='..'&&!name.startsWith('..'+sep)&&!isAbsolute(name);};
function limitsFrom(options){
 if(!options||typeof options!=='object'||Array.isArray(options)||![Object.prototype,null].includes(Object.getPrototypeOf(options)))fail('INVALID_BATCH_LIMITS');
 const result={...REHEARSAL_BATCH_LIMITS};
 for(const key of Reflect.ownKeys(options)){const d=Object.getOwnPropertyDescriptor(options,key);
  if(!Object.hasOwn(result,key)||!d||!Object.hasOwn(d,'value')||!Number.isSafeInteger(d.value)||d.value<(key==='maxTotalBytes'?0:1)||d.value>result[key])fail('INVALID_BATCH_LIMITS');result[key]=d.value;
 }return Object.freeze(result);
}
export function rehearsalBatchErrorCode(error){
 if(error instanceof RehearsalBatchError||error instanceof EvidenceManifestError||error instanceof RehearsalError)return error.code;
 if(error?.code==='ENOENT')return 'FILE_MISSING';if(['EACCES','EPERM'].includes(error?.code))return 'FILE_ACCESS_DENIED';return 'BATCH_FILE_READ_FAILED';
}
/** Compare the opened file before reading; path resolution alone cannot exclude a replacement race. */
async function readStableFile(path,info,limit){
 const handle=await open(path,'r');
 try{
  const before=await handle.stat({bigint:true});if(!same(info,before))fail('FILE_CHANGED');
  if(typeof before.size!=='bigint'||before.size<1n||before.size>BigInt(limit))fail('FILE_SIZE_LIMIT');
  const bytes=new Uint8Array(Number(before.size));let offset=0;
  while(offset<bytes.length){const length=Math.min(65536,bytes.length-offset),result=await handle.read(bytes,offset,length,offset);
   if(!Number.isSafeInteger(result.bytesRead)||result.bytesRead<1||result.bytesRead>length)fail('FILE_CHANGED');offset+=result.bytesRead;
  }
  const extra=await handle.read(new Uint8Array(1),0,1,bytes.length);if(extra.bytesRead!==0||!same(before,await handle.stat({bigint:true})))fail('FILE_CHANGED');
  return bytes;
 }finally{await handle.close();}
}
function decode(bytes){try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('INVALID_UTF8');}}

/** Explicit local manifest only. No scanning, fetching, source writes or automatic repair. */
export async function reviewRehearsalReportBatch(file,options={}){
 const limits=limitsFrom(options);if(typeof file!=='string'||!file)fail('INVALID_MANIFEST_PATH');
 const requested=resolve(file),info=await lstat(requested,{bigint:true});if(!info.isFile())fail('MANIFEST_NOT_REGULAR');
 const manifest=await realpath(requested),root=dirname(manifest),bytes=await readStableFile(manifest,info,EVIDENCE_MANIFEST_LIMIT);
 const unchanged=async()=>{if(await realpath(requested)!==manifest||!same(info,await lstat(manifest,{bigint:true})))fail('MANIFEST_CHANGED');};
 await unchanged();const entries=parseEvidenceManifest(decode(bytes));
 if(entries.length>limits.maxReports)fail('BATCH_ENTRY_LIMIT');if(entries.some(entry=>!entry.path.toLowerCase().endsWith('.json')))fail('REPORT_JSON_REQUIRED');
 const paths=new Set(),files=new Set(),results=[];let admittedBytes=0,readBytes=0;
 for(const entry of entries){
  let actualSha256=null,byteLength=null;
  try{
   const candidate=resolve(root,...entry.path.split('/')),actual=await realpath(candidate);
   if(!contained(root,actual))fail('OUTSIDE_EVIDENCE_DIRECTORY');if(actual===manifest)fail('MANIFEST_SELF_REFERENCE');
   const identity=process.platform==='win32'?actual.toLowerCase():actual;if(paths.has(identity))fail('FILE_ALIAS_DUPLICATE');paths.add(identity);
   const stat=await lstat(actual,{bigint:true});if(!stat.isFile())fail('FILE_NOT_REGULAR');
   const physical=stat.ino?stat.dev+':'+stat.ino:null;if(physical&&files.has(physical))fail('FILE_ALIAS_DUPLICATE');if(physical)files.add(physical);
   if(typeof stat.size!=='bigint'||stat.size<1n||stat.size>BigInt(limits.maxReportBytes))fail('FILE_SIZE_LIMIT');
   if(stat.size>BigInt(limits.maxTotalBytes-admittedBytes))fail('TOTAL_SIZE_LIMIT');admittedBytes+=Number(stat.size);
   const contents=await readStableFile(actual,stat,limits.maxReportBytes);byteLength=contents.length;readBytes+=byteLength;
   if(await realpath(candidate)!==actual||!same(stat,await lstat(actual,{bigint:true})))fail('FILE_CHANGED');
   actualSha256=hash(contents);
   if(actualSha256!==entry.expectedSha256){results.push(Object.freeze({...entry,status:'checksum-mismatch',byteLength,actualSha256}));continue;}
   const review=await reviewRehearsalReport(decode(contents),{expectedSha256:entry.expectedSha256,subtle:webcrypto.subtle});
   if(review.sha256!==actualSha256||review.checksumMatches!==true)fail('REVIEW_HASH_INCONSISTENT');
   if(await realpath(candidate)!==actual||!same(stat,await lstat(actual,{bigint:true})))fail('FILE_CHANGED');
   results.push(Object.freeze({...entry,status:review.matchesRecomputation?'matched':'different',byteLength,actualSha256,review}));
  }catch(error){const code=rehearsalBatchErrorCode(error);results.push(Object.freeze({...entry,status:code==='UNSUPPORTED_REVIEW_REPORT'?'unsupported':'unreadable',code,byteLength,actualSha256}));}
 }
 await unchanged();
 const summary=Object.freeze({files:entries.length,matched:results.filter(r=>r.status==='matched').length,different:results.filter(r=>r.status==='different').length,
  checksumMismatched:results.filter(r=>r.status==='checksum-mismatch').length,unsupported:results.filter(r=>r.status==='unsupported').length,unreadable:results.filter(r=>r.status==='unreadable').length,
  reportsWithFailedExpectations:results.filter(r=>r.review?.reportOutcome?.kind==='expected-outcomes'&&!r.review.reportOutcome.allMatched).length,readBytes,admittedBytes});
 const result=Object.freeze({schema:'threecore.rehearsal-report-batch-review.v1',readOnly:true,authenticatesOrigin:false,authorizesExecution:false,
  manifestSha256:hash(bytes),allChecksumsAndRecomputationsMatch:summary.matched===summary.files,limits,summary,files:Object.freeze(results)});
 receipts.add(result);return result;
}
export function encodeRehearsalBatchReview(result,format='json'){
 if(!receipts.has(result)||!['json','csv'].includes(format))fail('INVALID_BATCH_RESULT');
 if(format==='json')return JSON.stringify(result,null,2)+'\n';
 const rows=[['readOnly','authenticatesOrigin','authorizesExecution','manifestSha256','allChecksumsAndRecomputationsMatch','path','status','code','byteLength','expectedSha256','actualSha256','inputSchema','matchesRecomputation','expectationsMatch']];
 for(const row of result.files)rows.push([true,false,false,result.manifestSha256,result.allChecksumsAndRecomputationsMatch,row.path,row.status,row.code??'',row.byteLength??'',row.expectedSha256,row.actualSha256??'',row.review?.inputSchema??'',row.review?.matchesRecomputation??'',row.review?.reportOutcome?.kind==='expected-outcomes'?row.review.reportOutcome.allMatched:'']);
 const cell=value=>{let text=String(value);if(/^\s*[=+@-]/u.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
