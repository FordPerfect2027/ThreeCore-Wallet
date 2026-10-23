import { periodFail, periodWindows } from "./period-plan.js";

const STAGES = Object.freeze(["resume-check", "earlier", "later", "history", "final-check", "complete"]);
const IDENTITY_DETAILS = Object.freeze(["block", "code", "native", "metadata", "balance", "canonical", "complete"]);
const HISTORY_DETAILS = Object.freeze(["range", "token", "outgoing", "incoming", "blocks", "canonical", "complete"]);

/** Sanitize progress independently from financial observations. Never keep arbitrary text. */
export function validatePeriodProgress(value) {
  if (!value || !STAGES.includes(value.stage)) periodFail("PERIOD_PROGRESS");
  const { stage, checked, checks } = value;
  if (!Number.isSafeInteger(checked) || !Number.isSafeInteger(checks) ||
      checked < 0 || checks < checked || checks > 1226) periodFail("PERIOD_PROGRESS");
  const detail = value.detail ?? null;
  const windowIndex = value.windowIndex ?? null;
  if (detail !== null && !((stage === "earlier" || stage === "later") ? IDENTITY_DETAILS :
      stage === "history" ? HISTORY_DETAILS : []).includes(detail)) periodFail("PERIOD_PROGRESS");
  if (windowIndex !== null && (stage !== "history" || !Number.isInteger(windowIndex) || windowIndex < 0 || windowIndex >= 12)) {
    periodFail("PERIOD_PROGRESS");
  }
  return Object.freeze({ stage, detail, windowIndex, checked, checks });
}

export function periodProgressText(input, plan) {
  if (input === null) return "";
  const progress = validatePeriodProgress(input);
  const windows = periodWindows(plan);
  if (progress.windowIndex !== null && progress.windowIndex >= windows.length) periodFail("PERIOD_PROGRESS");
  if (progress.stage === "resume-check") return `保存したブロック情報を確認中（${progress.checked} / ${progress.checks}）`;
  if (progress.stage === "final-check") return `取得後のブロック情報を再確認中（${progress.checked} / ${progress.checks}）`;
  if (progress.stage === "complete") return "指定期間の読み取りと再確認が完了しました。";
  const identity = { block: "参照するブロック", code: "トークンの契約", native: "ETH残高", metadata: "トークン情報",
    balance: "トークン残高", canonical: "ブロックの一致", complete: "残高記録" };
  const history = { range: "対象の期間", token: "トークン情報", outgoing: "送信した履歴", incoming: "受信した履歴",
    blocks: "履歴が記録されたブロック", canonical: "区間のブロック一致", complete: "区間の履歴" };
  if (progress.stage === "earlier" || progress.stage === "later") {
    return `${progress.stage === "earlier" ? "開始時" : "終了時"}の${identity[progress.detail] ?? "残高"}を確認しています。`;
  }
  const number = progress.windowIndex === null ? "" : `${progress.windowIndex + 1} / ${windows.length}区間目：`;
  const counts = progress.detail === "blocks" ? `（${progress.checked} / ${progress.checks}）` : "";
  return `${number}${history[progress.detail] ?? "送受信履歴"}を確認しています${counts}。`;
}
