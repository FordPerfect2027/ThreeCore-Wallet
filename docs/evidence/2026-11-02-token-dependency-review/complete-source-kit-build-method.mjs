import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const repo='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029';
const evidence=repo+'/docs/evidence/2026-11-02-token-dependency-review';
const prior='C:/Users/aseet/Downloads/ThreeCore-source-verification-9838e5b-20261102-final';
const root='C:/Users/aseet/Downloads/ThreeCore-source-verification-complete-f7aaec1-20261102';
const runtime='C:/Users/aseet/AppData/Local/Temp/threecore compiler replay d1434c75-f0c0-4cd0-b0cb-21afd5f273ea';
const revision='f7aaec1e7179324bb9dcb7d8efb17b6414b5dcf9';
const sha=b=>createHash('sha256').update(b).digest('hex');
const run=(file,args,cwd)=>execFileSync(file,args,{cwd,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024,timeout:90000});
assert.equal(run('git',['rev-parse','HEAD'],repo).trim(),revision);
assert.equal(run('git',['status','--porcelain'],repo).trim(),'');
assert(!existsSync(root));mkdirSync(root);
for(const name of ['evidence','compiler','results'])mkdirSync(join(root,name));
const manifests=readFileSync(evidence+'/SHA256SUMS.txt','utf8').trimEnd().split(/\r?\n/);
const names=[
'reconstruct-runtime-source.mjs','verify-recorded-mainnet-deployments.mjs',
'verify-recorded-sepolia-deployments.mjs','dat-mainnet-source-input.mjs','verify-dat-mainnet-source-controls.mjs',
'source-reconstruction-inputs.json','source-reconstruction-DAT-input.json',
'source-reconstruction-EMA-input.json','source-reconstruction-CAWELON-input.json',
'runtime-public-comparison.json','mainnet-deployment-results.json','mainnet-deployment-rpc.json',
'sepolia-deployment-results.json','sepolia-deployment-rpc.json',
'dat-mainnet-sourcify-response.json','dat-mainnet-sourcify-receipt.json','dat-mainnet-sourcify-read-method.mjs'
];
for(const name of names){
 const bytes=readFileSync(join(evidence,name)),line=manifests.find(l=>l.slice(66)===name);
 assert(line);assert.equal(sha(bytes),line.slice(0,64));
 writeFileSync(join(root,'evidence',name),bytes,{flag:'wx'});
}
const oldLines=readFileSync(prior+'/SHA256SUMS.txt','utf8').trimEnd().split(/\r?\n/);
for(const name of ['compiler/package.json','compiler/package-lock.json','TOKEN-SOURCE-LICENSE','OPENZEPPELIN-LICENSE','LICENSE-SOURCES.txt']){
 const bytes=readFileSync(join(prior,name)),line=oldLines.find(l=>l.slice(66)===name);
 assert(line);assert.equal(sha(bytes),line.slice(0,64));writeFileSync(join(root,name),bytes,{flag:'wx'});
}
assert.equal(sha(readFileSync(root+'/compiler/package-lock.json')),sha(readFileSync(runtime+'/package-lock.json')));
const results=[];
for(const[name,script,withCompiler]of [
 ['runtime','reconstruct-runtime-source.mjs',true],
 ['source-controls','verify-dat-mainnet-source-controls.mjs',false],
 ['mainnet','verify-recorded-mainnet-deployments.mjs',true],
 ['sepolia','verify-recorded-sepolia-deployments.mjs',true]
]){
 const text=run(process.execPath,[join(root,'evidence',script),...(withCompiler?[runtime]:[])],root),r=JSON.parse(text);
 if(name==='runtime')assert.equal(r.completeRuntimeMatches,6);
 if(name==='source-controls')assert.equal(r.rejectedControls.length,9);
 if(name==='mainnet')assert.equal(r.completeCreationBytecodeMatches,3);
 if(name==='sepolia')assert.equal(r.creationAndInitialMintMatches,2);
 writeFileSync(join(root,'results',name+'.json'),text,{flag:'wx'});results.push({name,passed:true});
 console.log(JSON.stringify({stage:'relocated-replay',name,passed:true}));
}
let report=readFileSync(repo+'/docs/DEPLOYMENT_SOURCE_RECONSTRUCTION_2026-11-02.md','utf8');
report=report.replace('# Deployment source reconstruction — November 2, 2026','# Deployment source reconstruction — November 2, 2026\n\nThis standalone package pins f7aaec1. Use the commands in はじめに_README.txt.\nThe historical distribution sections below describe earlier packages.\n');
report=report.replaceAll('evidence/2026-11-02-token-dependency-review/','evidence/');
// The minimal kit includes only replay inputs; retain links only for files actually included.
report=report.replaceAll('(evidence/source-reconstruction-complete-results.json)','(results/runtime.json)')
 .replaceAll('(evidence/mainnet-deployment-complete-replay.json)','(results/mainnet.json)')
 .replaceAll('(evidence/dat-mainnet-source-controls.json)','(results/source-controls.json)')
 .replace('[Receipt](evidence/source-kit-receipt.json)','Earlier kit receipt in the repository')
 .replace('[compiler profile/replays](evidence/source-kit-replays.json)','earlier compiler profile/replays in the repository');
