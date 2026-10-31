import { historyErrorText, historyErrorCode } from "./report-history-view.js";
import { reportStatusText } from "./period-report-view.js";
import { REPORT_CHANGE_TEXT } from "./period-report-comparison.js";

export const SET_LIMITATION = "保存した報告の計画範囲と証拠の照合です。現在のチェーン状態や履歴の完全性を認証しません。トークン数量やイベントを合算せず、利益も計算しません。";
export const SET_ISSUES = Object.freeze({
  SINGLE_REPORT: "報告が1件のため、複数期間のつながりは確認できません。",
  MISSING_TOKEN: "選択した報告に含まれていないトークンがあります。",
  MIXED_CONTEXTS: "チェーン・コントラクト・アカウント等が異なる記録を別グループに分けています。",
  GAPS: "選択した計画の範囲に抜けがあります。",
  OVERLAPS: "選択した計画の範囲が重複しています。",
  REPEATED_EVIDENCE: "同じ証拠を含む複数の報告があります。",
  INCOMPLETE_EVIDENCE: "取得途中、再取得が必要、または計算が一致しない記録があります。",
  BALANCE_CONFLICTS: "同じブロック・ハッシュで保存された残高が異なります。",
  HASH_CONFLICTS: "同じチェーン・ブロックのハッシュが食い違っています。",
  REPORTS_NEED_REVIEW: "3トークンを同条件で照合できていない報告があります。",
});
export const SET_SEGMENTS = Object.freeze({ single: "計画1件", gap: "計画の抜け", overlap: "計画の重複", repeated: "同じ証拠の重複" });
export const SET_SOURCE_STATUS = Object.freeze({ exact: "保存内容と一致", metadata: "名前・メモ・保管状態が変更", changed: "報告の証拠が変更", missing: "保存番号が見つからない" });
const ERRORS = Object.freeze({
  PERIOD_SET_EVENT_FILE_JSON: "履歴比較のJSONを読み取れませんでした。保存した元のファイルを確認してください。",
  PERIOD_SET_EVENT_FILE_SCHEMA: "保存済み履歴の比較JSONを選んでください。",
  PERIOD_SET_EVENT_FILE_READ: "履歴比較ファイルを読み込めませんでした。",
  PERIOD_SET_EVENT_FILE_ENCODING: "履歴比較はUTF-8のJSONを選んでください。",
  PERIOD_SET_EVENT_NO_REVIEW: "先に保存した履歴比較ファイルを元資料と照合してください。",
  PERIOD_SET_EMPTY: "確認する報告を1件以上選んでください。",
  PERIOD_SET_SCHEMA: "対応する確認セットの形式ではありません。",
  PERIOD_SET_TITLE: "確認名を確認してください。",
  PERIOD_SET_DUPLICATE_SELECTION: "同じ報告が重複して選ばれています。",
  PERIOD_SET_SOURCE_MISSING: "選択した報告が保存一覧にありません。読み直してください。",
  PERIOD_SET_REPORT_MISSING: "表示中の確認セットに、その元レポートは含まれていません。選び直してください。",
  PERIOD_SET_QUEUE_WINDOW: "表示した予定から保存する区間を選び直してください。",
  PERIOD_SET_QUEUE_QUERY: "予定の範囲・ブロック数・ページ番号を確認してください。",
  PERIOD_SET_QUEUE_GROUP: "表示中の確認セットに、そのアカウントの区間はありません。",
  PERIOD_SET_QUEUE_PAGE: "指定したページには予定がありません。最初のページから選び直してください。",
  PERIOD_SET_QUEUE_DISJOINT: "このページの区間は連続していません。1区間ずつ保存対象に選んでください。",
  PERIOD_SET_EVIDENCE_SIZE: "比較の証拠一式は、空でない24 MiB以下のJSONを選んでください。出力が上限を超える場合は元資料を別々に保存してください。",
  PERIOD_SET_EVIDENCE_FORMAT: "比較の証拠一式として保存したJSONを選んでください。元資料と比較結果の両方が必要です。",
  PERIOD_SET_EVIDENCE_CONTENT: "一式に含まれる元資料または比較結果が、必要なファイル形式と異なります。別の欄へこの一式を移す操作はせず、保存した元の証拠一式を選び直してください。",
  PERIOD_SET_EVIDENCE_READ: "比較の証拠一式を読み取れませんでした。",
  PERIOD_SET_EVIDENCE_ENCODING: "比較の証拠一式はUTF-8で保存されたJSONを選んでください。",
  PERIOD_SET_PROPOSAL_UNAVAILABLE: "この画面では読み取り画面への直接受け渡しを利用できません。未取得の控えをJSON保存し、期間読み取り画面で開いてください。",
  PERIOD_SET_PROPOSAL_REFUSED: "期間読み取り画面へ渡せませんでした。そちらが処理中なら、完了または停止してから渡してください。元資料は保持しています。",
  PERIOD_SET_EVENT_RECHECK_SELECTION: "比較結果から、確認し直すイベントまたはブロックの食い違いを選んでください。",
  PERIOD_SET_EVENT_RECHECK_RANGE: "選んだ観測位置を1つの期間控えに収められません。元の比較範囲を確認してください。",
  PERIOD_SET_EVENT_QUERY: "異なる2つの報告と、比較するトークンを選んでください。",
  PERIOD_SET_EVENT_SOURCE: "選んだ報告が現在の確認セットにありません。選び直してください。",
  PERIOD_SET_EVENT_SLOT: "選んだ報告の片方に、このトークンの期間控えがありません。",
  PERIOD_SET_EVENT_CONTEXT: "アカウントまたはチェーンが違うため、履歴を比較できません。同じ対象の報告を選んでください。",
  PERIOD_SET_EVENT_SIZE: "履歴の比較ファイルが24 MiBを超えました。省略せず保存を中止しました。",
  PERIOD_SET_EVIDENCE_SOURCE_REVIEW: "先に元の比較の証拠一式JSONを、この画面で検証してください。検証結果の控えだけでは元資料を取り出せません。",
  PERIOD_SET_EVIDENCE_SOURCE_ROLE: "差し替え前か候補か、取り出す元資料を選んでください。",
  PERIOD_SET_EVIDENCE_NO_REVIEW: "先に比較の証拠一式を確認してください。",
  PERIOD_SET_COVERAGE_SIZE: "保存済み履歴範囲の説明ファイルが上限4 MiBを超えています。元の確認セットJSONを保管してください。",
  PERIOD_SET_COMPARISON_JSON: "比較ファイルのJSONを読み取れません。",
  PERIOD_SET_COMPARISON_SCHEMA: "差し替え比較のJSONを選んでください。",
  PERIOD_SET_COMPARISON_READ: "比較ファイルを読み取れませんでした。",
  PERIOD_SET_COMPARISON_ENCODING: "比較ファイルの文字コードを確認してください。",
  PERIOD_SET_COMPARISON_NO_REVIEW: "先に比較ファイルを照合してください。",
  PERIOD_SET_NO_COMPARISON: "表示中の確認セットがある状態で、差し替える候補を先に確認してください。",
  PERIOD_SET_COMPARISON_SIZE: "比較ファイルが保存できる大きさを超えています。",
  PERIOD_SET_SOURCE_CHANGED: "確認中に選択した報告が変わりました。保存一覧を読み直して選び直してください。",
  PERIOD_SET_NOT_LOADED: "先に報告の一覧を読み込んでください。",
  PERIOD_SET_NO_REVIEW: "先に選択内容を確認してください。",
  PERIOD_SET_NO_RESULT: "先に確認セットを作成するか、JSONから開いてください。",
  PERIOD_SET_BUSY: "確認セットの処理中です。完了を待つか中止してください。",
  PERIOD_SET_SIZE: "確認セットの上限は12報告・64 MiBです。",
  PERIOD_SET_FILE_SIZE: "ファイルの大きさが不正です。96 MiBまでのJSONを選んでください。",
  PERIOD_SET_CHECKS_SIZE: "確認箇所JSONは、空でない4 MiB以下のファイルを選んでください。出力が大きい場合はトークンや種類で絞り込んでください。",
  PERIOD_SET_CHECKS_READ: "確認箇所JSONを読み込めませんでした。元の資料は変更していません。",
  PERIOD_SET_CHECKS_ENCODING: "確認箇所JSONはUTF-8のテキストファイルを選んでください。",
  PERIOD_SET_CHECKS_JSON: "確認箇所JSONの内容を読み取れません。保存した元のファイルを確認してください。",
  PERIOD_SET_CHECKS_SCHEMA: "対応する確認箇所JSONではありません。確認セットJSONや照合結果JSONとは異なります。",
  PERIOD_SET_CHECKS_NO_REVIEW: "先に確認箇所JSONを選んで照合してください。",
  PERIOD_SET_FILE_SCHEMA: "確認セット用のバックアップJSONではありません。",
  PERIOD_SET_ACK: "保存される情報の内容を確認してチェックを入れてください。",
  PERIOD_SET_EXPORT_OPTIONS: "説明用ファイルの出力設定が不正です。",
  PERIOD_SET_FORMAT: "この形式では書き出せません。",
  PERIOD_SET_DISPOSED: "画面が閉じられています。",
  PERIOD_SET_FAILED: "処理を完了できませんでした。元の報告履歴は変更していません。",
  PERIOD_SET_OPTIONS: "確認機能の設定が不正です。画面を開き直してください。",
});

