import { readOwnErrorCode } from "./provider-error.js";
import { periodPlanText, periodMessage } from "./period-view.js";
import { periodDraftProgress } from "./period-draft.js";
import { validateLibraryEntry } from "./period-library-model.js";

export const LIBRARY_STATUS_TEXT = Object.freeze({ partial: "途中", complete: "取得済み", blocked: "再取得が必要" });
const MESSAGES = {
  PERIOD_LIBRARY_NOT_LOADED: "最初にPC内の保存一覧を開いてください。",
  PERIOD_LIBRARY_BUSY: "現在の処理が終わるまでお待ちください。",
  PERIOD_LIBRARY_LABEL: "保存名は1～60文字にし、改行や制御文字を含めないでください。",
  PERIOD_LIBRARY_CAPACITY: "保存上限（12件・合計48 MiB）を超えます。JSONへ保全して保存一覧を整理してください。",
  PERIOD_LIBRARY_DUPLICATE_DRAFT: "同じ内容の控えが保存済みです。重複保存は行いません。",
  PERIOD_LIBRARY_DUPLICATE_ID: "同じ保存番号が使われています。一覧を再読み込みしてください。",
  PERIOD_LIBRARY_STALE: "別の画面で保存一覧が変わりました。一覧を再読み込みしてからやり直してください。",
  PERIOD_LIBRARY_IMPORT_CONFLICT: "同じ保存番号の内容が異なります。既存の控えは上書きしていません。",
  PERIOD_LIBRARY_SOURCE_CHANGED: "確認後に取得中の控えが変わりました。保存内容をもう一度確認してください。",
  PERIOD_LIBRARY_NOT_FOUND: "選択した控えが見つかりません。一覧を再読み込みしてください。",
  PERIOD_LIBRARY_NO_SOURCE: "期間取得の画面で控えを作成してから保存してください。",
  PERIOD_LIBRARY_REVIEW: "内容を確認する操作を先に行ってください。",
  PERIOD_LIBRARY_PURGE_ACK: "非表示保管した控えだけを削除できます。JSONへの保全と削除対象を確認してください。",
  PERIOD_LIBRARY_TIME_ORDER: "PCの時刻が前の更新時刻より古くなっています。時刻を確認してください。",
  PERIOD_LIBRARY_DELIVERY: "取得画面への受け渡しができませんでした。保存した控えは保持しています。",
  PERIOD_LIBRARY_FILE_SIZE: "一覧ファイルの容量が上限64 MiBを超えるか、正しく読めませんでした。",
  PERIOD_LIBRARY_FILE_SCHEMA: "期間の保存一覧のJSONではありません。個別の控えは期間取得画面で開いてください。",
  PERIOD_LIBRARY_QUERY: "検索条件を確認してください。",
  CHECKPOINT_QUOTA: "ブラウザーの保存容量が不足しています。JSONへの保存を先に行ってください。",
  CHECKPOINT_UNAVAILABLE: "このブラウザーではPC内保存を利用できません。個別のJSON保存は引き続き利用できます。",
  CHECKPOINT_BLOCKED: "別の画面が保存先を使用中です。その画面を閉じて一覧を再読み込みしてください。",
  CHECKPOINT_BUSY: "未完了の保存処理が上限に達しています。終了を待ってから一覧を読み直してください。",
  CHECKPOINT_CLOCK: "経過時間を確認できません。ページを開き直してください。",
  CHECKPOINT_TIMER: "時間の保護を開始できません。保存結果を一覧で確認してください。",
  CHECKPOINT_TIMEOUT: "PC内保存先の応答がありません。一覧を再読み込みしてください。",
  CHECKPOINT_CANCELLED: "保存処理を中止しました。一覧を再読み込みして保存状況を確認してください。",
  CHECKPOINT_CLOSED: "保存先との接続を閉じました。画面を開き直してください。",
};

export function libraryErrorCode(value) {
  try {
    const code = readOwnErrorCode(value);
    return typeof code === "string" && /^(PERIOD|CHECKPOINT|TRANSFER|IDENTITY)_[A-Z_]+$/.test(code)
      ? code : "PERIOD_LIBRARY_FAILED";
  } catch { return "PERIOD_LIBRARY_FAILED"; }
}
export function libraryErrorText(code) {
  return (typeof code === "string" && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined) ?? (typeof code === "string" && code.startsWith("PERIOD_") && !code.startsWith("PERIOD_LIBRARY_")
    ? periodMessage(code) : "保存内容を扱えませんでした。既存の記録を消さず、JSONと保存先を確認してください。");
}

