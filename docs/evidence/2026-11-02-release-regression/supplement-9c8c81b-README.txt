ThreeCore レビュー資料・追加分（2026年11月2日）

目的
既存の完全版に、その後のソース照合結果・実機確認記録・最新のレビュー案内を追加します。
このZIP単体ではWalletを起動できません。先に保存した完全版が必要です。
資料の追加であり、公開・リリース・90%到達の承認ではありません。

必要な完全版
ThreeCore-review-23d0a35-20261102.zip
SHA-256: 31a88b5c015fd4adb71100d8b66fb8fd06b4eae5ad14defd868e76ce9d80aadc
完全版にある ThreeCore-Wallet-review.bundle を使用します。
そのbundleのSHA-256: 82ccc56f7aaa27f7c5b8dc592ba9990ff645d2db9de0d5efec57ace0ca329044

追加される内容
・6件の配置済みコントラクトと保存ソースの照合。実行部分6件一致、メタデータを含む全体5件一致。
・初回発行の保存データを再検証するプログラムと取得記録。
・実Walletとの口座・ネットワーク不一致を拒否し、履歴を保全した確認記録。
・公開PRとローカル修正版を区別する最新のレビュー案内。
・元のWallet実装と自動テストのコードは完全版から変更していません。

復元手順（GitとNode.jsが必要です）
完全版フォルダーと追加分フォルダーを同じ親フォルダーに展開してください。
下記はその親フォルダーで実行します。threecore-review-current は未作成の名前を使ってください。

git init threecore-review-current
git -C threecore-review-current config core.autocrlf true
git -C threecore-review-current fetch ../ThreeCore-review-23d0a35-20261102/ThreeCore-Wallet-review.bundle HEAD
git -C threecore-review-current checkout --detach FETCH_HEAD
git -C threecore-review-current bundle verify ../ThreeCore-review-supplement-9c8c81b-20261102/ThreeCore-Wallet-23d0a35-to-9c8c81b.bundle
git -C threecore-review-current fetch ../ThreeCore-review-supplement-9c8c81b-20261102/ThreeCore-Wallet-23d0a35-to-9c8c81b.bundle HEAD
git -C threecore-review-current checkout --detach FETCH_HEAD
git -C threecore-review-current rev-parse HEAD

最後の表示は 9c8c81bfd2cdefa8f9419815b5de79f490e02fc0 と一致する必要があります。

cd threecore-review-current
node scripts/verify-evidence-collection.js .
node docs/evidence/2026-10-28-readonly-verification/verify-evidence.mjs

復元後に読む資料
threecore-review-current/docs/RELEASE_HANDOFF_2026-11-02.md
このファイル内の相対リンクから、各記録へ進めます。

今回実際に確認したこと
完全版がない空の保管場所では、追加bundleの検証が失敗することを確認しました。
完全版→追加分の順に新しい作業フォルダーへ復元し、版番号・全Git履歴・作業ツリーを照合しました。
253個の証拠一覧に含まれる2,539件の照合項目がすべて一致しました。
過去の読み取り結果149ファイルの検証も成功しました。新たなチェーン読み取りではありません。
Wallet全体の機能テストは、同じ実装の既存検証記録を引き継ぎ、今回は繰り返していません。

まだ残ること
MetaMask自体での口座とネットワークの切り替え、実WalletのSepolia確認、候補版への移行と戻し。
DAT本番のコンパイラ情報の完全照合、開発依存関係の指摘、第三者レビューと正式な公開判断。
元の4231サーバーと作業中の記録は、この資料作成では変更していません。

同梱ファイル
supplement-receipt.json: 版番号・検証結果・追加bundleの照合値
evidence-verification.json / historical-verification.json: 実行結果の原文
changed-files.txt: 完全版から変わった65ファイル
bundle-verification.txt: 元版がない場合の拒否と、元版を入れた後の成功
SHA256SUMS.txt: この追加分のファイル照合値
BUILD-METHOD.mjs / SEAL-METHOD.mjs: 作成時に使った処理。元のPCの保存場所を含むため、再実行は不要です。

チェックサムの一致はファイルの同一性を確認するもので、安全性の認証やリリース許可ではありません。
