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
function savedInspectionFail(code) { const error = new Error(code); error.code = code; throw error; }

/** Inspect one explicit saved file without handing evidence to a wallet or changing storage. */
export async function inspectWalletSavedText(text, fileOptions = {}) {
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
  const textDigest = await sha256Hex(new TextEncoder().encode(text), options.subtle ?? globalThis.crypto?.subtle, options);
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
    value.validation === "validated-original" ? "元記録の形式とチェックサムを確認しました。まだ読み込み先へ反映していません。" :
      "形式の指定だけを判別しました。中身・チェックサム・記載された結論は検証していません。",
    value.destinationMessage];
  if (value.scope) {
    const scope = value.scope;
    if (scope.reportCount !== null) summary.push("報告 " + scope.reportCount + "件" + (scope.archivedReports !== null ? " / 非表示保管 " + scope.archivedReports + "件" : ""));
    summary.push("含まれるトークン: " + (scope.agents.join("、") || "なし"),
      "元の控えの参照 " + scope.draftReferences + "件 / 取得工程が未完了 " + scope.incompleteDraftReferences + "件 / 取得工程が空 " + scope.emptyDraftReferences + "件",
      scope.restrictedEntryReferences === null ? "この控えの形式には、保存一覧の保管状態と再取得の印は含まれません。" :
        "再取得の印がある保存項目の参照 " + scope.restrictedEntryReferences + "件 / 非表示保管の保存項目の参照 " + scope.archivedEntryReferences + "件");
    if (scope.repeatedReferencesMayExist) summary.push("同じ元記録を複数の報告が参照している場合があるため、参照数は独立した検証回数ではありません。");
  }
  summary.push("アドレス・残高・メモ本文はこの案内には表示しません。現在のチェーン、出所、完全性、安全性を証明する確認ではありません。");
  return summary.join("\n");
}

