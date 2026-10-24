import { validateReportSet, freezeSet } from "./report-set-model.js";
import { analyzeReportSet } from "./report-set-engine.js";
import { SET_SEGMENTS, shortSetAddress } from "./report-set-view.js";
import { reportStatusText } from "./period-report-view.js";

export const TIMELINE_NOTICE = "ブロック番号順の区間一覧です。各区間は同じ幅で表示し、長さの比率は表しません。計画の存在はデータ取得の完了を意味しません。";

function inside(block, start, end) {
  const value = BigInt(block);
  return value >= BigInt(start) && value <= BigInt(end);
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
