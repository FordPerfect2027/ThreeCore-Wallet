import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const work='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work';
const repo=join(work,'threecore-wallet-operation-rehearsal-20261029');
const revision='bf690f38b070362aab1369fbf22c8e68b1a6567f';
const folder='C:/Users/aseet/Downloads/ThreeCore-review-bf690f3-20261103';
const owned='C:/Users/aseet/AppData/Local/Temp/threecore review '+randomUUID();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|systemdrive|windir|temp|tmp|comspec|pathext)$/i.test(key)));
const priorInput=JSON.parse(await readFile(join(repo,'docs/evidence/2026-11-02-toolchain-empty-data/results.json'),'utf8'));
const guarded=JSON.parse(await readFile(join(repo,'docs/evidence/2026-11-03-toolchain-guards/summary.json'),'utf8'));
const input={tokens:priorInput.tokens.map(row=>{const current=guarded.tokenSources.find(item=>item.token===row.token);assert.equal(current.parent,row.commit);return {...row,priorCommit:row.commit,commit:current.revision,currentToolchainCases:current.testsPassed};})};
const comparisons=JSON.parse(await readFile(join(repo,'docs/evidence/2026-11-02-toolchain-empty-data/artifact-comparisons.json'),'utf8')).tokens;
const {verifySourceCheckpoint}=await import(pathToFileURL(join(repo,'scripts/verify-source-checkpoint.js')));
async function run(program,args,cwd,{log,timeout=240000}={}) {
  return await new Promise((done,reject)=>{
    const child=spawn(program,args,{cwd,env:safeEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr=''; const timer=setTimeout(()=>child.kill(),timeout);
    child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',async(code,signal)=>{clearTimeout(timer);try {
      if(log) await writeFile(log,stdout+stderr);
      if(code!==0) throw Error(`${program} failed (${code}, ${signal}): ${stderr.slice(-1500)} ${stdout.slice(-1500)}`);
      done({stdout,stderr,code});
    } catch(error) {reject(error);} });
  });
}
const git=async(cwd,args)=>(await run('git',args,cwd)).stdout.trim();
const json=(dir,name,value)=>writeFile(join(dir,name),JSON.stringify(value,null,2)+'\n');
async function assertSource(cwd,pin) {
  assert.equal(await git(cwd,['rev-parse','HEAD']),pin);
  assert.equal(await git(cwd,['status','--porcelain']),'');
  assert.equal(await git(cwd,['rev-parse','--is-shallow-repository']),'false');
}
await assertSource(repo,revision);
await mkdir(folder);await mkdir(owned);await mkdir(join(folder,'tokens'));
await json(folder,'build-paths.json',{folder,owned,revision,startedAt:new Date().toISOString()});
await copyFile(fileURLToPath(import.meta.url),join(folder,'build-method.mjs'));

async function restoreSource(cwd,pin,out,name) {
  await assertSource(cwd,pin);
  const bundle=join(out,'history.bundle'),zip=join(out,'source.zip');
  await run('git',['bundle','create',bundle,'HEAD'],cwd);
  await run('git',['-c','core.autocrlf=false','archive','--format=zip','--output='+zip,pin],cwd);
  const checkout=join(owned,name+' checkout'),exported=join(owned,name+' export');
  await mkdir(checkout);await mkdir(exported);
  await run('git',['init','-q'],checkout);
  await run('git',['config','core.autocrlf','true'],checkout);
  await run('git',['bundle','verify',bundle],checkout,{log:join(out,'bundle-verification.txt')});
  await run('git',['fetch',bundle,'HEAD'],checkout);
  await run('git',['checkout','--detach','FETCH_HEAD'],checkout);
  await run('git',['fsck','--full','--no-dangling'],checkout);
  await assertSource(checkout,pin);assert.equal(await git(checkout,['remote']), '');
  assert.equal(await git(checkout,['rev-list','--count','HEAD']),await git(cwd,['rev-list','--count',pin]));
  await run('tar.exe',['-xf',zip,'-C',exported],cwd);
  const source=await verifySourceCheckpoint(cwd,pin,exported);
  assert(source.allMatched,JSON.stringify(source.summary));await json(out,'source-verification.json',source);
  console.log(JSON.stringify({stage:'source-and-history-restored',name,pin,files:source.summary.files}));
  return {checkout,exported,source,pin};
}

