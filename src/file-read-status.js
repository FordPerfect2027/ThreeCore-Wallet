import { captureDataArray, captureDataRecord, captureOptionalDataFields, sha256Hex } from "./security-data.js";
import { readAbortState } from "./security-abort.js";
import { parseSecurityJson, boundedUtf8Length } from "./security-json.js";
import { observeCallbackResult, consumeCallback } from "./security-callback.js";
import { subscribeReadAbort } from "./security-abort.js";
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
  "threecore.operation-rehearsal-record-query.v3": "report",
  "threecore.operation-rehearsal-reference.v1": "report",
  "threecore.operation-rehearsal-record-summary.v1": "report",
  "threecore.operation-rehearsal-record-prefix.v1": "report",
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
  "threecore.operation-rehearsal.v1": ["rehearsal-record", "FILE_USE_REHEARSAL_RECORD"],
  "threecore.operation-rehearsal.v2": ["rehearsal-record", "FILE_USE_REHEARSAL_RECORD"],
  "threecore.operation-rehearsal-workspace.v1": ["rehearsal-workspace", "FILE_USE_REHEARSAL_WORKSPACE"],
  "threecore.operation-rehearsal-session.v1": ["rehearsal-session", "FILE_USE_REHEARSAL_SESSION"],
  "threecore.operation-rehearsal-scenario-set.v1": ["rehearsal-cases", "FILE_USE_REHEARSAL_CASES"],
  "threecore-workspace-file-v1": ["workspace", "FILE_USE_WORKSPACE"],
  "threecore-portfolio-snapshot-v1": ["portfolio", "FILE_USE_PORTFOLIO"],
  "threecore-portfolio-history-v1": ["portfolio-history", "FILE_USE_PORTFOLIO_HISTORY"],
  "threecore-wallet-setup-v1": ["setup", "FILE_USE_SETUP"],
  "threecore.saved-file-inspection.v3": [null, "PERIOD_FILE_INSPECTION_ONLY"],
  "threecore.transfer-file.v1": ["transfer", "FILE_USE_TRANSFER"],
  "threecore.transfer-archive-file.v1": ["transfer-archive", "FILE_USE_TRANSFER_ARCHIVE"],
  "threecore.transfer-vault-file.v1": ["transfer-vault", "FILE_USE_TRANSFER_VAULT"],
  "threecore-token-observation-file-v1": ["identity", "FILE_USE_IDENTITY"],
  "threecore-allowance-file-v1": ["allowance", "FILE_USE_ALLOWANCE"],
  "threecore.reconciliation-file.v1": ["reconciliation", "FILE_USE_RECONCILIATION"],
  "threecore.saved-file-inspection.v2": [null, "PERIOD_FILE_INSPECTION_ONLY"],
  "threecore.wallet-saved-local-batch-comparison.v1": [null, "PERIOD_FILE_LOCAL_BATCH_COMPARISON_ONLY"],
  "threecore.wallet-saved-local-batch-comparison-review.v1": [null, "PERIOD_FILE_LOCAL_BATCH_COMPARISON_ONLY"],
  "threecore.wallet-saved-batch-comparison-review.v1": [null, "PERIOD_FILE_SAVED_BATCH_COMPARISON_REVIEW_ONLY"],
  "threecore.wallet-saved-batch-comparison.v1": [null, "PERIOD_FILE_SAVED_BATCH_COMPARISON_ONLY"],
  "threecore.wallet-saved-browser-batch.v1": [null, "PERIOD_FILE_SAVED_BATCH_ONLY"],
  "threecore.wallet-saved-browser-batch.v2": [null, "PERIOD_FILE_SAVED_BATCH_ONLY"],
  "threecore.wallet-saved-browser-batch.v3": [null, "PERIOD_FILE_SAVED_BATCH_ONLY"],
  "threecore.wallet-saved-browser-batch.v4": [null, "PERIOD_FILE_SAVED_BATCH_ONLY"],
  "threecore.wallet-saved-batch-inspection.v1": [null, "PERIOD_FILE_SAVED_BATCH_ONLY"],
  "threecore.saved-file-comparison-bundle.v1": [null, "PERIOD_FILE_SAVED_BUNDLE_ONLY"],
  "threecore.saved-file-comparison-bundle-review.v1": [null, "PERIOD_FILE_SAVED_BUNDLE_REVIEW_ONLY"],
  "threecore.saved-file-comparison-review.v1": [null, "PERIOD_FILE_SAVED_REVIEW_ONLY"],
  "threecore.saved-file-comparison.v1": [null, "PERIOD_FILE_SAVED_COMPARISON_ONLY"],
  "threecore.saved-file-inspection.v1": [null, "PERIOD_FILE_INSPECTION_ONLY"],
  "threecore.report-history-import-inspection.v1": [null, "PERIOD_FILE_HISTORY_INSPECTION_ONLY"],
  "threecore.report-history-file.v1": ["history", "PERIOD_FILE_USE_HISTORY"],
  "threecore.period-library-file.v1": ["library", "PERIOD_FILE_USE_LIBRARY"],
  "threecore.period-library-import-inspection.v1": [null, "PERIOD_FILE_IMPORT_INSPECTION_ONLY"],
  "threecore.report-set-history-coverage-review.v1": [null, "PERIOD_FILE_COVERAGE_REVIEW_ONLY"],
  "threecore.saved-event-comparison-review.v1": [null, "PERIOD_FILE_EVENT_REVIEW_ONLY"],
  "threecore.saved-event-comparison-file.v1": ["event-comparison", "PERIOD_FILE_EVENT_COMPARISON_ONLY"],
  "threecore.report-set-comparison-evidence.v1": ["evidence", "PERIOD_FILE_USE_EVIDENCE"],
  "threecore.report-set-comparison-evidence-review.v1": [null, "PERIOD_FILE_EVIDENCE_REVIEW_ONLY"],
  "threecore.period-file.v1": ["period", "PERIOD_FILE_USE_PERIOD"],
  "threecore.period-report-file.v1": ["report", "PERIOD_FILE_USE_REPORT"],
  "threecore.report-set-file.v1": ["set", "PERIOD_FILE_USE_SET"],
  "threecore.report-set-check-details.v1": ["checks", "PERIOD_FILE_USE_CHECKS"],
  "threecore.report-set-comparison-file.v1": ["comparison", "PERIOD_FILE_USE_COMPARISON"],
  "threecore.report-set-check-review.v1": [null, "PERIOD_FILE_CHECK_REVIEW_ONLY"],
  "threecore.report-set-comparison-review.v1": [null, "PERIOD_FILE_COMPARISON_REVIEW_ONLY"],
  "threecore.report-set-history-coverage.v1": ["coverage", "PERIOD_FILE_COVERAGE_ONLY"],
  "threecore.missing-history-queue.v1": [null, "PERIOD_FILE_QUEUE_ONLY"],
});
const walletSavedMessages = Object.freeze({
  FILE_USE_REHEARSAL_RECORD: "運用リハーサルの練習用の記録です。「記録を保存・再確認」で元のJSONを選んでください。実際の入出金の証拠ではありません。",
  FILE_USE_REHEARSAL_WORKSPACE: "運用リハーサルの練習用の3トークン履歴です。「保存した3トークンの履歴を戻す」で元のJSONを選んでください。実際の入出金の証拠ではありません。",
  FILE_USE_REHEARSAL_SESSION: "運用リハーサルの練習用の履歴と比較ケースです。「履歴と比較ケースをまとめて保存・復旧」で元のJSONを選んでください。実際の入出金の証拠ではありません。",
  FILE_USE_REHEARSAL_CASES: "運用リハーサルの仮想条件を比べるケース集です。「比較ケースを名前付きで残す」で元のJSONを選んでください。実際の入出金の証拠ではありません。",
  FILE_USE_WORKSPACE: "3ウォレットの設定と保存記録をまとめたバックアップです。「3ウォレットをまとめて保存・復元」で元のJSONを選んで確認してください。ここでは設定や履歴を反映しません。",
  FILE_USE_PORTFOLIO: "過去の複数トークン残高の記録です。「複数トークンの残高確認」の「過去の記録を表示」で元のJSONを確認してください。この形式には内部チェックサムがありません。",
  FILE_USE_PORTFOLIO_HISTORY: "過去の複数トークン残高の保存履歴です。「保存記録の履歴管理」で元のJSONを確認してください。この形式には内部チェックサムがありません。",
  FILE_USE_SETUP: "3ウォレットの公開アドレスとネットワークの設定です。「3ウォレットの設定を保存・復元」で元のJSONを確認してください。この形式には内部チェックサムがなく、接続許可や所有権を証明しません。",
  FILE_USE_TRANSFER: "受信・送信履歴の保存JSONです。該当トークンの履歴画面で、元のJSONを選んで確認してください。現在のチェーンへの再照会は行いません。",
  FILE_USE_TRANSFER_ARCHIVE: "複数区間の履歴をまとめたJSONです。履歴の保管画面で元のJSONを確認してください。取得済み区間の記録であり、全履歴を取得した証明ではありません。",
  FILE_USE_TRANSFER_VAULT: "3トークンの履歴をまとめた保管JSONです。履歴の保管画面で元のJSONを確認してください。保存先への反映は行っていません。",
  FILE_USE_IDENTITY: "トークンと残高の保存観測JSONです。該当トークンの確認画面で元のJSONを選んでください。現在の残高や契約の安全性を証明するものではありません。",
  FILE_USE_ALLOWANCE: "既存の利用許可を調べる対象一覧、または過去の観測JSONです。利用許可の確認画面で元のJSONを確認してください。許可を付与・変更する操作ではありません。",
  FILE_USE_RECONCILIATION: "残高と履歴を照合する保存JSONです。残高と履歴の照合画面で元のJSONを確認してください。ここでは照合の結論を再計算せず、保存内容の形式とチェックサムを確認します。",
  PERIOD_FILE_LOCAL_BATCH_COMPARISON_ONLY: "これはコマンドで二組の保存ファイルを比較・照合した控えです。元記録は含まれず、復元には使えません。元の二組と照合値一覧を保全し、比較・検証コマンドで確認し直してください。",
  PERIOD_FILE_SAVED_BATCH_COMPARISON_REVIEW_ONLY: "これは二組の一括比較を照合した控えです。元記録は含まれず、復元には使えません。両方の元のJSONと元の比較JSONを保全し、『保存した一括比較JSONを照合する』で確認してください。",
  PERIOD_FILE_SAVED_BATCH_COMPARISON_ONLY: "これは二組の保存ファイルを比較した控えです。元記録は含まれず、復元には使えません。両方の元のJSONと照合値一覧を保全し、一括確認で比較し直してください。",
  PERIOD_FILE_SAVED_BATCH_ONLY: "これは複数の保存ファイルを確認した控えです。元記録は含まれず、復元には使えません。確認に使った元のJSONと照合値一覧を保全し、『複数の保存ファイルをまとめて確認する』で確認してください。",
  PERIOD_FILE_SAVED_BUNDLE_ONLY: "これは比較と両方の元資料をまとめたJSONです。ファイル読み込みの保護にある『まとめた資料を読み取り専用で確認する』で確認し、必要な元ファイルを取り出してください。直接の復元は行いません。",
  PERIOD_FILE_SAVED_BUNDLE_REVIEW_ONLY: "これはまとめた比較資料の照合結果です。元資料は含まれません。両方の元資料をまとめた元のJSONを使ってください。",
  PERIOD_FILE_SAVED_REVIEW_ONLY: "これは保存ファイル比較の照合結果です。元記録は含まれず、復元には使えません。両方の元のJSONと、保存した比較JSONを使ってください。",
  PERIOD_FILE_SAVED_COMPARISON_ONLY: "これは2つの保存ファイルの比較結果です。元記録は含まれず、復元には使えません。比較した両方の元のJSONを使ってください。",
  PERIOD_FILE_INSPECTION_ONLY: "これは保存ファイルの形式や開く場所を調べた案内です。元記録は含まれず、復元には使えません。調べる前の元のJSONを選んでください。",
  PERIOD_FILE_HISTORY_INSPECTION_ONLY: "これは報告履歴の読込み前の比較結果です。元の報告やメモは含まれません。復元には報告履歴のバックアップJSONを使ってください。",
  PERIOD_FILE_USE_HISTORY: "ファイルの形式指定は報告履歴のバックアップです。「報告を残して、後から確かめる」の「報告履歴のバックアップJSONから追加復元」で選んでください。内容の検証や既存の履歴への追加は行っていません。",
  PERIOD_FILE_USE_LIBRARY: "ファイルの形式指定は期間の保存一覧です。1件だけの元の控えも、この形式です。「途中の控えを、名前を付けて保管する」の「期間の保存一覧JSONを読み込む」で選んでください。内容の検証や保存先への追加は行っていません。",
  PERIOD_FILE_IMPORT_INSPECTION_ONLY: "これは期間の保存一覧の読込み前の比較結果です。元の控えは含まれていません。再確認には、比較に使った現在側と読込側の期間の保存一覧JSONを使ってください。",
  PERIOD_FILE_COVERAGE_REVIEW_ONLY: "これは履歴範囲JSONの照合結果です。再確認には、元の確認セットJSONと履歴範囲JSONを使ってください。この控えから元の履歴は復元できません。",
  PERIOD_FILE_EVENT_REVIEW_ONLY: "これは履歴比較ファイルの照合結果です。再確認には、元の確認セットJSONと履歴比較JSONを使ってください。この控えから元の履歴は復元できません。",
  PERIOD_FILE_EVENT_COMPARISON_ONLY: "これは保存済み履歴の比較資料です。元の確認セットJSONを開き、「保存した履歴比較JSONを元資料と照合」で選んでください。履歴を復元するファイルではありません。",
  PERIOD_FILE_USE_EVIDENCE: "ファイルの形式指定は比較の証拠一式です。「保存した比較の証拠一式を検証する」で選んでください。元資料を自動で取り込む操作ではありません。",
  PERIOD_FILE_EVIDENCE_REVIEW_ONLY: "これは比較の証拠一式の検証結果を記した控えの形式です。再確認には、元の証拠一式JSONを「保存した比較の証拠一式を検証する」で選んでください。",
  PERIOD_FILE_USE_PERIOD: "ファイルの形式指定は期間取得の控えです。「期間を選んで、残高の変化を確かめる」の「控えの保存と復元」で選んでください。内容の検証や読み取り開始は行っていません。",
  PERIOD_FILE_USE_REPORT: "ファイルの形式指定は3トークンの期間報告です。「3つの記録を、一つの報告に」のファイル読込みで選んでください。内容の検証や反映は行っていません。",
  PERIOD_FILE_USE_SET: "ファイルの形式指定は確認セットです。「複数の報告を、期間で見渡す」の「保存した確認セットを開く」で選んでください。内容の検証や反映は行っていません。",
  PERIOD_FILE_USE_CHECKS: "ファイルの形式指定は確認箇所の説明用JSONです。元の確認セットを表示してから「保存した確認箇所JSONを元資料と照合」で選んでください。元の証拠を復元するファイルではありません。",
  PERIOD_FILE_USE_COMPARISON: "ファイルの形式指定は差し替え前後の比較です。差し替え前の確認セットを表示し、候補の確認セットを読み込んでから「保存した比較JSONを照合」で選んでください。比較だけでは元の証拠を復元できません。",
  PERIOD_FILE_CHECK_REVIEW_ONLY: "これは確認箇所JSONの照合結果を記した控えの形式です。再確認には、元の確認セットJSONと確認箇所JSONを使ってください。この控えから元の履歴は復元できません。",
  PERIOD_FILE_COMPARISON_REVIEW_ONLY: "これは比較ファイルの照合結果を記した控えの形式です。再確認には、差し替え前と候補の確認セットJSON、および元の比較JSONを使ってください。",
  PERIOD_FILE_COVERAGE_ONLY: "これは保存済み・未取得・計画外の範囲を説明する資料の形式です。元の履歴を復元するファイルではありません。元の確認セットJSONを開いて、「保存した履歴範囲JSONを元資料と照合」で選んでください。",
  PERIOD_FILE_QUEUE_ONLY: "これは未取得範囲の予定を示す資料の形式です。読み取りの再開用ファイルではありません。元の確認セットから範囲を選び「未取得の期間控え」として保存してください。",
});

