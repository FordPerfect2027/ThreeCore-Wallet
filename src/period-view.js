import { describePeriodPlan } from "./period-plan.js";
import { validatePeriodDraft, periodDraftProgress, periodDraftWorkspace } from "./period-draft.js";
import { reconcileWorkspace } from "./reconciliation-engine.js";
import { formatTokenUnits } from "./token-identity-codec.js";

const messages = Object.freeze({
  PERIOD_BLOCK: "ブロック番号は0以上の整数を半角数字で入力してください。",
  PERIOD_ORDER: "終了ブロックは開始ブロックより大きくしてください。",
  PERIOD_WINDOW_SIZE: "1回の履歴取得は1～2,000ブロックにしてください。",
  PERIOD_WINDOW_LIMIT: "期間が長すぎます。最大12回に収まる期間を指定してください。",
  PERIOD_CONTEXT: "トークン・チェーン・公開アドレスを確認してください。",
  PERIOD_NOT_CONNECTED: "選択したトークンのウォレットを先に接続してください。",
  PERIOD_CONTEXT_MISMATCH: "接続先が保存した計画と異なります。元のアカウントとチェーンを確認してください。",
  PERIOD_SESSION_CHANGED: "途中で接続状態が変わりました。完了済みの記録を残して停止しました。",
  PERIOD_BLOCK_CHANGED: "保存時と現在のブロック情報が異なります。この控えは再利用せず、新しい計画で確認してください。",
  PERIOD_NEW_PLAN_REQUIRED: "ブロック情報の不一致が見つかったため、この控えからの再開と照合への受け渡しは停止しています。控えを保存し、新しい計画で取得してください。",
  PERIOD_CANCELLED: "読み取りを停止しました。完了した記録は残っています。",
  PERIOD_TIMEOUT: "応答待ちの上限に達しました。完了済みの記録を保存し、必要なら手動で再開してください。",
  PERIOD_READ_FAILED: "読み取りを完了できませんでした。接続先と期間を確認してください。",
  PERIOD_TOKEN_MISMATCH: "このブロックのトークン情報が登録内容と一致しません。",
  PERIOD_REVIEW_REQUIRED: "先に計画または読み込むファイルの内容を確認してください。",
  PERIOD_REPLACE_ACK: "現在の控えを置き換える確認欄にチェックしてください。",
  PERIOD_INCOMPLETE: "開始・終了残高と全期間の履歴が揃うまで照合へ渡せません。",
  PERIOD_NO_DRAFT: "先に期間の計画を作成してください。",
  PERIOD_BUSY: "処理中です。完了または停止してから操作してください。",
  PERIOD_CHECKSUM: "ファイルの検査値が一致しません。別の保存ファイルを確認してください。",
  PERIOD_FILE_SIZE: "ファイルサイズが不正か、24 MiBの上限を超えています。",
  PERIOD_FILENAME: "JSON形式のファイルを選択してください。",
  PERIOD_FILE_ENCODING: "UTF-8として読み込めないファイルです。",
  PERIOD_FILE_JSON: "JSONとして読み込めないファイルです。",
  PERIOD_FILE_SCHEMA: "期間取得用の保存ファイルを選択してください。",
  PERIOD_FILE_READ: "ファイルを読み込めませんでした。",
  PERIOD_CRYPTO: "ファイルの検査値を計算できませんでした。",
  PERIOD_STALE_REVIEW: "確認後に対象が変わりました。もう一度計画を確認してください。",
  PERIOD_ASYNC_DELIVERY: "保存処理を開始できませんでした。",
  PERIOD_DELIVERY_FAILED: "照合画面へ渡せませんでした。現在の記録は保持しています。",
  IDENTITY_TIMEOUT: "残高の応答待ちを終了しました。過去の状態を参照できる接続先か確認してください。",
  IDENTITY_BLOCK_CHANGED: "残高取得中にブロックが変わりました。新しい計画で確認してください。",
  TRANSFER_TIMEOUT: "履歴の応答待ちを終了しました。完了済みの区間は保持しています。",
  TRANSFER_RPC_FAILED: "履歴を取得できませんでした。失敗を0件として扱っていません。",
  TRANSFER_EVENT_LIMIT: "1区間の履歴件数が上限を超えています。期間を細かくした新しい計画を作成してください。",
  TRANSFER_FUTURE_BLOCK: "終了ブロックが接続先の最新ブロックより先にあります。",
});

export function periodMessage(code) { return messages[code] ?? "入力または保存記録を確認できませんでした。元のデータは保持しています。"; }

export function periodPlanText(input) {
  const plan = describePeriodPlan(input);
  return [
    `${plan.context.agent} / ${plan.context.chainId === 8453 ? "Base Mainnet" : "Base Sepolia"}`,
    `公開アドレス: ${plan.context.account}`,
    `開始時残高: block ${plan.earlierBlock} の終了時点`,
    `終了時残高: block ${plan.laterBlock} の終了時点`,
    `履歴: ${BigInt(plan.earlierBlock) + 1n} ～ ${plan.laterBlock}（${plan.blocks}ブロック）`,
    `${plan.windows.length}区間に分割し、残高2回と合わせて${plan.steps}段階で取得します。`,
    "取得前・取得後のブロック確認は別途行います。回数は所要時間の割合ではありません。",
    "ウォレットへの読み取り要求だけを行います。自動再試行はしません。",
  ].join("\n");
}

export function periodSummary(input) {
  const draft = validatePeriodDraft(input);
  const progress = periodDraftProgress(draft);
  const amount = value => value === null ? "未取得" : formatTokenUnits(value.balanceBaseUnits, value.metadata.decimals);
  const slot = progress.complete
    ? reconcileWorkspace(periodDraftWorkspace(draft)).slots.find(row => row.agent === draft.plan.context.agent) : null;
  return Object.freeze({ plan: draft.plan, progress,
    earlierAmount: amount(draft.earlier), laterAmount: amount(draft.later),
    result: slot?.status ?? "not-collected", residualBaseUnits: slot?.totals?.residualBaseUnits ?? null,
    importedRecordsAuthenticated: false, independentlyVerified: false });
}

export function periodReportText(input) {
  const draft = validatePeriodDraft(input);
  const summary = periodSummary(draft);
  return ["ThreeCore / 期間取得の控え", periodPlanText(draft.plan), "",
    `取得済み: ${summary.progress.completed} / ${summary.progress.total}`,
    `履歴: ${summary.progress.windowsCompleted} / ${summary.progress.windowsTotal}区間、${summary.progress.events}件`,
    `開始時残高: ${summary.earlierAmount} ${draft.plan.context.agent}`,
    `終了時残高: ${summary.laterAmount} ${draft.plan.context.agent}`,
    `計算結果: ${summary.result}`,
    `差額（最小単位）: ${summary.residualBaseUnits ?? "未計算"}`, "",
    "保存記録は公開アドレスと過去の残高・履歴を含みます。暗号化されていません。",
    "検査値は作成者の認証や残高の真正性を保証しません。独立監査ではありません。",
    "過去の照合結果であり、現在の残高・資産価格・利益を表しません。",
  ].join("\n") + "\n";
}
