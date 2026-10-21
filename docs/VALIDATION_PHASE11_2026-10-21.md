# 外部dApp・模擬Wallet接続互換性の検証

実施日：2026年10月21日（日本時間）

## 開始時の確認

4リポジトリのmainとローカルHEADの一致、未コミット変更なし、Phase 10の全CI成功記録を確認しました。

| リポジトリ | 開始時main |
| --- | --- |
| ThreeCore-Wallet | `20ff0dcb7f9d912ffcaf38fe2e5acbe151d60440` |
| DAT | `dcdbfc3877d838c2e52d079aa4316ba7bd494830` |
| EMA-Draft | `b7b0cfda167137786b6257678759d2387ede7ccc` |
| CAWELON-Draft | `781022c0c0f828c2f7115d5fb2f1cea41a8e1898` |

前回の公式Aerodrome模擬検証 `4848c39b60bac2c63fc38f685cdef12cd96290a8` を継承し、今回は公式サイトで再実行しました。

## 修正

模擬Walletの許可応答にdAppのinvokerと公開する模擬アカウントの制限を追加しました。接続許可と取り消しでaccountsChangedを通知し、on/removeListenerは登録解除と戻り値の連結に対応します。従来はイベントが通知されず、invokerも欠けていました。修正前の2件の失敗で確認しています。

EIP-6963の通知内容を固定し、window.ethereumを出さない検証モードを追加しました。検出だけではアカウントを公開せず、署名・送信・承認・ネットワーク切替・未許可RPCは従来どおり拒否します。模擬許可の取り消しは検査用のメモリー操作です。

公式画面の初回検査では、wallet_requestPermissionsの応答だけでSign-inまで進み、eth_requestAccountsが不要となる経路を観測しました。両方の呼び出しを必須とした検査条件を修正し、許可要求、実際の模擬アカウント付与、署名要求と拒否の証拠で判定します。URLが開いたことやボタンクリックだけでは接続成功にしません。

## 公式サイトでの観測

[GitHub Actionsの検証](https://github.com/FordPrefect2026/ThreeCore-Wallet/actions/runs/39495046594)は、拡張機能・既存Cookie・アカウントを持たない一時Chromeで、公式 `https://aerodrome.finance/dash` から `/connect` に進んで実施しました。検証ソースは `c715aeecce292340655ba6212b2e8fdd772a835f` です。mainに反映する同じ検査コードへ、結果文書とトークンの固定版設定を追加しました。

| 模擬Walletの公開方法 | 実際に確認できた範囲 |
| --- | --- |
| window.ethereumとEIP-6963の両方 | Browser Walletから接続許可、Sign-in、personal_sign要求、4001による拒否。模擬許可取り消しで接続選択画面へ復帰し、明示的な再接続でSign-inへ戻ることを確認。 |
| EIP-6963のみ | eth_accounts照会を観測。Browser Wallet操作後も接続許可要求に進まず、接続成立は確認できなかった。 |

後者の診断ジョブ成功は「観測を完了した」意味であり、接続互換性の合格ではありません。EIP-6963全般の非対応を断定する結果でもありません。前者も署名を拒否するため、ログインは完了していません。

[観測記録](phase11-external-dapp-evidence.json)に実行日時、対象コミット、RPC、イベント、判定結果を保存しました。初回の検査条件による失敗も記録しています。

## テストと再実行

- Wallet基本349件成功、失敗・スキップ0件。27件追加。
- DAT・EMA・CAWELON各セッションを従来方式/EIP-6963方式で検出・接続し、許可取り消しによる即時無効化と明示的な再接続を検証。
- 不正な許可指定、応答配列の変更による状態汚染、解除済みリスナー、未許可の署名/送信/切替、URLだけの誤判定、模擬アカウント未付与、許可のみの接続経路を検証。
- mainの通常CIではHTTP2件、模擬Chrome UI18件、各トークン読み取り120件・履歴EVM10件・Wallet結合42件を維持。トークン側でも契約/permit/型検査を継続します。
- 同じケースの複数CIでの実行を独立ケースとして合算しません。最終mainのCI結果はActionsと最終検証記録で確認します。

```sh
npm test
# Windows: Edge / Linux: /usr/bin/google-chrome
npm run test:external-dapp
npm run test:external-dapp -- --eip6963-only
```

ライブ検査は既定のnpm testに含めず、専用のexternal-dapp.ymlを手動実行できます。本フェーズの検証ブランチでも実行します。外部サイト変更・通信不調は実測結果に影響するため、通常のオフライン回帰と分けています。任意URL・既存ブラウザープロファイルの指定は受け付けません。

## 制約・未検証

これは模擬プロバイダーと公式Web画面の検証です。ThreeCore Wallet拡張そのものを配布・接続した検証ではありません。実Walletログイン、署名認証の完了、実残高表示、注文、トークン選択後の取引、WalletConnect、Coinbase/Binance拡張、他のdAppは未検証です。

現行のThreeCoreセッションは読み取り専用のままです。トークンのSolidity、供給量、配備設定は変更していません。実Walletでの署名・売買・送金・承認・LP追加、ゲーム開発は行っていません。模擬アカウントには秘密鍵を用意せず、全署名を拒否しました。第三者監査や本番安全性の証明ではありません。

仕様参照：[EIP-1193イベント](https://eips.ethereum.org/EIPS/eip-1193#events)、[EIP-2255許可応答](https://eips.ethereum.org/EIPS/eip-2255#wallet_getpermissions)、[EIP-6963検出](https://eips.ethereum.org/EIPS/eip-6963)。
