import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,copyFile,lstat} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
const work='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work',repo=work+'/threecore-wallet-operation-rehearsal-20261029';
const evidence=repo+'/docs/evidence/2026-11-02-token-dependency-review';
const revision='9838e5ba1b097fa998cb95d36f8d7fec4834143d';
const folder='C:/Users/aseet/Downloads/ThreeCore-source-verification-9838e5b-20261102-v2';
const owned='C:/Users/aseet/AppData/Local/Temp/threecore compiler replay '+randomUUID();
const sha=b=>createHash('sha256').update(b).digest('hex');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|systemdrive|windir|temp|tmp|comspec|pathext)$/i.test(key)));
async function run(program,args,cwd,{timeout=120000,allowFailure=false}={}){return new Promise((done,reject)=>{const child=spawn(program,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>child.kill(),timeout);child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',(code,signal)=>{clearTimeout(timer);if(signal||(!allowFailure&&code!==0))reject(Error('Command failed: '+code+' '+signal+' '+stderr.slice(-1200)));else done({code,stdout,stderr});});});}
const git=async args=>(await run('git',args,repo)).stdout.trim();
assert.equal(await git(['rev-parse','HEAD']),revision);assert.equal(await git(['status','--porcelain']),'');
await mkdir(folder);await mkdir(owned);await mkdir(join(folder,'evidence'));await mkdir(join(folder,'compiler'));await mkdir(join(folder,'results'));
const manifest=(await readFile(evidence+'/SHA256SUMS.txt','utf8')).trim().split(/\r?\n/);
const files=manifest.slice(-34).map(line=>line.slice(66));files.push('runtime-public-comparison.json');assert.equal(new Set(files).size,35);
for(const name of files){const bytes=await readFile(join(evidence,name));assert.equal(sha(bytes),manifest.find(l=>l.slice(66)===name).slice(0,64));await writeFile(join(folder,'evidence',name),bytes,{flag:'wx'});}
await copyFile(repo+'/docs/DEPLOYMENT_SOURCE_RECONSTRUCTION_2026-11-02.md',join(folder,'REPORT.md'));
await copyFile(work+'/token-dependency-repair-DAT-20261102/LICENSE',join(folder,'TOKEN-SOURCE-LICENSE'));
await writeFile(join(folder,'LICENSE-SOURCES.txt'),'TOKEN-SOURCE-LICENSE: DAT source at 502944c94ffed408356b487abc9a710807697ee2.\nOPENZEPPELIN-LICENSE: https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.6.1/LICENSE\n',{flag:'wx'});
await copyFile('C:/Users/aseet/AppData/Local/Temp/threecore-openzeppelin-5.6.1-LICENSE.txt',join(folder,'OPENZEPPELIN-LICENSE'));
const pkg={name:'threecore-offline-source-verification',private:true,version:'0.1.0',engines:{node:'>=22'},dependencies:{solc:'0.8.34',viem:'2.56.6'},overrides:{'follow-redirects':'1.16.2',solc:{tmp:'0.2.7'}}};
const packageBytes=JSON.stringify(pkg,null,2)+'\n';await writeFile(join(folder,'compiler/package.json'),packageBytes,{flag:'wx'});await writeFile(join(owned,'package.json'),packageBytes,{flag:'wx'});
const userconfig=join(owned,'empty-user.npmrc'),globalconfig=join(owned,'empty-global.npmrc');await writeFile(userconfig,'');await writeFile(globalconfig,'');
const npm='C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js';
const npmCommon=['--userconfig='+userconfig,'--globalconfig='+globalconfig,'--cache='+join(owned,'npm-cache'),'--registry=https://registry.npmjs.org'];
const install=await run(process.execPath,[npm,'install','--ignore-scripts','--no-audit','--no-fund',...npmCommon],owned);
await writeFile(join(folder,'results/compiler-install.log'),install.stdout+install.stderr,{flag:'wx'});await copyFile(join(owned,'package-lock.json'),join(folder,'compiler/package-lock.json'));
const packages=Object.entries(JSON.parse(await readFile(join(owned,'node_modules/.package-lock.json'),'utf8')).packages).map(([name,p])=>({name,version:p.version}));
assert(!packages.some(p=>/\/(hardhat|zod)$/.test(p.name)));assert(packages.some(p=>p.name==='node_modules/solc'&&p.version==='0.8.34'));
console.log(JSON.stringify({stage:'fresh-compiler-installed',packages:packages.length}));
const audit=await run(process.execPath,[npm,'audit','--omit=dev','--json',...npmCommon],owned,{allowFailure:true});
await writeFile(join(folder,'results/compiler-audit.json'),audit.stdout,{flag:'wx'});const auditResult=JSON.parse(audit.stdout);assert(auditResult.metadata?.vulnerabilities);
const results=[];
for(const[name,file]of [['runtime','reconstruct-runtime-source.mjs'],['mainnet','verify-recorded-mainnet-deployments.mjs'],['sepolia','verify-recorded-sepolia-deployments.mjs']]){
 const result=await run(process.execPath,[join(folder,'evidence',file),owned],owned);const parsed=JSON.parse(result.stdout);
 if(name==='runtime')assert.equal(parsed.completeRuntimeMatches,5);if(name==='mainnet')assert.equal(parsed.initialMintAndConstructorChecksPassed,3);if(name==='sepolia')assert.equal(parsed.creationAndInitialMintMatches,2);
 await writeFile(join(folder,'results',name+'-replay.json'),result.stdout,{flag:'wx'});results.push({name,exitCode:result.code,passed:true});console.log(JSON.stringify({stage:'fresh-replay',name,passed:true}));
}
await writeFile(join(folder,'receipt.json'),JSON.stringify({sourceRevision:revision,recordedAt:new Date().toISOString(),freshCompilerInstallation:true,reusedNodeModules:false,reusedNpmCache:false,npmDependenciesVendored:false,installedPackages:packages,advisoryCounts:auditResult.metadata.vulnerabilities,results,completeRuntimeMatches:5,mainnetInitialMintChecks:3,sepoliaInitialMintChecks:2,remainingMetadataMismatch:'DAT / Base Mainnet',original4231Restarted:false,publicChainRequestsDuringPackaging:0,independentAudit:false},null,2)+'\n',{flag:'wx'});
await writeFile(join(folder,'はじめに_README.txt'),`ThreeCore 配備済みソース・初期発行の追加検証資料\n固定版: ${revision}\n\nこれはWallet本体の置き換えではなく、追加の検証資料です。既存の保存版をそのまま保管してください。\n\n確認済み：本番・テストネット計6契約のうち5契約で、配備時の固定値とビルド情報を含む実行コードが一致。本番3契約、およびEMA/CAWELONテストネット2契約の作成記録と初期発行を照合。DAT本番のビルド情報は未解決です。\n\n新しいフォルダーに展開し、Node 22以上を使います。\n1. compilerフォルダーで npm ci --ignore-scripts --no-audit --no-fund\n2. このフォルダーへ戻り、次を実行：\nnode evidence/reconstruct-runtime-source.mjs ./compiler\nnode evidence/verify-recorded-mainnet-deployments.mjs ./compiler\nnode evidence/verify-recorded-sepolia-deployments.mjs ./compiler\n\n最初の依存部品導入はnpmへの接続が必要です。3つの照合コマンドは保存済みデータだけを使い、公開RPC・Walletへ接続しません。署名・送金・秘密鍵は不要です。\n\n新規のコンパイラー用環境に${packages.length}部品を導入し、全3コマンドが通ることを確認しました。この小さい環境にはHardhat/Zodを含みませんが、元の開発環境に残るZodの問題を解消したという意味ではありません。監査結果はresults/compiler-audit.jsonに保存しています。\n\nREPORT.md：確認方法と限界。evidence：原記録と再検証プログラム。results：今回の別環境での結果。SHA256SUMS.txt：保存内容の照合値。\n\nこれは現在の残高、独立した安全監査、メインネット公開の承認や90%達成を示す資料ではありません。実ウォレットの口座・ネットワーク切替と、移行・復帰、独立レビューなどは未完了です。チェックサムは変更検出用で、発行者認証ではありません。\n`,{flag:'wx'});
async function list(root,prefix=''){const files=[];for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())files.push(...await list(root,name+'/'));else{assert(entry.isFile());files.push(name);}}return files.sort();}
const all=await list(folder),lines=[];for(const file of all)lines.push(sha(await readFile(join(folder,file)))+'  '+file);await writeFile(join(folder,'SHA256SUMS.txt'),lines.join('\n')+'\n',{flag:'wx'});
const zip=folder+'.zip';await run('tar.exe',['-a','-cf',zip,'-C',folder,'.'],owned);
const restored=join(owned,'restored');await mkdir(restored);await run('tar.exe',['-xf',zip,'-C',restored],owned);
const restoredFiles=(await list(restored)).filter(n=>n!=='SHA256SUMS.txt');assert.deepEqual(restoredFiles,all);
for(const line of lines){const name=line.slice(66),path=resolve(restored,name),rel=relative(restored,path);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));assert((await lstat(path)).isFile());assert.equal(sha(await readFile(path)),line.slice(0,64));}
const zipBytes=await readFile(zip),receipt={sourceRevision:revision,zip,bytes:zipBytes.length,sha256:sha(zipBytes),manifestEntries:all.length,freshCompilerPackages:packages.length,advisoryCounts:auditResult.metadata.vulnerabilities,offlineReplaysPassed:3,zipExtractedAndMatched:true,owned};
await writeFile(folder+'-receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});await writeFile(zip+'.sha256',receipt.sha256+'  '+zip.split('/').pop()+'\n',{flag:'wx'});
assert.equal(await git(['rev-parse','HEAD']),revision);assert.equal(await git(['status','--porcelain']),'');console.log(JSON.stringify({stage:'complete',...receipt}));