export function libraryEntryText(input) {
  const entry = validateLibraryEntry(input), progress = periodDraftProgress(entry.draft);
  return [entry.label, periodPlanText(entry.draft.plan),
    `取得済み ${progress.completed} / ${progress.total}工程・${progress.events}イベント`,
    entry.requiresNewPlan ? "ブロック不一致の記録があります。新しい計画で再取得が必要です。" :
      "保存された過去の控えです。現在の接続先で再確認した表示ではありません。",
    `作成 ${entry.createdAt} / 更新 ${entry.updatedAt}`,
    entry.archived ? "非表示保管中（データは残っています）" : "通常の保存一覧",
  ].join("\n");
}

export function libraryComparisonText(value) {
  const labels = { "identical": "同じ取得内容です。", "extension": "現在の控えには、保存済みの続きの工程が追加されています。",
    "shorter": "現在の控えは、保存済みより少ない工程です。", "different-plan": "対象または期間の計画が異なるため、続きを比較できません。",
    "changed-evidence": "同じ工程の内容に違いがあります。どちらが正しいかはこの比較では判断しません。" };
  return [labels[value.kind], `保存済み: ${value.before.completed}/${value.before.total}工程`,
    `現在: ${value.after.completed}/${value.after.total}工程`,
    value.changedParts.length ? "相違する工程: " + value.changedParts.join(", ") : "",
    "この比較は記録の結合・置き換え・通信を行いません。"].filter(Boolean).join("\n");
}

export function libraryReviewText(review) {
  if (!review) return "";
  if (review.kind === "save") return ["新しい控えとしてPC内の一覧へ保存します。", libraryEntryText(review.entry),
    "既存の控えを上書きしません。画面内の確認後に内容が変わった場合は保存を中止します。"].join("\n");
  if (review.kind === "restore") return ["期間取得の画面に復元候補を送ります。", libraryEntryText(review.entry),
    "取得画面でも確認して反映してください。自動で接続・取得は行いません。"].join("\n");
  if (review.kind === "import") return [`一覧へ追加: ${review.plan.additions}件 / 同一の保存番号と内容: ${review.plan.duplicates}件`,
    `非表示保管: ${review.plan.archivedAdditions}件 / 再取得が必要: ${review.plan.blockedAdditions}件`,
    `追加後: ${review.plan.after.count} / 12件`,
    "同じ保存番号で内容が異なる場合は追加できません。現在の取得画面の控えは変更しません。"].join("\n");
  return "";
}

export function libraryImportInspectionText(value) {
  if (!value) return "";
  const names = { label: "保存名", createdAt: "作成時刻", updatedAt: "更新時刻", archived: "非表示保管の印", requiresNewPlan: "再取得の印", draft: "取得記録" };
  const kinds = { addition: "追加候補", identical: "同一内容", conflict: "同じ保存番号で内容が異なります" };
  const drafts = { identical: "取得内容は同一", extension: "取得工程が増えています", shorter: "取得工程が減っています", "different-plan": "対象または計画が異なります", "changed-evidence": "共通の取得工程に違いがあります" };
  return ["読込ファイルと現在の一覧の比較（この表示では変更しません）",
    `追加候補 ${value.additions}件 / 同一 ${value.identical}件 / 不一致 ${value.conflicts}件`,
    `ファイルに含まれず、そのまま残る既存の控え: ${value.retainedIds.length}件`,
    `追加だけ行う場合の容量: ${value.capacity.entriesAfter}/${value.capacity.maxEntries}件 · ${value.capacity.bytesAfter}/${value.capacity.maxBytes} bytes`,
    value.capacity.fits ? "件数・容量の上限内です。" : "件数または容量の上限を超えます。",
    value.compatible ? "追加可能な構成です。内容を確認してから操作してください。" : "このファイルは追加できません。既存の控えを上書きしません。",
    ...value.rows.flatMap(row => [row.id + " · " + row.incoming.agent + " · " + kinds[row.kind],
      row.changedFields.length ? "違い: " + row.changedFields.map(field => names[field]).join("、") : "",
      row.draftComparison ? drafts[row.draftComparison.kind] : "",
      row.before ? `取得工程 ${row.before.completed}/${row.before.total} → ${row.incoming.completed}/${row.incoming.total}` : `取得工程 ${row.incoming.completed}/${row.incoming.total}`,
      row.removedRestriction ? "注意: 読込側では再取得の印が外れています。解除の妥当性は確認していません。" : ""]),
    "記録の正しさや現在のチェーンを確認する検証ではありません。"].filter(Boolean).join("\n");
}