const walletOut=join(folder,'wallet');await mkdir(walletOut);
const wallet=await restoreSource(repo,revision,walletOut,'wallet');
const {verifyEvidenceCollection}=await import(pathToFileURL(join(wallet.checkout,'scripts/evidence-collection.js')));
const evidence=await verifyEvidenceCollection(wallet.checkout);
assert(evidence.allMatched);await json(walletOut,'evidence-verification.json',evidence);
const historical=await run(process.execPath,['docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs'],wallet.checkout);
assert.equal(JSON.parse(historical.stdout).verified,true);await writeFile(join(walletOut,'historical-verification.json'),historical.stdout);
const {createDemoServer}=await import(pathToFileURL(join(wallet.exported,'examples/dev-server.js')));
const server=createDemoServer(),checks=[];let origin,closed=false;
try {
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  origin='http://127.0.0.1:'+server.address().port;
  for(const[path,file]of [['/','examples/index.html'],['/rehearsal/','examples/operation-rehearsal.html'],
    ['/examples/wallet-entry.js','examples/wallet-entry.js'],['/examples/wallet-demo.js','examples/wallet-demo.js'],
    ['/examples/wallet-setup-panel.js','examples/wallet-setup-panel.js'],['/src/wallet-session.js','src/wallet-session.js'],
    ['/src/security-rpc.js','src/security-rpc.js'],['/src/file-read-status.js','src/file-read-status.js']]) {
    const response=await fetch(origin+path,{signal:AbortSignal.timeout(10000)});
    const bytes=Buffer.from(await response.arrayBuffer()),expected=await readFile(join(wallet.exported,file));
    const headers=response.headers.get('cache-control')==='no-store'&&response.headers.get('x-frame-options')==='DENY'&&response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'");
    const passed=response.status===200&&bytes.equals(expected)&&headers;
    checks.push({path,status:response.status,exactSourceBytes:bytes.equals(expected),securityHeadersPresent:headers,passed});assert(passed,path);
  }
  for(const[path,headers,status]of [['/.env',{},404],['/test/browser/',{},404],['/',{Origin:'https://review.invalid'},403]]) {
    const response=await fetch(origin+path,{headers,signal:AbortSignal.timeout(10000)});await response.arrayBuffer();
    checks.push({path,status:response.status,foreignOrigin:Boolean(headers.Origin),passed:response.status===status});assert.equal(response.status,status);
  }
} finally {
  const stopped=new Promise(done=>server.close(done));server.closeAllConnections();await stopped;closed=true;
  await json(walletOut,'startup-verification.json',{revision,origin,checks,allPassed:checks.length===11&&checks.every(c=>c.passed),ownServerClosed:closed,realWalletUsed:false,browserNavigationTested:false});
}
console.log(JSON.stringify({stage:'wallet-evidence-and-startup-passed',evidence:evidence.summary,startupChecks:checks.length}));

const tokens=[];
for(const row of input.tokens) {
  const token=row.token,cwd=join(work,`token-toolchain-empty-data-${token}-20261102`),out=join(folder,'tokens',token);
  await mkdir(out);const restored=await restoreSource(cwd,row.commit,out,token);
  const comparison=comparisons.find(c=>c.token===token);
  assert.equal(sha(await readFile(join(restored.checkout,`contracts/${token}Core.sol`))),comparison.sourceSha256);
  const artifact=await readFile(join(cwd,comparison.artifact));assert.equal(sha(artifact),comparison.afterArtifactSha256);
  await writeFile(join(out,`${token}Core.json`),artifact);
  const tokenReceipt={token,revision:row.commit,sourceSummary:restored.source.summary,
    completeHistoryVerified:true,restoredWorkingTreeClean:true,windowsCheckoutAutocrlf:true,
    sourceSha256:comparison.sourceSha256,artifactSha256:comparison.afterArtifactSha256,
    artifactCopiedFromVerifiedBuild:true,artifactRebuiltDuringPackaging:false,
    dependenciesInstalledDuringPackaging:false,testsRerunDuringPackaging:false,
    priorTests:row.tests,priorTestsRevision:row.priorCommit,supplementalToolchainCases:row.currentToolchainCases,supplementalToolchainEvidence:'wallet/source.zip: docs/evidence/2026-11-03-toolchain-guards/',priorTestsEvidence:'wallet/source.zip: docs/evidence/2026-11-02-toolchain-empty-data/',
    contractBytecodesUnchangedByToolchainRepair:true};
  await json(out,'receipt.json',tokenReceipt);tokens.push(tokenReceipt);
  await assertSource(cwd,row.commit);
}
await assertSource(repo,revision);
const receipt={schema:'threecore.combined-review-package.v4',recordedAt:new Date().toISOString(),node:process.version,
  sourceRevision:revision,walletImplementation:'f6f378cc9b44f33fc7e147f4626e23573de06a6c',
  latestCompleteWalletRegression:'212601977bc6dad8da298f11ebb9e7a421052571',
  laterTargetedChecks:{diagnosticNode:453,syntheticBrowser:1024,navigationServer:62,evidenceCollection:56,httpCommand:440},
  diagnosticsImplementation:'856f670e2e813a828214dc8cffa47ba53e8222f7',
  fullWalletRegressionRerunDuringPackaging:false,publicPrHead:'07041f00efdb503cb76a06fbe12e5531cb380930',
  walletSourceSummary:wallet.source.summary,evidenceSummary:evidence.summary,startupChecks:checks.length,
  ownServerClosed:closed,original4231Restarted:false,candidate4232Restarted:false,realWalletUsed:false,
  sourceHistoryComplete:true,restoredCheckoutsHaveNoRemotes:true,tokenSources:tokens,
  remaining:['Live account/chain-switch invalidation','Native Windows picker traversal','Older immutable public-release rollback if required','Zod GHSA-mrhx-c7xc-m3w5','Independent review and explicit release decision'],
  githubWrites:false,percentageCalculated:false};
