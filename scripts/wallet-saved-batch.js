import {createHash} from 'node:crypto';
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {parseEvidenceManifest,EvidenceManifestError,EVIDENCE_MANIFEST_LIMIT} from './evidence-manifest.js';
import {inspectWalletSavedText,compareWalletSavedInspections,WALLET_SAVED_OBSERVATION_SCOPE_FIELDS,WALLET_SAVED_REHEARSAL_SCOPE_FIELDS} from '../src/file-read-status.js';
import {readBoundedLocalBytes} from './read-bounded-local-file.js';
import {parseSecurityJson} from '../src/security-json.js';
import {isDeepStrictEqual} from 'node:util';

export const WALLET_SAVED_BATCH_LIMITS=Object.freeze({maxFiles:50,maxFileBytes:16*1024*1024,maxTotalBytes:64*1024*1024});
export class WalletSavedBatchError extends Error{constructor(code){super(code);this.name='WalletSavedBatchError';this.code=code;}}
const fail=code=>{throw new WalletSavedBatchError(code);},receipts=new WeakSet(),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(left,right)=>right.isFile()&&['size','mtimeNs','ctimeNs','ino','dev'].every(key=>left[key]===right[key]);
const contained=(root,path)=>{const name=relative(root,path);return Boolean(name)&&name!=='..'&&!name.startsWith('..'+sep)&&!isAbsolute(name);};
function limitsFrom(options){
 if(!options||typeof options!=='object'||Array.isArray(options)||![Object.prototype,null].includes(Object.getPrototypeOf(options)))fail('INVALID_BATCH_LIMITS');
 const limits={...WALLET_SAVED_BATCH_LIMITS};
 for(const key of Reflect.ownKeys(options)){const d=Object.getOwnPropertyDescriptor(options,key);if(!Object.hasOwn(limits,key)||!d||!Object.hasOwn(d,'value')||!Number.isSafeInteger(d.value)||d.value<(key==='maxTotalBytes'?0:1)||d.value>limits[key])fail('INVALID_BATCH_LIMITS');limits[key]=d.value;}
 return Object.freeze(limits);
}
export function walletSavedBatchErrorCode(error){
 if(error instanceof WalletSavedBatchError||error instanceof EvidenceManifestError)return error.code;
 let code;try{code=Object.getOwnPropertyDescriptor(error,'code')?.value;}catch{}
 if(code==='ENOENT')return 'FILE_MISSING';if(['EACCES','EPERM'].includes(code))return 'FILE_ACCESS_DENIED';
 return typeof code==='string'&&/^(?:FILE|PERIOD|TRANSFER|IDENTITY|ALLOWANCE|WORKSPACE|SETUP|HISTORY|RECONCILIATION)_[A-Z_]{1,64}$/.test(code)?code:'BATCH_FILE_READ_FAILED';
}
async function stableBytes(path,info,limit){
 const handle=await open(path,'r');try{
  const before=await handle.stat({bigint:true});if(!same(info,before))fail('FILE_CHANGED');if(typeof before.size!=='bigint'||before.size<1n||before.size>BigInt(limit))fail('FILE_SIZE_LIMIT');
  const bytes=new Uint8Array(Number(before.size));let offset=0;while(offset<bytes.length){const length=Math.min(65536,bytes.length-offset),result=await handle.read(bytes,offset,length,offset);if(!Number.isSafeInteger(result.bytesRead)||result.bytesRead<1||result.bytesRead>length)fail('FILE_CHANGED');offset+=result.bytesRead;}
  const extra=await handle.read(new Uint8Array(1),0,1,bytes.length);if(extra.bytesRead!==0||!same(before,await handle.stat({bigint:true})))fail('FILE_CHANGED');return bytes;
 }finally{await handle.close();}
}
const decode=bytes=>{try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('INVALID_UTF8');}};

