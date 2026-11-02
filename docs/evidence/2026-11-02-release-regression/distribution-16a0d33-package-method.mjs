import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const work='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work',repo=join(work,'threecore-wallet-operation-rehearsal-20261029');
const revision='16a0d33b6af6c735c5d690e63a8b629bbabf867c',folder='C:/Users/aseet/Downloads/ThreeCore-review-16a0d33-20261102';
const owned='C:/Users/aseet/AppData/Local/Temp/threecore release '+randomUUID();
const input=JSON.parse(await readFile(join(repo,'docs/evidence/2026-11-02-token-dependency-review/source-results.json'),'utf8')).tokens;
const comparisons=JSON.parse(await readFile(join(repo,'docs/evidence/2026-11-02-token-dependency-review/source-comparison.json'),'utf8')).comparisons;
const runtime=JSON.parse(await readFile('C:/Users/aseet/Downloads/ThreeCore-runtime-installation-20261102/paths.json','utf8'));
const {verifySourceCheckpoint}=await import(pathToFileURL(join(repo,'scripts/verify-source-checkpoint.js')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|systemdrive|windir|temp|tmp|comspec|pathext)$/i.test(key)));
async function run(program,args,cwd,{timeout=180000,allowFailure=false,log}={}){
 const started=new Date().toISOString();
 return await new Promise((done,reject)=>{
  const child=spawn(program,args,{cwd,env:safeEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill(),timeout);
  child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  child.on('error',error=>{clearTimeout(timer);reject(error)});
  child.on('close',async(code,signal)=>{clearTimeout(timer);if(log)await writeFile(log,stdout+stderr);const result={started,finished:new Date().toISOString(),stdout,stderr,code,signal};if(code!==0&&!allowFailure)reject(Error(program+' exited '+code+' '+stderr.slice(-1500)+' '+stdout.slice(-1500)));else done(result);});
 });
}
const git=async(cwd,args)=>(await run('git',args,cwd)).stdout.trim();
const json=(dir,name,data)=>writeFile(join(dir,name),JSON.stringify(data,null,2)+'\n');
await mkdir(folder);await mkdir(owned);await mkdir(join(folder,'ThreeCore-Tokens'));
await json(folder,'build-paths.json',{revision,owned,folder,createdAt:new Date().toISOString()});
async function assertSource(cwd,rev){assert.equal(await git(cwd,['rev-parse','HEAD']),rev);assert.equal(await git(cwd,['status','--porcelain']),'');assert.equal(await git(cwd,['rev-parse','--is-shallow-repository']),'false');}
async function restoreSource(cwd,rev,out,name){
 await assertSource(cwd,rev);
 const bundle=join(out,name+'-review.bundle'),zip=join(out,name+'-source.zip');
 await run('git',['bundle','create',bundle,'HEAD'],cwd);
 await run('git',['bundle','verify',bundle],cwd,{log:join(out,'bundle-verification.txt')});
 await run('git',['-c','core.autocrlf=false','archive','--format=zip','--output='+zip,rev],cwd);
 const checkout=join(owned,name+' checkout'),exported=join(owned,name+' export');await mkdir(checkout);await mkdir(exported);
 await run('git',['init','-q'],checkout);await run('git',['config','core.autocrlf','true'],checkout);await run('git',['fetch',bundle,'HEAD'],checkout);await run('git',['checkout','--detach','FETCH_HEAD'],checkout);
 await assertSource(checkout,rev);await run('git',['fsck','--full','--no-dangling'],checkout);
 await run('tar.exe',['-xf',zip,'-C',exported],cwd);
 const source=await verifySourceCheckpoint(cwd,rev,exported);assert(source.allMatched,JSON.stringify(source.summary));await json(out,'source-verification.json',source);
 return {checkout,exported,source};
}
async function walletPackage(){
 const restored=await restoreSource(repo,revision,folder,'ThreeCore-Wallet');console.log(JSON.stringify({stage:'wallet-source-restored',files:restored.source.summary.files}));
 const {verifyEvidenceCollection}=await import(pathToFileURL(join(restored.checkout,'scripts/evidence-collection.js')));
 const evidence=await verifyEvidenceCollection(restored.checkout);assert(evidence.allMatched);await json(folder,'evidence-verification.json',evidence);
 const historical=await run(process.execPath,['docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs'],restored.checkout);assert.equal(JSON.parse(historical.stdout).verified,true);await writeFile(join(folder,'historical-verification.json'),historical.stdout);
 const {createDemoServer}=await import(pathToFileURL(join(restored.exported,'examples/dev-server.js')));
 const server=createDemoServer(),checks=[];let origin,closed=false;
 try{
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)});origin='http://127.0.0.1:'+server.address().port;
  for(const[path,file]of [['/','examples/index.html'],['/rehearsal/','examples/operation-rehearsal.html'],['/examples/wallet-entry.js','examples/wallet-entry.js'],['/src/wallet-session.js','src/wallet-session.js'],['/src/file-read-status.js','src/file-read-status.js'],['/src/transfer-vault-collection.js','src/transfer-vault-collection.js'],['/examples/transfer-vault-panel.js','examples/transfer-vault-panel.js']]){
   const response=await fetch(origin+path,{signal:AbortSignal.timeout(10000)}),bytes=Buffer.from(await response.arrayBuffer()),expected=await readFile(join(restored.exported,file));
   const headers=response.headers.get('cache-control')==='no-store'&&response.headers.get('x-frame-options')==='DENY'&&response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'");
   const passed=response.status===200&&bytes.equals(expected)&&headers;checks.push({path,status:response.status,exactSourceBytes:bytes.equals(expected),securityHeadersPresent:headers,passed});assert(passed,path);
  }
  for(const[path,headers,status]of [['/.env',{},404],['/test/browser/',{},404],['/',{Origin:'https://review.invalid'},403]]){const response=await fetch(origin+path,{headers,signal:AbortSignal.timeout(10000)});await response.arrayBuffer();checks.push({path,status:response.status,foreignOrigin:Boolean(headers.Origin),passed:response.status===status});assert.equal(response.status,status);}
 }finally{const stop=new Promise(done=>server.close(done));server.closeAllConnections();await stop;closed=true;await json(folder,'startup-verification.json',{revision,origin,checks,allPassed:checks.length===10&&checks.every(c=>c.passed),ownServerClosed:closed,realWalletUsed:false,browserNavigationTested:false});}
 await assertSource(restored.checkout,revision);console.log(JSON.stringify({stage:'wallet-restoration-passed',files:restored.source.summary.files,evidence:evidence.summary.files,startup:checks.length}));
 return {sourceRevision:revision,sourceSummary:restored.source.summary,evidenceSummary:evidence.summary,historical:JSON.parse(historical.stdout),startupChecksPassed:checks.length,ownServerClosed:closed,completeHistoryVerified:true,windowsCheckoutAutocrlf:true};
}
async function tokenPackage(row){
 const token=row.token,cwd=join(work,'token-dependency-repair-'+token+'-20261102'),out=join(folder,'ThreeCore-Tokens',token);await mkdir(out);
 const restored=await restoreSource(cwd,row.commit,out,token),rel=relative(owned,resolve(restored.checkout));assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));
 const contract=token+'Core',sourcePath='contracts/'+contract+'.sol';
 assert.equal(sha(await readFile(join(restored.checkout,sourcePath))),row.sourceSha256);
 const install=await run(process.execPath,[runtime.npm,'ci','--offline','--omit=dev','--omit=optional','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--cache='+runtime.cache,'--userconfig='+runtime.userconfig,'--globalconfig='+runtime.globalconfig],restored.checkout,{log:join(out,'restored-runtime-install.log')});
 const modules=Object.entries(JSON.parse(await readFile(join(restored.checkout,'node_modules/.package-lock.json'),'utf8')).packages).map(([name,p])=>({name,version:p.version}));assert.equal(modules.length,19);assert(!modules.some(m=>/\/(hardhat|solc|typescript|zod)$/.test(m.name)));
 console.log(JSON.stringify({stage:'minimal-runtime-installed',token,packages:modules.length}));
 const cliFiles=['test/canonical-state-cli.test.mjs','test/onchain-identity-cli.test.mjs','test/history-cli.test.mjs','test/read-only-http.test.mjs','integration/source-portability.test.mjs','integration/test-routing.test.mjs'];
 if(token==='DAT')cliFiles.push('test/sepolia-verifier-cli.test.mjs');
 const cli=await run(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',...cliFiles],restored.checkout,{timeout:240000,log:join(out,'restored-cli-verification.log')});
 const tests=Number(cli.stdout.match(/^# tests (\d+)$/m)?.[1]),passes=Number(cli.stdout.match(/^# pass (\d+)$/m)?.[1]);assert(tests>30&&tests===passes);assert.match(cli.stdout,/# fail 0\b/);
 const comparison=comparisons.find(c=>c.token===token),artifact=await readFile(join(cwd,'artifacts/'+sourcePath+'/'+contract+'.json'));assert.equal(sha(artifact),comparison.artifactSha256);await writeFile(join(out,contract+'.json'),artifact);
 assert.deepEqual(artifact,await readFile(join(repo,'docs/evidence/2026-11-02-token-dependency-review/source-'+token+'-artifact.json')));
 let publicObservation=null;
 if(token==='DAT'){
  const reference='deployments/reference/DATCore-base-sepolia.json';assert.equal(sha(await readFile(join(restored.checkout,reference))),sha(await readFile(join(cwd,reference))));
  const live=await run(process.execPath,['scripts/verify-base-sepolia.js'],restored.checkout,{allowFailure:true,timeout:180000});
  publicObservation={...live,endpoint:'https://sepolia.base.org',minimalRuntime:true,defaultReferenceUsed:true,signatureCreated:false,transactionSent:false};
  if(live.code===0){publicObservation.report=JSON.parse(live.stdout);assert.equal(publicObservation.report.result,'PASS');assert.equal(publicObservation.report.checkpointBlockNumber,'46922886');}
  await json(out,'restored-public-sepolia.json',publicObservation);
 }
 for(const file of ['DEPENDENCY_SECURITY_2026-11-02.md','docs/READ_ONLY_RUNTIME_2026-11-02.md','docs/SOURCE_PORTABILITY_2026-11-02.md','docs/RPC_BODY_DEADLINE_2026-11-02.md'])await copyFile(join(restored.exported,file),join(out,file.split('/').at(-1)));
 if(token==='DAT')await copyFile(join(restored.exported,'docs/SEPOLIA_VERIFIER_2026-11-02.md'),join(out,'SEPOLIA_VERIFIER_2026-11-02.md'));
 await assertSource(restored.checkout,row.commit);await assertSource(cwd,row.commit);
 const receipt={token,revision:row.commit,sourceSummary:restored.source.summary,restoredSourceSha256:row.sourceSha256,completeHistoryVerified:true,restoredWorkingTreeClean:true,windowsCheckoutAutocrlf:true,restoredCliCasesPassed:tests,restoredCliCasesFailed:0,installedRuntimePackages:modules,existingNodeModulesReused:false,freshRuntimeInstall:true,npmOfflineMode:true,preexistingNpmPackageCacheUsed:true,npmDependenciesVendored:false,networkFreeBuildClaimed:false,artifactSourceRevision:row.commit,artifactSha256:comparison.artifactSha256,artifactMatchesRecordedSourceBuild:true,artifactCopiedFromEarlierBuildThisTurn:true,artifactRebuiltDuringPackaging:false,metadataChangedFromPreviousDistribution:true,publicHistoricalCheckPassed:publicObservation?publicObservation.code===0:null,realWalletUsed:false};
 await json(out,'receipt.json',receipt);await manifest(out);console.log(JSON.stringify({stage:'token-restoration-passed',token,tests,publicHistoricalCheckPassed:receipt.publicHistoricalCheckPassed}));return receipt;
}
async function files(root,prefix=''){const output=[];for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())output.push(...await files(root,name+'/'));else{assert(entry.isFile());output.push(name);}}return output;}
async function manifest(root){const names=(await files(root)).filter(n=>n!=='SHA256SUMS.txt').sort(),lines=[];for(const name of names)lines.push(sha(await readFile(join(root,name)))+'  '+name);await writeFile(join(root,'SHA256SUMS.txt'),lines.join('\n')+'\n');return names.length;}
const walletTask=walletPackage();walletTask.catch(()=>{});const tokens=[];
for(let i=0;i<input.length;i+=2){const batch=await Promise.allSettled(input.slice(i,i+2).map(tokenPackage));for(const result of batch){if(result.status==='rejected')throw result.reason;tokens.push(result.value);}}
const walletResult=await walletTask;await assertSource(repo,revision);
const receipt={schema:'threecore.offline-review-package.v3',recordedAt:new Date().toISOString(),node:process.version,...walletResult,applicationSourceRevision:'34d173112d7f45475c52fb64553cfa8b369699d2',tokenPackage:{tokens},updatesIncluded:['bounded response-body deadlines in all operational readers','strict historical Sepolia verifier and included matching reference','LF source portability with normal-build artifact reproduction','test discovery routing and sequential operational tests'],remainingDevelopmentAdvisory:'GHSA-mrhx-c7xc-m3w5',realWalletAcceptanceComplete:false,independentReviewComplete:false,publicGitHubChanged:false,original4231Restarted:false,percentageCalculated:false};
await json(folder,'package-receipt.json',receipt);
await writeFile(join(folder,'はじめに_README.txt'),`ThreeCore 開発・検証の統合保存版 / 2026年11月2日\n\n固定版: ${revision}\nWallet実装: 34d173112d7f45475c52fb64553cfa8b369699d2\n\nThreeCore-Wallet-source.zip：Walletのソースと検証資料。\nThreeCore-Wallet-review.bundle：Git履歴。\nThreeCore-Tokens：3トークンのソース、Git履歴、今回のLFビルド成果物と照合記録。\npackage-receipt.json：対象版と確認結果。SHA256SUMS.txt：ファイル照合値。\n\n追加修正：\n・通信ヘッダー後に応答が止まっても時間制限が働くよう修正。\n・過去のSepolia検証で通信エラーを成功としないよう修正。\n・3トークンの改行を統一し、DATの通常ビルドが記録済み参照データと一致。\n・検証用補助ファイルの誤実行と検証の重複を修正。\n\n復元確認：Wallet ${walletResult.sourceSummary.files}ファイル、証拠${walletResult.evidenceSummary.manifests}一覧/${walletResult.evidenceSummary.files}記録が一致。別の一時サーバーの起動・応答10件に成功し、そのサーバーは終了済み。\n3トークンのGit履歴を空のフォルダーへ復元。各19部品を個別導入し、${tokens.map(t=>t.token+' '+t.restoredCliCasesPassed+'件').join('、')}の選択したCLI・ソース検証に成功。既存node_modulesは共有していません。\nDATの復元後の公開履歴確認: ${tokens.find(t=>t.token==='DAT').publicHistoricalCheckPassed?'PASS（ブロック46,922,886。現在残高の確認ではありません）':'未確定。restored-public-sepolia.jsonを確認してください'}。\n今回の導入は既存npmキャッシュを用いたofflineモードです。依存部品は同梱しておらず、キャッシュのないPCでは通常npmへの接続が必要です。\n\n読み取り用の準備：ThreeCore-Tokens内の対象source.zipを新規フォルダーへ展開し、そのフォルダーで実行します。\n  npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund\n契約のコンパイルやnpm run checkには開発用の依存部品も必要です。既存プロジェクトや保存データを上書きしないでください。\n\n未完了：実Wallet受入れ、元ブラウザでのファイル選択と移行・復帰、開発用Zodの互換更新/影響確認、独立レビュー、公開判断。90%達成や公開承認の証明ではありません。\n原本の4231サーバーとWallet・運用リハーサルを変更せずに確認してください。\n\nOffline Git restore (NEW folder only):\n  git init threecore-review\n  git -C threecore-review fetch <path-to-ThreeCore-Wallet-review.bundle> HEAD\n  git -C threecore-review checkout --detach FETCH_HEAD\n  git -C threecore-review rev-parse HEAD\nCompare the revision above. Use Node 22 or newer. In the restored checkout:\n  node scripts/verify-evidence-collection.js .\n  node docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs\nChecksums detect corruption; they do not authenticate a publisher.\n`);
const count=await manifest(folder);console.log(JSON.stringify({stage:'package-complete',folder,revision,manifestEntries:count,tokens:tokens.map(t=>({token:t.token,tests:t.restoredCliCasesPassed}))}));
