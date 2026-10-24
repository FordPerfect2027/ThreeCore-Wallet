import { STORAGE_CONCURRENCY, STORAGE_COUNTER_LIMIT, ownStorageData } from "./storage-guard-policy.js";
import { STORAGE_STATUS_SCHEMA } from "./storage-guard.js";

const counters = ["active", "maxActive", "opening", "reading", "writing", "draining",
  "accepted", "completed", "failed", "cancelled", "timedOut", "rejected", "late", "uncertain"];
const fields = ["schema", "disposed", "clockFault", "canStart", ...counters];

/** Exact aggregate-only schema. Never render adapter prose or saved document data. */
export function validateStorageStatus(input) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return null;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) return null;
    const result = {};
    for (const key of fields) result[key] = ownStorageData(input, key);
    if (result.schema !== STORAGE_STATUS_SCHEMA ||
        ["disposed", "clockFault", "canStart"].some(key => typeof result[key] !== "boolean") ||
        counters.some(key => !Number.isSafeInteger(result[key]) || result[key] < 0 || result[key] > STORAGE_COUNTER_LIMIT) ||
        result.maxActive !== STORAGE_CONCURRENCY || result.active > result.maxActive ||
        result.opening + result.reading + result.writing + result.draining !== result.active ||
        result.uncertain > result.late ||
        (result.canStart && (result.disposed || result.clockFault || result.active >= result.maxActive))) return null;
    return Object.freeze(result);
  } catch { return null; }
}

export function describeStorageStatus(input) {
  const state = validateStorageStatus(input);
  if (!state) return Object.freeze({ level: "unavailable", heading: "PC内保存の状態を確認できません",
    detail: "この表示から保存の成功を判断しないでください。", counts: "集計は表示できません。", canStop: false });
  let level = "ready";
  let heading = "PC内保存の保護は待機中です";
  let detail = "保存開始時の内容を固定し、書き込む直前にも取り消しと期限を確認します。";
  if (state.active) {
    level = "working";
    heading = "PC内の保存領域を確認しています";
    detail = "保存完了の表示は、保存先の処理が確定してから行います。同時に4件まで受け付けます。";
  }
  if (state.draining) {
    level = "draining";
    heading = "停止を依頼した保存処理の終了を待っています";
    detail = "遅れて届いた結果は採用しません。保存先の終了が確認できるまで受付枠を保持します。";
  }
  if (!state.canStart && state.active === state.maxActive) {
    level = "limited";
    heading = "新しい保存処理の受付を待っています";
    detail = "未完了の処理が上限に達しています。自動で繰り返し保存することはありません。";
  }
  if (state.uncertain) {
    level = "review";
    heading = "保存結果の再確認が必要です";
    detail = "停止の依頼と保存完了が重なりました。対象の一覧を再読み込みし、内容を確認してから次の保存を行ってください。";
  }
  if (state.disposed || state.clockFault) {
    level = "stopped";
    heading = "このページの保存操作を停止しました";
    detail = state.clockFault ? "経過時間を確認できないため停止しました。ページを開き直してください。" :
      "保存済みのデータを削除する操作ではありません。";
  }
  const counts = [
    `未完了 ${state.active} / ${state.maxActive}件（開始待ち ${state.opening}、読み込み ${state.reading}、書き込み ${state.writing}、停止待ち ${state.draining}）`,
    `完了 ${state.completed}件 / 取消し ${state.cancelled}件 / 時間切れ ${state.timedOut}件`,
    `失敗 ${state.failed}件 / 受付できなかった操作 ${state.rejected}件 / 保存結果の再確認 ${state.uncertain}件`,
  ].join("\n");
  return Object.freeze({ level, heading, detail, counts, canStop: state.active > state.draining });
}
