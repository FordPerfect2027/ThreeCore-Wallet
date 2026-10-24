import { RPC_COUNTER_MAX } from "./rpc-supervisor.js";

const counts = Object.freeze(["pending", "waiting", "abandoned", "occupiedProviders",
  "perProvider", "perPage", "started", "completed", "failed", "timedOut",
  "cancelled", "denied", "late"]);
const keys = Object.freeze(["schema", ...counts, "fault", "disposed", "canStart"]);

/** Reject unknown fields and accessors; diagnostic text must never echo RPC data. */
export function validateRpcStatus(input) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return null;
    const names = Reflect.ownKeys(input);
    if (names.length !== keys.length || names.some(key => !keys.includes(key))) return null;
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) return null;
      result[key] = descriptor.value;
    }
    if (result.schema !== "threecore-rpc-status-v1" ||
        counts.some(key => !Number.isSafeInteger(result[key]) || result[key] < 0 || result[key] > RPC_COUNTER_MAX) ||
        ![null, "RPC_CLOCK"].includes(result.fault) || typeof result.disposed !== "boolean" ||
        result.canStart !== (!result.fault && !result.disposed)) return null;
    if (result.perProvider < 1 || result.perProvider > 32 || result.perPage < result.perProvider ||
        result.perPage > 96 || result.pending > result.perPage ||
        result.waiting + result.abandoned !== result.pending ||
        result.occupiedProviders > result.pending ||
        (result.pending === 0) !== (result.occupiedProviders === 0)) return null;
    return Object.freeze(result);
  } catch { return null; }
}

export function describeRpcStatus(input) {
  const state = validateRpcStatus(input);
  if (!state) return Object.freeze({ level: "unavailable", heading: "応答状況を取得できません",
    detail: "接続の安全性や完了を確認した表示ではありません。必要な場合は上の停止ボタンで接続を停止してください。",
    counts: "表示できる集計がありません。" });
  let level = "ready";
  let heading = "応答待ちの要求はありません";
  let detail = "接続・再試行は各トークンの操作から行います。この表示だけで自動接続は行いません。";
  if (state.waiting) {
    level = "waiting";
    heading = "Walletの応答を待っています";
  }
  if (state.abandoned) {
    level = "pending";
    heading = "待機を終了した要求がWallet側で未完了です";
    detail = "停止や時間切れでも、拡張機能側の処理は取消できません。遅れて返る結果は使いません。Walletの画面を確認してください。";
  }
  if (state.pending >= state.perPage) {
    level = "limited";
    heading = "未完了の要求が上限に達しています";
    detail = "要求が完了するまで追加を受け付けません。接続をやり直しても未完了件数は消えません。自動再試行は行いません。";
  }
  if (state.disposed || state.fault) {
    level = "stopped";
    heading = "応答の監視を停止しました";
    detail = state.fault ? "経過時間を確認できないため、この画面からの要求を停止しています。" :
      "この画面の監視は終了しています。Wallet拡張機能の処理完了を意味するものではありません。";
  }
  const summary = [
    "この画面の未完了: " + state.pending + " / " + state.perPage,
    "結果を待機中: " + state.waiting + "　待機終了後も未完了: " + state.abandoned,
    "Wallet提供元ごとの上限: " + state.perProvider,
    "時間切れ: " + state.timedOut + "　停止: " + state.cancelled,
    "上限による受付拒否: " + state.denied + "　遅い結果の破棄: " + state.late,
  ].join("\n");
  return Object.freeze({ level, heading, detail, counts: summary });
}
