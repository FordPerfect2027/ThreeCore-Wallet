/** Provider-supplied prose can contain phishing instructions or private data. */
const messages = new Map([
  [4001, "Walletで接続操作が拒否されました。"],
  [4100, "Walletの接続許可がありません。再接続してください。"],
  [4200, "Walletがこの読み取り方法に対応していません。"],
  [4900, "Walletが切断されています。"],
  [4901, "選択したチェーンに接続できません。"],
  [-32002, "Walletに未完了の確認があります。Wallet画面を確認してください。"],
  [-32601, "Walletがこの読み取り方法に対応していません。"],
  [-32602, "Walletが読み取り条件を受け付けませんでした。"],
  [-32000, "Walletから読み取り結果を取得できませんでした。"],
  [-32001, "指定したブロックの状態を読み取れませんでした。"],
  ["PERMISSION_PENDING", "Walletに未完了の接続確認があります。"],
]);

export function safeProviderFailure(value) {
  let code;
  try {
    const candidate = value?.code;
    if (messages.has(candidate)) code = candidate;
  } catch {}
  const error = new Error(messages.get(code) ?? "Walletの処理に失敗しました。接続状態を確認してください。");
  error.name = "ProviderBoundaryError";
  error.code = code ?? "PROVIDER_FAILURE";
  return error;
}