writeFileSync(root+'/REPORT.md',report);
const receipt={schema:'threecore.complete-source-verification-kit.v1',sourceRevision:revision,
 recordedAt:new Date().toISOString(),completeRuntimeMatches:6,completeMainnetCreationMatches:3,
 sepoliaCreationAndInitialMintMatches:2,sourceControlsRejected:9,remainingMetadataMismatches:[],
 results,compilerInstallationReused:true,compilerLockUnchanged:true,newDependencyInstallation:false,
 dependenciesVendored:false,compilerCheckedByVersionAndDigest:true,
 publicChainRequestsDuringPackaging:0,walletUsed:false,original4231Restarted:false,
 independentAudit:false,percentageCalculated:false};
writeFileSync(root+'/receipt.json',JSON.stringify(receipt,null,2)+'\n');
writeFileSync(root+'/はじめに_README.txt',[
'ThreeCore コード照合・完全一致版（2026年11月2日）','',
'今回確認できたこと',
'・DAT・EMA・CAWELONの本番／テストネット、6件すべてのコードが、コンパイラ情報を含めて完全一致。',
'・本番3件の作成コードと初回発行を再確認。',
'・EMA・CAWELONのテストネット2件の作成コードと初回発行も再確認。',
'・DAT本番で残っていた違いは、ファイルの配置場所と末尾の改行1文字でした。',
'','保存された過去のチェーン応答と公開ソースを、手元で再コンパイルして照合するための一式です。',
'現在の残高や安全監査、メインネットの公開許可を示すものではありません。','',
'再確認の方法（Node.js 22以上）',
'1. ZIPを新しいフォルダーへ展開し、そのフォルダーでターミナルを開きます。',
'2. コンパイラ部品を初回だけ導入します。npmの公式配布先への接続が必要です。',
'cd compiler',
'npm ci --ignore-scripts --no-audit --no-fund',
'cd ..',
'3. 保存されたデータを照合します。ここからはネット接続・Walletが不要です。',
'node evidence/reconstruct-runtime-source.mjs ./compiler',
'node evidence/verify-dat-mainnet-source-controls.mjs',
'node evidence/verify-recorded-mainnet-deployments.mjs ./compiler',
'node evidence/verify-recorded-sepolia-deployments.mjs ./compiler','',
'成功時の目安',
'最初の結果: completeRuntimeMatches = 6、remainingMetadataMismatches = []',
'入力検査: rejectedControls に9項目',
'本番の結果: completeCreationBytecodeMatches = 3',
'テストネットの結果: creationAndInitialMintMatches = 2','',
'REPORT.mdに方法と限界、evidenceに元データと検証プログラム、resultsに今回の実行結果があります。',
'SHA256SUMS.txtは全ファイルの照合値です。改変検出用であり、発行者や安全性の認証ではありません。',
'この版のソース: '+revision,
'以前の9838e5b版は5/6の結果を記録した別の時点の資料で、上書きしていません。',
'今回の配布確認には、以前に新規構築して検証済みのコンパイラ環境を再利用しました。',
'部品の版と本体の照合値を再確認し、新しい保存場所から全4コマンドが成功しました。',
'元の開発環境に残るZodの問題や、実Walletの切り替え・移行・第三者レビューは別の確認事項です。',
''
].join('\n'));
copyFileSync(import.meta.filename,root+'/BUILD-METHOD.mjs');
function list(dir,prefix=''){return readdirSync(join(dir,prefix),{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(dir,prefix+e.name+'/'):[prefix+e.name]).sort();}
const files=list(root);const sums=files.map(n=>sha(readFileSync(join(root,n)))+'  '+n);
writeFileSync(root+'/SHA256SUMS.txt',sums.join('\n')+'\n');
const python='C:/Users/aseet/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const code=[
'import pathlib,sys,zipfile,tempfile,hashlib,json',
'root=pathlib.Path(sys.argv[1]); zpath=pathlib.Path(str(root)+".zip")',
'with zipfile.ZipFile(zpath,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:',
' for f in sorted(root.rglob("*")):',
'  if f.is_file(): z.write(f,f.relative_to(root).as_posix())',
'fresh=pathlib.Path(tempfile.mkdtemp(prefix="threecore-complete-source-zip-"))',
'with zipfile.ZipFile(zpath) as z:',
' names=z.namelist()',
' assert len(names)==len(set(names))',
' assert all(not pathlib.PurePosixPath(n).is_absolute() and ".." not in pathlib.PurePosixPath(n).parts and "\\\\" not in n for n in names)',
' z.extractall(fresh)',
'lines=(fresh/"SHA256SUMS.txt").read_text(encoding="utf-8").splitlines()',
'for l in lines:',
' digest,name=l.split("  ",1)',
' assert hashlib.sha256((fresh/name).read_bytes()).hexdigest()==digest, name',
'assert set(names)=={l.split("  ",1)[1] for l in lines}|{"SHA256SUMS.txt"}',
'print(json.dumps({"manifestEntries":len(lines),"freshExtractionAllMatched":True}))'
].join('\n');
const extracted=JSON.parse(run(python,['-c',code,root],root));
const zip=readFileSync(root+'.zip');
const result={...receipt,zip:root.split('/').at(-1)+'.zip',bytes:zip.length,sha256:sha(zip),...extracted};
writeFileSync(root+'-receipt.json',JSON.stringify(result,null,2)+'\n');
writeFileSync(root+'.zip.sha256',result.sha256+'  '+result.zip+'\n');
assert.equal(run('git',['status','--porcelain'],repo).trim(),'');
console.log(JSON.stringify({stage:'complete',...result},null,2));
