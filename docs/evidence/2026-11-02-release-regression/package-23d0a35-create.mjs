import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile,readdir,lstat} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const work='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work';
const repo=join(work,'threecore-wallet-operation-rehearsal-20261029');
const revision='23d0a35b129c32be581bf1a3ffad57e228b9b65c';
const regressionRevision='e5841f0d1b412b516b3e3eb4a81d75eabaf81edd';
const applicationRevision='96b59459a0f593246c60f0bed4b52052211a464a';
const downloads='C:/Users/aseet/Downloads';
const previous=join(downloads,'ThreeCore-review-16a0d33-20261102');
const folder=join(downloads,'ThreeCore-review-23d0a35-20261102');
const owned='C:/Users/aseet/AppData/Local/Temp/threecore release '+randomUUID();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|systemdrive|windir|temp|tmp|comspec|pathext)$/i.test(key)));
async function run(program,args,cwd,{timeout=180000,log}={}){
 return await new Promise((done,reject)=>{
  const child=spawn(program,args,{cwd,env:safeEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill(),timeout);
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.on('error',error=>{clearTimeout(timer);reject(error)});
  child.on('close',async(code,signal)=>{
   clearTimeout(timer);if(log)await writeFile(log,stdout+stderr);
   if(code!==0||signal)reject(Error(program+' failed: '+code+' '+signal+' '+stderr.slice(-1200)+' '+stdout.slice(-1200)));
   else done({code,signal,stdout,stderr});
  });
 });
}
const git=async(cwd,args)=>(await run('git',args,cwd)).stdout.trim();
const json=(dir,name,value)=>writeFile(join(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
async function sourceState(cwd,head){
 assert.equal(await git(cwd,['rev-parse','HEAD']),head);
 assert.equal(await git(cwd,['status','--porcelain']),'');
 assert.equal(await git(cwd,['rev-parse','--is-shallow-repository']),'false');
}
async function list(root,prefix=''){
 const files=[];
 for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){
  const name=prefix+entry.name;
  if(entry.isDirectory())files.push(...await list(root,name+'/'));
  else{assert(entry.isFile());files.push(name);}
 }
 return files.sort();
}
async function verifyManifest(root){
 const raw=await readFile(join(root,'SHA256SUMS.txt')),entries=[];let total=0;
 for(const line of raw.toString().trim().split(/\r?\n/)){
  const match=line.match(/^([a-f0-9]{64})  (.+)$/);assert(match);
  const file=resolve(root,match[2]),rel=relative(root,file);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));
  const stat=await lstat(file);assert(stat.isFile()&&!stat.isSymbolicLink());assert(stat.size<=64*1024*1024);
  total+=stat.size;assert(total<=256*1024*1024);
  assert.equal(sha(await readFile(file)),match[1],match[2]);entries.push(match[2]);
 }
 assert.equal(new Set(entries).size,entries.length);
 assert.deepEqual((await list(root)).filter(file=>file!=='SHA256SUMS.txt'),entries.toSorted());
 return {entries:entries.length,totalBytes:total,manifestSha256:sha(raw),allMatched:true};
}
async function makeManifest(root){
 const entries=(await list(root)).filter(file=>file!=='SHA256SUMS.txt'),lines=[];
 for(const file of entries)lines.push(sha(await readFile(join(root,file)))+'  '+file);
 await writeFile(join(root,'SHA256SUMS.txt'),lines.join('\n')+'\n',{flag:'wx'});
 return verifyManifest(root);
}
async function copyTree(from,to){
 await mkdir(to);
 for(const file of await list(from)){
  const target=join(to,file);await mkdir(resolve(target,'..'),{recursive:true});
  await writeFile(target,await readFile(join(from,file)),{flag:'wx'});
 }
}
const fullWallet=await readFile(join(downloads,'ThreeCore-release-e5841f0-wallet-20261102.log'),'utf8');
assert.match(fullWallet,/ℹ tests 16454\b/);assert.match(fullWallet,/ℹ pass 16454\b/);assert.match(fullWallet,/ℹ fail 0\b/);
assert.match(fullWallet,/ℹ cancelled 0\b/);assert.match(fullWallet,/ℹ skipped 0\b/);
const browser=await readFile(join(downloads,'ThreeCore-release-e5841f0-browser-20261102.log'),'utf8');
assert.match(browser,/1021 browser UI tests passed with a synthetic provider and no external RPC/);
await sourceState(repo,revision);
const priorReceipt=JSON.parse(await readFile(join(downloads,'ThreeCore-review-16a0d33-zip-receipt-20261102.json'),'utf8'));
assert.equal(priorReceipt.sha256,'79e5329634c0634e7528a27272a202d553c7101467a146eb82b82e85ee08ed17');
assert.equal(sha(await readFile(previous+'.zip')),priorReceipt.sha256);
const priorManifest=await verifyManifest(previous);
assert.equal(priorManifest.manifestSha256,priorReceipt.after.rootManifestSha256);
await mkdir(folder);await mkdir(owned);
await json(folder,'build-paths.json',{revision,owned,folder,createdAt:new Date().toISOString()});
await copyTree(join(previous,'ThreeCore-Tokens'),join(folder,'ThreeCore-Tokens'));
const tokenReceipts=[];
for(const token of ['DAT','EMA','CAWELON']){
 const target=join(folder,'ThreeCore-Tokens',token),receipt=JSON.parse(await readFile(join(target,'receipt.json'),'utf8'));
 await sourceState(join(work,'token-dependency-repair-'+token+'-20261102'),receipt.revision);
 const checked=await verifyManifest(target);
 tokenReceipts.push({token,revision:receipt.revision,files:checked.entries,bytesMatchPriorPackage:true,
  retainedValidationReceipt:'ThreeCore-Tokens/'+token+'/receipt.json',validationRerunThisPackaging:false});
}
for(const name of ['ZOD-EXPOSURE.json','ZOD-EXPOSURE-METHOD.mjs','ZOD-EXPOSURE.txt','TOOLCHAIN-METADATA.json','TOOLCHAIN-METADATA-METHOD.mjs'])await copyFile(join(previous,name),join(folder,name));
const sourceZip=join(folder,'ThreeCore-Wallet-source.zip'),bundle=join(folder,'ThreeCore-Wallet-review.bundle');
await run('git',['bundle','create',bundle,'HEAD'],repo);
await run('git',['bundle','verify',bundle],repo,{log:join(folder,'bundle-verification.txt')});
await run('git',['-c','core.autocrlf=false','archive','--format=zip','--output='+sourceZip,revision],repo);
const checkout=join(owned,'Wallet checkout'),exported=join(owned,'Wallet export');await mkdir(checkout);await mkdir(exported);
await run('git',['init','-q'],checkout);await run('git',['config','core.autocrlf','true'],checkout);
await run('git',['fetch',bundle,'HEAD'],checkout);await run('git',['checkout','--detach','FETCH_HEAD'],checkout);
await sourceState(checkout,revision);await run('git',['fsck','--full','--no-dangling'],checkout);
await run('tar.exe',['-xf',sourceZip,'-C',exported],repo);
const {verifySourceCheckpoint}=await import(pathToFileURL(join(repo,'scripts/verify-source-checkpoint.js')));
const source=await verifySourceCheckpoint(repo,revision,exported);assert(source.allMatched);await json(folder,'source-verification.json',source);
const {verifyEvidenceCollection}=await import(pathToFileURL(join(checkout,'scripts/evidence-collection.js')));
const evidence=await verifyEvidenceCollection(checkout);assert(evidence.allMatched);await json(folder,'evidence-verification.json',evidence);
const historical=await run(process.execPath,['docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs'],checkout);
assert.equal(JSON.parse(historical.stdout).verified,true);await writeFile(join(folder,'historical-verification.json'),historical.stdout);
console.log(JSON.stringify({stage:'wallet-restored',files:source.summary.files,evidence:evidence.summary.files}));
const {createDemoServer}=await import(pathToFileURL(join(exported,'examples/dev-server.js')));
const {catalogToken}=await import(pathToFileURL(join(exported,'src/token-catalog.js')));
const {TRANSFER_TOPIC}=await import(pathToFileURL(join(exported,'src/transfer-codec.js')));
const upstream=[];
const server=createDemoServer({stateFetch:async(_url,options)=>{upstream.push(JSON.parse(options.body));return Response.json({jsonrpc:'2.0',id:1,result:[]});}});
const checks=[];let origin,closed=false;
try{
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)});origin='http://127.0.0.1:'+server.address().port;
 for(const[path,file]of [['/','examples/index.html'],['/rehearsal/','examples/operation-rehearsal.html'],['/examples/wallet-entry.js','examples/wallet-entry.js'],['/src/wallet-session.js','src/wallet-session.js'],['/src/security-rpc.js','src/security-rpc.js'],['/src/transfer-vault-collection.js','src/transfer-vault-collection.js'],['/examples/transfer-vault-panel.js','examples/transfer-vault-panel.js']]){
  const response=await fetch(origin+path,{signal:AbortSignal.timeout(10000)}),bytes=Buffer.from(await response.arrayBuffer());
  const exact=bytes.equals(await readFile(join(exported,file))),headers=response.headers.get('cache-control')==='no-store'&&response.headers.get('x-frame-options')==='DENY'&&response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'");
  assert(response.status===200&&exact&&headers);checks.push({path,status:response.status,exactSourceBytes:exact,securityHeadersPresent:headers,passed:true});
 }
 for(const[path,headers,status]of [['/.env',{},404],['/test/browser/',{},404],['/',{Origin:'https://review.invalid'},403]]){
  const response=await fetch(origin+path,{headers,signal:AbortSignal.timeout(10000)});await response.arrayBuffer();assert.equal(response.status,status);
  checks.push({path,status:response.status,foreignOrigin:Boolean(headers.Origin),passed:true});
 }
 const account='0x'+'11'.repeat(20),token=catalogToken({agent:'DAT',chainId:8453});
 const request={method:'eth_getLogs',params:[{address:token.address,fromBlock:'0x0',toBlock:'0x7d0',topics:[TRANSFER_TOPIC,null,'0x'+account.slice(2).padStart(64,'0')]}]};
 async function post(){return fetch(origin+'/rpc/base-mainnet',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({agent:'DAT',account,request}),signal:AbortSignal.timeout(10000)});}
 const refused=await post();assert.equal(refused.status,400);assert.deepEqual(await refused.json(),{error:'STATE_RPC_REQUEST'});assert.equal(upstream.length,0);
 checks.push({case:'2001-block-history-refused-before-upstream',passed:true});
 request.params[0].toBlock='0x7cf';const accepted=await post();assert.equal(accepted.status,200);assert.deepEqual(await accepted.json(),{result:[]});assert.equal(upstream.length,1);assert.deepEqual(upstream[0],{jsonrpc:'2.0',id:1,...request});
 checks.push({case:'2000-block-history-accepted-with-unchanged-filter',passed:true});
}finally{const stop=new Promise(done=>server.close(done));server.closeAllConnections();await stop;closed=true;await json(folder,'startup-verification.json',{revision,origin,checks,allPassed:checks.length===12&&checks.every(c=>c.passed),ownServerClosed:closed,realWalletUsed:false,publicRpcUsed:false,browserNavigationTested:false});}
const dat=join(owned,'DAT minimal runtime');await mkdir(dat);
await run('git',['init','-q'],dat);await run('git',['fetch',join(folder,'ThreeCore-Tokens/DAT/DAT-review.bundle'),'HEAD'],dat);await run('git',['checkout','--detach','FETCH_HEAD'],dat);
const datRevision=tokenReceipts.find(t=>t.token==='DAT').revision;await sourceState(dat,datRevision);
const runtime=JSON.parse(await readFile(join(downloads,'ThreeCore-runtime-installation-20261102/paths.json'),'utf8'));
await run(process.execPath,[runtime.npm,'ci','--offline','--omit=dev','--omit=optional','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--cache='+runtime.cache,'--userconfig='+runtime.userconfig,'--globalconfig='+runtime.globalconfig],dat,{log:join(folder,'offline-replay-runtime-install.log')});
const packages=Object.entries(JSON.parse(await readFile(join(dat,'node_modules/.package-lock.json'),'utf8')).packages).map(([name,p])=>({name,version:p.version}));
assert.equal(packages.length,19);assert(!packages.some(p=>/\/(hardhat|solc|typescript|zod)$/.test(p.name)));
const replay=await run(process.execPath,['docs/evidence/2026-11-02-token-dependency-review/verify-runtime-comparison.mjs',dat],checkout);
const replayResult=JSON.parse(replay.stdout);assert.equal(replayResult.observationsChecked,6);assert.equal(replayResult.completeRuntimeMatches,1);assert.equal(replayResult.metadataDifferences,5);
await json(folder,'runtime-comparison-replay.json',{...replayResult,freshMinimalRuntime:true,installedRuntimePackages:packages,previousNodeModulesReused:false,preexistingNpmCacheUsed:true,dependenciesVendored:false});
await sourceState(dat,datRevision);await sourceState(checkout,revision);await sourceState(repo,revision);
await writeFile(join(folder,'full-wallet-regression.log'),fullWallet);await writeFile(join(folder,'full-browser-regression.log'),browser);
const receipt={schema:'threecore.offline-review-package.v4',recordedAt:new Date().toISOString(),sourceRevision:revision,applicationSourceRevision:applicationRevision,regressionRevision,node:process.version,
 sourceSummary:source.summary,evidenceSummary:evidence.summary,completeHistoryVerified:true,windowsCheckoutAutocrlf:true,fullWalletCasesPassed:16454,fullSyntheticBrowserCasesPassed:1021,
 startupChecksPassed:checks.length,ownServerClosed:closed,tokenPackage:{reusedFromZipSha256:priorReceipt.sha256,tokens:tokenReceipts},runtimeComparisonReplay:replayResult,
 liveAcceptance:{network:'Base Mainnet',distinctExistingAccounts:1,connectedCards:3,restoreAndStopHistoryBytesIdentical:true,remaining:['two-account switch','chain switch','Sepolia acceptance','complete candidate migration','independent review']},
 updatesIncluded:['actual three-card save/restore/reconnect and pending-read stop','event-based native crypto test drain wait','inclusive 2000-block guard at direct RPC/HTTP relay boundary','six deployed runtime comparisons with explicit metadata differences','offline comparison checker and corruption controls'],
 publicRpcUsedDuringPackaging:false,realWalletAcceptanceComplete:false,independentReviewComplete:false,remainingDevelopmentAdvisory:'GHSA-mrhx-c7xc-m3w5',original4231Restarted:false,publicGitHubChanged:false,percentageCalculated:false};
