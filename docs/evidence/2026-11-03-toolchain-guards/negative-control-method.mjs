import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const base='C:/Users/aseet/AppData/Local/Temp/threecore-zod-compatibility-9a317ddc-6dbe-49df-bf43-13ff25e38f9b';
const current='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/token-toolchain-empty-data-DAT-20261102/node_modules/@nomicfoundation/hardhat-zod-utils/dist/src/index.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const currentHash=hash(await readFile(current));
const rows=[];
for(const [name,expected] of [['baseline','3.25.76'],['candidate','4.6.6']]){
 const root=base+'/'+name, helper=root+'/hardhat-zod-utils-original.mjs';
 assert.equal(hash(await readFile(helper)),currentHash);
 const require=createRequire(root+'/package.json');
 const version=require('zod/package.json').version; assert.equal(version,expected);
 const {z}=await import(pathToFileURL(require.resolve('zod')).href);
 const {validateUserConfigZodType}=await import(pathToFileURL(helper).href);
 const schema=z.object({networks:z.object({development:z.object({url:z.string()})})});
 assert.deepEqual(validateUserConfigZodType({networks:{development:{url:'https://example.invalid'}}},schema),[]);
 let errors,thrown;
 try{errors=validateUserConfigZodType({networks:{development:{url:42}}},schema);}catch(error){thrown=error.name;}
 if(name==='baseline'){assert.equal(thrown,undefined);assert.deepEqual(errors.map(e=>e.path),[['networks','development','url']]);}
 else assert.equal(thrown,'TypeError');
 rows.push({version,validCaseAccepted:true,invalidCaseReturnsStructuredPath:!thrown,thrown:thrown??null,packageLockSha256:hash(await readFile(root+'/package-lock.json'))});
}
const result={recordedAt:new Date().toISOString(),currentHelperVersion:'3.0.8',currentHelperSha256:currentHash,fixturesMatchCurrentHelperBytes:true,rows,currentNewRegressionDetectsForcedMajorIncompatibility:true,dependencyInstalls:false,projectConfigurationLoaded:false,keystoreLoaded:false,walletUsed:false,advisoryClosed:false};
await writeFile('C:/Users/aseet/Downloads/ThreeCore-zod-guard-control-20261103.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