export function setErrorCode(value) {
  const code = historyErrorCode(value);
  return code === "PERIOD_HISTORY_FAILED" ? "PERIOD_SET_FAILED" : code;
}
export function setErrorText(code) { return typeof code === "string" && Object.hasOwn(ERRORS, code) ? ERRORS[code] : historyErrorText(code); }

export function setCheckReviewText(value) {
  if (!value) return "まだ確認箇所JSONを照合していません。";
  const fields = { sourcePayloadDigest: "参照元資料", items: "確認箇所・ハッシュ・保存値", query: "検索条件",
    options: "表示設定", summary: "元資料全体の確認結果", total: "全体件数", matched: "該当件数",
    liveChainRechecked: "現在のチェーン確認の表示", authenticated: "出所認証の表示", restorable: "復元可否の表示" };
  return ["最後に完了した照合結果", value.matchesRecomputation ? "元資料からの再計算と一致" : "再計算と食い違いがあります",
    "参照元資料の識別値: " + (value.sourceDigestMatches ? "一致" : "不一致"),
    "再計算した確認箇所: " + value.matched + " / " + value.total + "件",
    "元資料全体: " + (value.summary.allContinuous ? "選択範囲の境界は一致" : "確認が必要な箇所あり"),
    ...value.differences.map(field => "・食い違い: " + (fields[field] ?? "確認情報の項目")),
    ...(value.unexpectedFields ? ["定義外の項目: " + value.unexpectedFields + "件"] : []),
    "一致は出所の認証や、現在のチェーン状態の確認を意味しません。照合したテキストの識別値は結果JSONに残ります。"].join("\n");
}
export function shortSetAddress(value, shorten = true) {
  return !value ? "—" : shorten ? value.slice(0, 8) + "…" + value.slice(-6) : value;
}
export function setStatusText(result) {
  return result.allContinuous ? "選択した証拠は3トークンとも期間境界で一致" : "確認が必要な箇所があります";
}
export function setIssueText(code) { return typeof code === "string" && Object.hasOwn(SET_ISSUES, code) ? SET_ISSUES[code] : "確認が必要です。"; }

