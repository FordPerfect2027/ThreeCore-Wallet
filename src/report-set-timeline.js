import { validateReportSet, freezeSet } from "./report-set-model.js";
import { analyzeReportSet } from "./report-set-engine.js";
import { SET_SEGMENTS, shortSetAddress } from "./report-set-view.js";
import { reportStatusText } from "./period-report-view.js";

export const TIMELINE_NOTICE = "ブロック番号順の区間一覧です。各区間は同じ幅で表示し、長さの比率は表しません。計画の存在はデータ取得の完了を意味しません。";

function inside(block, start, end) {
  const value = BigInt(block);
  return value >= BigInt(start) && value <= BigInt(end);
}

/** Sweep saved query windows, not every block. Record presence is not chain verification. */
function historyCoverage(group, agent, reports, analysis) {
  const records = group.rows.flatMap(row => {
    const entry = reports.get(row.reportId), source = entry.report.slots.find(slot => slot.agent === agent).entry;
    return source.draft.records.map((record, recordIndex) => ({
      reportId: row.reportId, label: row.reportLabel, recordIndex,
      start: (BigInt(record.range.fromBlock) - 1n).toString(), end: record.range.toBlock,
      sourceStatus: row.status, restricted: source.requiresNewPlan,
      archivedReport: entry.archived, archivedSource: source.archived, eventCount: record.events.length,
    }));
  });
  const edges = [...new Set([...group.rows, ...records].flatMap(row => [row.start, row.end]))]
    .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
  const covers = (row, start, end) => BigInt(row.start) <= BigInt(start) && BigInt(row.end) >= BigInt(end);
  const cells = edges.slice(0, -1).map((start, index) => {
    const end = edges[index + 1], planned = group.rows.filter(row => covers(row, start, end));
    const present = records.filter(row => covers(row, start, end));
    const hashConflictBlocks = analysis.anchors.conflicts.filter(row => row.chainId === group.context.chainId && inside(row.block, start, end)).map(row => row.block);
    const balanceConflictBlocks = group.balanceConflicts.filter(row => inside(row.block, start, end)).map(row => row.block);
    const internalConflict = planned.some(row => analysis.anchors.invalid.some(item => item.reportId === row.reportId && item.agent === agent));
    const needsReview = present.length > 0 && (present.length > 1 || present.some(row => row.restricted || row.sourceStatus !== "arithmetic-agreement") ||
      hashConflictBlocks.length > 0 || balanceConflictBlocks.length > 0 || internalConflict);
    return { number: index + 1, fromBlock: (BigInt(start) + 1n).toString(), toBlock: end,
      blocks: (BigInt(end) - BigInt(start)).toString(),
      kind: present.length ? "recorded" : planned.length ? "pending" : "unplanned",
      needsReview, plannedReportIds: planned.map(row => row.reportId), records: present,
      hashConflictBlocks, balanceConflictBlocks, internalConflict };
  });
  const sum = predicate => cells.filter(predicate).reduce((total, cell) => total + BigInt(cell.blocks), 0n).toString();
  return { fromBlock: (BigInt(group.start) + 1n).toString(), toBlock: group.end,
    spanBlocks: (BigInt(group.end) - BigInt(group.start)).toString(),
    plannedUniqueBlocks: group.plannedUniqueBlocks, recordedUniqueBlocks: sum(cell => cell.kind === "recorded"),
    pendingPlannedBlocks: sum(cell => cell.kind === "pending"), unplannedBlocks: sum(cell => cell.kind === "unplanned"),
    multipleRecordBlocks: sum(cell => cell.records.length > 1), reviewRecordedBlocks: sum(cell => cell.needsReview),
    savedQueryRecords: records.length, cells, rangeNotation: "inclusive", completeHistory: false, liveChainRechecked: false };
}

export function historyCoverageSummaryText(value) {
  return "計画内 " + value.plannedUniqueBlocks + " / 保存済み履歴範囲 " + value.recordedUniqueBlocks +
    " / 計画内で履歴記録なし " + value.pendingPlannedBlocks + " / 計画外の間隔 " + value.unplannedBlocks +
    " ブロック（重複する保存範囲は1回だけ計上）。保存済みのうち要確認 " + value.reviewRecordedBlocks + " ブロック。";
}

export function historyCoverageCellText(cell) {
  const labels = { recorded: "履歴記録あり", pending: "計画はあるが履歴記録なし", unplanned: "この区間を含む計画なし" };
  const lines = [cell.fromBlock + " ～ " + cell.toBlock + "（両端を含む " + cell.blocks + "ブロック）",
    labels[cell.kind], "計画に含めた報告ID: " + (cell.plannedReportIds.join(", ") || "なし")];
  for (const row of cell.records) {
    lines.push(row.label + " / " + row.reportId + " / 保存区間 " + (row.recordIndex + 1),
      "  元の範囲 " + (BigInt(row.start) + 1n) + " ～ " + row.end + " / 元区間全体のイベント " + row.eventCount + "件 / " + reportStatusText(row.sourceStatus));
    if (row.restricted) lines.push("  再取得が必要という印があります。");
    if (row.archivedReport || row.archivedSource) lines.push("  非表示保管の記録を含みます。");
  }
  if (cell.records.length > 1) lines.push("複数の保存記録が重なっています。イベントや金額は結合していません。");
  if (cell.hashConflictBlocks.length) lines.push("範囲または直前境界のハッシュ不一致: " + cell.hashConflictBlocks.join(", "));
  if (cell.balanceConflictBlocks.length) lines.push("範囲または直前境界の残高不一致: " + cell.balanceConflictBlocks.join(", "));
  if (cell.internalConflict) lines.push("元資料内にブロック情報の矛盾があります。");
  if (cell.needsReview) lines.push("保存記録はありますが、重複・未完了・食い違いなどの確認が必要です。");
  lines.push("記録がない区間に取引がなかったとは判断できません。保存範囲の存在は、全履歴の取得や現在のチェーンとの一致を証明しません。");
  return lines.join("\n");
}

