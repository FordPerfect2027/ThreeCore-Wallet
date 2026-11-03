# 公開dApp見積もりと提案・予算の結び付け

2026年11月3日。既存の各Tokenプロジェクトの `dex-quote` は個別トークンのプール見積もりを
取得していた。今回Wallet側に、3トークン共通の読み取り処理、Routerとの相互確認、原本付き
提案との照合を追加した。外部AIの接続設定を待つ間に進めた独立のdApp実装である。

## 実装した経路

Aerodrome ClassicのDAT・EMA・CAWELONとnative USDCのvolatileプールを対象にする。
買い方向（USDC→Token）と売り方向（Token→USDC）を明示して、入力額は最小単位で指定する。
共通Walletリポジトリに新しい依存ライブラリーは追加していない。

- Base Mainnetのチェーンとブロックを確定し、すべての状態読取を同じcanonical hashに固定する。
- Factory、Router、両トークン、プールのコード存在、Factory停止状態、Routerの既定Factory、
  プールのFactory・種類・token0/token1・桁数を確認する。
- 保存されたreserve、Factoryの手数料、Pool.getAmountOut、Router.getAmountsOutを取得する。
- 手数料の整数切捨てを含むvolatileプールの計算と、Pool・Router双方の返答が一致するか確認する。
- 最後に同じ高さのhash・時刻とチェーンを再確認する。対応しないRPCでlatest読取へ変更しない。
- 取得途中の取り消し、全体時間制限、個々の要求の時間制限、応答容量制限を維持する。

プロトコルの参照元は公式リポジトリの固定版
[`1ba30815`](https://github.com/aerodrome-finance/contracts/tree/1ba30815bba620f7e9faa34769ffd00c214c9b82)。
[Pool](https://github.com/aerodrome-finance/contracts/blob/1ba30815bba620f7e9faa34769ffd00c214c9b82/contracts/Pool.sol)の手数料控除とvolatile計算、
[Router](https://github.com/aerodrome-finance/contracts/blob/1ba30815bba620f7e9faa34769ffd00c214c9b82/contracts/Router.sol)の単一経路見積もり、
[公開アドレス](https://github.com/aerodrome-finance/contracts/blob/1ba30815bba620f7e9faa34769ffd00c214c9b82/README.md)を参照した。
5参照ファイルのSHA-256、12個の関数識別子と単一経路エンコードを、既存のviem 2.56.6でも
[別に照合した](evidence/2026-11-03-aerodrome-proposal-quote/protocol-reference-verification.json)。
これらは公開配備コードの完全同一性や安全性の監査ではない。

## 提案との照合

保存済みの提案確認ファイルを元の時刻で再現し、現在の時刻で使用条件を再検査する。
そのうえで見積もりのagent・チェーン・入力トークン・使用額・dApp origin・Routerを照合する。
予算に用いた原本のブロック番号とhashも同じであることを要求する。

許容する取得後経過秒、ブロック経過秒、出力量の差の上限、slippageの上限は呼び出し側が
明示する。未来の時刻、古いブロック、期限切れ提案、金額や対象の不一致、受取下限ゼロは
通さない。保存した見積もりはSHA-256と金額計算を再検査できる。

`outputShortfallBpsCeil` はreserve比率の理論値に対する出力の差を、basis point単位で
上向きに丸めた値。**手数料と最小単位の丸めを含み、純粋な市場価格への影響率ではない。**
特に小さい金額では丸めの影響が大きい。slippageから計算する最低出力量も見積上の比較値で、
実際の取引命令や約定保証ではない。

既存の提案・予算形式はDAT等のToken支出を対象にしているため、現状の提案照合に接続するのは
売り方向。買い方向の見積もり自体は取得済みだが、USDC支出予算と提案の画面統合は次の実装に残る。

## コマンド

JSONだけをファイルに保存する場合は `npm` の起動案内を混ぜず、次のように `node` を使う。

```text
node scripts/aerodrome-quote.js read DAT buy 1000000 50
node scripts/aerodrome-quote.js read EMA sell 1000000000000000000000 50 53457078
node scripts/aerodrome-quote.js verify DAT-quote.json
node scripts/aerodrome-quote.js review proposal-review.json DAT-quote.json 300 300 200 50
```

最後の4数値は取得後経過秒・ブロック経過秒・出力量差の上限bps・slippage上限bps。
上記は呼び出し形式の例であり、運用値の推奨や資金使用の許可ではない。
`read` の最後のブロック番号は省略可能。`verify` と `review` はオフラインで動作する。
終了値は0が取得／整合検査の成功、reviewの2が条件不一致、1が形式・取得・検査失敗。
画面からの見積もり取得・表示は、この変更にはまだ含まない。

## 実チェーンの結果

Base Mainnet **53,457,078**、hash
`0xe60495e68f89e6bf1dc9d70baadf368aa30027864b71dcbdf57b8c78f0ad656a`
で、3トークンとも売買両方向の読み取りを確認した。手数料は取得時30bps。

- 1 USDC相当の入力による[買い方向3件](evidence/2026-11-03-aerodrome-proposal-quote/live-results-buy.json)はすべて計算・Pool・Routerが一致。
- [1トークン入力](evidence/2026-11-03-aerodrome-proposal-quote/live-results.json)と
  [1,000トークン入力](evidence/2026-11-03-aerodrome-proposal-quote/live-results-sell1000.json)ではDAT・EMAが一致。
  CAWELONはどちらも出力が1 micro-USDC未満になり、有効な見積もりとして拒否された。
- 1 CAWELONのゼロ出力は[Pool・Routerの返答を独立に再読取](evidence/2026-11-03-aerodrome-proposal-quote/zero-output-control.json)して確認。
  1,000枚についても同じブロックのreserveと手数料からゼロへの丸めを再現した。
- CAWELONは既に取得した買い見積もりの出力額を逆方向の入力に用い、
  [974,514 micro-USDCという正の出力](evidence/2026-11-03-aerodrome-proposal-quote/cawelon-reverse-result.json)が一致した。
  同じ固定状態での別々の見積もりであり、連続した2取引をシミュレーションしたものではない。

計8個の有効な見積もりファイルと、ゼロ出力を検出した2件を保存した。
実口座、接続許可、署名、送金、承認取引は使っていない。
各保存ファイルは過去の観測であり、現在の価格や現在の実行可能性を示さない。

## 検証と次の作業

- [最終の提案・見積もり関連検証](evidence/2026-11-03-aerodrome-proposal-quote/final-limits-tests.tap): **38/38**。
- [既存の公開RPC・プール・残高読取の検証](evidence/2026-11-03-aerodrome-proposal-quote/related-tests.tap): **167/167**。
  一部は前者と重複するため、完了項目の合計として加算しない。
- [証拠ファイルのチェックサム](evidence/2026-11-03-aerodrome-proposal-quote/SHA256SUMS.txt)。

提案との結び付けを含む画面、USDC予算、実行前のgas・既存承認・状態変化の確認、隔離EVMでの
連続実行検査、製品内AIの接続は未完。今回の読み取りと比較だけで構想全体90%とは判断しない。
旧ZIPと利用中のサーバーは保持している。