export function setSummaryText(result) {
  if (!result) return "";
  return [result.title, setStatusText(result), "対象: " + result.reportCount + "報告（非表示保管 " + result.archivedCount + "件）",
    "確認セット作成日時: " + result.createdAt,
    ...result.issues.map(setIssueText), SET_LIMITATION].join("\n");
}

export function setTokenText(token, shortAddresses = true) {
  const lines = [token.agent, token.continuous ? "選択した期間の境界が一致" : "期間・証拠の確認が必要"];
  if (token.hashConflictCount || token.invalidAnchorCount) lines.push("ブロックハッシュの食い違い: " +
    token.hashConflictCount + "箇所 / 記録内の矛盾: " + token.invalidAnchorCount + "件");
  if (token.missingReportIds.length) lines.push("このトークンを含まない報告: " + token.missingReportIds.length + "件");
  for (const group of token.groups) {
    lines.push("Chain " + group.context.chainId + " / " + shortSetAddress(group.context.account, shortAddresses));
    lines.push("計画範囲: " + group.start + " → " + group.end + " / " + group.rows.length + "報告");
    lines.push("計画に含まれるブロック数（重複分を除く）: " + group.plannedUniqueBlocks);
    lines.push("計画の抜け: " + group.gapBlocks + " / 重複: " + group.overlapBlocks + " ブロック");
    for (const row of group.rows) lines.push("  " + row.reportLabel + ": " + row.start + " → " + row.end + " / " + reportStatusText(row.status));
    if (group.balanceConflicts.length) lines.push("同一ブロックの残高不一致: " + group.balanceConflicts.length + "件");
  }
  return lines.join("\n");
}

