import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const base='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/',root=base+'token-dependency-repair-DAT-20261102',wallet=base+'threecore-wallet-operation-rehearsal-20261029';
const sha=b=>createHash('sha256').update(b).digest('hex');
const relativePaths=['node_modules/@nomicfoundation/hardhat-zod-utils/dist/src/rpc/types/access-list.js','node_modules/@nomicfoundation/hardhat-zod-utils/dist/src/rpc/types/authorization-list.js','node_modules/@nomicfoundation/hardhat-zod-utils/dist/src/rpc/validate-params.js','node_modules/hardhat/dist/src/internal/builtin-plugins/network-manager/request-handlers/handlers/accounts/local-accounts.js'];
const hashes=Object.fromEntries(relativePaths.map(p=>[p,sha(readFileSync(root+'/'+p))]));
const {rpcAccessList}=await import(pathToFileURL(root+'/'+relativePaths[0]));
const {rpcAuthorizationList}=await import(pathToFileURL(root+'/'+relativePaths[1]));
const observations=[];
for(const[name,schema]of [['rpcAccessList',rpcAccessList],['rpcAuthorizationList',rpcAuthorizationList]]){
 for(const length of [0,1,4,16,64]){
  const start=performance.now(),result=schema.safeParse(Array.from({length},()=>({}))),elapsedMs=performance.now()-start;
  const errors=result.success?0:result.error.issues.length;
  assert.equal(result.success,length===0);assert.equal(errors,length*(name==='rpcAccessList'?2:6));
  observations.push({schema:name,inputElements:length,success:result.success,validationIssueCount:errors,elapsedMs});
 }
}
const walletSourceFiles=[];
function walk(dir){for(const entry of readdirSync(wallet+'/'+dir,{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.isDirectory())walk(path);else if(entry.isFile()&&/\.(js|mjs|html)$/.test(entry.name))walletSourceFiles.push(path);}}
walk('src');walk('examples');
const references=walletSourceFiles.filter(p=>/\b(?:from\s*|import\s*\(|require\s*\()\s*["'](?:zod(?:[/'"])|hardhat(?:[/'"])|@nomicfoundation\/)/.test(readFileSync(wallet+'/'+p,'utf8')));
assert.equal(references.length,0);
const packageVersions=Object.fromEntries(['zod','hardhat','@nomicfoundation/hardhat-zod-utils'].map(name=>[name,JSON.parse(readFileSync(root+'/node_modules/'+name+'/package.json')).version]));
const result={recordedAt:new Date().toISOString(),node:process.version,advisoryUrl:'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5',packageVersions,sourceHashes:hashes,observations,walletSourceScan:{files:walletSourceFiles.length,roots:['src','examples'],directZodOrHardhatImports:references,scope:'Static direct-import search in local JS/MJS/HTML only, not a universal dynamic reachability proof'},scope:'Installed schemas only, fictional bounded input up to 64 objects. No Hardhat account handler instantiated, no config/keystore/private-key access, no RPC, no signature or transaction.',conclusion:'Both installed RPC collection schemas collect proportional per-element issues at these bounded sizes. This confirms a development dependency surface to review, not an out-of-memory reproduction or network exploit. No exception waiver or security clearance is asserted.'};
writeFileSync('C:/Users/aseet/Downloads/ThreeCore-zod-exposure-20261102.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
