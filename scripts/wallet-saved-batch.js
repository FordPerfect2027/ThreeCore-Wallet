import {createHash} from 'node:crypto';
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {parseEvidenceManifest,EvidenceManifestError,EVIDENCE_MANIFEST_LIMIT} from './evidence-manifest.js';
import {inspectWalletSavedText} from '../src/file-read-status.js';

export const WALLET_SAVED_BATCH_LIMITS=Object.freeze({maxFiles:50,maxFileBytes:16*1024*1024,maxTotalBytes:64*1024*1024});
export class WalletSavedBatchError extends Error{constructor(code){super(code);this.name='WalletSavedBatchError';this.code=code;}}
const fail=code=>{throw new WalletSavedBatchError(code);},receipts=new WeakSet(),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(left,right)=>right.isFile()&&['size','mtimeMs','ctimeMs','ino','dev'].every(key=>left[key]===right[key]);
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
 return typeof code==='string'&&/^(?:FILE|PERIOD|TRANSFER|IDENTITY|RECONCILIATION)_[A-Z_]{1,64}$/.test(code)?code:'BATCH_FILE_READ_FAILED';
}
async function stableBytes(path,info,limit){
 const handle=await open(path,'r');try{
  const before=await handle.stat();if(!same(info,before))fail('FILE_CHANGED');if(!Number.isSafeInteger(before.size)||before.size<1||before.size>limit)fail('FILE_SIZE_LIMIT');
  const bytes=new Uint8Array(before.size);let offset=0;while(offset<bytes.length){const length=Math.min(65536,bytes.length-offset),result=await handle.read(bytes,offset,length,offset);if(!Number.isSafeInteger(result.bytesRead)||result.bytesRead<1||result.bytesRead>length)fail('FILE_CHANGED');offset+=result.bytesRead;}
  const extra=await handle.read(new Uint8Array(1),0,1,bytes.length);if(extra.bytesRead!==0||!same(before,await handle.stat()))fail('FILE_CHANGED');return bytes;
 }finally{await handle.close();}
}
const decode=bytes=>{try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('INVALID_UTF8');}};

