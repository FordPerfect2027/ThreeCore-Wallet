import { parseSecurityJson } from "./security-json.js";
import { observeCallbackResult } from "./security-callback.js";
import { FILE_READ_CONCURRENCY, FILE_READ_RESERVED_LIMIT } from "./file-read-policy.js";

const counters = ["active", "waiting", "retained", "reservedBytes", "maxActive", "maxReservedBytes",
  "accepted", "completed", "failed", "cancelled", "timedOut", "rejected"];
const keys = ["schema", "disposed", "clockFault", "canStart", ...counters];

/** Explain a known failure without exposing an exception's message or path. */
export function describeFileReadError(error, limitLabel) {
  if (rehearsalTargetErrors.has(error)) return rehearsalTargetErrors.get(error);
  let code;
  try { code = Object.getOwnPropertyDescriptor(error, "code")?.value; } catch { return null; }
  const messages = {
    FILE_TIMEOUT: "30秒以内に読み込めませんでした。ファイルを手元のフォルダーに保存して、もう一度選んでください。",
    FILE_BUSY: "ほかのファイルの読み込みが終わるまでお待ちください。終わったら、もう一度ファイルを選んでください。自動での再読み込みはしません。",
    FILE_ENCODING: "文字を正しく読み取れません。UTF-8形式の元の保存ファイルを選んでください。",
    FILE_SIZE: "ファイルが空、容量超過、または読み取った容量と一致しません。" + limitLabel + "以内の保存が完了した元のファイルを選び直してください。",
    FILE_READ: "ファイルを読み取れませんでした。手元のフォルダーに保存が完了していることを確認して、元のファイルを選び直してください。",
    FILE_CANCELLED: "ファイルの読み込みを取り消しました。読み込む場合は、もう一度ファイルを選んでください。",
    FILE_CLOCK: "読み込みの待ち時間を確認できないため停止しました。現在の記録を保存してから、このページを開き直してください。",
    FILE_DISPOSED: "この画面の読み込み処理は終了しています。現在の記録を保存してから、このページを開き直してください。",
  };
  return typeof code === "string" && Object.hasOwn(messages, code) ? messages[code] : null;
}

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

/** Optional display metadata cannot prevent a valid local document review. */
export function displayFileName(file, fallback) {
  let name;
  try { name = file?.name; } catch { return fallback; }
  if (typeof name !== "string") { observeCallbackResult(name); return fallback; }
  return name.slice(0, 160).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "") || fallback;
}


// These names describe where a declared format belongs, not content validity.
const rehearsalDestinations = Object.freeze({
  record: "記録を保存・再確認",
  workspace: "保存した3トークンの履歴を戻す",
  session: "履歴と比較ケースをまとめて保存・復旧",
  cases: "比較ケースを名前付きで残す",
  expectations: "保存した期待結果との比較",
  report: "保存した資料を再計算して確認",
  evidence: "まとめて保存した証拠を再確認する",
});
const rehearsalSchemaTargets = Object.freeze({
  "threecore.operation-rehearsal-review-evidence.v1": "evidence",
  "threecore.operation-rehearsal.v1": "record",
  "threecore.operation-rehearsal.v2": "record",
  "threecore.operation-rehearsal-workspace.v1": "workspace",
  "threecore.operation-rehearsal-session.v1": "session",
  "threecore.operation-rehearsal-scenario-set.v1": "cases",
  "threecore.operation-rehearsal-check-suite.v1": "expectations",
  "threecore.operation-rehearsal-overview.v1": "report",
  "threecore.operation-rehearsal-comparison.v1": "report",
  "threecore.operation-rehearsal-scenario.v1": "report",
  "threecore.operation-rehearsal-scenario-set-report.v1": "report",
  "threecore.operation-rehearsal-check-report.v1": "report",
  "threecore.operation-rehearsal-record-query.v1": "report",
  "threecore.operation-rehearsal-record-query.v2": "report",
});
const rehearsalTargetErrors = new WeakMap();

/** Bounded hints only. Never validates, restores, redirects or executes input. */
export function describeRehearsalFileTarget(text, currentTarget) {
  if (typeof currentTarget !== "string" || !Object.hasOwn(rehearsalDestinations, currentTarget)) return null;
  let root;
  try {
    root = parseSecurityJson(text, { bytes: 6291456, depth: 28, nodes: 150000,
      keyCharacters: 128, stringCharacters: 2097152 });
  } catch { return null; }
  if (!root || typeof root !== "object" || Array.isArray(root) || root.simulationOnly !== true ||
      typeof root.schema !== "string") return null;
  if (root.schema === "threecore.operation-rehearsal-evidence-review.v1")
    return "これは証拠ファイルの再確認結果を記した控えです。再確認には、元の証拠ファイルを「まとめて保存した証拠を再確認する」欄で選んでください。";
  if (root.schema === "threecore.operation-rehearsal-report-review.v1")
    return "これは資料の確認結果を記した控えの形式です。再計算する場合は、この控えと一緒に保管した元の資料を選んでください。";
  if (["threecore.operation-rehearsal-difference-page.v1", "threecore.operation-rehearsal-difference-detail.v1", "threecore.operation-rehearsal-difference-values.v1", "threecore.operation-rehearsal-difference-query.v1", "threecore.operation-rehearsal-difference-query-all.v1"].includes(root.schema))
    return "これは相違の場所や値を調べた確認用の資料です。再計算には元の資料を、証拠の再確認には元の証拠ファイルを選んでください。相違の表示だけでは履歴を復元できません。";
  if (!Object.hasOwn(rehearsalSchemaTargets, root.schema)) return null;
  const target = rehearsalSchemaTargets[root.schema];
  if (target === currentTarget) return null;
  return "ファイル内の形式指定が、この欄と異なります。「" + rehearsalDestinations[target] + "」欄で内容を確認してください。";
}