await json(folder,'package-receipt.json',receipt);
await writeFile(join(folder,'はじめに_README.txt'),`ThreeCore 開発・検証の統合保存版 / 2026年11月2日\n\n固定版: ${revision}\nWallet実装の修正版: ${applicationRevision}\n全体検証を実行した版: ${regressionRevision}\n\nThreeCore-Wallet-source.zip：Walletのソースと検証資料。\nThreeCore-Wallet-review.bundle：完全なGit履歴。\nThreeCore-Tokens：前回と同一の3トークンのソース・履歴・ビルド・検証記録。各フォルダーの記録日時は元の検証日時です。\npackage-receipt.json：今回の対象版と確認結果。SHA256SUMS.txt：この保存版のファイル照合値。\n\n今回追加した内容：\n・実機で3トークンを既存の同じMetaMask口座に接続し、本番ネットワークを読み取り。\n・実際の保存ファイルの復元、明示的な再接続、読み取り途中の停止後も履歴を保持。3ファイルの4,410バイトが完全一致。\n・暗号処理の終了待ち検証を通知方式に修正。製品の暗号処理は変更していません。\n・通信側でも履歴取得の上限2,000ブロックを確認。\n・本番・テストネット計6契約の実行部分と配備時定数の比較。\n・6契約の比較を手元で再確認できる検証プログラム。\n\n全体検証：Wallet 16,454件、実ウォレットを使わないブラウザー検証1,021件。\n新規フォルダーに復元し、${source.summary.files}ソースファイル、${evidence.summary.manifests}証拠一覧/${evidence.summary.files}記録が一致。別の一時サーバーの12条件を確認して終了済み。\n新規のDAT読み取り用環境に19部品を導入し、保存した6契約の比較も再実行しました。既存node_modulesは再利用していません。導入には以前のnpmキャッシュを使っています。\n\n契約比較：実行部分・定数は6件で一致。ビルド情報まで含む完全一致はDATのテストネット1件のみで、他5件はメタデータ識別値が異なります。これをソース完全一致や監査済みとは扱いません。\n\n未完了：既存2口座の切替、ネットワーク切替、Sepoliaでの受入れ、新しい候補サーバーへの移行と復帰、独立レビュー、開発用Zodの対応判断、公開判断。実ファイルの選択は対応するブラウザー操作機能を使用し、Windowsの選択画面の操作自体は検証していません。90%達成や公開承認を示す保存版ではありません。\n元の4231サーバーや未保存画面を上書き・再起動しないでください。\n\n復元は必ず新しいフォルダーで行ってください。Node 22以上を使用します。\n  git init threecore-review\n  git -C threecore-review fetch <ThreeCore-Wallet-review.bundleのパス> HEAD\n  git -C threecore-review checkout --detach FETCH_HEAD\n復元したフォルダーで：\n  node scripts/verify-evidence-collection.js .\n  node docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs\n\n読み取り用トークン環境の準備（依存部品は同梱していません）：\n  npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund\nWallet側から保存済み契約比較を再確認：\n  node docs/evidence/2026-11-02-token-dependency-review/verify-runtime-comparison.mjs <viemを導入したトークンフォルダー>\nこの比較は公開RPCへ接続せず、現在のチェーン状態を再確認しません。チェックサムは破損検出用で、発行者の認証ではありません。\n`);
const manifest=await makeManifest(folder);console.log(JSON.stringify({stage:'package-complete',folder,revision,sourceFiles:source.summary.files,evidenceFiles:evidence.summary.files,manifest}));