export function walletSavedFileTargetCode(schema, currentTarget) {
  if (typeof schema !== "string" || typeof currentTarget !== "string" ||
      !["history", "library", "period", "report", "set", "checks", "comparison", "evidence", "event-comparison", "coverage"].includes(currentTarget) || !Object.hasOwn(walletSavedTargets, schema)) return null;
  const [target, code] = walletSavedTargets[schema];
  return target === currentTarget ? null : code;
}

export function walletSavedFileTargetMessage(code) {
  return typeof code === "string" && Object.hasOwn(walletSavedMessages, code) ? walletSavedMessages[code] : null;
}

export const WALLET_SAVED_INSPECTION_LIMIT = 96 * 1024 * 1024;
const savedInspectionCaptures = new WeakSet();
function captureSavedInspection(value) { const result = Object.freeze(value); savedInspectionCaptures.add(result); return result; }
const originalSavedTypes = Object.freeze({
  "threecore.period-file.v1": ["period", "期間取得の控え", "「控えの保存と復元」で、この元のファイルを選んで確認してください。"],
  "threecore.period-library-file.v1": ["library", "期間の保存一覧", "「途中の控えを、名前を付けて保管する」の「期間の保存一覧JSONを読み込む」で、この元のファイルを選んでください。"],
  "threecore.period-report-file.v1": ["report", "3トークンの期間レポート", "「3つの記録を、一つの報告に」で、この元のファイルを選んで確認してください。"],
  "threecore.report-history-file.v1": ["history", "報告履歴のバックアップ", "「報告を残して、後から確かめる」の「報告履歴のバックアップJSONから追加復元」で、この元のファイルを選んでください。"],
  "threecore.report-set-file.v1": ["set", "報告の確認セット", "「保存した確認セットを開く」で、この元のファイルを選んで確認してください。"],
});
const observationSavedTypes = Object.freeze({
  "threecore-workspace-file-v1": "3ウォレットの設定・残高履歴バックアップ",
  "threecore.transfer-file.v1": "1区間の受信・送信履歴",
  "threecore.transfer-archive-file.v1": "複数区間の受信・送信履歴",
  "threecore.transfer-vault-file.v1": "3トークンの履歴保管",
  "threecore-token-observation-file-v1": "トークンと残高の保存観測",
  "threecore-allowance-file-v1": "利用許可の確認用保存資料",
  "threecore.reconciliation-file.v1": "残高と履歴の照合用保存資料",
});
export const WALLET_SAVED_OBSERVATION_SCOPE_FIELDS = Object.freeze(["archiveReferences", "transferRecordReferences", "eventReferences", "identityObservationReferences", "allowanceTargetReferences", "allowanceObservationReferences", "configurationReferences", "configuredAccountReferences", "configuredTokenReferences", "portfolioObservationReferences", "holdingReferences", "unknownHoldingReferences"]);
export const WALLET_SAVED_REHEARSAL_SCOPE_FIELDS = Object.freeze(["rehearsalLedgerReferences", "rehearsalRecordReferences", "rehearsalRejectedRecordReferences", "rehearsalScenarioReferences"]);
const rehearsalScopeLabels = Object.freeze({ rehearsalLedgerReferences: "練習用の履歴の参照", rehearsalRecordReferences: "練習用の記録の参照", rehearsalRejectedRecordReferences: "入力された仮想条件に合わない記録の参照", rehearsalScenarioReferences: "仮想条件の比較ケース" });
const rehearsalSavedTypes = Object.freeze({ "threecore.operation-rehearsal.v1": "運用リハーサルの旧形式の記録", "threecore.operation-rehearsal.v2": "運用リハーサルの記録", "threecore.operation-rehearsal-workspace.v1": "運用リハーサルの3トークン履歴", "threecore.operation-rehearsal-session.v1": "運用リハーサルの履歴と比較ケース", "threecore.operation-rehearsal-scenario-set.v1": "運用リハーサルの比較ケース集" });
const observationScopeLabels = Object.freeze({ archiveReferences: "履歴まとめの参照", transferRecordReferences: "取得区間の記録の参照", eventReferences: "履歴イベントの参照", identityObservationReferences: "トークン・残高観測の参照", allowanceTargetReferences: "利用許可の確認対象の参照", allowanceObservationReferences: "利用許可の観測行の参照", configurationReferences: "ウォレット設定の行", configuredAccountReferences: "設定済み公開アドレスの参照", configuredTokenReferences: "設定済みトークン契約の参照", portfolioObservationReferences: "複数トークン残高記録の参照", holdingReferences: "トークン残高の行の参照", unknownHoldingReferences: "残高が不明な行の参照" });
const legacySavedTypes = Object.freeze({ "threecore-portfolio-snapshot-v1": "過去の複数トークン残高記録", "threecore-portfolio-history-v1": "複数トークン残高の保存履歴", "threecore-wallet-setup-v1": "3ウォレットの公開設定" });
function savedPortfolioScope(observations, configuration) {
  const holdings = observations?.flatMap(row => row.holdings) ?? null;
  return { configurationReferences: configuration?.length ?? null, configuredAccountReferences: configuration?.filter(row => row.account !== null).length ?? null,
    configuredTokenReferences: configuration?.some(row => Array.isArray(row.tokens)) ? configuration.reduce((count, row) => count + row.tokens.length + (row.tokenAddress === null ? 0 : 1), 0) : null,
    portfolioObservationReferences: observations?.length ?? null, holdingReferences: holdings?.length ?? null,
    unknownHoldingReferences: holdings?.filter(row => !row.hasCode).length ?? null };
}
function emptySavedPeriodScope(agents) { return { reportCount: null, archivedReports: null, entryReferences: null, draftReferences: null, archivedEntryReferences: null, restrictedEntryReferences: null, incompleteDraftReferences: null, emptyDraftReferences: null,
  agents: Object.freeze(["DAT", "EMA", "CAWELON"].filter(agent => agents.includes(agent))), annotationValuesIncluded: false, repeatedReferencesMayExist: true }; }
