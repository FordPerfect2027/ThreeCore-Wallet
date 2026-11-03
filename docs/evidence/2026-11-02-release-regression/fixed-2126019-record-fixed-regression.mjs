import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const dir=dirname(fileURLToPath(import.meta.url));
const revision='212601977bc6dad8da298f11ebb9e7a421052571';
const previousRegression='e5841f0d1b412b516b3e3eb4a81d75eabaf81edd';
const checkout='C:/Users/aseet/AppData/Local/Temp/threecore review dcee74dd-1b85-49e8-b5ad-e0a958064208/wallet checkout';
const readJson=async name=>JSON.parse((await readFile(join(dir,name),'utf8')).replace(/^\uFEFF/,''));
function git(...args){const r=spawnSync('git',args,{cwd:checkout,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});if(r.status!==0)throw Error('Git failed: '+args[0]);return r.stdout.trim();}
const before=await readJson('node-start.json'), nodeResult=await readJson('node-result.json'), browserStart=await readJson('browser-start.json'), browserResult=await readJson('browser-result.json');
if(before.sourceRevision!==revision||browserStart.sourceRevision!==revision||git('rev-parse','HEAD')!==revision||git('status','--porcelain'))throw Error('Fixed source identity or clean checkout assertion failed');
if(nodeResult.exitCode!==0||browserResult.exitCode!==0)throw Error('Full regression did not pass');
const tap=await readFile(join(dir,'node-full.log'),'utf8');
const totals={};for(const field of ['tests','suites','pass','fail','cancelled','skipped','todo','duration_ms']){const matches=[...tap.matchAll(new RegExp('^# '+field+' ([0-9.]+)\\r?$','gm'))];if(matches.length!==1)throw Error('Missing or ambiguous TAP total '+field);totals[field]=Number(matches[0][1]);}
if(totals.tests!==16454||totals.pass!==totals.tests||['fail','cancelled','skipped','todo'].some(k=>totals[k]!==0))throw Error('Unexpected full Node result');
const browser=await readFile(join(dir,'browser-full.log'),'utf8');
for(const required of ['Browser module preflight passed: 261 local modules.','Browser shard 1/2: 511 cases passed.','Browser shard 2/2: 510 cases passed.','1021 browser UI tests passed with a synthetic provider and no external RPC.'])if(!browser.includes(required))throw Error('Missing browser completion evidence: '+required);
const sourceChanges=git('diff','--name-only',previousRegression,revision,'--','src','examples','scripts','test','integration').split(/\r?\n/).filter(Boolean);
const packageFile='C:/Users/aseet/Downloads/ThreeCore-review-2126019-20261102.zip';const packageBytes=await readFile(packageFile);const packageHash=createHash('sha256').update(packageBytes).digest('hex');if(packageHash!=='a938e26ed7c572962c32decf0cc452654caeed58f5514be9ae41418c9ad605ea')throw Error('Fixed review package changed');
const files=['node-start.json','node-result.json','node-full.log','browser-start.json','browser-result.json','browser-full.log','public-pr-and-release-status.json','actual-switch-followup.json','record-fixed-regression.mjs'];const evidence=[];for(const name of files){const bytes=await readFile(join(dir,name));evidence.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
const summary={schema:'threecore.fixed-candidate-full-regression.v1',recordedAt:new Date().toISOString(),sourceRevision:revision,applicationRevision:'8fa0ed2739482b8df415e46c6c45491955d4bfc4',previousFullRegression:previousRegression,restoredFromStandaloneReviewBundle:true,checkoutCleanAfterChecks:true,nodeVersion:before.node,node:{...nodeResult,command:before.command,...totals},browser:{...browserResult,command:browserStart.command,passed:1021,shards:[511,510],modulePreflight:261,isolatedSyntheticProvider:true,externalRpc:false,ownProfilesCleaned:true,runs:1},implementationChangesSincePreviousFullRegression:sourceChanges,reviewPackage:{path:packageFile,bytes:packageBytes.length,sha256:packageHash},evidence,limits:{actualWalletSwitchVerified:false,nativeOsFilePickerVerified:false,developmentZodFindingResolved:false,independentReviewCompleted:false,publicReleaseApproved:false,remoteCiRerun:false,githubWrites:false,userWalletSignatureOrTransaction:false}};
await writeFile(join(dir,'fixed-regression-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({sourceRevision:revision,nodePassed:totals.pass,browserPassed:1021,clean:true,summary:join(dir,'fixed-regression-summary.json')}));