/** Explicit local inventory: validate each original independently, never restore or sum holdings. */
export async function inspectWalletSavedBatch(path,options={}){
 const limits=limitsFrom(options);if(typeof path!=='string'||!path||path.includes('\0'))fail('INVALID_MANIFEST_PATH');
 const requested=resolve(path),manifestInfo=await lstat(requested);if(!manifestInfo.isFile())fail('MANIFEST_NOT_REGULAR');
 const manifest=await realpath(requested),root=dirname(manifest),manifestBytes=await stableBytes(manifest,manifestInfo,EVIDENCE_MANIFEST_LIMIT);
 const unchanged=async()=>{if(await realpath(requested)!==manifest||!same(manifestInfo,await lstat(manifest)))fail('MANIFEST_CHANGED');};
 await unchanged();const entries=parseEvidenceManifest(decode(manifestBytes));if(entries.length>limits.maxFiles)fail('BATCH_ENTRY_LIMIT');if(entries.some(row=>!row.path.toLowerCase().endsWith('.json')))fail('JSON_FILES_REQUIRED');
 const paths=new Set(),inodes=new Set(),files=[];let admittedBytes=0,readBytes=0;
 for(const entry of entries){
  let actualSha256=null,byteLength=null;
  try{
   const candidate=resolve(root,...entry.path.split('/')),actual=await realpath(candidate);if(!contained(root,actual))fail('OUTSIDE_EVIDENCE_DIRECTORY');if(actual===manifest)fail('MANIFEST_SELF_REFERENCE');
   const identity=process.platform==='win32'?actual.toLowerCase():actual;if(paths.has(identity))fail('FILE_ALIAS_DUPLICATE');paths.add(identity);
   const info=await lstat(actual);if(!info.isFile())fail('FILE_NOT_REGULAR');const physical=info.ino?info.dev+':'+info.ino:null;if(physical&&inodes.has(physical))fail('FILE_ALIAS_DUPLICATE');if(physical)inodes.add(physical);
   if(!Number.isSafeInteger(info.size)||info.size<1||info.size>limits.maxFileBytes)fail('FILE_SIZE_LIMIT');if(info.size>limits.maxTotalBytes-admittedBytes)fail('TOTAL_SIZE_LIMIT');admittedBytes+=info.size;
   const bytes=await stableBytes(actual,info,limits.maxFileBytes);byteLength=bytes.length;readBytes+=byteLength;if(await realpath(candidate)!==actual||!same(info,await lstat(actual)))fail('FILE_CHANGED');actualSha256=hash(bytes);
   if(actualSha256!==entry.expectedSha256){files.push(Object.freeze({...entry,actualSha256,byteLength,status:'checksum-mismatch',inspection:null}));continue;}
   const inspection=await inspectWalletSavedText(decode(bytes));
   if(inspection.validation==='validated-original'&&(inspection.textDigest!==actualSha256||inspection.checksumVerified!==true))fail('INSPECTION_HASH_INCONSISTENT');
   if(await realpath(candidate)!==actual||!same(info,await lstat(actual)))fail('FILE_CHANGED');
   files.push(Object.freeze({...entry,actualSha256,byteLength,status:inspection.validation,inspection}));
  }catch(error){files.push(Object.freeze({...entry,actualSha256,byteLength,status:'unreadable',code:walletSavedBatchErrorCode(error),inspection:null}));}
 }
 await unchanged();
 const summary=Object.freeze({files:entries.length,validatedOriginals:files.filter(row=>row.status==='validated-original').length,declaredOnly:files.filter(row=>row.status==='declared-only').length,checksumMismatched:files.filter(row=>row.status==='checksum-mismatch').length,unreadable:files.filter(row=>row.status==='unreadable').length,admittedBytes,readBytes});
 const result=Object.freeze({schema:'threecore.wallet-saved-batch-inspection.v1',readOnly:true,authenticatesOrigin:false,authorizesExecution:false,restorable:false,liveChainRechecked:false,atomicSnapshot:false,manifestSha256:hash(manifestBytes),allOriginalsValidated:summary.validatedOriginals===summary.files,allChecksumsMatch:files.every(row=>['validated-original','declared-only'].includes(row.status)&&row.actualSha256===row.expectedSha256),limits,summary,files:Object.freeze(files)});receipts.add(result);return result;
}
export function encodeWalletSavedBatch(result,format='json'){
 if(!receipts.has(result)||!['json','csv'].includes(format))fail('INVALID_BATCH_RESULT');if(format==='json')return JSON.stringify(result,null,2)+'\n';
 const rows=[['readOnly','authenticatesOrigin','authorizesExecution','restorable','liveChainRechecked','atomicSnapshot','manifestSha256','allOriginalsValidated','allChecksumsMatch','selectedFiles','path','status','code','byteLength','expectedSha256','actualSha256','sourceSchema','target','internalChecksumVerified','draftReferences','incompleteDraftReferences','restrictedEntryReferences','agents','repeatedReferencesMayExist']];
 for(const row of result.files){const i=row.inspection,s=i?.scope;rows.push([true,false,false,false,false,false,result.manifestSha256,result.allOriginalsValidated,result.allChecksumsMatch,result.summary.files,row.path,row.status,row.code??'',row.byteLength??'',row.expectedSha256,row.actualSha256??'',i?.sourceSchema??'',i?.target??'',i?.checksumVerified??'',s?.draftReferences??'',s?.incompleteDraftReferences??'',s?.restrictedEntryReferences??'',s?.agents.join(' | ')??'',s?.repeatedReferencesMayExist??'']);}
 const cell=value=>{let text=String(value);if(/^\s*[=+@-]/u.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