async function inspectRehearsalSaved(text, schema, byteLength, options, checkpoint, knownTextDigest) {
  let ledgers = [], cases = null;
  const { decodeRehearsal, evaluateRehearsal } = await import("./operation-rehearsal.js"); checkpoint();
  if (["threecore.operation-rehearsal.v1", "threecore.operation-rehearsal.v2"].includes(schema)) ledgers = [decodeRehearsal(text)];
  else if (schema === "threecore.operation-rehearsal-workspace.v1") ledgers = (await import("./operation-rehearsal-workspace.js")).decodeRehearsalWorkspace(text).ledgers;
  else if (schema === "threecore.operation-rehearsal-scenario-set.v1") cases = (await import("./operation-rehearsal-scenario-set.js")).decodeRehearsalScenarioSet(text).cases;
  else { const session = (await import("./operation-rehearsal-session.js")).decodeRehearsalSession(text); ledgers = session.workspace.ledgers; cases = session.cases.cases; }
  checkpoint();
  const references = [...ledgers, ...(cases ?? []).flatMap(row => [row.before, row.after])];
  const reports = references.map(ledger => evaluateRehearsal(ledger)); checkpoint();
  const scope = Object.freeze({ ...emptySavedPeriodScope(references.map(row => row.agent)),
    rehearsalLedgerReferences: references.length, rehearsalRecordReferences: references.reduce((total, row) => total + row.events.length, 0),
    rehearsalRejectedRecordReferences: reports.reduce((total, row) => total + row.rows.filter(event => !event.withinEnteredLimits).length, 0), rehearsalScenarioReferences: cases?.length ?? null });
  const textDigest = knownTextDigest ?? await sha256Hex(new TextEncoder().encode(text), options.subtle ?? globalThis.crypto?.subtle, options); checkpoint();
  return captureSavedInspection({ schema: "threecore.saved-file-inspection.v3", sourceSchema: schema, byteLength, title: rehearsalSavedTypes[schema], target: walletSavedTargets[schema][0], destinationMessage: walletSavedMessages[walletSavedTargets[schema][1]],
    validation: "validated-structure", simulationOnly: true, checksumVerified: false, sourceDigest: null, textDigest, scope, originalEvidenceValidated: false, restorable: false, automaticallyImported: false, liveChainRechecked: false, authenticated: false, authorizesExecution: false });
}
async function inspectLegacySaved(text, schema, byteLength, options, checkpoint, knownTextDigest) {
  let observations = null, configuration = null;
  if (schema === "threecore-portfolio-snapshot-v1") observations = [(await import("./portfolio-report.js")).decodePortfolioReport(text).snapshot];
  else if (schema === "threecore-portfolio-history-v1") { const history = (await import("./portfolio-history.js")).createPortfolioHistory(); history.importText(text); observations = history.state().snapshots; }
  else configuration = (await import("./wallet-setup.js")).decodeWalletSetup(text).entries;
  checkpoint();
  const scope = Object.freeze({ ...emptySavedPeriodScope((observations ?? configuration).map(row => row.agent)), ...savedPortfolioScope(observations, configuration) });
  const textDigest = knownTextDigest ?? await sha256Hex(new TextEncoder().encode(text), options.subtle ?? globalThis.crypto?.subtle, options); checkpoint();
  return captureSavedInspection({ schema: "threecore.saved-file-inspection.v3", sourceSchema: schema, byteLength, title: legacySavedTypes[schema], target: walletSavedTargets[schema][0], destinationMessage: walletSavedMessages[walletSavedTargets[schema][1]],
    validation: "validated-structure", checksumVerified: false, sourceDigest: null, textDigest, scope, originalEvidenceValidated: false, restorable: false, automaticallyImported: false, liveChainRechecked: false, authenticated: false, authorizesExecution: false });
}
async function inspectSavedObservation(text, schema, byteLength, options, checkpoint, knownTextDigest) {
  let decoded, agents = [], archives = [], records = [], identities = null, targetCount = null, allowanceCount = null, portfolioScope;
  const target = walletSavedTargets[schema][0];
  if (target === "transfer") { decoded = await (await import("./transfer-file.js")).decodeTransferFile(text, options); records = [decoded.snapshot]; agents = [decoded.snapshot.context.agent]; }
  else if (target === "transfer-archive") { decoded = await (await import("./transfer-archive-file.js")).decodeTransferArchiveFile(text, options); archives = [decoded.archive]; }
  else if (target === "transfer-vault") { decoded = await (await import("./transfer-vault-file.js")).decodeVaultFile(text, options); archives = decoded.bundle.slots.map(row => row.archive).filter(Boolean); }
  else if (target === "identity") { decoded = await (await import("./token-identity-report.js")).decodeTokenIdentityFile(new TextEncoder().encode(text), options); agents = [decoded.observation.agent]; identities = [decoded.observation]; }
  else if (target === "allowance") {
    decoded = await (await import("./allowance-file.js")).decodeAllowanceFile(new TextEncoder().encode(text), options);
    const observation = decoded.kind === "observation";
    agents = [observation ? decoded.payload.identity.agent : decoded.payload.agent];
    targetCount = (observation ? decoded.payload.targets : decoded.payload).targets.length;
    if (observation) { identities = [decoded.payload.identity]; allowanceCount = decoded.payload.rows.length; }
  } else if (target === "workspace") {
    decoded = await (await import("./workspace-file.js")).decodeWorkspaceFile(new TextEncoder().encode(text), options);
    const configuration = decoded.workspace.entries, observations = configuration.flatMap(row => row.history.reports.map(report => report.snapshot));
    agents = configuration.map(row => row.agent); portfolioScope = savedPortfolioScope(observations, configuration);
  } else {
    decoded = await (await import("./reconciliation-file.js")).decodeReconciliationFile(text, options);
    archives = decoded.workspace.slots.map(row => row.archive).filter(Boolean);
    identities = decoded.workspace.slots.flatMap(row => [row.earlier, row.later].filter(Boolean));
    agents = decoded.workspace.slots.filter(row => row.earlier || row.later || row.archive).map(row => row.agent);
  }
  checkpoint();
  if (archives.length) { records = archives.flatMap(row => row.records); agents.push(...records.map(row => row.context.agent)); }
  const hasTransfers = ["transfer", "transfer-archive", "transfer-vault", "reconciliation"].includes(target);
  const scope = Object.freeze({ reportCount: null, archivedReports: null, entryReferences: null, draftReferences: null,
    archivedEntryReferences: null, restrictedEntryReferences: null, incompleteDraftReferences: null, emptyDraftReferences: null,
    agents: Object.freeze(["DAT", "EMA", "CAWELON"].filter(agent => agents.includes(agent))), annotationValuesIncluded: false,
    repeatedReferencesMayExist: archives.length > 0 || target === "reconciliation",
    archiveReferences: hasTransfers && target !== "transfer" ? archives.length : null,
    transferRecordReferences: hasTransfers ? records.length : null, eventReferences: hasTransfers ? records.reduce((count, row) => count + row.events.length, 0) : null,
    identityObservationReferences: identities?.length ?? null, allowanceTargetReferences: targetCount, allowanceObservationReferences: allowanceCount, ...portfolioScope });
  const textDigest = knownTextDigest ?? await sha256Hex(new TextEncoder().encode(text), options.subtle ?? globalThis.crypto?.subtle, options); checkpoint();
  return captureSavedInspection({ schema: "threecore.saved-file-inspection.v2", sourceSchema: schema, byteLength,
    title: observationSavedTypes[schema], target, destinationMessage: walletSavedMessages[walletSavedTargets[schema][1]],
    validation: "validated-original", checksumVerified: true, sourceDigest: decoded.digest, textDigest, scope,
    originalEvidenceValidated: true, restorable: false, automaticallyImported: false, liveChainRechecked: false, authenticated: false, authorizesExecution: false });
}
function savedInspectionFail(code) { const error = new Error(code); error.code = code; throw error; }

/** Inspect one explicit saved file without handing evidence to a wallet or changing storage. */
export async function inspectWalletSavedText(text, fileOptions = {}) {
  return inspectWalletSavedTextCaptured(text, fileOptions);
}

