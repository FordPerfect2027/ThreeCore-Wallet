import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const work='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work';
const repo=join(work,'threecore-wallet-operation-rehearsal-20261029');
const revision='128ee11fefc263a11e36c026fbf786655c4cf8f6';
const folder='C:/Users/aseet/Downloads/ThreeCore-review-128ee11-20261103';
const owned='C:/Users/aseet/AppData/Local/Temp/threecore review '+randomUUID();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|systemdrive|windir|temp|tmp|comspec|pathext)$/i.test(key)));
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

const regressionPin='bf690f38b070362aab1369fbf22c8e68b1a6567f';
const implementationChanges=await git(repo,['diff','--name-only',regressionPin,revision,'--','src','examples','scripts','test','integration','package.json','package-lock.json']);
assert.equal(implementationChanges,'','Wallet implementation changed since its full regression');
const walletOut=join(folder,'wallet');await mkdir(walletOut);
const wallet=await restoreSource(repo,revision,walletOut,'wallet');
const collection=await run(process.execPath,['scripts/verify-evidence-collection.js','.'],wallet.checkout);
const evidence=JSON.parse(collection.stdout);assert(evidence.allMatched);
await writeFile(join(walletOut,'evidence-verification.json'),collection.stdout);
console.log(JSON.stringify({stage:'wallet-evidence-verified',summary:evidence.summary}));

const pins=JSON.parse(await readFile(join(repo,'docs/evidence/2026-11-03-zod-applied/source-commits.json'),'utf8'));
const applied=JSON.parse(await readFile(join(repo,'docs/evidence/2026-11-03-zod-applied/final-summary.json'),'utf8'));
const previousArtifacts=JSON.parse(await readFile(join(repo,'docs/evidence/2026-11-02-toolchain-empty-data/artifact-comparisons.json'),'utf8')).tokens;
const tokens=[];
for(const pin of pins) {
  const token=pin.token,cwd=join(work,`token-toolchain-empty-data-${token}-20261102`),out=join(folder,'tokens',token);
  await mkdir(out);const restored=await restoreSource(cwd,pin.head,out,token);
  const build=applied.tokens.find(row=>row.token===token),previous=previousArtifacts.find(row=>row.token===token);
  assert(build && previous);
  assert.equal(sha(await readFile(join(restored.checkout,`contracts/${token}Core.sol`))),previous.sourceSha256);
  const bytes=await readFile(join(cwd,previous.artifact)),artifact=JSON.parse(bytes);
  // The earlier receipt hashes the complete bytecode as hexadecimal text.
  assert.equal(sha(artifact.bytecode),build.creationBytecodeSha256);
  assert.equal(sha(artifact.deployedBytecode),build.runtimeBytecodeSha256);
  assert.equal(sha(await readFile(join(restored.checkout,'vendor/helper.tgz'))),build.stagedTarballSha256);
  const compatibility=JSON.parse(await readFile(join(repo,`docs/evidence/2026-11-03-helper-decoder-compatibility/comparison-${token}.json`),'utf8'));
  assert(compatibility.passed && compatibility.cases===68);
  await writeFile(join(out,`${token}Core.json`),bytes);
  const item={token,revision:pin.head,sourceSummary:restored.source.summary,completeHistoryVerified:true,
    restoredWorkingTreeClean:true,sourceSha256:previous.sourceSha256,artifactSha256:sha(bytes),
    creationBytecodeSha256:build.creationBytecodeSha256,runtimeBytecodeSha256:build.runtimeBytecodeSha256,
    helperArchiveSha256:build.stagedTarballSha256,helperVersion:build.helperVersion,zodVersion:build.zodVersion,
    appliedVerification:build.verification,auditAtRecordedTime:build.audit,compatibilityCases:68,
    dependenciesInstalledDuringPackaging:false,contractsRebuiltDuringPackaging:false,contractExecutionTestsRerun:false};
  await json(out,'receipt.json',item);tokens.push(item);
}

const regression=JSON.parse(await readFile(join(repo,'docs/evidence/2026-11-03-fixed-review/summary.json'),'utf8'));
const receipt={schema:'threecore.combined-review-package.v5',recordedAt:new Date().toISOString(),node:process.version,
  sourceRevision:revision,walletImplementation:'f6f378cc9b44f33fc7e147f4626e23573de06a6c',
  latestCompleteWalletRegression:regressionPin,walletImplementationAndTestFilesUnchangedSinceRegression:true,
  earlierRegression:{nodeHttp:regression.node.passed,syntheticBrowser:regression.browser.passed,rerunDuringPackaging:false},
  walletSourceSummary:wallet.source.summary,evidenceSummary:evidence.summary,tokenSources:tokens,
  sourceHistoryComplete:true,restoredCheckoutsHaveNoRemotes:true,packageContainsDependencyInstallations:false,
  privateHelperArchiveIncluded:true,privateWalletBackupsIncluded:false,
  remaining:['Actual connected MetaMask account/chain-switch invalidation','Native Windows picker traversal',
    'Older immutable public-release rollback if required','Independent private-helper review and maintenance approval',
    'Independent candidate review and explicit release decision'],
  originalServersRestarted:false,realWalletUsedDuringPackaging:false,githubWrites:false,percentageCalculated:false};