/** Discrete ordered cells avoid losing tiny intervals beside very large gaps. */
export function reportSetTimeline(value) {
  const input = validateReportSet(value);
  const analysis = analyzeReportSet(input);
  const reports = new Map(input.entries.map(entry => [entry.id, entry]));
  const groups = [];

  for (const token of analysis.tokens) {
    token.groups.forEach((group, groupIndex) => {
      const groupId = token.agent + "-" + (groupIndex + 1);
      const cells = group.segments.map((segment, index) => {
        const relevantHashes = analysis.anchors.conflicts.filter(conflict =>
          conflict.chainId === group.context.chainId && inside(conflict.block, segment.start, segment.end));
        const balances = group.balanceConflicts.filter(conflict => inside(conflict.block, segment.start, segment.end));
        const covering = segment.reportIds.map(id => {
          const entry = reports.get(id);
          const row = group.rows.find(candidate => candidate.reportId === id);
          return {
            id,
            label: entry.label,
            status: row.status,
            archived: entry.archived,
            restricted: row.restricted,
            fromBlock: row.start,
            toBlock: row.end,
          };
        });
        const neighbors = segment.kind === "gap" ? group.rows.filter(row =>
          row.end === segment.start || row.start === segment.end).map(row => ({
            id: row.reportId,
            label: row.reportLabel,
            side: row.end === segment.start ? "before" : "after",
          })) : [];
        const internalConflict = covering.some(row => analysis.anchors.invalid.some(item =>
          item.reportId === row.id && item.agent === token.agent));
        const conflict = relevantHashes.length > 0 || balances.length > 0 || internalConflict;
        const tone = conflict ? "conflict" : segment.kind === "gap" ? "gap" :
          segment.kind !== "single" || !segment.allArithmeticAgreement ? "review" : "recorded";
        return {
          id: groupId + "-segment-" + (index + 1),
          number: index + 1,
          agent: token.agent,
          chainId: group.context.chainId,
          account: group.context.account,
          start: segment.start,
          end: segment.end,
          blocks: segment.blocks,
          kind: segment.kind,
          kindLabel: SET_SEGMENTS[segment.kind],
          tone,
          covering,
          neighbors,
          hashConflictBlocks: relevantHashes.map(item => item.block),
          balanceConflictBlocks: balances.map(item => item.block),
          internalConflict,
          arithmeticAgreement: segment.allArithmeticAgreement,
        };
      });
      groups.push({
        id: groupId,
        agent: token.agent,
        context: group.context,
        tokenAddress: group.tokenAddress,
        start: group.start,
        end: group.end,
        cells,
        historyCoverage: historyCoverage(group, token.agent, reports, analysis),
      });
    });
  }

  return freezeSet({
    groups,
    groupCount: groups.length,
    cellCount: groups.reduce((sum, group) => sum + group.cells.length, 0),
    missingAgents: analysis.tokens.filter(token => token.groups.length === 0).map(token => token.agent),
    proportional: false,
    chronological: true,
    liveChainRechecked: false,
    tokenAmountsSummed: false,
  });
}

export function timelineCellLabel(cell) {
  const status = cell.tone === "conflict" ? " / 証拠に食い違い" :
    !cell.arithmeticAgreement && cell.kind !== "gap" ? " / 計算一致は未確認" : "";
  return cell.agent + " 区間 " + cell.number + ": " + cell.start + "から" + cell.end +
    "、" + cell.blocks + "ブロック、" + cell.kindLabel + status;
}

export function timelineCellText(cell) {
  const lines = [
    cell.agent + " / 区間 " + cell.number,
    "Chain " + cell.chainId + " / " + shortSetAddress(cell.account),
    "開始を含まず終了を含む範囲: (" + cell.start + ", " + cell.end + "]",
    "計画範囲の長さ: " + cell.blocks + "ブロック / " + cell.kindLabel,
  ];
  if (cell.kind === "gap") {
    lines.push("この区間を含む選択済みの計画はありません。取引がなかったことを意味しません。");
    for (const neighbor of cell.neighbors) {
      lines.push((neighbor.side === "before" ? "直前" : "直後") + "の報告: " + neighbor.label);
    }
  } else {
    lines.push("この区間を含む報告: " + cell.covering.length + "件");
    for (const report of cell.covering) {
      lines.push("・" + report.label + (report.archived ? "（非表示保管）" : "") +
        " / " + report.fromBlock + " → " + report.toBlock + " / " + reportStatusText(report.status));
      if (report.restricted) lines.push("  再取得が必要という印が付いた控えです。");
    }
    if (cell.kind === "repeated") lines.push("同じ証拠の再保存です。取引や資産を二重に数えません。");
    if (cell.kind === "overlap") lines.push("異なる証拠の計画が重なっています。履歴は結合していません。");
  }
  if (cell.hashConflictBlocks.length) {
    lines.push("範囲または境界のハッシュ不一致: Block " + cell.hashConflictBlocks.join(", "));
  }
  if (cell.balanceConflictBlocks.length) {
    lines.push("範囲または境界の残高不一致: Block " + cell.balanceConflictBlocks.join(", "));
  }
  if (cell.internalConflict) lines.push("元の期間控えの中にブロック情報の矛盾があります。");
  lines.push("保存済みの証拠の説明です。現在のチェーンに対する再検証ではありません。");
  return lines.join("\n");
}