// Only the local batch row can supply a digest of its captured immutable text.
// Public callers and imported receipts cannot bypass hashing through options.
async function inspectWalletSavedTextCaptured(text, fileOptions, knownTextDigest) {
  let options;
  try { options = captureOptionalDataFields(fileOptions, ["subtle", "signal", "timeoutMs"]); }
  catch { savedInspectionFail("FILE_INSPECTION_OPTIONS"); }
  const checkpoint = () => {
    let aborted; try { aborted = readAbortState(options.signal); } catch { savedInspectionFail("FILE_INSPECTION_OPTIONS"); }
    if (typeof aborted !== "boolean") savedInspectionFail("FILE_INSPECTION_OPTIONS");
    if (aborted) savedInspectionFail("FILE_CANCELLED");
  };
  checkpoint();
  let byteLength;
  try { byteLength = boundedUtf8Length(text, WALLET_SAVED_INSPECTION_LIMIT); }
  catch { savedInspectionFail("FILE_SIZE"); }
  if (!byteLength) savedInspectionFail("FILE_SIZE");
  let declared;
  try { declared = parseSecurityJson(text); } catch { savedInspectionFail("FILE_INSPECTION_JSON"); }
  const schema = declared?.schema;
  declared = null;
  if (typeof schema !== "string" || !Object.hasOwn(walletSavedTargets, schema)) savedInspectionFail("FILE_INSPECTION_UNSUPPORTED");
  const targetCode = walletSavedTargets[schema][1], definition = originalSavedTypes[schema];
  if (Object.hasOwn(rehearsalSavedTypes, schema)) return inspectRehearsalSaved(text, schema, byteLength, options, checkpoint, knownTextDigest);
  if (Object.hasOwn(legacySavedTypes, schema)) return inspectLegacySaved(text, schema, byteLength, options, checkpoint, knownTextDigest);
  if (Object.hasOwn(observationSavedTypes, schema)) return inspectSavedObservation(text, schema, byteLength, options, checkpoint, knownTextDigest);
  if (!definition) {
    checkpoint();
    return captureSavedInspection({ schema: "threecore.saved-file-inspection.v1", sourceSchema: schema, byteLength,
      title: "補助資料の形式指定", target: walletSavedTargets[schema][0], destinationMessage: walletSavedMessages[targetCode],
      validation: "declared-only", checksumVerified: false, sourceDigest: null, textDigest: null,
      scope: null, originalEvidenceValidated: false, restorable: false,
      automaticallyImported: false, liveChainRechecked: false, authenticated: false, authorizesExecution: false });
  }
  let decoded;
  // Static module paths only. No destination is taken from imported data.
  if (definition[0] === "period") decoded = await (await import("./period-file.js")).decodePeriodFile(text, options);
  else if (definition[0] === "library") decoded = await (await import("./period-library-file.js")).decodePeriodLibraryFile(text, options);
  else if (definition[0] === "report") decoded = await (await import("./period-report-file.js")).decodePeriodReportFile(text, options);
  else if (definition[0] === "history") decoded = await (await import("./report-history-file.js")).decodeReportHistoryFile(text, options);
  else decoded = await (await import("./report-set-file.js")).decodeReportSetFile(text, options);
  checkpoint();
  const reports = definition[0] === "history" ? decoded.document.entries : definition[0] === "set" ? decoded.input.entries : null;
  const entries = reports ? reports.flatMap(row => row.report.slots.map(slot => slot.entry).filter(Boolean)) :
    definition[0] === "report" ? decoded.input.slots.map(slot => slot.entry).filter(Boolean) :
    definition[0] === "library" ? decoded.document.entries : [];
  const drafts = definition[0] === "period" ? [decoded.draft] : entries.map(row => row.draft);
  const { periodDraftProgress } = await import("./period-draft.js");
  checkpoint();
  const progress = drafts.map(draft => periodDraftProgress(draft));
  const scope = Object.freeze({ reportCount: reports?.length ?? (definition[0] === "report" ? 1 : null),
    archivedReports: reports ? reports.filter(row => row.archived).length : null,
    entryReferences: entries.length, draftReferences: drafts.length,
    archivedEntryReferences: definition[0] === "period" ? null : entries.filter(row => row.archived).length,
    restrictedEntryReferences: definition[0] === "period" ? null : entries.filter(row => row.requiresNewPlan).length,
    incompleteDraftReferences: progress.filter(row => !row.complete).length,
    emptyDraftReferences: progress.filter(row => row.completed === 0).length,
    agents: Object.freeze(["DAT", "EMA", "CAWELON"].filter(agent => drafts.some(draft => draft.plan.context.agent === agent))),
    annotationValuesIncluded: false, repeatedReferencesMayExist: Boolean(reports) });
  const textDigest = knownTextDigest ?? await sha256Hex(new TextEncoder().encode(text), options.subtle ?? globalThis.crypto?.subtle, options);
  checkpoint();
  return captureSavedInspection({ schema: "threecore.saved-file-inspection.v1", sourceSchema: schema, byteLength,
    title: definition[1], target: definition[0], destinationMessage: definition[2],
    validation: "validated-original", checksumVerified: decoded.checksumVerified === true,
    sourceDigest: decoded.digest, textDigest, scope, originalEvidenceValidated: true, restorable: false,
    automaticallyImported: false, liveChainRechecked: false, authenticated: false, authorizesExecution: false });
}

export function walletSavedInspectionText(value) {
  if (!value) return "";
  const summary = [value.title + " · " + value.byteLength + " bytes",
    value.validation === "validated-original" ? "元記録の形式とチェックサムを確認しました。まだ読み込み先へ反映していません。" : value.validation === "validated-structure" ? "データ形式を確認しました。この形式に内部チェックサムはなく、変更前との一致は確認していません。まだ読み込み先へ反映していません。" :
      "形式の指定だけを判別しました。中身・チェックサム・記載された結論は検証していません。",
    value.destinationMessage];
  if (value.simulationOnly === true) summary.push("練習用の入力から記録を再計算しました。仮想条件に合わない記録が0件でも、実際の運用の許可や安全性の証明にはなりません。");
  if (value.scope) {
    const scope = value.scope;
    if (scope.reportCount !== null) summary.push("報告 " + scope.reportCount + "件" + (scope.archivedReports !== null ? " / 非表示保管 " + scope.archivedReports + "件" : ""));
    summary.push("含まれるトークン: " + (scope.agents.join("、") || "なし"));
    if (scope.draftReferences !== null) summary.push("元の控えの参照 " + scope.draftReferences + "件 / 取得工程が未完了 " + scope.incompleteDraftReferences + "件 / 取得工程が空 " + scope.emptyDraftReferences + "件",
      scope.restrictedEntryReferences === null ? "この控えの形式には、保存一覧の保管状態と再取得の印は含まれません。" :
        "再取得の印がある保存項目の参照 " + scope.restrictedEntryReferences + "件 / 非表示保管の保存項目の参照 " + scope.archivedEntryReferences + "件");
    for (const field of WALLET_SAVED_OBSERVATION_SCOPE_FIELDS) if (scope[field] !== null && scope[field] !== undefined) summary.push(observationScopeLabels[field] + " " + scope[field] + "件");
    for (const field of WALLET_SAVED_REHEARSAL_SCOPE_FIELDS) if (scope[field] !== null && scope[field] !== undefined) summary.push(rehearsalScopeLabels[field] + " " + scope[field] + "件");
    if (scope.repeatedReferencesMayExist) summary.push("同じ記録やイベントが複数の箇所に含まれる場合があるため、参照数は独立した検証回数や重複を除いた履歴件数ではありません。");
  }
  summary.push("アドレス・残高・メモ本文はこの案内には表示しません。現在のチェーン、出所、完全性、安全性を証明する確認ではありません。");
  return summary.join("\n");
}

export function walletSavedInspectionErrorText(error) {
  let code; try { code = Object.getOwnPropertyDescriptor(error, "code")?.value; } catch {}
  if (code === "FILE_BATCH_SOURCE_CHANGED") return "一括確認した時とファイルの内容が違うため、詳細を開く操作を止めました。元ファイルを保全し、選び直して一括確認してください。";
  if (code === "FILE_BATCH_MANIFEST") return "照合値一覧の書式を確認できません。SHA-256とJSONファイル名を記した、16 KiB以内・20行以内の元の一覧を使ってください。";
  if (code === "FILE_BATCH_REFERENCE_SELECTION") return "照合値一覧と、選択したJSONのファイル名が一致しません。大文字・小文字も含め、一覧の全ファイルを選んでください。";
  if (code === "FILE_BATCH_CHECKSUM_MISMATCH") return "以前の照合値と一致しません。この内容を元記録として確認する処理は行っていません。以前の資料を保全して調べてください。";
  if (code === "FILE_BATCH_REFERENCE_HASH_UNAVAILABLE") return "照合値一覧そのものの照合用の値を計算できませんでした。比較なしに切り替えずに停止しました。";
  if (code === "FILE_BUNDLE_SIZE") return "まとめる元資料の合計は24 MiB、まとめた資料は48 MiBまでです。大きい場合は両方の元ファイルを別々に保全してください。";
  if (code === "FILE_BUNDLE_SOURCE_CHANGED") return "比較した後に元資料が変わったため保存を中止しました。両方の元ファイルを選び直して比較してください。";
  if (code === "FILE_BUNDLE_ORIGINALS_REQUIRED") return "両方の検証済み元記録が必要です。案内や比較結果だけでは、元資料をまとめられません。";
  if (typeof code === "string" && code.startsWith("FILE_BUNDLE_")) return "まとめた資料の形式や比較結果を確認できませんでした。元のJSONを保全して、確認し直してください。";
  if (typeof code === "string" && code.startsWith("FILE_COMPARISON_REVIEW_")) return "保存した比較JSONを確認できませんでした。比較先の元資料ではなく、2つのファイルの比較結果を選んでください。";
  if (code === "PERIOD_CHECKSUM") return "チェックサムが一致しません。保存が完了した元のJSONを選び直してください。内容は取り込んでいません。";
  if (code === "FILE_INSPECTION_UNSUPPORTED") return "この案内では扱わない形式です。ThreeCoreの期間・報告・履歴・残高観測・設定・運用リハーサルなどの元の保存JSONを選んでください。";
  if (code === "FILE_INSPECTION_JSON") return "JSONの形式を確認できません。元の保存ファイルを選び直してください。";
  return describeFileReadError(error, "96 MiB") ?? "ファイルの形式・内容を確認できませんでした。元のJSONを保全し、保存が完了しているか確認してください。";
}

/** Only inspections made by this module can establish a comparison, never imported claims. */
export function compareWalletSavedInspections(before, after) {
  if (!savedInspectionCaptures.has(before) || !savedInspectionCaptures.has(after)) savedInspectionFail("FILE_INSPECTION_COMPARISON");
  const verified = before.validation === "validated-original" && after.validation === "validated-original";
  const sameFormat = before.sourceSchema === after.sourceSchema;
  const sameOriginal = verified && sameFormat ? before.sourceDigest === after.sourceDigest : null;
  const sameText = verified ? before.textDigest === after.textDigest : null;
  const kind = !verified ? "unverified" : !sameFormat ? "different-format" : !sameOriginal ? "changed-original" : !sameText ? "format-only" : "identical";
  const scopeFields = ["reportCount", "archivedReports", "entryReferences", "draftReferences", "archivedEntryReferences",
    "restrictedEntryReferences", "incompleteDraftReferences", "emptyDraftReferences", "agents", ...WALLET_SAVED_OBSERVATION_SCOPE_FIELDS];
  const scopeChanges = verified && sameFormat ? scopeFields.filter(field => JSON.stringify(before.scope[field]) !== JSON.stringify(after.scope[field]))
    .map(field => Object.freeze({ field, before: before.scope[field], after: after.scope[field],
      difference: typeof before.scope[field] === "number" && typeof after.scope[field] === "number" ? after.scope[field] - before.scope[field] : null })) : [];
  return Object.freeze({ schema: "threecore.saved-file-comparison.v1", kind,
    before, after, sameFormat, sameOriginal, sameText, byteDifference: after.byteLength - before.byteLength,
    scopeChanges: Object.freeze(scopeChanges), unchangedScopeWithChangedOriginal: kind === "changed-original" && scopeChanges.length === 0,
    containsOriginalEvidence: false, restorable: false, automaticallyImported: false,
    liveChainRechecked: false, authenticated: false, authorizesExecution: false });
}

