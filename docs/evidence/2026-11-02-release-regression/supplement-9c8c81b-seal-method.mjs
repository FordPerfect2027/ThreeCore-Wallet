import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const dir='C:/Users/aseet/Downloads/ThreeCore-review-supplement-9c8c81b-20261102';
const zip=dir+'.zip';
const python='C:/Users/aseet/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const hash=b=>createHash('sha256').update(b).digest('hex');
if(existsSync(zip)) throw Error('Refusing to overwrite existing ZIP');
const receipt=JSON.parse(readFileSync(join(dir,'supplement-receipt.json'),'utf8'));
const looseHandoff=join(dir,'RELEASE_HANDOFF_2026-11-02.md');
const normalizedText=path=>readFileSync(path,'utf8').replace(/\r\n/g,'\n');
if(normalizedText(looseHandoff) !== normalizedText('C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029/docs/RELEASE_HANDOFF_2026-11-02.md')) throw Error('Unexpected loose handoff content');
unlinkSync(looseHandoff); // The restored repository has working relative evidence links.
copyFileSync('C:/Users/aseet/AppData/Local/Temp/threecore-supplement-build-20261102.mjs',join(dir,'BUILD-METHOD.mjs'));
copyFileSync(import.meta.filename,join(dir,'SEAL-METHOD.mjs'));
const readme=[
'ThreeCore レビュー資料・追加分（2026年11月2日）',
'',
'目的',
'既存の完全版に、その後のソース照合結果・実機確認記録・最新のレビュー案内を追加します。',
'このZIP単体ではWalletを起動できません。先に保存した完全版が必要です。',
'資料の追加であり、公開・リリース・90%到達の承認ではありません。',
'',
'必要な完全版',
'ThreeCore-review-23d0a35-20261102.zip',
'SHA-256: 31a88b5c015fd4adb71100d8b66fb8fd06b4eae5ad14defd868e76ce9d80aadc',
'完全版にある ThreeCore-Wallet-review.bundle を使用します。',
'そのbundleのSHA-256: '+receipt.baseBundle.sha256,
'',
'追加される内容',
'・6件の配置済みコントラクトと保存ソースの照合。実行部分6件一致、メタデータを含む全体5件一致。',
'・初回発行の保存データを再検証するプログラムと取得記録。',
'・実Walletとの口座・ネットワーク不一致を拒否し、履歴を保全した確認記録。',
'・公開PRとローカル修正版を区別する最新のレビュー案内。',
'・元のWallet実装と自動テストのコードは完全版から変更していません。',
'',
'復元手順（GitとNode.jsが必要です）',
'完全版フォルダーと追加分フォルダーを同じ親フォルダーに展開してください。',
'下記はその親フォルダーで実行します。threecore-review-current は未作成の名前を使ってください。',
'',
'git init threecore-review-current',
'git -C threecore-review-current config core.autocrlf true',
'git -C threecore-review-current fetch ../ThreeCore-review-23d0a35-20261102/ThreeCore-Wallet-review.bundle HEAD',
'git -C threecore-review-current checkout --detach FETCH_HEAD',
'git -C threecore-review-current bundle verify ../ThreeCore-review-supplement-9c8c81b-20261102/ThreeCore-Wallet-23d0a35-to-9c8c81b.bundle',
'git -C threecore-review-current fetch ../ThreeCore-review-supplement-9c8c81b-20261102/ThreeCore-Wallet-23d0a35-to-9c8c81b.bundle HEAD',
'git -C threecore-review-current checkout --detach FETCH_HEAD',
'git -C threecore-review-current rev-parse HEAD',
'',
'最後の表示は '+receipt.targetRevision+' と一致する必要があります。',
'',
'cd threecore-review-current',
'node scripts/verify-evidence-collection.js .',
'node docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs',
'',
'復元後に読む資料',
'threecore-review-current/docs/RELEASE_HANDOFF_2026-11-02.md',
'このファイル内の相対リンクから、各記録へ進めます。',
'',
'今回実際に確認したこと',
'完全版がない空の保管場所では、追加bundleの検証が失敗することを確認しました。',
'完全版→追加分の順に新しい作業フォルダーへ復元し、版番号・全Git履歴・作業ツリーを照合しました。',
'253個の証拠一覧に含まれる2,539件の照合項目がすべて一致しました。',
'過去の読み取り結果149ファイルの検証も成功しました。新たなチェーン読み取りではありません。',
'Wallet全体の機能テストは、同じ実装の既存検証記録を引き継ぎ、今回は繰り返していません。',
'',
'まだ残ること',
'MetaMask自体での口座とネットワークの切り替え、実WalletのSepolia確認、候補版への移行と戻し。',
'DAT本番のコンパイラ情報の完全照合、開発依存関係の指摘、第三者レビューと正式な公開判断。',
'元の4231サーバーと作業中の記録は、この資料作成では変更していません。',
'',
'同梱ファイル',
'supplement-receipt.json: 版番号・検証結果・追加bundleの照合値',
'evidence-verification.json / historical-verification.json: 実行結果の原文',
'changed-files.txt: 完全版から変わった65ファイル',
'bundle-verification.txt: 元版がない場合の拒否と、元版を入れた後の成功',
'SHA256SUMS.txt: この追加分のファイル照合値',
'BUILD-METHOD.mjs / SEAL-METHOD.mjs: 作成時に使った処理。元のPCの保存場所を含むため、再実行は不要です。',
'',
'チェックサムの一致はファイルの同一性を確認するもので、安全性の認証やリリース許可ではありません。',
''];
writeFileSync(join(dir,'はじめに_README.txt'),readme.join('\n'));
const files=readdirSync(dir).filter(n=>n!=='SHA256SUMS.txt').sort();
if(files.some(n=>!statSync(join(dir,n)).isFile())) throw Error('Unexpected directory');
const lines=files.map(n=>hash(readFileSync(join(dir,n)))+'  '+n);
writeFileSync(join(dir,'SHA256SUMS.txt'),lines.join('\n')+'\n');
const code=[
'import pathlib,sys,zipfile,tempfile,hashlib,json',
'root=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2])',
'with zipfile.ZipFile(target,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:',
' for f in sorted(root.iterdir()):',
'  assert f.is_file()',
'  z.write(f,f.name)',
'fresh=pathlib.Path(tempfile.mkdtemp(prefix="threecore-supplement-zip-"))',
'with zipfile.ZipFile(target) as z:',
' names=z.namelist()',
' assert len(names)==len(set(names))',
' assert all(pathlib.PurePosixPath(n).name==n and n not in (".","..") for n in names)',
' z.extractall(fresh)',
'lines=(fresh/"SHA256SUMS.txt").read_text(encoding="utf-8").splitlines()',
'for line in lines:',
' digest,name=line.split("  ",1)',
' assert hashlib.sha256((fresh/name).read_bytes()).hexdigest()==digest, name',
'assert set(names)=={line.split("  ",1)[1] for line in lines}|{"SHA256SUMS.txt"}',
'print(json.dumps({"manifestEntries":len(lines),"zipEntries":len(names),"allMatched":True,"extractedTo":str(fresh)}))'
].join('\n');
const verified=JSON.parse(execFileSync(python,['-c',code,dir,zip],{windowsHide:true,encoding:'utf8'}));
const summary={schema:'threecore.review-supplement-zip.v1',recordedAt:new Date().toISOString(),
 sourceRevision:receipt.targetRevision,zip:zip.split('/').at(-1),bytes:statSync(zip).size,
 sha256:hash(readFileSync(zip)),rootManifestSha256:hash(readFileSync(join(dir,'SHA256SUMS.txt'))),
 manifestEntries:verified.manifestEntries,zipEntries:verified.zipEntries,freshExtractionAllMatched:verified.allMatched,
 requiresBaseZip:'ThreeCore-review-23d0a35-20261102.zip',baseThenDeltaRestorePassed:true};
writeFileSync('C:/Users/aseet/Downloads/ThreeCore-supplement-zip-receipt-20261102.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({summary,extractedTo:verified.extractedTo},null,2));