/** Explicit local inventory: validate each original independently, never restore or sum holdings. */
export async function inspectWalletSavedBatch(path,options={}){
 const limits=limitsFrom(options);if(typeof path!=='string'||!path||path.includes('\0'))fail('INVALID_MANIFEST_PATH');
 const requested=resolve(path),manifestInfo=await lstat(requested,{bigint:true});if(!manifestInfo.isFile())fail('MANIFEST_NOT_REGULAR');
 const manifest=await realpath(requested),root=dirname(manifest),manifestBytes=await stableBytes(manifest,manifestInfo,EVIDENCE_MANIFEST_LIMIT);
 const unchanged=async()=>{if(await realpath(requested)!==manifest||!same(manifestInfo,await lstat(manifest,{bigint:true})))fail('MANIFEST_CHANGED');};
 await unchanged();const entries=parseEvidenceManifest(decode(manifestBytes));if(entries.length>limits.maxFiles)fail('BATCH_ENTRY_LIMIT');if(entries.some(row=>!row.path.toLowerCase().endsWith('.json')))fail('JSON_FILES_REQUIRED');
 const paths=new Set(),inodes=new Set(),files=[];let admittedBytes=0,readBytes=0;
 for(const entry of entries){
  let actualSha256=null,byteLength=null;
  try{
   const candidate=resolve(root,...entry.path.split('/')),actual=await realpath(candidate);if(!contained(root,actual))fail('OUTSIDE_EVIDENCE_DIRECTORY');if(actual===manifest)fail('MANIFEST_SELF_REFERENCE');
   const identity=process.platform==='win32'?actual.toLowerCase():actual;if(paths.has(identity))fail('FILE_ALIAS_DUPLICATE');paths.add(identity);
   const info=await lstat(actual,{bigint:true});if(!info.isFile())fail('FILE_NOT_REGULAR');const physical=info.ino?info.dev+':'+info.ino:null;if(physical&&inodes.has(physical))fail('FILE_ALIAS_DUPLICATE');if(physical)inodes.add(physical);
   if(typeof info.size!=='bigint'||info.size<1n||info.size>BigInt(limits.maxFileBytes))fail('FILE_SIZE_LIMIT');if(info.size>BigInt(limits.maxTotalBytes-admittedBytes))fail('TOTAL_SIZE_LIMIT');admittedBytes+=Number(info.size);
   const bytes=await stableBytes(actual,info,limits.maxFileBytes);byteLength=bytes.length;readBytes+=byteLength;if(await realpath(candidate)!==actual||!same(info,await lstat(actual,{bigint:true})))fail('FILE_CHANGED');actualSha256=hash(bytes);
   if(actualSha256!==entry.expectedSha256){files.push(Object.freeze({...entry,actualSha256,byteLength,status:'checksum-mismatch',inspection:null}));continue;}
   const inspection=await inspectWalletSavedText(decode(bytes));
   if(inspection.validation==='validated-original'&&(inspection.textDigest!==actualSha256||inspection.checksumVerified!==true))fail('INSPECTION_HASH_INCONSISTENT');
   if(await realpath(candidate)!==actual||!same(info,await lstat(actual,{bigint:true})))fail('FILE_CHANGED');
   files.push(Object.freeze({...entry,actualSha256,byteLength,status:inspection.validation,inspection}));
  }catch(error){files.push(Object.freeze({...entry,actualSha256,byteLength,status:'unreadable',code:walletSavedBatchErrorCode(error),inspection:null}));}
 }
 await unchanged();
 const structureValidated=files.filter(row=>row.status==='validated-structure').length,simulationFiles=files.filter(row=>row.inspection?.simulationOnly===true).length;
 const summary=Object.freeze({files:entries.length,validatedOriginals:files.filter(row=>row.status==='validated-original').length,declaredOnly:files.filter(row=>row.status==='declared-only').length,checksumMismatched:files.filter(row=>row.status==='checksum-mismatch').length,unreadable:files.filter(row=>row.status==='unreadable').length,admittedBytes,readBytes,...(structureValidated?{structureValidated}:{}),...(simulationFiles?{simulationFiles}:{})});
 const result=Object.freeze({schema:'threecore.wallet-saved-batch-inspection.v1',readOnly:true,authenticatesOrigin:false,authorizesExecution:false,restorable:false,liveChainRechecked:false,atomicSnapshot:false,manifestSha256:hash(manifestBytes),allOriginalsValidated:summary.validatedOriginals===summary.files,allChecksumsMatch:files.every(row=>['validated-original','validated-structure','declared-only'].includes(row.status)&&row.actualSha256===row.expectedSha256),limits,summary,files:Object.freeze(files)});receipts.add(result);return result;
}
export function encodeWalletSavedBatch(result,format='json'){
 if(!receipts.has(result)||!['json','csv'].includes(format))fail('INVALID_BATCH_RESULT');if(format==='json')return JSON.stringify(result,null,2)+'\n';
 const rows=[['readOnly','authenticatesOrigin','authorizesExecution','restorable','liveChainRechecked','atomicSnapshot','manifestSha256','allOriginalsValidated','allChecksumsMatch','selectedFiles','path','status','code','byteLength','expectedSha256','actualSha256','sourceSchema','target','internalChecksumVerified','draftReferences','incompleteDraftReferences','restrictedEntryReferences','agents','repeatedReferencesMayExist']];
 for(const row of result.files){const i=row.inspection,s=i?.scope;rows.push([true,false,false,false,false,false,result.manifestSha256,result.allOriginalsValidated,result.allChecksumsMatch,result.summary.files,row.path,row.status,row.code??'',row.byteLength??'',row.expectedSha256,row.actualSha256??'',i?.sourceSchema??'',i?.target??'',i?.checksumVerified??'',s?.draftReferences??'',s?.incompleteDraftReferences??'',s?.restrictedEntryReferences??'',s?.agents.join(' | ')??'',s?.repeatedReferencesMayExist??'']);}
 const extraFields=[...WALLET_SAVED_OBSERVATION_SCOPE_FIELDS,...WALLET_SAVED_REHEARSAL_SCOPE_FIELDS].filter(field=>result.files.some(row=>row.inspection?.scope&&Object.hasOwn(row.inspection.scope,field)));if(extraFields.length){rows[0].push(...extraFields);result.files.forEach((row,index)=>rows[index+1].push(...extraFields.map(field=>row.inspection?.scope?.[field]??'')));}
 if(result.files.some(row=>row.inspection?.simulationOnly===true)){rows[0].push('simulationOnly');result.files.forEach((row,index)=>rows[index+1].push(row.inspection?.simulationOnly??''));}
 const cell=value=>{let text=String(value);if(/^\s*[=+@-]/u.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}

const comparisons=new WeakSet(),reviews=new WeakSet();
export const WALLET_LOCAL_BATCH_COMPARISON_SCHEMA='threecore.wallet-saved-local-batch-comparison.v1';
export const WALLET_LOCAL_BATCH_REVIEW_LIMIT=4*1024*1024;
/** Compare only receipts produced by this local file inspector. */
export function compareWalletSavedBatches(before,after){
 if(!receipts.has(before)||!receipts.has(after))fail('INVALID_BATCH_COMPARISON');
 const left=new Map(before.files.map(row=>[row.path,row])),right=new Map(after.files.map(row=>[row.path,row])),paths=[...new Set([...left.keys(),...right.keys()])];
 const files=paths.map(path=>{const a=left.get(path)??null,b=right.get(path)??null,selection=!a?'only-after':!b?'only-before':'both',sameBytes=a?.actualSha256&&b?.actualSha256?a.actualSha256===b.actualSha256:null,comparison=a?.status==='validated-original'&&b?.status==='validated-original'?compareWalletSavedInspections(a.inspection,b.inspection):null;return Object.freeze({path,selection,before:a,after:b,sameBytes,comparison,kind:selection!=='both'?selection:comparison?.kind??'unverified'});});
 const count=kind=>files.filter(row=>row.kind===kind).length,summary=Object.freeze({files:files.length,bothSelected:files.filter(row=>row.selection==='both').length,onlyBefore:count('only-before'),onlyAfter:count('only-after'),identical:count('identical'),formatOnly:count('format-only'),changedOriginal:count('changed-original'),differentFormat:count('different-format'),unverified:count('unverified')});
 const result=Object.freeze({schema:WALLET_LOCAL_BATCH_COMPARISON_SCHEMA,readOnly:true,authenticatesOrigin:false,authorizesExecution:false,restorable:false,containsOriginalEvidence:false,liveChainRechecked:false,atomicSnapshot:false,reportsFilesystemDeletions:false,before,after,sameSelection:summary.onlyBefore===0&&summary.onlyAfter===0,allSelectedOriginalsIdentical:summary.identical===files.length,summary,files:Object.freeze(files)});comparisons.add(result);return result;
}
export async function compareWalletSavedBatchManifests(beforeManifest,afterManifest){
 const before=await inspectWalletSavedBatch(beforeManifest),after=await inspectWalletSavedBatch(afterManifest);return compareWalletSavedBatches(before,after);
}
export function encodeWalletSavedLocalBatchComparison(result,format='json'){
 if(!comparisons.has(result)||!['json','csv'].includes(format))fail('INVALID_BATCH_COMPARISON');if(format==='json')return JSON.stringify(result,null,2)+'\n';
 const rows=[['readOnly','authenticatesOrigin','authorizesExecution','restorable','liveChainRechecked','atomicSnapshot','reportsFilesystemDeletions','beforeManifestSha256','afterManifestSha256','sameSelection','allSelectedOriginalsIdentical','path','selection','kind','sameBytes','beforeStatus','afterStatus','beforeExpectedSha256','afterExpectedSha256','beforeActualSha256','afterActualSha256','sameOriginal','byteDifference','scopeChangeFields','unchangedScopeWithChangedOriginal']];
 for(const row of result.files)rows.push([true,false,false,false,false,false,false,result.before.manifestSha256,result.after.manifestSha256,result.sameSelection,result.allSelectedOriginalsIdentical,row.path,row.selection,row.kind,row.sameBytes??'',row.before?.status??'',row.after?.status??'',row.before?.expectedSha256??'',row.after?.expectedSha256??'',row.before?.actualSha256??'',row.after?.actualSha256??'',row.comparison?.sameOriginal??'',row.comparison?.byteDifference??'',row.comparison?.scopeChanges.map(change=>change.field).join(' | ')??'',row.comparison?.unchangedScopeWithChangedOriginal??'']);
 const cell=value=>{let text=String(value);if(/^\s*[=+@-]/u.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
/** Read the supplied comparison as untrusted data, then recompute from both local manifests. */
export async function reviewWalletSavedLocalBatchComparison(beforeManifest,afterManifest,comparisonPath){
 if(typeof comparisonPath!=='string'||!comparisonPath||comparisonPath.includes('\0'))fail('INVALID_BATCH_COMPARISON_PATH');
 const requested=resolve(comparisonPath),info=await lstat(requested,{bigint:true});if(!info.isFile())fail('BATCH_COMPARISON_NOT_REGULAR');const actual=await realpath(requested);
 const unchanged=async()=>{if(await realpath(requested)!==actual||!same(info,await lstat(actual,{bigint:true})))fail('BATCH_COMPARISON_CHANGED');};
 const bytes=await readBoundedLocalBytes(actual,WALLET_LOCAL_BATCH_REVIEW_LIMIT,{fail,sizeCode:'BATCH_COMPARISON_SIZE',changedCode:'BATCH_COMPARISON_CHANGED'});await unchanged();let supplied;
 try{supplied=parseSecurityJson(decode(bytes),{bytes:WALLET_LOCAL_BATCH_REVIEW_LIMIT});}catch{fail('BATCH_COMPARISON_JSON');}
 if(!supplied||typeof supplied!=='object'||Array.isArray(supplied)||supplied.schema!==WALLET_LOCAL_BATCH_COMPARISON_SCHEMA)fail('BATCH_COMPARISON_SCHEMA');
 const expected=await compareWalletSavedBatchManifests(beforeManifest,afterManifest),differences=Object.keys(expected).filter(field=>!Object.hasOwn(supplied,field)||!isDeepStrictEqual(supplied[field],expected[field])),unexpectedFields=Object.keys(supplied).filter(field=>!Object.hasOwn(expected,field)).length;await unchanged();
 const result=Object.freeze({schema:'threecore.wallet-saved-local-batch-comparison-review.v1',readOnly:true,authenticatesOrigin:false,authorizesExecution:false,restorable:false,containsOriginalEvidence:false,liveChainRechecked:false,atomicSnapshot:false,matchesRecomputation:differences.length===0&&unexpectedFields===0,beforeBindingMatches:isDeepStrictEqual(supplied.before,expected.before),afterBindingMatches:isDeepStrictEqual(supplied.after,expected.after),beforeManifestSha256:expected.before.manifestSha256,afterManifestSha256:expected.after.manifestSha256,comparisonTextDigest:hash(bytes),expectedComparisonDigest:hash(encodeWalletSavedLocalBatchComparison(expected)),allSelectedOriginalsIdentical:expected.allSelectedOriginalsIdentical,expectedSummary:expected.summary,differences:Object.freeze(differences),unexpectedFields});reviews.add(result);return result;
}
export function encodeWalletSavedLocalBatchComparisonReview(result){if(!reviews.has(result))fail('INVALID_BATCH_COMPARISON_REVIEW');return JSON.stringify(result,null,2)+'\n';}
