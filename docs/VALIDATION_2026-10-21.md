# 安全性・互換性の再検証（2026-10-21 JST）

開始時のmain: Wallet `4848c39b60bac2c63fc38f685cdef12cd96290a8`、DAT `f4249160dade663ab50c97452f0a23ec6f912f0b`、EMA `41538151cb5148dc57d249100a2be16f7e3e53c0`、CAWELON `a8b9abf62a9b76fe8f92a95c3e2b91681ed8c01e`。新規取得した4作業ツリーは変更なし。別環境にある未保存・未コミット変更は確認対象外。参照会話の全文取得機能は利用できず、指定コミットとリポジトリ内の記録を継承した。

## 実装

- Walletと3トークンのread-only readinessでuint256上限超過を拒否。最大値の既存承認額は丸めず保持し、承認済みという露出として報告する。
- Aerodrome模擬Walletの注入先を完全なoriginで照合し、別ポートを拒否する。
- 公開RPC inspectorのコード・残高・既存承認額を、レポートに記載する同一ブロックへ固定。`latest`の進行による観測混在を防ぐ。ブロック番号による固定であり、チェーン再編や不正RPCへの耐性を保証しない。
- Walletのオフライン回帰テストをGitHub Actionsへ追加。外部サイトのテストはCIから除外。
- 初回Linux CIで既存の行数集計ツールのWindows絶対パス判定が失敗したため、OSに依存せずWindowsパスも拒否するよう修正。検証証跡JSONなどdocs配下も行数集計から除外した。

## 実際の検証

- Wallet: `npm test` 142件成功、失敗・スキップ0。
- DAT: `npm run check` 成功。Hardhat runner 92件、追加のread-only runner 65件成功。
- EMA / CAWELON: それぞれ `npm run check` 成功。Hardhat runner各94件、追加のread-only runner各65件成功。
- Hardhat runnerにはread-onlyテストも含まれるため、上記件数を独立テストとして合算しない。コンパイル、模擬EVM上の供給量・転送・承認・permit等の既存テスト、型検査を含む。模擬EVM専用アカウントを使い、実Walletは使わない。
- 3トークンそれぞれの `npm ci --ignore-scripts`: auditの既知脆弱性報告0件。独立監査や安全性保証ではない。
- 公式Aerodromeを新規一時Edgeプロファイルで再検証。Browser Wallet表示、`wallet_requestPermissions` / `eth_requestAccounts`、Sign-inでの`personal_sign`要求を確認。模擬providerが署名要求を拒否し、署名・送信なし。前回の結果を再現した。
- Base Mainnetの公開RPCで3トークンのidentity検証を再実行し成功。
- Aerodrome Classic PoolFactory照会、Base block `52862187`: 3つのvolatile token/USDCプールのコード・トークン組合せ・準備金を確認。USDC側は各`100000000` base units（100 USDC）。stableの3ペアはゼロアドレス。時点観測であり、流動性の十分性や取引可能性を保証しない。

## 未検証事項と禁止事項

実Wallet接続、Aerodromeログイン完了、ThreeCore製Walletの外部dAppでの採用・完全互換性、売買実行、Slipstream・UniversalRouter・他DEX互換性、独立したスマートコントラクト監査は未検証。

実Walletでの署名、売買、送金、承認変更、LP追加、デプロイは行っていない。ゲーム開発なし。20,000行に合わせるための水増しなし。テストは現在のソースと限定された動作の証拠であり、デプロイ済みbytecodeとソースの完全一致や安全性の認定ではない。
