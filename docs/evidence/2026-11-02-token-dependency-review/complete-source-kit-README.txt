ThreeCore コード照合・完全一致版（2026年11月2日）

今回確認できたこと
・DAT・EMA・CAWELONの本番／テストネット、6件すべてのコードが、コンパイラ情報を含めて完全一致。
・本番3件の作成コードと初回発行を再確認。
・EMA・CAWELONのテストネット2件の作成コードと初回発行も再確認。
・DAT本番で残っていた違いは、ファイルの配置場所と末尾の改行1文字でした。

保存された過去のチェーン応答と公開ソースを、手元で再コンパイルして照合するための一式です。
現在の残高や安全監査、メインネットの公開許可を示すものではありません。

再確認の方法（Node.js 22以上）
1. ZIPを新しいフォルダーへ展開し、そのフォルダーでターミナルを開きます。
2. コンパイラ部品を初回だけ導入します。npmの公式配布先への接続が必要です。
cd compiler
npm ci --ignore-scripts --no-audit --no-fund
cd ..
3. 保存されたデータを照合します。ここからはネット接続・Walletが不要です。
node evidence/reconstruct-runtime-source.mjs ./compiler
node evidence/verify-dat-mainnet-source-controls.mjs
node evidence/verify-recorded-mainnet-deployments.mjs ./compiler
node evidence/verify-recorded-sepolia-deployments.mjs ./compiler

成功時の目安
最初の結果: completeRuntimeMatches = 6、remainingMetadataMismatches = []
入力検査: rejectedControls に9項目
本番の結果: completeCreationBytecodeMatches = 3
テストネットの結果: creationAndInitialMintMatches = 2

REPORT.mdに方法と限界、evidenceに元データと検証プログラム、resultsに今回の実行結果があります。
SHA256SUMS.txtは全ファイルの照合値です。改変検出用であり、発行者や安全性の認証ではありません。
この版のソース: f7aaec1e7179324bb9dcb7d8efb17b6414b5dcf9
以前の9838e5b版は5/6の結果を記録した別の時点の資料で、上書きしていません。
今回の配布確認には、以前に新規構築して検証済みのコンパイラ環境を再利用しました。
部品の版と本体の照合値を再確認し、新しい保存場所から全4コマンドが成功しました。
元の開発環境に残るZodの問題や、実Walletの切り替え・移行・第三者レビューは別の確認事項です。