export function walletSavedComparisonText(value) {
  if (!value) return "";
  const titles = {
    identical: "同じ形式・同じ元記録で、ファイルのテキストも一致しています。",
    "format-only": "元記録のチェックサムは一致しています。空白や項目の並びなど、ファイルの書式に違いがあります。",
    "changed-original": "同じ形式ですが、元記録の内容に違いがあります。どちらが正しいかは、この比較では判断しません。",
    "different-format": "種類が異なるファイルです。元記録の一致・不一致としては比較しません。",
    unverified: "内部チェックサム付きの元記録として両方を確認できないため、内容の一致を判断していません。",
  };
  const fields = { reportCount: "報告件数", archivedReports: "非表示保管の報告", entryReferences: "保存項目の参照数",
    draftReferences: "取得控えの参照数", archivedEntryReferences: "非表示保管の保存項目", restrictedEntryReferences: "再取得の印がある保存項目",
    incompleteDraftReferences: "未完了の控え", emptyDraftReferences: "工程が空の控え", agents: "含まれるトークン" };
  const show = value => value === null ? "この形式には含まれません" : Array.isArray(value) ? value.join("、") || "なし" : String(value);
  return [titles[value.kind], "比較元: " + value.before.title + " / 比較先: " + value.after.title,
    "ファイルサイズ: " + value.before.byteLength + " → " + value.after.byteLength + " bytes（差 " + value.byteDifference + "）",
    ...value.scopeChanges.map(row => (fields[row.field] ?? observationScopeLabels[row.field]) + ": " + show(row.before) + " → " + show(row.after)),
    value.unchangedScopeWithChangedOriginal ? "上の件数が同じでも、元記録の内容は変わっています。" : "",
    "比較するのは保存ファイルだけです。元ファイルの選び直し・置き換え・復元や現在のチェーンの確認は行いません。",
    "この比較結果には元記録を含まず、復元には使えません。両方の元ファイルを保全してください。"].filter(Boolean).join("\n");
}

export const WALLET_SAVED_COMPARISON_REVIEW_LIMIT = 256 * 1024;
function sameSavedJSON(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameSavedJSON(left[key], right[key]));
}

/** Recompute from owned inspections; a saved comparison is evidence to check, never authority. */
export async function reviewWalletSavedComparison(before, after, text, fileOptions = {}) {
  const expected = compareWalletSavedInspections(before, after);
  let options;
  try { options = captureOptionalDataFields(fileOptions, ["subtle", "signal", "timeoutMs"]); }
  catch { savedInspectionFail("FILE_COMPARISON_REVIEW_OPTIONS"); }
  let aborted; try { aborted = readAbortState(options.signal); } catch { savedInspectionFail("FILE_COMPARISON_REVIEW_OPTIONS"); }
  if (typeof aborted !== "boolean") savedInspectionFail("FILE_COMPARISON_REVIEW_OPTIONS");
  if (aborted) savedInspectionFail("FILE_CANCELLED");
  let supplied;
  try { supplied = parseSecurityJson(text, { bytes: WALLET_SAVED_COMPARISON_REVIEW_LIMIT }); }
  catch { savedInspectionFail("FILE_COMPARISON_REVIEW_JSON"); }
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied) || supplied.schema !== "threecore.saved-file-comparison.v1") savedInspectionFail("FILE_COMPARISON_REVIEW_SCHEMA");
  const differences = Object.keys(expected).filter(field => !Object.hasOwn(supplied, field) || !sameSavedJSON(supplied[field], expected[field]));
  const unexpectedFields = Object.keys(supplied).filter(field => !Object.hasOwn(expected, field)).length;
  const comparisonTextDigest = await sha256Hex(new TextEncoder().encode(text), options.subtle, options);
  if (readAbortState(options.signal) !== false) savedInspectionFail("FILE_CANCELLED");
  return Object.freeze({ schema: "threecore.saved-file-comparison-review.v1",
    matchesRecomputation: differences.length === 0 && unexpectedFields === 0,
    expectedKind: expected.kind, expectedSameOriginal: expected.sameOriginal,
    beforeSourceDigest: before.sourceDigest, afterSourceDigest: after.sourceDigest,
    beforeTextDigest: before.textDigest, afterTextDigest: after.textDigest,
    originalPairValidated: before.validation === "validated-original" && after.validation === "validated-original",
    beforeBindingMatches: before.validation === "validated-original" ? supplied.before?.sourceSchema === before.sourceSchema && supplied.before?.sourceDigest === before.sourceDigest && supplied.before?.textDigest === before.textDigest : null,
    afterBindingMatches: after.validation === "validated-original" ? supplied.after?.sourceSchema === after.sourceSchema && supplied.after?.sourceDigest === after.sourceDigest && supplied.after?.textDigest === after.textDigest : null,
    comparisonTextDigest, differences: Object.freeze(differences), unexpectedFields,
    containsOriginalEvidence: false, restorable: false, readOnly: true,
    liveChainRechecked: false, authenticated: false, authorizesExecution: false });
}

export function walletSavedComparisonReviewText(value) {
  if (!value) return "";
  const fields = { schema: "ファイル形式", kind: "比較の判定", before: "比較元の記録", after: "比較先の記録",
    sameFormat: "同じ形式か", sameOriginal: "元記録が同じか", sameText: "テキストが同じか", byteDifference: "ファイルサイズの差",
    scopeChanges: "件数等の変化", unchangedScopeWithChangedOriginal: "件数が同じ内容変更", containsOriginalEvidence: "元記録の有無",
    restorable: "復元に使えるか", automaticallyImported: "自動取込の主張", liveChainRechecked: "現在のチェーン確認の主張",
    authenticated: "出所の認証の主張", authorizesExecution: "実行許可の主張" };
  return [value.matchesRecomputation ? "保存した比較結果は、この2つの記録からの再計算と一致しています。" : "保存した比較結果に、再計算と一致しない箇所があります。",
    value.originalPairValidated ? "両方の元記録の形式とチェックサムを確認しています。" : "内部チェックサム付きの元記録として両方を確認できないため、元記録同士の一致は判断していません。",
    "比較元との結び付け: " + (value.beforeBindingMatches === null ? "未検証" : value.beforeBindingMatches ? "一致" : "不一致") + " / 比較先との結び付け: " + (value.afterBindingMatches === null ? "未検証" : value.afterBindingMatches ? "一致" : "不一致"),
    ...value.differences.map(field => "不一致: " + fields[field]),
    value.unexpectedFields ? "仕様にない追加項目: " + value.unexpectedFields + "個" : "",
    "再計算との一致は、2つの元ファイルの内容が同じという意味ではありません。現在のチェーンや記録の正しさを証明するものでもありません。",
    "この照合結果には元記録を含まず、復元には使えません。"].filter(Boolean).join("\n");
}

export const WALLET_SAVED_BUNDLE_SOURCE_LIMIT = 24 * 1024 * 1024;
export const WALLET_SAVED_BUNDLE_LIMIT = 48 * 1024 * 1024;
const savedBundleSources = new WeakMap();
function savedBundleOptions(value) {
  try { return captureOptionalDataFields(value, ["subtle", "signal", "timeoutMs"]); }
  catch { savedInspectionFail("FILE_BUNDLE_OPTIONS"); }
}
function boundedSavedPair(beforeText, afterText) {
  try {
    const beforeBytes = boundedUtf8Length(beforeText, WALLET_SAVED_BUNDLE_SOURCE_LIMIT);
    const afterBytes = boundedUtf8Length(afterText, WALLET_SAVED_BUNDLE_SOURCE_LIMIT);
    if (!beforeBytes || !afterBytes || beforeBytes + afterBytes > WALLET_SAVED_BUNDLE_SOURCE_LIMIT) throw Error();
  } catch { savedInspectionFail("FILE_BUNDLE_SIZE"); }
}
function checkSavedBundleAbort(options) {
  let aborted; try { aborted = readAbortState(options.signal); } catch { savedInspectionFail("FILE_BUNDLE_OPTIONS"); }
  if (typeof aborted !== "boolean") savedInspectionFail("FILE_BUNDLE_OPTIONS");
  if (aborted) savedInspectionFail("FILE_CANCELLED");
}

/** Keep exact original UTF-8 text, including formatting, with a reproducible comparison. */
export async function prepareWalletSavedBundle(beforeText, afterText, fileOptions = {}) {
  const options = savedBundleOptions(fileOptions); checkSavedBundleAbort(options); boundedSavedPair(beforeText, afterText);
  const before = await inspectWalletSavedText(beforeText, options); checkSavedBundleAbort(options);
  const after = await inspectWalletSavedText(afterText, options); checkSavedBundleAbort(options);
  if (before.validation !== "validated-original" || after.validation !== "validated-original") savedInspectionFail("FILE_BUNDLE_ORIGINALS_REQUIRED");
  const comparison = compareWalletSavedInspections(before, after);
  const text = JSON.stringify({ schema: "threecore.saved-file-comparison-bundle.v1", beforeFileText: beforeText,
    afterFileText: afterText, comparisonText: JSON.stringify(comparison, null, 2) + "\n",
    authenticated: false, encrypted: false, authorizesExecution: false }) + "\n";
  try { boundedUtf8Length(text, WALLET_SAVED_BUNDLE_LIMIT); } catch { savedInspectionFail("FILE_BUNDLE_SIZE"); }
  checkSavedBundleAbort(options);
  return Object.freeze({ text, filename: "ThreeCore-saved-file-comparison-bundle.json", mimeType: "application/json;charset=utf-8",
    comparison, sourceTextPreserved: true, containsOriginalEvidence: true, authenticated: false, encrypted: false, authorizesExecution: false });
}

