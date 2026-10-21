# 接続状態とpermitの追加検証 — 2026-10-21 JST

開始時のmainはDAT `e7df5e8`、EMA `598c132`、CAWELON `b371cd1`、Wallet `b92cc15`。GitHubのmainとローカルHEADの一致、および未コミット変更なしを確認して開始した。

## Wallet修正

接続許可待ちで発生する切断・アカウント変更・チェーン変更を、接続完了前から監視する。許可応答後に`eth_accounts`を再確認し、途中で選択アカウントが変わった場合は接続しない。

古い`eth_chainId`応答は接続世代を確認してから解釈する。これにより、再接続前の応答が新しい接続を切断しない。イベント登録が途中で失敗した場合も接続状態を残さず、providerのイベント解除処理が例外を投げてもローカルの認可を解除する。解除できなかった古いコールバックも新しい接続には影響しない。

WalletとAerodrome公開RPC inspectorのERC-20残高・既存承認額は、完全な32バイト1ワードのABI戻り値だけを受け入れる。空・短い・余分なワード付きの応答は拒否する。ネイティブETH残高のRPC数量形式とは分けて検証する。

## 検証結果

- 追加した接続境界テスト13件は修正前にすべて失敗し、問題を再現した。
- 修正後のWallet全テスト156件が成功。失敗・スキップ0。
- DAT `npm run check`: コンパイル、Hardhat runner 102件、型検査、追加read-only runner 65件が成功。
- EMA / CAWELON `npm run check`: それぞれコンパイル、Hardhat runner 104件、型検査、追加read-only runner 65件が成功。
- Hardhat runnerにもread-onlyテストが含まれるため、件数を独立テストとして合算しない。

3トークンそれぞれにpermit境界テスト10件を追加した。別チェーン、別コントラクト、異なるドメイン名・バージョン、異なるnonce、不正署名者、owner・spender・金額・期限の改変を拒否することを、実際にローカル模擬EVMへ要求して確認した。拒否理由は`ERC2612InvalidSigner`を確認している。失敗前後でnonce・既存承認額・供給量・保有量が変わらず、その後の正しいpermitが成功することも検証した。

これらの署名・承認・コントラクト作成はHardhat模擬EVM内だけで実行した。実Wallet・秘密鍵・キーストア・公開チェーンへの書き込みは使用しない。トークンの本番コントラクト変更・デプロイは行っていない。

## 範囲と未検証

公式Aerodrome模擬Walletの実サイト検証は[前回記録](VALIDATION_2026-10-21.md)を継承し、この工程では再実行していない。今回の修正はローカル回帰テストとGitHub CIで検証する。

実Walletログイン完了、WalletConnectなど他の接続方式、外部dApp全体との完全互換性、デプロイ済みbytecodeとローカルソースの完全一致、独立監査は未検証。イベントを発行しないproviderのすべての状態変化を検出する保証や、進行中RPCのキャンセルは提供しない。

実Walletでの署名・売買・送金・承認変更・LP追加は実施せず、ゲーム開発も行っていない。

仕様参照: [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193)、[Solidity ABI](https://docs.soliditylang.org/en/latest/abi-spec.html)、[ERC-2612](https://eips.ethereum.org/EIPS/eip-2612)。
