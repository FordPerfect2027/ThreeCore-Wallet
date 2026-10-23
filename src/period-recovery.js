import { createPeriodPlan, PERIOD_MAX_WINDOWS } from "./period-plan.js";
import { validatePeriodDraft, periodDraftProgress } from "./period-draft.js";

const RESTART = new Set(["PERIOD_BLOCK_CHANGED", "IDENTITY_BLOCK_CHANGED", "TRANSFER_BLOCK_CHANGED", "PERIOD_NEW_PLAN_REQUIRED"]);
const RECONNECT = new Set(["PERIOD_SESSION_CHANGED", "PERIOD_NOT_CONNECTED", "PERIOD_CONTEXT_MISMATCH"]);
const RETRY = new Set(["PERIOD_CANCELLED", "PERIOD_TIMEOUT", "IDENTITY_TIMEOUT", "TRANSFER_TIMEOUT", "TRANSFER_RPC_FAILED", "PERIOD_READ_FAILED"]);

/** Recommendations are drafts only. They never execute or silently discard evidence. */
export function periodRecovery(input, errorCode) {
  const draft = validatePeriodDraft(input);
  const plan = draft.plan;
  const progress = periodDraftProgress(draft);
  const base = { errorCode: typeof errorCode === "string" && /^(PERIOD|IDENTITY|TRANSFER)_[A-Z_]+$/.test(errorCode)
    ? errorCode : "PERIOD_READ_FAILED", savedSteps: progress.completed,
    action: "inspect", proposedPlan: null, remaining: null,
    automaticallyExecuted: false, changesWalletPermissions: false };
  if (RESTART.has(errorCode)) {
    return Object.freeze({ ...base, action: "restart", proposedPlan: plan,
      title: "同じ期間を新しく取得する",
      explanation: "過去のブロック情報と一致しません。現在の控えをJSON保存した後、新しい計画として開始時点から取り直します。古い記録を自動では削除しません。" });
  }
  if (errorCode === "TRANSFER_EVENT_LIMIT") {
    if (plan.windowSize === 1) return Object.freeze({ ...base,
      title: "この1ブロックは取得上限を超えています",
      explanation: "1ブロックより細かい区間にはできません。この画面では取得できないため、控えを保存して接続先の仕様と履歴件数を確認してください。" });
    const windowSize = Math.max(1, Math.floor(plan.windowSize / 2));
    const upper = BigInt(plan.earlierBlock) + BigInt(windowSize * PERIOD_MAX_WINDOWS);
    const last = BigInt(plan.laterBlock);
    const laterBlock = (upper < last ? upper : last).toString();
    const proposedPlan = createPeriodPlan({ context: plan.context, earlierBlock: plan.earlierBlock, laterBlock, windowSize });
    const remaining = laterBlock === plan.laterBlock ? null : Object.freeze({
      earlierBlock: laterBlock, laterBlock: plan.laterBlock,
    });
    return Object.freeze({ ...base, action: "narrow", proposedPlan, remaining,
      title: "1区間を細かくして新しい計画を作る",
      explanation: `1区間を${windowSize}ブロックにします。` + (remaining
        ? `12区間の上限に合わせ、今回はblock ${laterBlock}までです。残り（${laterBlock}, ${plan.laterBlock}]は別の計画が必要です。`
        : "開始・終了ブロックは変えずに取り直します。") + " 現在の控えを保存してから計画を確認してください。" });
  }
  if (RECONNECT.has(errorCode)) return Object.freeze({ ...base, action: "reconnect",
    title: "元の接続先を確認する",
    explanation: `${plan.context.agent} / chain ${plan.context.chainId} / ${plan.context.account} のカードを確認してください。` +
      "再接続後に取得ボタンを押すと、保存したブロック情報を再確認してから続きを読み取ります。" });
  if (RETRY.has(errorCode)) return Object.freeze({ ...base, action: "resume",
    title: "取得済みの控えを使って手動で再開する",
    explanation: "接続先の応答状況を確認してください。取得ボタンを押した場合にだけ、保存したブロック情報を確認して続きを読み取ります。自動再試行は行いません。" });
  return Object.freeze({ ...base,
    title: "記録と接続先を確認する",
    explanation: "このエラーは区間を変えれば解消するとは限りません。控えを保存し、トークン情報・対象チェーン・接続先の履歴対応を確認してください。" });
}