/** Validate both originals and compare the supplied result with a fresh computation. */
export async function reviewWalletSavedBundle(text, fileOptions = {}) {
  const options = savedBundleOptions(fileOptions); checkSavedBundleAbort(options);
  let bundle;
  try { bundle = parseSecurityJson(text, { bytes: WALLET_SAVED_BUNDLE_LIMIT, stringCharacters: WALLET_SAVED_BUNDLE_SOURCE_LIMIT }); }
  catch { savedInspectionFail("FILE_BUNDLE_JSON"); }
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle) ||
      Object.keys(bundle).sort().join(",") !== "afterFileText,authenticated,authorizesExecution,beforeFileText,comparisonText,encrypted,schema" ||
      bundle.schema !== "threecore.saved-file-comparison-bundle.v1" || bundle.authenticated !== false || bundle.encrypted !== false || bundle.authorizesExecution !== false) savedInspectionFail("FILE_BUNDLE_SCHEMA");
  boundedSavedPair(bundle.beforeFileText, bundle.afterFileText);
  const before = await inspectWalletSavedText(bundle.beforeFileText, options); checkSavedBundleAbort(options);
  const after = await inspectWalletSavedText(bundle.afterFileText, options); checkSavedBundleAbort(options);
  if (before.validation !== "validated-original" || after.validation !== "validated-original") savedInspectionFail("FILE_BUNDLE_ORIGINALS_REQUIRED");
  const comparison = compareWalletSavedInspections(before, after);
  const comparisonReview = await reviewWalletSavedComparison(before, after, bundle.comparisonText, options);
  const bundleTextDigest = await sha256Hex(new TextEncoder().encode(text), options.subtle, options); checkSavedBundleAbort(options);
  const result = Object.freeze({ schema: "threecore.saved-file-comparison-bundle-review.v1", bundleTextDigest,
    before, after, comparison, comparisonReview, originalsValidated: true,
    comparisonMatchesRecomputation: comparisonReview.matchesRecomputation,
    originalsAvailable: comparisonReview.matchesRecomputation,
    containsOriginalEvidence: false, restorable: false, automaticallyImported: false,
    liveChainRechecked: false, authenticated: false, authorizesExecution: false });
  if (result.originalsAvailable) savedBundleSources.set(result, Object.freeze({ before: bundle.beforeFileText, after: bundle.afterFileText }));
  return result;
}

/** Only a completed faithful review owned by this module can yield embedded source text. */
export function walletSavedBundleSourceFile(receipt, role) {
  if (!["before", "after"].includes(role) || !savedBundleSources.has(receipt)) savedInspectionFail("FILE_BUNDLE_SOURCE");
  return Object.freeze({ text: savedBundleSources.get(receipt)[role], filename: "ThreeCore-comparison-" + role + "-original.json",
    mimeType: "application/json;charset=utf-8", containsOriginalEvidence: true, sourceTextPreserved: true,
    authenticated: false, encrypted: false, automaticallyImported: false, authorizesExecution: false });
}

export function walletSavedBundleReviewText(value) {
  if (!value) return "";
  return ["まとめた資料の比較元: " + value.before.title + " / 比較先: " + value.after.title,
    "両方の元記録の形式とチェックサムを確認しました。",
    value.comparisonMatchesRecomputation ? "保存された比較結果は再計算と一致しています。元記録を取り出せます。" :
      "保存された比較結果に不一致があるため、この資料から元記録を取り出す操作はできません。",
    walletSavedComparisonText(value.comparison), walletSavedComparisonReviewText(value.comparisonReview),
    "元記録を取り出しても、ウォレットへの接続・復元・取得開始は行いません。各形式の読込み欄で改めて確認してください。"].join("\n");
}

export const WALLET_SAVED_BROWSER_BATCH_LIMITS = Object.freeze({ files: 20, fileBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 });
export const WALLET_SAVED_BATCH_MANIFEST_LIMIT = 16384;
const browserSavedBatchReceipts = new WeakSet();
const browserSavedFileBatchSelections = new WeakMap();
export function validateWalletSavedBatchSelection(input) {
  try {
    const names = new Set(); let totalBytes = 0;
    const files = captureDataArray(input, WALLET_SAVED_BROWSER_BATCH_LIMITS.files, 1).map(input => {
      const row = captureDataRecord(input, ["name", "byteLength"]);
      if (typeof row.name !== "string" || row.name.length > 180 || row.name !== row.name.trim() ||
          !/\.json$/i.test(row.name) || /^[.]/.test(row.name) ||
          /[/\\:*?"<>|\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(row.name) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(row.name) ||
          !Number.isSafeInteger(row.byteLength) || row.byteLength < 1 || row.byteLength > WALLET_SAVED_BROWSER_BATCH_LIMITS.fileBytes) throw Error();
      const key = row.name.normalize("NFC").toLowerCase(); if (names.has(key)) throw Error(); names.add(key); totalBytes += row.byteLength;
      return Object.freeze({ name: row.name, byteLength: row.byteLength });
    });
    if (totalBytes > WALLET_SAVED_BROWSER_BATCH_LIMITS.totalBytes) throw Error();
    return Object.freeze({ files: Object.freeze(files), totalBytes });
  } catch { savedInspectionFail("FILE_BATCH_SELECTION"); }
}

/** Bind an explicit prior checksum list to every selected portable basename. */
export function matchWalletSavedBatchManifest(selectionInput, text) {
  const selection = validateWalletSavedBatchSelection(selectionInput);
  let entries;
  try {
    boundedUtf8Length(text, WALLET_SAVED_BATCH_MANIFEST_LIMIT);
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/); if (lines.at(-1) === "") lines.pop();
    if (!lines.length || lines.length > WALLET_SAVED_BROWSER_BATCH_LIMITS.files) throw Error();
    entries = lines.map(line => { const match = /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(line); if (!match) throw Error(); return Object.freeze({ name: match[2], expectedSha256: match[1].toLowerCase() }); });
    validateWalletSavedBatchSelection(entries.map(row => ({ name: row.name, byteLength: 1 })));
  } catch { savedInspectionFail("FILE_BATCH_MANIFEST"); }
  const byName = new Map(entries.map(row => [row.name, row]));
  if (entries.length !== selection.files.length || selection.files.some(row => !byName.has(row.name))) savedInspectionFail("FILE_BATCH_REFERENCE_SELECTION");
  return Object.freeze(selection.files.map(row => byName.get(row.name)));
}

async function inspectSavedBatchRow(row, { subtle, signal, timeoutMs, expectedSha256 }) {
  let sha256 = null, inspection = null, status = "hash-unavailable", code = null, checksumMatches = null;
  try { sha256 = await sha256Hex(new TextEncoder().encode(row.text), subtle, { signal, timeoutMs: Math.min(timeoutMs, 30000) }); }
  catch { code = "FILE_BATCH_HASH_UNAVAILABLE"; }
  if (readAbortState(signal)) return null;
  if (expectedSha256 !== undefined && sha256 !== null) checksumMatches = sha256 === expectedSha256;
  if (checksumMatches === false) { status = "checksum-mismatch"; code = "FILE_BATCH_CHECKSUM_MISMATCH"; }
  if (sha256 !== null && checksumMatches !== false) {
    try {
      // A decoder's lazy module import can stall before its own abort-aware work starts.
      inspection = await waitSavedBatchSource(() => inspectWalletSavedTextCaptured(row.text, { subtle, signal, timeoutMs: Math.min(timeoutMs, 30000) }, sha256), signal);
      if (inspection.validation === "validated-original" && (inspection.textDigest !== sha256 || !inspection.checksumVerified)) savedInspectionFail("FILE_BATCH_HASH_INCONSISTENT");
      status = inspection.validation;
    } catch (error) {
      status = "invalid"; inspection = null;
      try { code = Object.getOwnPropertyDescriptor(error, "code")?.value; } catch {}
      if (typeof code !== "string" || !/^(FILE|PERIOD|TRANSFER|IDENTITY|ALLOWANCE|WORKSPACE|SETUP|HISTORY|RECONCILIATION)_[A-Z_]{1,64}$/.test(code)) code = "FILE_INSPECTION_FAILED";
    }
  }
  if (readAbortState(signal)) return null;
  return Object.freeze({ name: row.name, byteLength: row.byteLength, sha256, status, code, inspection,
    ...(expectedSha256 !== undefined ? { expectedSha256, checksumMatches } : {}) });
}

function finishSavedBatch(rows, selection, completed, phase, referenceText, reference, referenceSha256, fileReads = false, continuation = null) {
  const hasReference = reference !== null;
  const files = rows.map((row, i) => completed[i] ?? Object.freeze({ name: row.name, byteLength: fileReads ? null : row.byteLength,
    ...(fileReads ? { reportedByteLength: row.byteLength } : {}), sha256: null, status: "pending", code: null, inspection: null,
    ...(hasReference ? { expectedSha256: reference[i].expectedSha256, checksumMatches: null } : {}) }));
  const count = status => files.filter(row => row.status === status).length;
  const unknownSourceBytes = fileReads && files.some(row => row.byteLength === null);
  const summary = Object.freeze({ selected: files.length, checked: completed.length, pending: count("pending"), validatedOriginals: count("validated-original"), declaredOnly: count("declared-only"), invalid: count("invalid"), hashUnavailable: count("hash-unavailable"),
    totalBytes: unknownSourceBytes ? files.reduce((total, row) => total + (row.byteLength ?? 0), 0) : selection.totalBytes,
    ...(hasReference ? { checksumsCompared: files.filter(row => row.checksumMatches !== null).length, checksumsMatching: files.filter(row => row.checksumMatches === true).length, checksumMismatches: count("checksum-mismatch") } : {}),
    ...(unknownSourceBytes ? { sourceUnavailable: count("source-unavailable"), selectedReportedBytes: selection.totalBytes, unreadSourceReportedBytes: files.reduce((total, row) => total + (row.reportedByteLength ?? 0), 0) } : {}),
    ...(count("validated-structure") ? { structureValidated: count("validated-structure") } : {}),
    ...(files.some(row => row.inspection?.simulationOnly === true) ? { simulationFiles: files.filter(row => row.inspection?.simulationOnly === true).length } : {}) });
  const result = Object.freeze({ schema: "threecore.wallet-saved-browser-batch." + (continuation ? "v4" : unknownSourceBytes ? "v3" : hasReference ? "v2" : "v1"), readOnly: true, authenticatesOrigin: false, authorizesExecution: false, restorable: false, liveChainRechecked: false, atomicSnapshot: false, externalChecksumsCompared: hasReference && summary.checksumsCompared > 0,
    phase, complete: phase === "complete" && completed.length === rows.length, allOriginalsValidated: phase === "complete" && summary.validatedOriginals === rows.length, summary, files: Object.freeze(files),
    ...(continuation ? { continuation: Object.freeze(continuation) } : {}),
    ...(hasReference ? { referenceProvided: true, reference: Object.freeze({ text: referenceText, sha256: referenceSha256, entries: reference }), allExternalChecksumsMatch: phase === "complete" && summary.checksumsMatching === rows.length } : {}) });
  browserSavedBatchReceipts.add(result); return result;
}

