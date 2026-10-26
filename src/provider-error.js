// Rejections are arbitrary JavaScript values, including inaccessible proxies.
// Inspect only primitive fields; never invoke an error object's coercion hooks.
/** Local adapter diagnostics may only expose an own data property, not an accessor. */
export function readOwnErrorCode(error) {
  try {
    const code = Object.getOwnPropertyDescriptor(error, "code")?.value;
    return typeof code === "number" || typeof code === "string" ? code : undefined;
  } catch { return undefined; }
}

export function readErrorCode(error) {
  try {
    const code = error?.code;
    return typeof code === "number" || typeof code === "string" ? code : undefined;
  } catch { return undefined; }
}

export function readErrorMessage(error) {
  try {
    const message = typeof error === "string" ? error : error?.message;
    if (typeof message === "string" && message.trim()) return message;
  } catch {}
  return "Walletの処理に失敗しました。接続状態を確認して、もう一度お試しください。";
}