export function setSourcesText(inspection) {
  if (!inspection) return "";
  return ["現在のPC内保存一覧との照合 / 版 " + inspection.revision,
    ...inspection.rows.map(row => row.label + ": " + SET_SOURCE_STATUS[row.status]),
    "照合のみです。確認セットと元の保存一覧は変更していません。"].join("\n");
}


export function setComparisonText(comparison) {
  if (!comparison) return "";
  const kinds = { added: "表示対象に追加", removed: "表示対象から外れる", changed: "保存した証拠の変更", "metadata-only": "名前・保管情報などの変更", unchanged: "同じ記録" };
  const metadata = { label: "保存名", note: "メモ", tags: "タグ", savedAt: "保存日時", updatedAt: "更新日時", archived: "非表示保管", title: "報告名", createdAt: "作成日時", sourceRevision: "元一覧の版番号" };
  const c = comparison.counts;
  const lines = ["現在表示中の確認セットとの差", comparison.beforeTitle + " → " + comparison.afterTitle,
    "報告数: " + comparison.beforeCount + " → " + comparison.afterCount,
    "追加 " + c.added + " / 対象外へ " + c.removed + " / 証拠の変更 " + c.changed + " / 名前・保管情報 " + c["metadata-only"] + " / 同一 " + c.unchanged];
  if (comparison.metadataChanges.length) lines.push("確認セットの変更項目: " + comparison.metadataChanges.map(key => metadata[key]).join("、"));
  if (comparison.orderChanged) lines.push("報告の選択または並び順が変わります。");
  for (const row of comparison.rows) {
    if (row.kind === "unchanged") continue;
    lines.push("", kinds[row.kind] + ": " + (row.afterLabel ?? row.beforeLabel) + " / " + row.id);
    if (row.metadataChanges.length) lines.push("  保存情報の変更: " + row.metadataChanges.map(key => metadata[key]).join("、"));
    if (row.reportMetadataChanges.length) lines.push("  報告内の変更: " + row.reportMetadataChanges.map(key => metadata[key]).join("、"));
    for (const slot of row.tokenChanges.filter(item => item.kind !== "unchanged")) {
      lines.push("  " + slot.agent + ": " + REPORT_CHANGE_TEXT[slot.kind]);
      if (slot.beforeSteps !== null && slot.afterSteps !== null) lines.push("    取得工程: " + slot.beforeSteps + " → " + slot.afterSteps);
      if (slot.changedAnchorCount) lines.push("    同じブロックの観測ハッシュが変わった箇所: " + slot.changedAnchorCount);
      if (slot.restrictionChange !== "unchanged") lines.push("    再取得が必要という印が" + (slot.restrictionChange === "introduced" ? "付きます。" : "外れます。この比較で妥当性を認証したものではありません。"));
      if (slot.archiveChange !== "unchanged") lines.push("    元控えの保管状態が変わります。");
      if (slot.eventChanges) lines.push("    保存履歴の差: 追加 " + slot.eventChanges.added + " / 除外 " + slot.eventChanges.removed + " / 内容変更 " + slot.eventChanges.changed);
    }
  }
  lines.push("", "対象から外れてもPC内の保存履歴を削除しません。差し替え後の全体に確認点があるか: " +
    (comparison.afterSummary.allContinuous ? "この保存資料内では連続" : "要確認"),
    "過去の保存資料同士の比較です。時刻や版番号の大きさで信頼性を判断せず、現在のチェーンの再検証や自動統合も行いません。");
  return lines.join("\n");
}