/** Text-only inspection: no filesystem, import, wallet or storage capability. */
export async function inspectWalletSavedTextBatch(input, options = {}) {
  try { options = captureOptionalDataFields(options, ["subtle", "signal", "timeoutMs", "onProgress", "manifestText"]); }
  catch { savedInspectionFail("FILE_BATCH_OPTIONS"); }
  const { subtle = globalThis.crypto?.subtle, signal, timeoutMs = 120000, onProgress } = options;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || (onProgress !== undefined && typeof onProgress !== "function")) savedInspectionFail("FILE_BATCH_OPTIONS");
  let rows;
  try { rows = captureDataArray(input, WALLET_SAVED_BROWSER_BATCH_LIMITS.files, 1).map(input => {
    const row = captureDataRecord(input, ["name", "text"]);
    return Object.freeze({ name: row.name, text: row.text, byteLength: boundedUtf8Length(row.text, WALLET_SAVED_BROWSER_BATCH_LIMITS.fileBytes) });
  }); } catch { savedInspectionFail("FILE_BATCH_INPUT"); }
  const selection = validateWalletSavedBatchSelection(rows.map(({ name, byteLength }) => ({ name, byteLength })));
  const hasReference = options.manifestText !== undefined;
  const reference = hasReference ? matchWalletSavedBatchManifest(selection.files, options.manifestText) : null;
  let referenceSha256 = null;
  const local = new AbortController(), completed = []; let phase = "complete", timer, subscription;
  const stop = reason => { if (!readAbortState(local.signal)) { phase = reason; local.abort(); } };
  const progress = () => consumeCallback(() => onProgress?.(Object.freeze({ selected: rows.length, checked: completed.length })));
  try {
    try { subscription = subscribeReadAbort(signal, () => stop("cancelled")); } catch { savedInspectionFail("FILE_BATCH_SIGNAL"); }
    timer = setTimeout(() => stop("timed-out"), timeoutMs); progress();
    if (hasReference && !readAbortState(local.signal)) {
      try { referenceSha256 = await sha256Hex(new TextEncoder().encode(options.manifestText), subtle, { signal: local.signal, timeoutMs: Math.min(timeoutMs, 30000) }); }
      catch { if (!readAbortState(local.signal)) savedInspectionFail("FILE_BATCH_REFERENCE_HASH_UNAVAILABLE"); }
    }
    for (const [index, row] of rows.entries()) {
      if (readAbortState(local.signal)) break;
      const checked = await inspectSavedBatchRow(row, { subtle, signal: local.signal, timeoutMs, expectedSha256: hasReference ? reference[index].expectedSha256 : undefined });
      if (readAbortState(local.signal) || !checked) break;
      completed.push(checked); progress();
    }
    return finishSavedBatch(rows, selection, completed, phase, options.manifestText, reference, referenceSha256);
  } finally { clearTimeout(timer); subscription?.dispose(); local.abort(); }
}

function waitSavedBatchSource(read, signal) {
  return new Promise((resolve, reject) => {
    let settled = false, subscription;
    const finish = (callback, value) => { if (callback === reject) observeCallbackResult(value); if (settled) return; settled = true; subscription?.dispose(); callback(value); };
    subscription = subscribeReadAbort(signal, () => { const error = new Error("FILE_CANCELLED"); error.code = "FILE_CANCELLED"; finish(reject, error); });
    if (settled) return;
    try { const value = read();
      if (typeof value === "string") finish(resolve, value);
      else try { Reflect.apply(Promise.prototype.then, value, [value => finish(resolve, value), error => finish(reject, error)]); }
      catch { observeCallbackResult(value); const error = new Error("FILE_READ"); error.code = "FILE_READ"; finish(reject, error); }
    } catch (error) { finish(reject, error); }
  });
}

/** Sequential trusted reader adapter: finish each file before starting the next. */
export async function inspectWalletSavedFileBatch(input, readSource, options = {}) {
  const selection = validateWalletSavedBatchSelection(input);
  return inspectSavedFileBatchCaptured(selection, readSource, options);
}

/** Only the current module's unfinished file reads can be continued, never uploaded claims. */
export function canResumeWalletSavedFileBatch(previous) {
  return browserSavedFileBatchSelections.has(previous) && ["cancelled", "timed-out"].includes(previous.phase) && previous.summary.pending > 0;
}
export async function resumeWalletSavedFileBatch(previous, readSource, options = {}) {
  if (!canResumeWalletSavedFileBatch(previous)) savedInspectionFail("FILE_BATCH_RESUME");
  try { options = captureOptionalDataFields(options, ["subtle", "signal", "timeoutMs", "onProgress", "manifestText"]); } catch { savedInspectionFail("FILE_BATCH_OPTIONS"); }
  if (Object.hasOwn(options, "manifestText")) savedInspectionFail("FILE_BATCH_OPTIONS");
  return inspectSavedFileBatchCaptured(browserSavedFileBatchSelections.get(previous), readSource,
    { ...options, ...(previous.referenceProvided ? { manifestText: previous.reference.text } : {}) }, previous);
}
async function inspectSavedFileBatchCaptured(selection, readSource, options, previous = null) {
  try { options = captureOptionalDataFields(options, ["subtle", "signal", "timeoutMs", "onProgress", "manifestText"]); } catch { savedInspectionFail("FILE_BATCH_OPTIONS"); }
  const { subtle = globalThis.crypto?.subtle, signal, timeoutMs = 120000, onProgress } = options;
  if (typeof readSource !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || (onProgress !== undefined && typeof onProgress !== "function")) savedInspectionFail("FILE_BATCH_OPTIONS");
  const reference = options.manifestText === undefined ? null : matchWalletSavedBatchManifest(selection.files, options.manifestText);
  const completed = previous ? previous.files.slice(0, previous.summary.checked) : [], startAt = completed.length, local = new AbortController();
  let phase = "complete", timer, subscription, referenceSha256 = previous?.reference?.sha256 ?? null;
  const continuation = previous ? { sequence: (previous.continuation?.sequence ?? 0) + 1, retainedChecks: startAt, previousPhase: previous.phase, previousBatchSha256: null } : null;
  const stop = reason => { if (!readAbortState(local.signal)) { phase = reason; local.abort(); } };
  const progress = () => consumeCallback(() => onProgress?.(Object.freeze({ selected: selection.files.length, checked: completed.length })));
  try {
    try { subscription = subscribeReadAbort(signal, () => stop("cancelled")); } catch { savedInspectionFail("FILE_BATCH_SIGNAL"); }
    timer = setTimeout(() => stop("timed-out"), timeoutMs); progress();
    if (continuation && !readAbortState(local.signal)) {
      try { continuation.previousBatchSha256 = await sha256Hex(new TextEncoder().encode(encodeWalletSavedTextBatch(previous)), subtle, { signal: local.signal, timeoutMs: Math.min(timeoutMs, 30000) }); }
      catch { if (!readAbortState(local.signal)) savedInspectionFail("FILE_BATCH_RESUME_HASH_UNAVAILABLE"); }
    }
    if (reference && referenceSha256 === null && !readAbortState(local.signal)) {
      try { referenceSha256 = await sha256Hex(new TextEncoder().encode(options.manifestText), subtle, { signal: local.signal, timeoutMs: Math.min(timeoutMs, 30000) }); }
      catch { if (!readAbortState(local.signal)) savedInspectionFail("FILE_BATCH_REFERENCE_HASH_UNAVAILABLE"); }
    }
    for (const [index, row] of selection.files.entries()) {
      if (index < startAt) continue;
      if (readAbortState(local.signal)) break;
      let text;
      try {
        text = await waitSavedBatchSource(() => readSource(index, Object.freeze({ signal: local.signal, maxBytes: row.byteLength })), local.signal);
        if (readAbortState(local.signal)) break;
        let byteLength; try { byteLength = boundedUtf8Length(text, row.byteLength); } catch { savedInspectionFail("FILE_SIZE"); }
        if (byteLength !== row.byteLength) savedInspectionFail("FILE_SIZE");
      } catch (error) {
        if (readAbortState(local.signal)) break;
        let code; try { code = Object.getOwnPropertyDescriptor(error, "code")?.value; observeCallbackResult(code); } catch {}
        if (!["FILE_READ", "FILE_SIZE", "FILE_ENCODING", "FILE_TIMEOUT", "FILE_CLOCK", "FILE_BUSY", "FILE_DISPOSED"].includes(code)) code = "FILE_READ";
        completed.push(Object.freeze({ name: row.name, byteLength: null, reportedByteLength: row.byteLength, sha256: null, status: "source-unavailable", code, inspection: null,
          ...(reference ? { expectedSha256: reference[index].expectedSha256, checksumMatches: null } : {}) })); progress(); continue;
      }
      const checked = await inspectSavedBatchRow({ ...row, text }, { subtle, signal: local.signal, timeoutMs, expectedSha256: reference ? reference[index].expectedSha256 : undefined });
      if (readAbortState(local.signal) || !checked) break; completed.push(checked); progress();
    }
    const result = finishSavedBatch(selection.files, selection, completed, phase, options.manifestText, reference, referenceSha256, true, continuation);
    browserSavedFileBatchSelections.set(result, selection); return result;
  } finally { clearTimeout(timer); subscription?.dispose(); local.abort(); }
}
export function encodeWalletSavedTextBatch(result) {
  if (!browserSavedBatchReceipts.has(result)) savedInspectionFail("FILE_BATCH_RESULT");
  return JSON.stringify(result, null, 2) + "\n";
}
export function walletSavedTextBatchManifest(result) {
  if (!browserSavedBatchReceipts.has(result)) savedInspectionFail("FILE_BATCH_RESULT");
  if (!result.complete || result.files.some(row => row.sha256 === null)) savedInspectionFail("FILE_BATCH_HASHES_INCOMPLETE");
  return result.files.map(row => row.sha256 + "  " + row.name).join("\n") + "\n";
}