/** Run the existing synchronous decoder first; hints never replace validation. */
export function decodeRehearsalForPanel(text, target, decode) {
  try { return decode(text); }
  catch (error) {
    const hint = describeRehearsalFileTarget(text, target);
    if (!hint) throw error;
    const failure = new Error("REHEARSAL_WRONG_PANEL");
    rehearsalTargetErrors.set(failure, hint);
    throw failure;
  }
}

// These routes describe a declared format only. They never validate or open a file.
const walletSavedTargets = Object.freeze({
  "threecore.saved-event-comparison-file.v1": [null, "PERIOD_FILE_EVENT_COMPARISON_ONLY"],
  "threecore.report-set-comparison-evidence.v1": ["evidence", "PERIOD_FILE_USE_EVIDENCE"],
  "threecore.report-set-comparison-evidence-review.v1": [null, "PERIOD_FILE_EVIDENCE_REVIEW_ONLY"],
  "threecore.period-file.v1": ["period", "PERIOD_FILE_USE_PERIOD"],
  "threecore.period-report-file.v1": ["report", "PERIOD_FILE_USE_REPORT"],
  "threecore.report-set-file.v1": ["set", "PERIOD_FILE_USE_SET"],
  "threecore.report-set-check-details.v1": ["checks", "PERIOD_FILE_USE_CHECKS"],
  "threecore.report-set-comparison-file.v1": ["comparison", "PERIOD_FILE_USE_COMPARISON"],
  "threecore.report-set-check-review.v1": [null, "PERIOD_FILE_CHECK_REVIEW_ONLY"],
  "threecore.report-set-comparison-review.v1": [null, "PERIOD_FILE_COMPARISON_REVIEW_ONLY"],
  "threecore.report-set-history-coverage.v1": [null, "PERIOD_FILE_COVERAGE_ONLY"],
  "threecore.missing-history-queue.v1": [null, "PERIOD_FILE_QUEUE_ONLY"],
});
const walletSavedMessages = Object.freeze({
  PERIOD_FILE_EVENT_COMPARISON_ONLY: "これは保存済み履歴の比較資料です。元の確認セットJSONを開き、資料A・資料B・トークンを選んで再計算してください。履歴を復元するファイルではありません。",
  PERIOD_FILE_USE_EVIDENCE: "ファイルの形式指定は比較の証拠一式です。「保存した比較の証拠一式を検証する」で選んでください。元資料を自動で取り込む操作ではありません。",
  PERIOD_FILE_EVIDENCE_REVIEW_ONLY: "これは比較の証拠一式の検証結果を記した控えの形式です。再確認には、元の証拠一式JSONを「保存した比較の証拠一式を検証する」で選んでください。",
  PERIOD_FILE_USE_PERIOD: "ファイルの形式指定は期間取得の控えです。「期間を選んで、残高の変化を確かめる」の「控えの保存と復元」で選んでください。内容の検証や読み取り開始は行っていません。",
  PERIOD_FILE_USE_REPORT: "ファイルの形式指定は3トークンの期間報告です。「3つの記録を、一つの報告に」のファイル読込みで選んでください。内容の検証や反映は行っていません。",
  PERIOD_FILE_USE_SET: "ファイルの形式指定は確認セットです。「複数の報告を、期間で見渡す」の「保存した確認セットを開く」で選んでください。内容の検証や反映は行っていません。",
  PERIOD_FILE_USE_CHECKS: "ファイルの形式指定は確認箇所の説明用JSONです。元の確認セットを表示してから「保存した確認箇所JSONを元資料と照合」で選んでください。元の証拠を復元するファイルではありません。",
  PERIOD_FILE_USE_COMPARISON: "ファイルの形式指定は差し替え前後の比較です。差し替え前の確認セットを表示し、候補の確認セットを読み込んでから「保存した比較JSONを照合」で選んでください。比較だけでは元の証拠を復元できません。",
  PERIOD_FILE_CHECK_REVIEW_ONLY: "これは確認箇所JSONの照合結果を記した控えの形式です。再確認には、元の確認セットJSONと確認箇所JSONを使ってください。この控えから元の履歴は復元できません。",
  PERIOD_FILE_COMPARISON_REVIEW_ONLY: "これは比較ファイルの照合結果を記した控えの形式です。再確認には、差し替え前と候補の確認セットJSON、および元の比較JSONを使ってください。",
  PERIOD_FILE_COVERAGE_ONLY: "これは保存済み・未取得・計画外の範囲を説明する資料の形式です。元の履歴を復元するファイルではありません。元の確認セットJSONを開いて、履歴範囲を再計算してください。",
  PERIOD_FILE_QUEUE_ONLY: "これは未取得範囲の予定を示す資料の形式です。読み取りの再開用ファイルではありません。元の確認セットから範囲を選び「未取得の期間控え」として保存してください。",
});

export function walletSavedFileTargetCode(schema, currentTarget) {
  if (typeof schema !== "string" || typeof currentTarget !== "string" ||
      !["period", "report", "set", "checks", "comparison", "evidence"].includes(currentTarget) || !Object.hasOwn(walletSavedTargets, schema)) return null;
  const [target, code] = walletSavedTargets[schema];
  return target === currentTarget ? null : code;
}

export function walletSavedFileTargetMessage(code) {
  return typeof code === "string" && Object.hasOwn(walletSavedMessages, code) ? walletSavedMessages[code] : null;
}