export function walletSavedInspectionErrorText(error) {
  let code; try { code = Object.getOwnPropertyDescriptor(error, "code")?.value; } catch {}
  if (code === "FILE_BUNDLE_SIZE") return "まとめる元資料の合計は24 MiB、まとめた資料は48 MiBまでです。大きい場合は両方の元ファイルを別々に保全してください。";
  if (code === "FILE_BUNDLE_SOURCE_CHANGED") return "比較した後に元資料が変わったため保存を中止しました。両方の元ファイルを選び直して比較してください。";
  if (code === "FILE_BUNDLE_ORIGINALS_REQUIRED") return "両方の検証済み元記録が必要です。案内や比較結果だけでは、元資料をまとめられません。";
  if (typeof code === "string" && code.startsWith("FILE_BUNDLE_")) return "まとめた資料の形式や比較結果を確認できませんでした。元のJSONを保全して、確認し直してください。";
  if (typeof code === "string" && code.startsWith("FILE_COMPARISON_REVIEW_")) return "保存した比較JSONを確認できませんでした。比較先の元資料ではなく、2つのファイルの比較結果を選んでください。";
  if (code === "PERIOD_CHECKSUM") return "チェックサムが一致しません。保存が完了した元のJSONを選び直してください。内容は取り込んでいません。";
  if (code === "FILE_INSPECTION_UNSUPPORTED") return "この案内では扱わない形式です。ThreeCoreの期間・報告・確認セットの元のJSONを選んでください。";
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
    "restrictedEntryReferences", "incompleteDraftReferences", "emptyDraftReferences", "agents"];
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
    unverified: "元記録として検証できない補助資料が含まれるため、内容の一致を判断していません。",
  };
  const fields = { reportCount: "報告件数", archivedReports: "非表示保管の報告", entryReferences: "保存項目の参照数",
    draftReferences: "取得控えの参照数", archivedEntryReferences: "非表示保管の保存項目", restrictedEntryReferences: "再取得の印がある保存項目",
    incompleteDraftReferences: "未完了の控え", emptyDraftReferences: "工程が空の控え", agents: "含まれるトークン" };
  const show = value => value === null ? "この形式には含まれません" : Array.isArray(value) ? value.join("、") || "なし" : String(value);
  return [titles[value.kind], "比較元: " + value.before.title + " / 比較先: " + value.after.title,
    "ファイルサイズ: " + value.before.byteLength + " → " + value.after.byteLength + " bytes（差 " + value.byteDifference + "）",
    ...value.scopeChanges.map(row => fields[row.field] + ": " + show(row.before) + " → " + show(row.after)),
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
    value.originalPairValidated ? "両方の元記録の形式とチェックサムを確認しています。" : "補助資料が含まれるため、元記録同士としての一致は判断していません。",
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
const browserSavedBatchReceipts = new WeakSet();
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

/** Text-only inspection: no filesystem, import, wallet or storage capability. */
export async function inspectWalletSavedTextBatch(input, options = {}) {
  try { options = captureOptionalDataFields(options, ["subtle", "signal", "timeoutMs", "onProgress"]); }
  catch { savedInspectionFail("FILE_BATCH_OPTIONS"); }
  const { subtle = globalThis.crypto?.subtle, signal, timeoutMs = 120000, onProgress } = options;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || (onProgress !== undefined && typeof onProgress !== "function")) savedInspectionFail("FILE_BATCH_OPTIONS");
  let rows;
  try { rows = captureDataArray(input, WALLET_SAVED_BROWSER_BATCH_LIMITS.files, 1).map(input => {
    const row = captureDataRecord(input, ["name", "text"]);
    return Object.freeze({ name: row.name, text: row.text, byteLength: boundedUtf8Length(row.text, WALLET_SAVED_BROWSER_BATCH_LIMITS.fileBytes) });
  }); } catch { savedInspectionFail("FILE_BATCH_INPUT"); }
  const selection = validateWalletSavedBatchSelection(rows.map(({ name, byteLength }) => ({ name, byteLength })));
  const local = new AbortController(), completed = []; let phase = "complete", timer, subscription;
  const stop = reason => { if (!local.signal.aborted) { phase = reason; local.abort(); } };
  const progress = () => consumeCallback(() => onProgress?.(Object.freeze({ selected: rows.length, checked: completed.length })));
  try {
    try { subscription = subscribeReadAbort(signal, () => stop("cancelled")); } catch { savedInspectionFail("FILE_BATCH_SIGNAL"); }
    timer = setTimeout(() => stop("timed-out"), timeoutMs); progress();
    for (const row of rows) {
      if (local.signal.aborted) break;
      let sha256 = null, inspection = null, status = "hash-unavailable", code = null;
      try { sha256 = await sha256Hex(new TextEncoder().encode(row.text), subtle, { signal: local.signal, timeoutMs: Math.min(timeoutMs, 30000) }); }
      catch { code = "FILE_BATCH_HASH_UNAVAILABLE"; }
      if (local.signal.aborted) break;
      if (sha256 !== null) {
        try {
          inspection = await inspectWalletSavedText(row.text, { subtle, signal: local.signal, timeoutMs: Math.min(timeoutMs, 30000) });
          if (inspection.validation === "validated-original" && (inspection.textDigest !== sha256 || !inspection.checksumVerified)) savedInspectionFail("FILE_BATCH_HASH_INCONSISTENT");
          status = inspection.validation;
        } catch (error) {
          status = "invalid"; inspection = null;
          try { code = Object.getOwnPropertyDescriptor(error, "code")?.value; } catch {}
          if (typeof code !== "string" || !/^(FILE|PERIOD|TRANSFER|IDENTITY|RECONCILIATION)_[A-Z_]{1,64}$/.test(code)) code = "FILE_INSPECTION_FAILED";
        }
      }
      if (local.signal.aborted) break;
      completed.push(Object.freeze({ name: row.name, byteLength: row.byteLength, sha256, status, code, inspection })); progress();
    }
    const files = rows.map((row, i) => completed[i] ?? Object.freeze({ name: row.name, byteLength: row.byteLength, sha256: null, status: "pending", code: null, inspection: null }));
    const count = status => files.filter(row => row.status === status).length;
    const summary = Object.freeze({ selected: files.length, checked: completed.length, pending: count("pending"), validatedOriginals: count("validated-original"), declaredOnly: count("declared-only"), invalid: count("invalid"), hashUnavailable: count("hash-unavailable"), totalBytes: selection.totalBytes });
    const result = Object.freeze({ schema: "threecore.wallet-saved-browser-batch.v1", readOnly: true, authenticatesOrigin: false, authorizesExecution: false, restorable: false, liveChainRechecked: false, atomicSnapshot: false, externalChecksumsCompared: false,
      phase, complete: phase === "complete" && completed.length === rows.length, allOriginalsValidated: phase === "complete" && summary.validatedOriginals === rows.length, summary, files: Object.freeze(files) });
    browserSavedBatchReceipts.add(result); return result;
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