await json(folder,'package-receipt.json',receipt);
await copyFile('C:/Users/aseet/Downloads/ThreeCore-review-bf690f3-20261103/verify-package.mjs',join(folder,'verify-package.mjs'));
await writeFile(join(folder,'START_HERE.txt'),`ThreeCore レビュー用統合保存版 / 2026-11-03

Wallet固定版: ${revision}
DAT: ${pins.find(p=>p.token==='DAT').head}
EMA: ${pins.find(p=>p.token==='EMA').head}
CAWELON: ${pins.find(p=>p.token==='CAWELON').head}

このフォルダーだけで、Walletと3トークンのソース・完全なGit履歴を復元できます。
以前のZIPや追加パッチは不要です。依存ライブラリのインストール済み実体は含みません。
3トークンのZod修正版、変更した共通ライブラリのソース付きアーカイブとMITライセンス、
追加した68種類の入力比較、9件の実ファイル復元記録を収録しています。
個人のWalletバックアップ本体や画面写真は同梱せず、検証記録とハッシュを保存しています。

開き方:
1. このZIPを新しい空のフォルダーへ展開します。
2. node verify-package.mjs で外側の全ファイルを照合します。
3. wallet/source.zip を別の空フォルダーに展開し、docs/RELEASE_HANDOFF_2026-11-02.md を読みます。
4. トークンのソースは tokens/<DAT|EMA|CAWELON>/source.zip です。

完全な履歴を復元する例（新しい空のフォルダーを使ってください）:
  git init wallet-review
  git -C wallet-review fetch <展開先>/wallet/history.bundle HEAD
  git -C wallet-review checkout --detach FETCH_HEAD
  git -C wallet-review rev-parse HEAD

今回の確認:
・4リポジトリの履歴を独立した空フォルダーへ復元し、固定版・全ソースを照合しました。
・同梱された検証資料を照合しました。詳しい件数は package-receipt.json を参照してください。
・Walletの実装と検査コードは、全体検査済みの bf690f3 から変わっていません。
・その以前の全体検査は Node/HTTP 16,470件、疑似Walletのブラウザー検査1,024件です。
  今回それらを再実行したと主張するものではありません。
・3トークンには、適用済みの修正、コンパイル、型検査、依存関係検査、日付付き監査の記録があります。
・各トークンで68種類の読み取り用変換を旧版と比較し、判定・値・エラー箇所が一致しました。
  通常のエラー文言が変わる3例は記録しています。68件は機能数ではありません。

未完了:
実Wallet接続中の口座・ネットワーク変更の観測、Windows本来のファイル選択操作、
必要に応じた旧公開版への復帰、共通ライブラリの独立レビューと保守承認、公開判断。
この保存版は開発・レビュー用です。90%達成や公開承認、トークンの安全性を示しません。
署名・送金・承認取引・秘密鍵は不要です。自動で取引を実行する手順は含めていません。
既存の作業タブや4231/4232/4233サーバーを上書き・再起動しないでください。

資料内の過去のZIP、検査結果、監査はそれぞれの日付と固定版に対応します。
今回の外側の package-receipt.json が、この保存版の版一覧です。
チェックサムは内容の変化を検出しますが、発行者や安全性を認証しません。
`);
await assertSource(repo,revision);
for(const pin of pins)await assertSource(join(work,`token-toolchain-empty-data-${pin.token}-20261102`),pin.head);
async function list(root,prefix='') {
  const names=[];for(const entry of await readdir(join(root,prefix),{withFileTypes:true})) {
    const name=prefix+entry.name;if(entry.isDirectory())names.push(...await list(root,name+'/'));else{assert(entry.isFile());names.push(name);}
  }return names;
}
const names=(await list(folder)).filter(name=>name!=='SHA256SUMS.txt').sort();
const lines=[];for(const name of names)lines.push(sha(await readFile(join(folder,name)))+'  '+name);
await writeFile(join(folder,'SHA256SUMS.txt'),lines.join('\n')+'\n');
const verified=await run(process.execPath,['verify-package.mjs'],folder);
console.log(JSON.stringify({stage:'package-complete',folder,owned,verified:JSON.parse(verified.stdout)}));