export function setComparisonReviewText(value) {
  if (!value) return "保存した比較ファイルを、現在表示中の元資料と差し替え候補に照らして確認できます。";
  return ["最後に完了した比較ファイルの照合結果:", value.matchesRecomputation ? "比較ファイルは再計算と一致しました。" : "比較ファイルに再計算との食い違いがあります。",
    "差し替え前の元資料: " + (value.beforeDigestMatches ? "一致" : "不一致"),
    "候補の元資料: " + (value.afterDigestMatches ? "一致" : "不一致"),
    "異なる項目: " + (value.differences.join(", ") || "なし") + " / 余分な項目: " + value.unexpectedFields,
    "比較ファイルのテキスト SHA-256: " + value.comparisonTextSha256,
    "読み取ったテキストと元資料からの再計算を照合した結果です。出所の認証や現在のチェーン確認ではありません。",
    "資料の差し替え・保存履歴の変更は行っていません。"].join("\n");
}

export function setComparisonEvidenceReviewText(value) {
  if (!value) return "保存した証拠一式に含まれる2つの元資料と比較結果を検証します。表示中の確認セットには取り込みません。";
  return ["最後に完了した証拠一式の確認:",
    "元資料の検査値: 両方とも一致 / 報告数 " + value.beforeReportCount + " → " + value.afterReportCount,
    "証拠一式のテキスト SHA-256: " + value.evidenceTextSha256,
    setComparisonReviewText(value.comparisonReview),
    "検証した一式は表示中の確認セットとは別です。元資料の取り込み・署名・送金は行っていません。"].join("\n");
}

