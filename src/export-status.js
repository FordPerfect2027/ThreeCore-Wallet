import { EXPORT_LIMITS } from "./export-policy.js";
const fields = ["schema", "disposed", "clockFault", "cleanupBlocked", "canOffer", "active", "pendingCleanup",
  "reservedBytes", "maxActive", "maxReservedBytes", "accepted", "offered", "rejected", "failed", "released"];
export function inspectExportStatus(input) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
        Reflect.ownKeys(input).length !== fields.length) return null;
    const value = {};
    for (const key of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
      value[key] = descriptor.value;
    }
    if (value.schema !== "threecore-export-status-v1" ||
        ["disposed", "clockFault", "cleanupBlocked", "canOffer"].some(key => typeof value[key] !== "boolean")) return null;
    for (const key of fields.slice(5)) if (!Number.isSafeInteger(value[key]) || value[key] < 0) return null;
    if (value.maxActive !== EXPORT_LIMITS.active || value.maxReservedBytes !== EXPORT_LIMITS.totalBytes ||
        value.active > value.maxActive || value.reservedBytes > value.maxReservedBytes ||
        value.pendingCleanup > value.active || value.active > value.accepted ||
        value.offered > value.accepted || value.failed > value.accepted || value.released > value.accepted ||
        (value.active === 0) !== (value.reservedBytes === 0) || value.reservedBytes < value.active ||
        value.cleanupBlocked !== (value.pendingCleanup > 0) ||
        value.canOffer !== (!value.disposed && !value.clockFault && !value.cleanupBlocked &&
          value.active < value.maxActive && value.reservedBytes < value.maxReservedBytes)) return null;
    return Object.freeze(value);
  } catch { return null; }
}
export function describeExportStatus(input) {
  const value = inspectExportStatus(input);
  if (!value) return Object.freeze({ kind: "unavailable", title: "保存ファイルの保護状態を確認できません", detail: "画面を開き直してから確認してください。", counts: "" });
  const kind = value.cleanupBlocked ? "cleanup" : value.clockFault ? "clock" : value.disposed ? "closed" :
    !value.canOffer ? "limited" : value.active ? "retaining" : "ready";
  const text = {
    ready: ["保存ファイルの保護は待機中です", "保存ボタンを押したときだけ処理します。自動保存はしません。"],
    retaining: ["ブラウザーへ渡した一時URLを保持しています", "通常は約1秒後に解放します。ダウンロード完了はブラウザーで確認してください。"],
    limited: ["保存処理の上限に達しています", "一時URLの解放後に、保存ボタンから操作してください。自動再試行はしません。"],
    cleanup: ["一時URLの解放を確認できません", "追加の保存開始を止めています。「一時URLの解放を再試行」で確認してください。"],
    clock: ["時刻の異常により保存開始を止めました", "この画面を開き直して確認してください。既存の保存ファイルは変更しません。"],
    closed: ["保存ファイルの保護を終了しました", "この画面から新しい保存は開始しません。"],
  }[kind];
  return Object.freeze({ kind, title: text[0], detail: text[1], counts:
    `一時URLの枠: ${value.active} / ${value.maxActive}件（解放確認待ち ${value.pendingCleanup}件）\n` +
    `受付済み入力サイズ: ${value.reservedBytes} / ${value.maxReservedBytes} bytes\n` +
    `ブラウザーへ渡した件数 ${value.offered} / 受付拒否 ${value.rejected} / 処理失敗 ${value.failed}\n` +
    `解放した枠 ${value.released}件` });
}
