# EIP-6963のみで接続要求に進まない原因の調査

実施日：2026年10月21日（日本時間）

## 結論

今回の公式Aerodromeデスクトップ画面では、EIP-6963検出は成功しています。しかし、画面の候補一覧が初期設定のコネクター数に限定されるため、追加検出した模擬Walletを選択できません。「Browser Wallet」は従来のwindow.ethereumを参照するコネクターです。このためEIP-6963だけを公開する模擬Walletへは、接続許可の要求が届きません。

再通知と待機後の再クリックでも同じ結果でした。単なる最初の通知タイミングや、模擬Walletが許可要求を拒否したことが原因ではありません。EIP-6963規格全般の非対応を示すものではなく、今回観測した公式ページの候補選択経路の制約です。

## 開始時の確認

4リポジトリのmainとローカルHEADの一致、未コミット変更なし、Phase 11の全main CI成功を確認しました。

| リポジトリ | 開始時main |
| --- | --- |
| ThreeCore-Wallet | `2b6a23b61d04cd72f3d868f66c037a1aae07776b` |
| DAT | `bc4669c5c7dcd739e32a388c65df695036135019` |
| EMA-Draft | `99ae43bde36909ebd5763735be9576a732425e53` |
| CAWELON-Draft | `0337ea55eca6a67aced765f36a519a5734fb4218` |

最初の公式Aerodrome模擬検証 `4848c39b60bac2c63fc38f685cdef12cd96290a8` とPhase 11の観測を引き継いでいます。

## 原因を確かめた証拠

隔離した拡張機能なしの一時Chromeで、従来方式とEIP-6963のみを別々に検証しました。[検証実行](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39498715359)のソースは `1aa163c6edd128e5755f6a9245a20874d91af05c` です。最終mainでは同じ検査コードへ文書・観測記録・トークン固定版設定だけを追加しています。

1. ページ読み込み時にdAppから検出要求を受け、Walletが再通知しました。
2. 接続ボタンを押す前に、dAppからeth_accounts照会が届きました。前回見えた照会は接続許可そのものではありません。
3. 読み込み後2.5秒待ってBrowser Walletを押しても、EIP-6963のみでは許可要求が来ませんでした。
4. 明示的な再検出要求にWalletが応答した後、再度クリックして5秒観測しても、許可要求は届きませんでした。
5. 同じ公開JavaScriptを読み取り、検出した候補の追加、画面側の候補の切り詰め、Browser Walletのwindow.ethereum参照を確認しました。
6. 従来方式では許可要求、署名の4001拒否、模擬許可取り消し、明示的な再接続まで成功しました。

対象の公開資産：`https://aerodrome.finance/assets/index-8N6caatx.js`、SHA-256 `1ab822229f1f4b7e20c1e7b4780cceb1afca995a31d8d4ef7f3a7a4ec8a94a38`。画面は初期コネクター数で切り詰め、標準InjectedコネクターをBrowser Walletと表示します。[証拠JSON](phase12-discovery-evidence.json)には取得元、指紋、位置、RPCの呼び出し順と段階を記録しました。将来のビルドでも同じとは限りません。

RPCの記録だけでは画面内部の選択原因までは断定できないため、診断コードでは「検出したが許可要求がない」という観測結果と、公開ソースを照合した原因分析を分けています。

## ThreeCore側の変更と検証

- 模擬Walletに検出要求・通知・RPCの段階と順序の記録を追加。署名メッセージやRPC引数は記録せず、トレースは200件までに制限。
- `--diagnose-discovery`で読み込み待ち・再通知・再クリックと公開資産の読み取り検査を実行。資産はロード済みの同一公式オリジンのJavaScriptだけを対象とし、リダイレクトを許可せず、24資産・各6MiB・8秒に制限。
- 検出完了と接続許可を区別し、記録不足や上限到達を原因確定に扱わない診断を追加。
- ThreeCore画面のブラウザー検査を3件追加。従来プロバイダーなしでEIP-6963から接続・残高読み取り、遅れて届くWalletの選択、追加Walletがあっても選択済みプロバイダーへ接続することを確認。

Wallet基本361件（12件追加）、Chrome UI21件（3件追加）が成功しました。通常CIではHTTP2件、3トークン各120件の読み取り・10件の履歴EVM・42件のWallet結合検査を維持します。最終mainのCI結果はActionsと最終検証記録で確認します。重複実行数を独立ケースとして合算しません。

```sh
npm test
npm run test:browser-ui # LinuxのChrome
npm run test:external-dapp -- --eip6963-only --diagnose-discovery
npm run test:external-dapp -- --diagnose-discovery
```

## 外部サイト側に必要な対応と境界

外部dApp側は、検出されたコネクターを初期設定数で除外せず、利用者がそのWalletを選べるようにし、選んだコネクターを接続処理へ渡す必要があります。ThreeCoreの画面はこの選択経路を持ち、今回の模擬ブラウザー検査で動作を確認しています。

Aerodromeの公開サイトは変更していません。未選択Walletへの自動切替、window.ethereumの上書き、他Walletの名前の偽装でEIP-6963接続成功に見せる回避策も追加していません。公式画面のEIP-6963のみの接続は未成立のままです。上流へのメッセージ送信やIssue作成は行っていません。

## 未検証と禁止事項

実Wallet、署名ログイン完了、取引、WalletConnectやCoinbase/Binance拡張、他のdApp、本番の安全性・第三者監査は未検証です。検査の署名要求はすべて模擬プロバイダーで拒否し、秘密鍵は用意していません。

実Walletでの署名・売買・送金・承認・LP追加、ゲーム開発は行っていません。トークンのSolidity、供給量、配備設定、ThreeCoreの読み取り専用セッション処理は変更していません。

仕様参照：[EIP-6963](https://eips.ethereum.org/EIPS/eip-6963)。
