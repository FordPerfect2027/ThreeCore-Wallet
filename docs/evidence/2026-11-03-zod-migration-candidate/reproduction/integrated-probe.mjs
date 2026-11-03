import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const baseline='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/token-toolchain-empty-data-DAT-20261102';
const candidate='C:/Users/aseet/AppData/Local/Temp/threecore-zod4-repro-20261103';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fixtures=[
{name:'empty config',target:'network',input:{}},
{name:'valid HTTP config and headers',target:'network',input:{networks:{demo:{type:'http',chainType:'op',url:'https://example.invalid',httpHeaders:{'X-ThreeCore-Probe':'fictional'},chainId:84532}}}},
{name:'invalid HTTP URL',target:'network',input:{networks:{demo:{type:'http',url:42}}}},
{name:'invalid HTTP header value',target:'network',input:{networks:{demo:{type:'http',url:'https://example.invalid',httpHeaders:{'X-ThreeCore-Probe':42}}}}},
{name:'invalid network discriminator',target:'network',input:{networks:{demo:{type:'fictional'}}}},
{name:'valid simulated network shape only',target:'network',input:{networks:{demo:{type:'edr-simulated',chainType:'op'}}}},
{name:'invalid mining interval',target:'network',input:{networks:{demo:{type:'edr-simulated',chainType:'op',mining:{interval:[100,500]}}}}},
{name:'valid compiler string',target:'solidity',input:{solidity:'0.8.34'}},
{name:'valid compiler settings',target:'solidity',input:{solidity:{version:'0.8.34',settings:{optimizer:{enabled:true,runs:200}}}}},
{name:'incompatible compiler configuration',target:'solidity',input:{solidity:{version:'0.8.34',compilers:[{version:'0.8.34'}]}}},
{name:'valid compiler profiles',target:'solidity',input:{solidity:{profiles:{default:{version:'0.8.34'}}}}},
{name:'missing default compiler profile',target:'solidity',input:{solidity:{profiles:{fictional:{version:'0.8.34'}}}}},
{name:'invalid source paths',target:'solidity',input:{paths:{sources:[42]}}}
];
const results=[];
for(const [profile,root] of [['baseline',baseline],['candidate',candidate]]){
const require=createRequire(join(root,'package.json')),hh=join(root,'node_modules/hardhat/dist/src/internal/builtin-plugins');
const {validateNetworkUserConfig}=await import(pathToFileURL(join(hh,'network-manager/type-validation.js')));
const {validateSolidityUserConfig}=await import(pathToFileURL(join(hh,'solidity/config.js')));
const helper=require.resolve('@nomicfoundation/hardhat-zod-utils'),hr=createRequire(helper);
const zodVersion=hr('zod/package.json').version,{z}=await import(pathToFileURL(hr.resolve('zod')));
const observations=[];
for(const fixture of fixtures){let errors=null,thrown=null;try{errors=await (fixture.target==='network'?validateNetworkUserConfig:validateSolidityUserConfig)(fixture.input);}catch(e){thrown={name:e.name,message:e.message};}observations.push({name:fixture.name,errors,thrown});}
let visited=0;const small=z.array(z.preprocess(v=>{visited++;return v;},z.string())).max(2).safeParse([1,2,3]);assert.equal(small.success,false);
results.push({profile,hardhatVersion:require('hardhat/package.json').version,zodVersion,helperSha256:hash(await readFile(helper)),observations,boundedSizeCheck:{elements:3,limit:2,elementVisits:visited,issues:small.error.issues.length}});
}
const comparisons=fixtures.map((fixture,index)=>{const before=results[0].observations[index],after=results[1].observations[index];return {name:fixture.name,baselineThrew:before.thrown!==null,candidateThrew:after.thrown!==null,bothAccepted:before.errors?.length===0&&after.errors?.length===0,pathsMatch:before.errors!==null&&after.errors!==null&&JSON.stringify(before.errors.map(e=>e.path))===JSON.stringify(after.errors.map(e=>e.path)),messagesMatch:JSON.stringify(before.errors)===JSON.stringify(after.errors)};});
const result={recordedAt:new Date().toISOString(),results,comparisons,allCasesStructurallyCompatible:comparisons.every(c=>!c.baselineThrew&&!c.candidateThrew&&c.pathsMatch),candidateEarlySizeGate:results[1].boundedSizeCheck.elementVisits===0,projectConfigurationLoaded:false,accountOrKeystoreLoaded:false,providersCreated:false,externalRpc:false,signatures:false,fullToolchainCompatibilityProven:false,remediationApproved:false};
await writeFile(join(candidate,'integrated-probe-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
