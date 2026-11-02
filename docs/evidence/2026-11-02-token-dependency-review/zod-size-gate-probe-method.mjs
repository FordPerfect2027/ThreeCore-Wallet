import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const base='C:/Users/aseet/AppData/Local/Temp/threecore-zod-compatibility-9a317ddc-6dbe-49df-bf43-13ff25e38f9b';
const roots=[{label:'v3 installed',folder:base+'/baseline',module:'zod',expected:'3.25.76'},
 {label:'v4 patched',folder:base+'/candidate',module:'zod',expected:'4.6.6'},
 {label:'v3 compatibility export in patched package',folder:base+'/candidate',module:'zod/v3',expected:'4.6.6'}];
const sha=b=>createHash('sha256').update(b).digest('hex');
const rows=[];
for(const item of roots){
 const require=createRequire(join(item.folder,'package.json')),pkg=require('zod/package.json');
 assert.equal(pkg.version,item.expected);
 const z=require(item.module),entry=require.resolve(item.module);
 const samples=[];
 for(const n of [2,3,64])for(const bounded of [false,true]){
  let visited=0;
  const element=z.preprocess(value=>{visited++;return value;},z.string());
  const array=z.array(element),schema=bounded?array.max(2):array;
  const input=Array.from({length:n},(_,i)=>i);
  const result=schema.safeParse(input);assert.equal(result.success,false);
  const issues=result.error.issues;
  const cappedV4=item.module==='zod'&&pkg.version==='4.6.6'&&bounded&&n>2;
  assert.equal(visited,cappedV4?0:n);
  assert.equal(issues.length,cappedV4?1:n+(bounded&&n>2?1:0));
  samples.push({inputItems:n,configuredMaximum:bounded?2:null,visitedElements:visited,issues:issues.length,
    issueCodes:[...new Set(issues.map(x=>x.code))]});
 }
 const valid=z.array(z.string()).max(2).safeParse(['a','b']);assert.equal(valid.success,true);
 rows.push({label:item.label,installedPackageVersion:pkg.version,moduleSpecifier:item.module,
 entrySha256:sha(readFileSync(entry)),packageLockSha256:sha(readFileSync(join(item.folder,'package-lock.json'))),
 validAtLimitAccepted:true,samples});
}
const result={schema:'threecore.zod-boundary-export-probe.v1',recordedAt:new Date().toISOString(),
 upstreamFix:'https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd',
 maximumInputItems:64,rows,conclusions:{v4MaximumRejectsBeforeElementParsing:true,
 v4UnconstrainedArrayStillVisitsEveryElement:true,v3CompatibilityExportDoesNotApplyTheV4SizeGate:true,
 packageVersionAloneNotARemediationOfUnboundedSchemas:true},
 dependencyInstallationsChanged:false,projectSourcesChanged:false,realNetworkExploitAttempted:false,
 configurationLoaded:false,keystoreLoaded:false,walletUsed:false,
 fullHardhatCompatibilityEstablished:false,advisoryClosed:false};
writeFileSync('C:/Users/aseet/Downloads/ThreeCore-zod-boundary-export-probe-20261102.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
