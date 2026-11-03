import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile,readdir,stat,lstat} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const work='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work';
const repo=join(work,'threecore-wallet-operation-rehearsal-20261029');
const revision='d9044422820973e53fa41e0c55908f6e34217d7f';
const folder='C:/Users/aseet/Downloads/ThreeCore-review-d904442-20261102';
const owned='C:/Users/aseet/AppData/Local/Temp/threecore release '+randomUUID();
const inputs=JSON.parse(await readFile('C:/Users/aseet/Downloads/ThreeCore-runtime-installation-20261102/committed-sources.json','utf8'));
const runtime=JSON.parse(await readFile('C:/Users/aseet/Downloads/ThreeCore-runtime-installation-20261102/paths.json','utf8'));
const compatibility=JSON.parse(await readFile(join(repo,'docs/evidence/2026-11-02-token-dependency-review/wallet-compatibility-receipts.json'),'utf8'));
const buildCommits=JSON.parse(await readFile(join(repo,'docs/evidence/2026-11-02-token-dependency-review/repair-commits.json'),'utf8'));
const {verifySourceCheckpoint}=await import(pathToFileURL(join(repo,'scripts/verify-source-checkpoint.js')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeEnv={PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,SystemDrive:process.env.SystemDrive,TEMP:process.env.TEMP,TMP:process.env.TMP};
async function run(program,args,cwd,options={}){
 return await new Promise((done,reject)=>{
  const child=spawn(program,args,{cwd,env:options.cleanEnv?safeEnv:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill(),options.timeout??180000);
  child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',(code,signal)=>{clearTimeout(timer);if(code!==0)reject(Error(program+' exited '+code+' '+signal+'\n'+stderr.slice(-3000)+'\n'+stdout.slice(-3000)));else done({stdout,stderr,code});});
 });
}
const git=async(cwd,args)=>(await run('git',args,cwd)).stdout.trim();
const writeJson=(dir,name,value)=>writeFile(join(dir,name),JSON.stringify(value,null,2)+'\n');
await mkdir(folder);await mkdir(owned);await mkdir(join(folder,'ThreeCore-Tokens'));
await writeJson(folder,'build-paths.json',{sourceRevision:revision,owned,folder,createdAt:new Date().toISOString()});
async function assertSource(cwd,rev){assert.equal(await git(cwd,['rev-parse','HEAD']),rev);assert.equal(await git(cwd,['status','--porcelain']),'');assert.equal(await git(cwd,['rev-parse','--is-shallow-repository']),'false');}
await assertSource(repo,revision);
async function restoreSource(cwd,rev,out,name){
 await assertSource(cwd,rev);
 const bundle=join(out,name+'-review.bundle'),zip=join(out,name+'-source.zip');
 await run('git',['bundle','create',bundle,'HEAD'],cwd);
 const verified=await run('git',['bundle','verify',bundle],cwd);await writeFile(join(out,'bundle-verification.txt'),verified.stdout+verified.stderr);
 await run('git',['-c','core.autocrlf=false','archive','--format=zip','--output='+zip,rev],cwd);
 const checkout=join(owned,name+' checkout'),exported=join(owned,name+' export');await mkdir(checkout);await mkdir(exported);
 await run('git',['init','-q'],checkout);await run('git',['fetch',bundle,'HEAD'],checkout);await run('git',['checkout','--detach','FETCH_HEAD'],checkout);
 await assertSource(checkout,rev);assert.equal(await git(checkout,['config','--get','core.autocrlf']),'true');
 await run('git',['fsck','--full','--no-dangling'],checkout);
 await run('tar.exe',['-xf',zip,'-C',exported],cwd);
 const source=await verifySourceCheckpoint(cwd,rev,exported);assert.equal(source.allMatched,true,JSON.stringify(source.summary));
 await writeJson(out,'source-verification.json',source);
 return {checkout,exported,source,bundle,zip};
}
async function walletPackage(){
 const restored=await restoreSource(repo,revision,folder,'ThreeCore-Wallet');
 console.log(JSON.stringify({stage:'wallet-source-restored',files:restored.source.summary.files}));
 const {verifyEvidenceCollection}=await import(pathToFileURL(join(restored.checkout,'scripts/evidence-collection.js')));
 const evidence=await verifyEvidenceCollection(restored.checkout);assert(evidence.allMatched);await writeJson(folder,'evidence-verification.json',evidence);
 const historicalRun=await run(process.execPath,['docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs'],restored.checkout,{cleanEnv:true});
 const historical=JSON.parse(historicalRun.stdout);assert.equal(historical.verified,true);await writeFile(join(folder,'historical-verification.json'),historicalRun.stdout);
 const {createDemoServer}=await import(pathToFileURL(join(restored.exported,'examples/dev-server.js')));
 const server=createDemoServer(),checks=[];let origin,closed=false;
 try{
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)});origin='http://127.0.0.1:'+server.address().port;
  for(const [path,file]of [['/','examples/index.html'],['/rehearsal/','examples/operation-rehearsal.html'],['/examples/wallet-entry.js','examples/wallet-entry.js'],['/src/wallet-session.js','src/wallet-session.js'],['/src/file-read-status.js','src/file-read-status.js'],['/src/transfer-vault-collection.js','src/transfer-vault-collection.js'],['/examples/transfer-vault-panel.js','examples/transfer-vault-panel.js']]){
   const response=await fetch(origin+path,{signal:AbortSignal.timeout(10000)}),bytes=Buffer.from(await response.arrayBuffer()),expected=await readFile(join(restored.exported,file));
   const headers=response.headers.get('cache-control')==='no-store'&&response.headers.get('x-frame-options')==='DENY'&&response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'");
   const passed=response.status===200&&bytes.equals(expected)&&headers;checks.push({path,status:response.status,exactSourceBytes:bytes.equals(expected),securityHeadersPresent:headers,passed});assert(passed,path);
  }
  for(const [path,headers,status]of [['/.env',{},404],['/test/browser/',{},404],['/',{Origin:'https://review.invalid'},403]]){
   const response=await fetch(origin+path,{headers,signal:AbortSignal.timeout(10000)});await response.arrayBuffer();checks.push({path,foreignOrigin:Boolean(headers.Origin),status:response.status,passed:response.status===status});assert.equal(response.status,status);
  }
 }finally{const stop=new Promise(done=>server.close(done));server.closeAllConnections();await stop;closed=true;await writeJson(folder,'startup-verification.json',{sourceRevision:revision,origin,checks,allPassed:checks.length===10&&checks.every(x=>x.passed),ownServerClosed:closed,realWalletUsed:false,browserNavigationTested:false});}
 await assertSource(restored.checkout,revision);
 console.log(JSON.stringify({stage:'wallet-checks-passed',manifests:evidence.summary.manifests,evidenceFiles:evidence.summary.files,startup:checks.length}));
 return {sourceRevision:revision,sourceSummary:restored.source.summary,evidenceSummary:evidence.summary,historical,startupChecksPassed:checks.length,ownServerClosed:closed,restoredWindowsAutocrlf:true,sourceArchiveAutocrlf:false,bundleRestoredIntoEmptyRepository:true,completeHistoryVerified:true};
}
async function tokenPackage(row){
 const token=row.token,cwd=join(work,'token-dependency-repair-'+token+'-20261102'),out=join(folder,'ThreeCore-Tokens',token);await mkdir(out);
 const restored=await restoreSource(cwd,row.commit,out,token);
 const rel=relative(owned,resolve(restored.checkout));assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));
 const install=await run(process.execPath,[runtime.npm,'ci','--offline','--omit=dev','--omit=optional','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--cache='+runtime.cache,'--userconfig='+runtime.userconfig,'--globalconfig='+runtime.globalconfig],restored.checkout,{cleanEnv:true});
 await writeFile(join(out,'restored-runtime-install.log'),install.stdout+install.stderr);
 const modules=Object.entries(JSON.parse(await readFile(join(restored.checkout,'node_modules/.package-lock.json'),'utf8')).packages).map(([name,p])=>({name,version:p.version}));assert.equal(modules.length,19);assert(!modules.some(x=>/\/(hardhat|solc|typescript|zod)$/.test(x.name)));
 console.log(JSON.stringify({stage:'token-runtime-restored',token,packages:modules.length,existingModulesReused:false,offlineCacheUsed:true}));
 const cli=await run(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1','test/canonical-state-cli.test.mjs','test/onchain-identity-cli.test.mjs','test/history-cli.test.mjs'],restored.checkout,{cleanEnv:true,timeout:240000});
 await writeFile(join(out,'restored-cli-verification.log'),cli.stdout+cli.stderr);assert.match(cli.stdout,/# tests 30\b/);assert.match(cli.stdout,/# pass 30\b/);assert.match(cli.stdout,/# fail 0\b/);
 await assertSource(restored.checkout,row.commit);
 const previous=compatibility.receipts.find(x=>x.name===token),build=buildCommits.commits.find(x=>x.name===token);
 const oldLockText=(await run('git',['show',build.revision+':package-lock.json'],cwd)).stdout;
 assert.equal(sha(Buffer.from(oldLockText)),previous.packageLockSha256,'Original verified lock bytes');
 const oldLock=JSON.parse(oldLockText),newLock=JSON.parse(await readFile(join(restored.exported,'package-lock.json'),'utf8'));
 const strip=entry=>Object.fromEntries(Object.entries(entry).filter(([key])=>!['dev','devOptional','optional','peer'].includes(key)));
 assert.deepEqual(Object.keys(oldLock.packages).sort(),Object.keys(newLock.packages).sort());
 for(const name of Object.keys(oldLock.packages).filter(Boolean))assert.deepEqual(strip(newLock.packages[name]),strip(oldLock.packages[name]),'Dependency graph changed: '+name);
 assert.equal(await git(cwd,['diff','--name-only',build.revision,row.commit,'--','contracts','hardhat.config.ts','tsconfig.json']),'');
 const contract=token+'Core',artifact=await readFile(join(cwd,'artifacts/contracts/'+contract+'.sol/'+contract+'.json'));assert.equal(sha(artifact),previous.artifactSha256);await writeFile(join(out,contract+'.json'),artifact);
 for(const file of ['DEPENDENCY_SECURITY_2026-11-02.md','docs/READ_ONLY_RUNTIME_2026-11-02.md','docs/HISTORY_CLI_2026-11-02.md'])await copyFile(join(restored.exported,file),join(out,file.split('/').at(-1)));
 const receipt={token,revision:row.commit,sourceSummary:restored.source.summary,bundleRestoredOfflineIntoEmptyRepository:true,restoredHistoryComplete:true,gitFsckPassed:true,restoredWindowsAutocrlf:true,sourceArchiveAutocrlf:false,restoredWorkingTreeClean:true,restoredCliCasesPassed:30,restoredCliCasesFailed:0,existingNodeModulesReused:false,freshRuntimeInstall:true,npmOfflineMode:true,preexistingNpmPackageCacheUsed:true,npmDependenciesVendored:false,networkFreeBuildClaimed:false,installedRuntimePackages:modules,previousVerifiedBuildRevision:build.revision,previousVerifiedLockSha256:previous.packageLockSha256,currentLockSha256:sha(await readFile(join(restored.exported,'package-lock.json'))),lockBytesUnchanged:false,packageVersionsResolutionIntegrityUnchanged:true,contractBuildSourcesUnchanged:true,artifactMatchesPreviouslyVerifiedBuild:true,artifactSha256:previous.artifactSha256,compilerAndRuntimeArtifactsRebuilt:false,fullRegressionRerun:false,realWalletUsed:false,publicRpcRequested:false};
 await writeJson(out,'receipt.json',receipt);await manifest(out);
 console.log(JSON.stringify({stage:'token-package-passed',token,sourceFiles:restored.source.summary.files,cliPassed:30}));return receipt;
}
async function listFiles(root,prefix=''){
 const names=[];for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())names.push(...await listFiles(root,name+'/'));else{assert(entry.isFile());names.push(name);}}return names;
}
async function manifest(root){const names=(await listFiles(root)).filter(name=>name!=='SHA256SUMS.txt').sort();const lines=[];for(const name of names)lines.push(sha(await readFile(join(root,name)))+'  '+name);await writeFile(join(root,'SHA256SUMS.txt'),lines.join('\n')+'\n');return names.length;}
const walletTask=walletPackage();walletTask.catch(()=>{});
const tokens=[];
for(let i=0;i<inputs.length;i+=2){const batch=await Promise.allSettled(inputs.slice(i,i+2).map(tokenPackage));for(const result of batch){if(result.status==='rejected')throw result.reason;tokens.push(result.value);}}
const walletResult=await walletTask;
for(const row of inputs)await assertSource(join(work,'token-dependency-repair-'+row.token+'-20261102'),row.commit);await assertSource(repo,revision);
const receipt={schema:'threecore.offline-review-package.v2',recordedAt:new Date().toISOString(),node:process.version,npm:'11.17.0',...walletResult,applicationSourceRevision:'34d173112d7f45475c52fb64553cfa8b369699d2',tokenPackage:{tokens},fullSuitesFromEarlierEvidence:{nodeHttp:16451,syntheticBrowser:1021,tokenReadOnlyEach:213,rerunForThisPackaging:false},updatesIncluded:['history CLI input validation and provider-error redaction','runtime viem dependency classification and minimal installation','bounded incompatible Zod major-version probe'],remainingDevelopmentAdvisory:'GHSA-mrhx-c7xc-m3w5',realWalletAcceptanceComplete:false,independentReviewComplete:false,publicGitHubChanged:false,original4231Restarted:false,signaturesPerformed:false,transactionsPerformed:false,percentageCalculated:false};
await writeJson(folder,'package-receipt.json',receipt);
await writeFile(join(folder,'はじめに_README.txt'),`ThreeCore 開発・検証の統合保存版 / 2026年11月2日\n\n固定版: ${revision}\n\nThreeCore-Wallet-source.zip：Walletソースと検証資料。\nThreeCore-Wallet-review.bundle：ネット接続なしで復元できるGit履歴。\nThreeCore-Tokens：DAT・EMA・CAWELONのソース、Git履歴、以前に検証したコンパイル成果物と照合記録。\npackage-receipt.json：この保存版の検証結果と対象の版番号。\nSHA256SUMS.txt：全ファイルの照合値。\n\n今回含めた修正：\n・履歴コマンドが不正な入力を通信前に拒否し、接続先の詳しいエラーをそのまま表示しないよう修正。\n・読み取りコマンドに必要な部品の分類を修正し、開発用部品を入れない配布構成でも起動可能に。\n・開発用Zodを大きな版へ差し替える案は互換性問題を再現したため不採用。未解決として記録。\n\nこの保存版の確認：\n・Walletソース${walletResult.sourceSummary.files}ファイル、証拠${walletResult.evidenceSummary.manifests}一覧/${walletResult.evidenceSummary.files}件が一致。\n・空のGit保存先から完全な履歴を復元し、Windowsの通常の改行設定で確認。\n・一時サーバーの起動・応答10件を確認し、そのサーバーのみ終了済み。\n・3トークンを別々の空の保存先へ復元。各保存先に必要な19部品を新規導入し、読み取りCLI検証30件ずつに成功。既存node_modulesは共有していません。\n・今回の導入は既に取得したnpmキャッシュを使ったofflineモードです。依存部品をこのZIPに同梱したわけではありません。\n・全体回帰や実ウォレットの検証を今回再実行したという意味ではありません。以前の対象版と結果はソース内の記録をご覧ください。\n\n空のフォルダーで読み取り専用コマンドを準備する場合：\n  npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund\n  node --test --test-concurrency=2 test/*.test.mjs\n通常は公開npmレジストリへの通信が必要です。キャッシュのないPCでの完全オフライン構築は保証しません。\n\n未完了：\n既存2口座による3トークンの実Wallet受入れ、元ブラウザのファイル選択、実Wallet移行・復帰、開発用Zodの互換更新、独立レビューと公開判断。90%達成や公開承認を示す保存版ではありません。\n\n元の4231サーバー、Wallet・運用リハーサルのタブ、以前の保存ファイルを上書きしないでください。署名・送金を行う保存版ではありません。\n詳しくはソース内の docs/RELEASE_HANDOFF_2026-11-02.md、docs/READ_ONLY_RUNTIME_2026-11-02.md、docs/ZOD_COMPATIBILITY_2026-11-02.md をお読みください。\n\nOffline Git restore (NEW folder only):\n  git init threecore-review\n  git -C threecore-review fetch <path-to-ThreeCore-Wallet-review.bundle> HEAD\n  git -C threecore-review checkout --detach FETCH_HEAD\n  git -C threecore-review rev-parse HEAD\nCompare the exact revision above. Node 22 or newer is required.\nInside the restored Git checkout:\n  node scripts/verify-evidence-collection.js .\n  node docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs\nChecksums detect corruption; they do not authenticate a publisher.\n`);
const entries=await manifest(folder);console.log(JSON.stringify({stage:'package-complete',folder,revision,manifestEntries:entries,tokenCliPassedEach:30}));