/** A viewing table of every selected row, including failures and pending rows. */
export function encodeWalletSavedTextBatchCsv(result) {
  if (!browserSavedBatchReceipts.has(result)) savedInspectionFail("FILE_BATCH_RESULT");
  const rows = [["readOnly", "authenticatesOrigin", "authorizesExecution", "restorable", "liveChainRechecked", "atomicSnapshot", "phase", "complete", "allOriginalsValidated", "referenceProvided", "referenceSha256", "allExternalChecksumsMatch", "selected", "checked", "pending", "name", "byteLength", "status", "code", "sha256", "expectedSha256", "checksumMatches", "sourceSchema", "internalChecksumVerified", "draftReferences", "incompleteDraftReferences", "restrictedEntryReferences", "agents", "repeatedReferencesMayExist"]];
  for (const row of result.files) { const i = row.inspection, s = i?.scope; rows.push([true, false, false, false, false, false, result.phase, result.complete, result.allOriginalsValidated, result.referenceProvided ?? false, result.reference?.sha256 ?? "", result.allExternalChecksumsMatch ?? "", result.summary.selected, result.summary.checked, result.summary.pending, row.name, row.byteLength ?? "", row.status, row.code ?? "", row.sha256 ?? "", row.expectedSha256 ?? "", row.checksumMatches ?? "", i?.sourceSchema ?? "", i?.checksumVerified ?? "", s?.draftReferences ?? "", s?.incompleteDraftReferences ?? "", s?.restrictedEntryReferences ?? "", s?.agents.join(" | ") ?? "", s?.repeatedReferencesMayExist ?? ""]); }
  if (Object.hasOwn(result.summary, "sourceUnavailable")) {
    rows[0].push("reportedByteLength", "sourceUnavailable", "selectedReportedBytes", "unreadSourceReportedBytes");
    result.files.forEach((row, index) => rows[index + 1].push(row.reportedByteLength ?? "", result.summary.sourceUnavailable, result.summary.selectedReportedBytes, result.summary.unreadSourceReportedBytes));
  }
  if (result.continuation) {
    rows[0].push("continuationSequence", "retainedChecks", "previousPhase", "previousBatchSha256");
    for (const row of rows.slice(1)) row.push(result.continuation.sequence, result.continuation.retainedChecks, result.continuation.previousPhase, result.continuation.previousBatchSha256 ?? "");
  }
  const extraFields = [...WALLET_SAVED_OBSERVATION_SCOPE_FIELDS, ...WALLET_SAVED_REHEARSAL_SCOPE_FIELDS].filter(field => result.files.some(row => row.inspection?.scope && Object.hasOwn(row.inspection.scope, field)));
  if (extraFields.length) {
    rows[0].push(...extraFields);
    result.files.forEach((row, index) => rows[index + 1].push(...extraFields.map(field => row.inspection?.scope?.[field] ?? "")));
  }
  if (result.files.some(row => row.inspection?.simulationOnly === true)) { rows[0].push("simulationOnly"); result.files.forEach((row, index) => rows[index + 1].push(row.inspection?.simulationOnly ?? "")); }
  const cell = value => { let text = String(value); if (/^\s*[=+@-]/u.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

const savedBatchComparisons = new WeakSet();
/** Compare two owned observations; a missing selection is not a deleted file. */
export function compareWalletSavedTextBatches(before, after) {
  if (!browserSavedBatchReceipts.has(before) || !browserSavedBatchReceipts.has(after)) savedInspectionFail("FILE_BATCH_COMPARISON");
  const beforeByName = new Map(before.files.map(row => [row.name, row]));
  const afterByName = new Map(after.files.map(row => [row.name, row]));
  const names = [...beforeByName.keys(), ...afterByName.keys()].filter((name, index, all) => all.indexOf(name) === index);
  const files = names.map(name => {
    const left = beforeByName.get(name) ?? null, right = afterByName.get(name) ?? null;
    const selection = !left ? "only-after" : !right ? "only-before" : "both";
    const sameBytes = left?.sha256 && right?.sha256 ? left.sha256 === right.sha256 : null;
    const comparison = left?.status === "validated-original" && right?.status === "validated-original"
      ? compareWalletSavedInspections(left.inspection, right.inspection) : null;
    return Object.freeze({ name, selection, before: left, after: right, sameBytes, comparison,
      kind: selection !== "both" ? selection : comparison?.kind ?? "unverified" });
  });
  const count = kind => files.filter(row => row.kind === kind).length;
  const summary = Object.freeze({ files: files.length, bothSelected: files.filter(row => row.selection === "both").length,
    onlyBefore: count("only-before"), onlyAfter: count("only-after"), identical: count("identical"),
    formatOnly: count("format-only"), changedOriginal: count("changed-original"), differentFormat: count("different-format"), unverified: count("unverified") });
  const result = Object.freeze({ schema: "threecore.wallet-saved-batch-comparison.v1", readOnly: true,
    authenticatesOrigin: false, authorizesExecution: false, containsOriginalEvidence: false, restorable: false,
    liveChainRechecked: false, atomicSnapshot: false, reportsFilesystemDeletions: false,
    before, after, sameSelection: summary.onlyBefore === 0 && summary.onlyAfter === 0,
    allSelectedOriginalsIdentical: before.complete && after.complete && summary.identical === files.length,
    summary, files: Object.freeze(files) });
  savedBatchComparisons.add(result); return result;
}

export function encodeWalletSavedBatchComparison(result, format = "json") {
  if (!savedBatchComparisons.has(result) || !["json", "csv"].includes(format)) savedInspectionFail("FILE_BATCH_COMPARISON");
  if (format === "json") return JSON.stringify(result, null, 2) + "\n";
  const rows = [["readOnly", "authenticatesOrigin", "authorizesExecution", "restorable", "liveChainRechecked", "atomicSnapshot", "reportsFilesystemDeletions", "beforePhase", "beforeComplete", "afterPhase", "afterComplete", "sameSelection", "allSelectedOriginalsIdentical", "name", "selection", "kind", "sameBytes", "beforeStatus", "afterStatus", "beforeSha256", "afterSha256", "beforeExpectedSha256", "afterExpectedSha256", "beforeChecksumMatches", "afterChecksumMatches", "sameOriginal", "byteDifference", "scopeChangeFields", "unchangedScopeWithChangedOriginal"]];
  for (const row of result.files) rows.push([true, false, false, false, false, false, false,
    result.before.phase, result.before.complete, result.after.phase, result.after.complete,
    result.sameSelection, result.allSelectedOriginalsIdentical, row.name, row.selection, row.kind, row.sameBytes ?? "",
    row.before?.status ?? "", row.after?.status ?? "", row.before?.sha256 ?? "", row.after?.sha256 ?? "",
    row.before?.expectedSha256 ?? "", row.after?.expectedSha256 ?? "", row.before?.checksumMatches ?? "", row.after?.checksumMatches ?? "",
    row.comparison?.sameOriginal ?? "", row.comparison?.byteDifference ?? "", row.comparison?.scopeChanges.map(change => change.field).join(" | ") ?? "", row.comparison?.unchangedScopeWithChangedOriginal ?? ""]);
  const cell = value => { let text = String(value); if (/^\s*[=+@-]/u.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function walletSavedBatchComparisonText(result) {
  if (result == null) return "";
  if (!savedBatchComparisons.has(result)) savedInspectionFail("FILE_BATCH_COMPARISON");
  const s = result.summary;
  return `両方に選択 ${s.bothSelected}件／比較元だけ ${s.onlyBefore}件／今回だけ ${s.onlyAfter}件。` +
    ` 同じ元記録・同じ書式 ${s.identical}件／書式だけの違い ${s.formatOnly}件／元記録の変化 ${s.changedOriginal}件／異なる形式 ${s.differentFormat}件／元記録を比較できない ${s.unverified}件。` +
    " 選択されなかったファイルが削除されたとは判断しません。未確認や照合値の不一致を含む行は、元記録の一致と扱いません。";
}

export const WALLET_SAVED_BATCH_COMPARISON_REVIEW_LIMIT = 1024 * 1024;
const savedBatchComparisonReviews = new WeakSet();
/** A saved comparison is checked against newly owned batches, never imported as authority. */
export async function reviewWalletSavedBatchComparison(before, after, text, fileOptions = {}) {
  const expected = compareWalletSavedTextBatches(before, after);
  let options; try { options = captureOptionalDataFields(fileOptions, ["subtle", "signal", "timeoutMs"]); }
  catch { savedInspectionFail("FILE_BATCH_COMPARISON_REVIEW_OPTIONS"); }
  const { subtle = globalThis.crypto?.subtle, signal, timeoutMs = 30000 } = options;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) savedInspectionFail("FILE_BATCH_COMPARISON_REVIEW_OPTIONS");
  const local = new AbortController(); let subscription, timer, timedOut = false;
  const checkpoint = () => { if (readAbortState(local.signal)) savedInspectionFail(timedOut ? "FILE_BATCH_COMPARISON_REVIEW_TIMEOUT" : "FILE_CANCELLED"); };
  try {
    try { subscription = subscribeReadAbort(signal, () => local.abort()); } catch { savedInspectionFail("FILE_BATCH_COMPARISON_REVIEW_OPTIONS"); }
    checkpoint(); timer = setTimeout(() => { timedOut = true; local.abort(); }, timeoutMs);
    let supplied; try { supplied = parseSecurityJson(text, { bytes: WALLET_SAVED_BATCH_COMPARISON_REVIEW_LIMIT }); } catch { savedInspectionFail("FILE_BATCH_COMPARISON_REVIEW_JSON"); }
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied) || supplied.schema !== expected.schema) savedInspectionFail("FILE_BATCH_COMPARISON_REVIEW_SCHEMA");
    const differences = Object.keys(expected).filter(field => !Object.hasOwn(supplied, field) || !sameSavedJSON(supplied[field], expected[field]));
    const unexpectedFields = Object.keys(supplied).filter(field => !Object.hasOwn(expected, field)).length;
    const digest = async value => { try { const result = await sha256Hex(new TextEncoder().encode(value), subtle, { signal: local.signal, timeoutMs }); checkpoint(); return result; } catch (error) { checkpoint(); throw error; } };
    const comparisonTextDigest = await digest(text), beforeBatchDigest = await digest(encodeWalletSavedTextBatch(before)), afterBatchDigest = await digest(encodeWalletSavedTextBatch(after)), expectedComparisonDigest = await digest(encodeWalletSavedBatchComparison(expected));
    checkpoint(); const result = Object.freeze({ schema: "threecore.wallet-saved-batch-comparison-review.v1", readOnly: true, authenticatesOrigin: false, authorizesExecution: false, containsOriginalEvidence: false, restorable: false, liveChainRechecked: false, atomicSnapshot: false,
      matchesRecomputation: differences.length === 0 && unexpectedFields === 0, beforeBindingMatches: sameSavedJSON(supplied.before, before), afterBindingMatches: sameSavedJSON(supplied.after, after),
      bothBatchesComplete: before.complete && after.complete, allSelectedOriginalsIdentical: expected.allSelectedOriginalsIdentical,
      expectedSummary: expected.summary, comparisonTextDigest, beforeBatchDigest, afterBatchDigest, expectedComparisonDigest, differences: Object.freeze(differences), unexpectedFields });
    savedBatchComparisonReviews.add(result); return result;
  } finally { clearTimeout(timer); subscription?.dispose(); local.abort(); }
}

export function encodeWalletSavedBatchComparisonReview(result) {
  if (!savedBatchComparisonReviews.has(result)) savedInspectionFail("FILE_BATCH_COMPARISON_REVIEW_RESULT");
  return JSON.stringify(result, null, 2) + "\n";
}
