import { FILE_READ_CONCURRENCY, FILE_READ_RESERVED_LIMIT } from "./file-read-policy.js";

const counters = ["active", "waiting", "retained", "reservedBytes", "maxActive", "maxReservedBytes",
  "accepted", "completed", "failed", "cancelled", "timedOut", "rejected"];
const keys = ["schema", "disposed", "clockFault", "canStart", ...counters];

/** The UI only accepts the exact aggregate schema; no untrusted prose is shown. */
export function validateFileReadStatus(input) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return null;
    const names = Reflect.ownKeys(input);
    if (names.length !== keys.length || names.some(key => !keys.includes(key))) return null;
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
      result[key] = descriptor.value;
    }
    if (result.schema !== "threecore-file-read-status-v1" ||
        ["disposed", "clockFault", "canStart"].some(key => typeof result[key] !== "boolean") ||
        counters.some(key => !Number.isSafeInteger(result[key]) || result[key] < 0) ||
        result.maxActive !== FILE_READ_CONCURRENCY || result.maxReservedBytes !== FILE_READ_RESERVED_LIMIT ||
        result.active > result.maxActive || result.reservedBytes > result.maxReservedBytes ||
        result.waiting + result.retained !== result.active ||
        (result.active === 0) !== (result.reservedBytes === 0) ||
        result.reservedBytes < result.active ||
        result.canStart !== (!result.disposed && !result.clockFault &&
          result.active < result.maxActive && result.reservedBytes < result.maxReservedBytes)) return null;
    return Object.freeze(result);
  } catch { return null; }
}

export function describeFileReadStatus(input) {
  const state = validateFileReadStatus(input);
  if (!state) return Object.freeze({ level: "unavailable", heading: "ファイル読み込みの状況を取得できません",
    detail: "読み込みが完了したことを示す表示ではありません。", counts: "表示できる集計がありません。" });
  let level = "ready";
  let heading = "ファイル読み込みの保護は待機中です";
  let detail = "JSONの読み込みは同時に4件までです。途中で止めた読み込みの遅い結果は取り込みません。";
  if (state.waiting) {
    level = "reading";
    heading = "ファイルを確認しています";
    detail = "大きさ・読み込み時間・データ形式を確認しています。完了前に保存内容を置き換えません。";
  }
  if (state.retained) {
    level = "retained";
    heading = "停止した読み込みの終了を待っています";
    detail = "元の処理が終わるまで上限の枠を保持します。遅れて届いた内容は破棄します。";
  }
  if (!state.canStart) {
    level = "limited";
    heading = "新しいファイル読み込みを受け付けられません";
    detail = "処理が終わるまでお待ちください。自動で再読み込みはしません。";
  }
  if (state.disposed || state.clockFault) {
    level = "stopped";
    heading = "ファイル読み込みを停止しました";
    detail = state.clockFault ? "経過時間を確認できません。この画面を再読み込みしてから操作してください。" :
      "この画面の読み込み処理は終了しました。保存済みファイルは変更していません。";
  }
  const counts = [
    `未完了: ${state.active} / ${state.maxActive}件（結果待ち ${state.waiting}件、停止後の未完了 ${state.retained}件）`,
    `受付済み入力サイズ: ${state.reservedBytes} / ${state.maxReservedBytes} bytes`,
    `完了 ${state.completed}件 / 取消し ${state.cancelled}件 / 時間切れ ${state.timedOut}件`,
    `読み込み失敗 ${state.failed}件 / 受付できなかった入力 ${state.rejected}件`,
  ].join("\n");
  return Object.freeze({ level, heading, detail, counts });
}