export function setEventComparisonText(value, page = 0) {
  if (!value) return "同じトークン・アカウント・チェーンの報告を2つ選んでください。両方に保存した履歴範囲だけを比較します。";
  const labels = { "no-common-coverage": "両方が履歴を保存した共通範囲はありません。比較は未成立です。",
    differences: "保存したイベントまたはブロック情報に食い違いがあります。",
    "saved-observations-match": "共通範囲に保存したイベントと共有ブロック情報は一致しています。" };
  const counts = value.counts, limit = 50, pages = Math.max(1, Math.ceil(value.differences.length / limit));
  if (!Number.isInteger(page) || page < 0 || page >= pages) return "表示ページを確認してください。";
  const lines = [labels[value.status], value.context.agent + " / Chain " + value.context.chainId + " / " + value.context.account,
    "資料A: " + value.before.label + " / " + value.before.reportId,
    "資料B: " + value.after.label + " / " + value.after.reportId,
    "共通取得範囲: " + (value.commonRanges.map(row => row.fromBlock + " ～ " + row.toBlock).join("、") || "なし") + " / " + value.comparedBlocks + "ブロック（両端を含む）",
    "同一 " + counts.matching + " / 内容違い " + counts.changed + " / Aだけ " + counts.onlyBefore + " / Bだけ " + counts.onlyAfter,
    "共通範囲外として除外: A " + value.before.excludedEvents + " / B " + value.after.excludedEvents + "件",
    "両資料で照合できたブロック情報 " + value.sharedAnchorCount + " / ハッシュ不一致 " + value.anchorDifferences.length];
  for (const [name, source] of [["A", value.before], ["B", value.after]]) {
    if (!source.internallyConsistentHashes) lines.push(name + "の元資料内にブロック情報の矛盾があります。");
    if (source.restricted) lines.push(name + "には再取得が必要という印があります。");
    if (source.archivedReport || source.archivedSource) lines.push(name + "には非表示保管の記録を含みます。");
  }
  for (const row of value.anchorDifferences) lines.push("Block " + row.blockNumber + " / A " + row.beforeHash + " / B " + row.afterHash);
  lines.push("イベントの差 " + (page + 1) + "/" + pages + "ページ（最大50件ずつ。JSON保存は全件です）");
  const kinds = { onlyBefore: "Aだけに保存", onlyAfter: "Bだけに保存", changed: "同じ取引・ログ番号で内容違い" };
  const fields = { blockNumber: "ブロック番号", blockHash: "ブロックハッシュ", transactionIndex: "取引の位置", from: "送信元", to: "受信先", amountBaseUnits: "数量（最小単位）" };
  for (const row of value.differences.slice(page * limit, (page + 1) * limit)) {
    lines.push("", kinds[row.kind] + " / " + row.transactionHash + " / log " + row.logIndex);
    if (row.changedFields.length) lines.push("異なる値: " + row.changedFields.map(field => fields[field]).join("、"));
    for (const [name, source] of [["A", row.before], ["B", row.after]]) {
      if (!source) { lines.push(name + ": 共通範囲の保存記録にはありません"); continue; }
      const event = source.event;
      lines.push(name + ": 保存区間 " + (source.recordIndex + 1) + " / イベント " + (source.eventIndex + 1),
        "  Block " + event.blockNumber + " / hash " + event.blockHash + " / 取引の位置 " + event.transactionIndex,
        "  " + event.from + " → " + event.to + " / 数量（最小単位） " + event.amountBaseUnits);
    }
  }
  lines.push("", "保存資料同士の比較です。片方に記録がない理由や正しい取得元は確定できません。現在のチェーン照合・履歴の統合・送金は行いません。");
  return lines.join("\n");
}

export function setEventComparisonReviewText(value) {
  if (!value) return "元の確認セットを開き、保存した履歴比較JSONを選んで再計算と照合します。ファイルに記載された資料A・B・トークンを使います。";
  const meanings = { "saved-observations-match": "共通範囲の保存観測は一致", differences: "保存観測に食い違いあり", "no-common-coverage": "共通取得範囲がなく比較未成立" };
  return ["最後に完了した履歴比較ファイルの照合:",
    value.matchesRecomputation ? "ファイルの内容は再計算と一致しました。" : "ファイルの内容に再計算との食い違いがあります。",
    "元資料の検査値: " + (value.sourceDigestMatches ? "一致" : "不一致"),
    "資料A: " + value.query.beforeId, "資料B: " + value.query.afterId, "トークン: " + value.query.agent,
    "再計算した履歴比較: " + meanings[value.comparisonStatus] + " / 共通範囲 " + value.comparedBlocks + "ブロック",
    ...Object.entries(value.sources).flatMap(([role, source]) => {
      const name = role === "before" ? "A" : "B";
      return [source.restricted ? name + "には再取得が必要という印があります。" : "",
        source.archivedReport || source.archivedSource ? name + "には非表示保管の記録を含みます。" : "",
        !source.internallyConsistentHashes ? name + "の元資料内にブロック情報の矛盾があります。" : ""].filter(Boolean);
    }),
    "同一 " + value.counts.matching + " / 内容違い " + value.counts.changed + " / Aだけ " + value.counts.onlyBefore + " / Bだけ " + value.counts.onlyAfter + " / ブロックハッシュ不一致 " + value.anchorDifferenceCount,
    "異なる項目: " + (value.differences.join(", ") || "なし") + " / 余分な項目: " + value.unexpectedFields,
    "履歴比較ファイルのテキスト SHA-256: " + value.comparisonTextSha256,
    "ファイルと再計算の一致は、A・Bの履歴が一致したという意味とは別です。出所や現在のチェーン状態を認証せず、資料の差し替え・履歴の統合も行いません。"].join("\n");
}