await json(folder,'package-receipt.json',receipt);
await writeFile(join(folder,'START_HERE.txt'),`ThreeCore 復旧機能を含むレビュー用統合保存版 / 2026-11-03\n\nWallet固定版: ${revision}\n\nwallet/source.zip と tokens/<DAT|EMA|CAWELON>/source.zip に各ソースが入っています。\n各 history.bundle は完全なGit履歴です。以前の保存版は不要です。\npackage-receipt.json に版・復元確認・未完了事項を記録しています。\nSHA256SUMS.txt で同梱ファイルを照合できます。\n\n今回の収録内容：\n・資料の一括照合が256フォルダーで止まる問題の修正（総容量の保護は維持）。\n・3トークンの更新時に設定エラー処理の不整合を検知する検査と、自動検証の対象漏れの修正。\n・接続停止理由を区別して残す診断機能と、その検証記録。\n・外部からの直接移動が拒否された場合に、同じサイト内のリンクから開く案内。\n・Account 1 / Base Sepolia での3トークン読み取りと9件の保存・復元記録。\n・3トークンの開発ツールが空データをゼロ1バイトとして扱っていた不具合の修正。\n・Walletが実際に返したネットワークとカード側の選択を区別する表示。\n・既に実施したMainnet/Sepoliaの読み取り、保存・復元、候補版への移行・復帰の記録。\n\n今回やり直した検査は、ソースとGit履歴の復元、保存証拠の照合、一時サーバーの起動確認です。\n過去に通った検査を新しい検査として数えていません。\nトークンのABIと実行コードは今回の開発ツール修正の前後で同一です。\n\nこれは開発・独立レビュー用です。公開承認や90%達成を示すものではありません。\n実ウォレット接続中の口座・ネットワーク変更の観測、Windows本来のファイル選択操作、\nZodの依存関係問題、独立レビュー、公開判断は未完了です。\n秘密鍵やシードは不要です。利用者の署名・送金・承認取引は行わないでください。\n\n依存ライブラリの実体は同梱していません。トークンのビルド検査にはnpm経由の導入が必要です。\n既存の4231/4232サーバー・作業タブ・保存データを上書きしないでください。\n\nGitの復元例（必ず新しい空のフォルダー）：\n  git init wallet-review\n  git -C wallet-review fetch <展開先>/wallet/history.bundle HEAD\n  git -C wallet-review checkout --detach FETCH_HEAD\n  git -C wallet-review rev-parse HEAD\n\n復元したWalletの docs/RELEASE_HANDOFF_2026-11-02.md と\ndocs/TOOLCHAIN_EMPTY_DATA_2026-11-02.md がレビューの入口です。\n同梱ソース内で紹介される以前のZIPは過去の固定版です。今回の版は上記の固定版です。\nチェックサムは内容の変化を検出しますが、発行者や安全性を認証しません。\n`);
async function list(root,prefix='') {
  const names=[];for(const entry of await readdir(join(root,prefix),{withFileTypes:true})) {
    const name=prefix+entry.name;if(entry.isDirectory())names.push(...await list(root,name+'/'));else {assert(entry.isFile());names.push(name);}
  }return names;
}
const names=(await list(folder)).filter(n=>n!=='SHA256SUMS.txt').sort();
const lines=[];for(const name of names)lines.push(sha(await readFile(join(folder,name)))+'  '+name);
await writeFile(join(folder,'SHA256SUMS.txt'),lines.join('\n')+'\n');
console.log(JSON.stringify({stage:'package-prepared',folder,owned,revision,entries:names.length,tokens:tokens.map(t=>({token:t.token,revision:t.revision}))}));
