/** Observable crypto status is deliberately smaller than any operation input. */
const fields = ["started", "completed", "failed", "cancelled", "timedOut", "late", "denied"];
const phases = ["idle", "running", "draining", "disposed"];
function own(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) throw Error("SECURE_STATUS");
  return descriptor.value;
}
export function secureOperationStatus(value) {
  try {
    if (!value || typeof value !== "object") throw Error("SECURE_STATUS");
    const phase = own(value, "phase");
    const busy = own(value, "busy");
    const disposed = own(value, "disposed");
    const clockFault = own(value, "clockFault");
    if (!phases.includes(phase) || typeof busy !== "boolean" ||
        typeof disposed !== "boolean" || typeof clockFault !== "boolean" ||
        (disposed !== (phase === "disposed")) ||
        (["running", "draining"].includes(phase) && !busy) ||
        (phase === "idle" && busy)) throw Error("SECURE_STATUS");
    const result = { available: true, phase, busy, disposed, clockFault };
    for (const name of fields) {
      const count = own(value, name);
      if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000_000) throw Error("SECURE_STATUS");
      result[name] = count;
    }
    return Object.freeze(result);
  } catch {
    return Object.freeze({ available: false });
  }
}
export function describeSecureOperation(value) {
  const status = secureOperationStatus(value);
  if (!status.available) return "暗号処理の状態を確認できません。合言葉やファイルの内容は表示しません。";
  if (status.clockFault) return "経過時間の確認に失敗したため暗号処理を停止しました。画面を開き直してください。";
  if (status.phase === "disposed") return "この画面の暗号処理は終了しています。";
  if (status.phase === "draining") return "取り消し済みの暗号処理が終了するのを待っています。その結果は使いません。追加の暗号処理は待機中です。";
  if (status.phase === "running") return "PC内で暗号処理を実行しています。同時に実行できるのは1件です。";
  return "暗号処理の待機はありません。保存や復元は各ボタンから明示的に行ってください。";
}
export function describeSecureOperationCounts(value) {
  const status = secureOperationStatus(value);
  if (!status.available) return "";
  return `この画面で開始: ${status.started}件 ／ 完了: ${status.completed}件 ／ ` +
    `取り消し: ${status.cancelled}件 ／ 時間超過: ${status.timedOut}件 ／ ` +
    `失敗: ${status.failed}件 ／ 受け付けなかった操作: ${status.denied}件`;
}
