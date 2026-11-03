ThreeCore 最新修正を含むレビュー用統合保存版 / 2026-11-02

Wallet固定版: 212601977bc6dad8da298f11ebb9e7a421052571

wallet/source.zip と tokens/<DAT|EMA|CAWELON>/source.zip に各ソースが入っています。
各 history.bundle は完全なGit履歴です。以前の保存版は不要です。
package-receipt.json に版・復元確認・未完了事項を記録しています。
SHA256SUMS.txt で同梱ファイルを照合できます。

今回の収録内容：
・3トークンの開発ツールが空データをゼロ1バイトとして扱っていた不具合の修正。
・Walletが実際に返したネットワークとカード側の選択を区別する表示。
・既に実施したMainnet/Sepoliaの読み取り、保存・復元、候補版への移行・復帰の記録。

今回やり直した検査は、ソースとGit履歴の復元、保存証拠の照合、一時サーバーの起動確認です。
過去に通った検査を新しい検査として数えていません。
トークンのABIと実行コードは今回の開発ツール修正の前後で同一です。

これは開発・独立レビュー用です。公開承認や90%達成を示すものではありません。
実ウォレット接続中の口座・ネットワーク変更、Windows本来のファイル選択操作、
Zodの依存関係問題、独立レビュー、公開判断は未完了です。
秘密鍵やシードは不要です。利用者の署名・送金・承認取引は行わないでください。

依存ライブラリの実体は同梱していません。トークンのビルド検査にはnpm経由の導入が必要です。
既存の4231/4232サーバー・作業タブ・保存データを上書きしないでください。

Gitの復元例（必ず新しい空のフォルダー）：
  git init wallet-review
  git -C wallet-review fetch <展開先>/wallet/history.bundle HEAD
  git -C wallet-review checkout --detach FETCH_HEAD
  git -C wallet-review rev-parse HEAD

復元したWalletの docs/RELEASE_HANDOFF_2026-11-02.md と
docs/TOOLCHAIN_EMPTY_DATA_2026-11-02.md がレビューの入口です。
同梱ソース内で紹介される以前のZIPは過去の固定版です。今回の版は上記の固定版です。
チェックサムは内容の変化を検出しますが、発行者や安全性を認証しません。

同梱ファイルの確認（Node.jsが必要）：
  node verify-package.mjs
allMatched: true が出れば、同梱一覧とすべてのファイルが一致しています。
ZIP自体は隣の .sha256 ファイルと照合できます。
