import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const base='C:/Users/aseet/AppData/Local/Temp/threecore-zod-compatibility-9a317ddc-6dbe-49df-bf43-13ff25e38f9b';
const originalPath='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/token-toolchain-empty-data-DAT-20261102/node_modules/@nomicfoundation/hardhat-zod-utils/dist/src/index.js';
const original=await readFile(originalPath,'utf8'),hash=x=>createHash('sha256').update(x).digest('hex');
assert.equal(hash(original),'ed7daa506d8a6283b4071036f866168dddf831b5bb39f1735d12138eb3bbbb48');
assert.equal(original.split('result.error.errors').length,2);
const aliasRepaired=original.replace('result.error.errors','result.error.issues');
const errorMap=/\.never\(\{\s*errorMap: \(\) => \(\{\s*message: errorMessage,\s*\}\),\s*\}\)/g;
assert.equal([...aliasRepaired.matchAll(errorMap)].length,1);
const repaired=aliasRepaired.replace(errorMap,'.never({ error: () => errorMessage })');
const root='C:/Users/aseet/Downloads/ThreeCore-zod-repair-probe-v2-20261103';await mkdir(root);
const cases=[];
for(const [profile,version,patched] of [['baseline','3.25.76',false],['candidate','4.6.6',true]]){
const dir=join(base,profile),require=createRequire(join(dir,'package.json'));
assert.equal(require('zod/package.json').version,version);
const helperPath=patched?join(dir,'hardhat-zod-utils-issues-and-error-probe.mjs'):join(dir,'hardhat-zod-utils-original.mjs');
if(patched)await writeFile(helperPath,repaired,{flag:'wx'});else assert.equal(hash(await readFile(helperPath)),hash(original));
const {z}=await import(pathToFileURL(require.resolve('zod'))),h=await import(pathToFileURL(helperPath));
let called=0;const fn=()=>{called++;throw Error('must not invoke fictional config functions');};
const tests=[
['nested invalid config retains structured path',()=>{const errors=h.validateUserConfigZodType({networks:{demo:{url:42}}},z.object({networks:z.object({demo:z.object({url:z.string()})})}));assert.deepEqual(errors.map(e=>e.path),[['networks','demo','url']]);}],
['Hardhat single-argument record accepts headers',()=>{const schema=z.object({httpHeaders:z.optional(z.record(z.string()))});assert(schema.safeParse({httpHeaders:{'X-ThreeCore-Probe':'fictional'}}).success);}],
['Hardhat single-argument record rejects wrong value',()=>{const schema=z.object({httpHeaders:z.optional(z.record(z.string()))});const errors=h.validateUserConfigZodType({httpHeaders:{'X-ThreeCore-Probe':42}},schema);assert.deepEqual(errors.map(e=>e.path),[['httpHeaders','X-ThreeCore-Probe']]);}],
['resolved configuration variable accepts functions without invoking',()=>{assert(h.resolvedConfigurationVariableSchema.safeParse({_type:'ResolvedConfigurationVariable',get:fn,getUrl:fn,getBigInt:fn,getHexString:fn}).success);}],
['resolved configuration variable reports invalid function',()=>{const errors=h.validateUserConfigZodType({value:{_type:'ResolvedConfigurationVariable',get:42,getUrl:fn,getBigInt:fn,getHexString:fn}},z.object({value:h.resolvedConfigurationVariableSchema}));assert.deepEqual(errors.map(e=>e.path),[['value','get']]);}],
['incompatible field retains deliberate diagnostic',()=>{const errors=h.validateUserConfigZodType({unused:true},z.object({unused:h.incompatibleFieldType('This field is incompatible with this mode')}));assert.deepEqual(errors,[{path:['unused'],message:'This field is incompatible with this mode'}]);}],
['ordinary configuration variable accepts fictional reference',()=>{assert(h.configurationVariableSchema.safeParse({_type:'ConfigurationVariable',name:'THREECORE_FICTIONAL_VALUE'}).success);}],
['conditional union retains nested error path',()=>{const schema=z.object({values:h.conditionalUnionType([[(x)=>Array.isArray(x),z.array(z.string())]],'Expected strings')});const errors=h.validateUserConfigZodType({values:['ok',4]},schema);assert.deepEqual(errors.map(e=>e.path),[['values',1]]);}],
['sensitive URL rejects invalid fictional value',()=>{const errors=h.validateUserConfigZodType({url:42},z.object({url:h.sensitiveUrlSchema}));assert.deepEqual(errors.map(e=>e.path),[['url']]);}]
];
for(const [name,test] of tests){let pass=true,failureType=null;try{test();}catch(error){pass=false;failureType=error.name;}cases.push({profile,version,issuesAliasPatched:patched,name,pass,failureType});}
assert.equal(called,0);
}
assert(cases.filter(c=>c.profile==='baseline').every(c=>c.pass));
assert(cases.find(c=>c.profile==='candidate'&&c.name==='nested invalid config retains structured path').pass);
assert(cases.filter(c=>c.profile==='candidate').every(c=>c.pass));
assert.equal(hash(await readFile(originalPath)),hash(original));
const result={recordedAt:new Date().toISOString(),helperVersion:'3.0.8',originalHelperSha256:hash(original),experimentalHelperSha256:hash(repaired),patch:'error.errors -> error.issues; never errorMap -> error callback (isolated helper only)',cases,counts:['baseline','candidate'].map(profile=>({profile,passed:cases.filter(c=>c.profile===profile&&c.pass).length,failed:cases.filter(c=>c.profile===profile&&!c.pass).length})),installedProjectHelperUnchanged:true,projectDependenciesChanged:false,newDependencyInstall:false,configurationOrKeystoreLoaded:false,fictionalFunctionsInvoked:0,walletOrNetworkUsed:false,remediationAccepted:false,advisoryClosed:false};
await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
