import { periodShape, periodFail } from "./period-plan.js";
import { validateReportSet, freezeSet, REPORT_SET_AGENTS } from "./report-set-model.js";
import { analyzeReportSet } from "./report-set-engine.js";

const SEVERITIES = Object.freeze(["conflict", "missing", "review", "information"]);
const SEVERITY_LABELS = Object.freeze({
  conflict: "証拠の食い違い",
  missing: "不足している記録",
  review: "内容の確認が必要",
  information: "確認上の補足",
});

const GUIDANCE = Object.freeze({
  "single-report": {
    title: "報告が1件だけです",
    action: "別の期間を保存した報告があれば追加で選択してください。1件だけでは期間のつながりは判断できません。",
  },
  "missing-token": {
    title: "このトークンの記録がありません",
    action: "該当する報告を開き、このトークンの期間控えが選ばれているか確認してください。別トークンの記録で補うことはできません。",
  },
  "mixed-contexts": {
    title: "アカウントまたはチェーンが異なります",
    action: "同じアカウント・同じチェーンの報告を選んで確認してください。別グループの残高や履歴は結合しません。",
  },
  gap: {
    title: "計画の間に抜けがあります",
    action: "抜けている範囲の控えが保存済みか確認してください。未保存なら、元の期間取得画面で対象を確認してから取得してください。ここでは自動取得しません。",
  },
  overlap: {
    title: "異なる証拠の計画範囲が重複しています",
    action: "重複する報告の計画範囲と取得日時を比較してください。重複区間のイベントや残高は合算しません。",
  },
  repeated: {
    title: "同じ証拠が複数の報告に含まれています",
    action: "再保存した報告か確認し、必要なら片方を選択から外してください。元の保存履歴は削除しません。",
  },
  "incomplete-evidence": {
    title: "計算一致を確認できていない記録があります",
    action: "元の報告を開き、取得途中・再取得制限・残高差・イベント範囲の表示を確認してください。計画範囲の存在だけでは取得完了を意味しません。",
  },
  "boundary-conflict": {
    title: "期間境界の証拠が一致しません",
    action: "前の報告の終了時点と次の報告の開始時点を比較してください。ブロック番号・ハッシュ・残高を確認し、元の記録を保全してください。",
  },
  "balance-conflict": {
    title: "同じブロック・ハッシュの残高が異なります",
    action: "各報告の取得元と保存時点を確認してください。片方の値を自動採用せず、元の証拠を保全したまま調べてください。",
  },
  "hash-conflict": {
    title: "同じチェーン・ブロックのハッシュが異なります",
    action: "取得元・チェーン・取得日時を確認してください。チェーン再編成などの原因はこの保存データだけでは確定できません。",
  },
  "invalid-anchors": {
    title: "ひとつの記録内でブロック情報が矛盾しています",
    action: "元の期間控えの検証結果を確認してください。この記録を連続性の根拠として扱いません。",
  },
  "archived-report": {
    title: "非表示保管の報告を含めています",
    action: "選択が意図どおりか確認してください。非表示保管は削除や無効化を意味せず、証拠はそのまま使われます。",
  },
});

/** Actionable checks are always regenerated from source evidence, never imported. */
export function reportSetDiagnostics(value) {
  const input = validateReportSet(value);
  const result = analyzeReportSet(input);
  const items = [];
  const labels = new Map(input.entries.map(entry => [entry.id, entry.label]));

  function add(kind, severity, details = {}) {
    const guide = GUIDANCE[kind];
    const reportIds = [...new Set(details.reportIds ?? [])];
    items.push({
      id: "check-" + (items.length + 1),
      kind,
      severity,
      severityLabel: SEVERITY_LABELS[severity],
      title: guide.title,
      action: guide.action,
      agents: details.agents ?? [],
      chainId: details.chainId ?? null,
      account: details.account ?? null,
      fromBlock: details.fromBlock ?? null,
      toBlock: details.toBlock ?? null,
      blocks: details.blocks ?? null,
      reportIds,
      reportLabels: reportIds.map(id => labels.get(id)),
      observations: details.observations ?? [],
    });
  }

  if (input.entries.length === 1) {
    add("single-report", "information", { reportIds: [input.entries[0].id] });
  }

  for (const token of result.tokens) {
    const agents = [token.agent];
    if (token.missingReportIds.length) {
      add("missing-token", "missing", { agents, reportIds: token.missingReportIds });
    }
    if (token.contextCount > 1) {
      add("mixed-contexts", "review", { agents,
        reportIds: token.groups.flatMap(group => group.rows.map(row => row.reportId)) });
    }
    for (const group of token.groups) {
      const context = { agents, chainId: group.context.chainId, account: group.context.account };
      for (const segment of group.segments) {
        if (segment.kind === "single") continue;
        // A gap has no covering report. Identify its enclosing reports instead.
        const reportIds = segment.kind === "gap" ? group.rows.filter(row =>
          row.end === segment.start || row.start === segment.end).map(row => row.reportId) : segment.reportIds;
        add(segment.kind, segment.kind === "gap" ? "missing" : "review", {
          ...context, fromBlock: segment.start, toBlock: segment.end,
          blocks: segment.blocks, reportIds,
        });
      }
      if (group.incompleteReports.length) {
        add("incomplete-evidence", "review", { ...context, reportIds: group.incompleteReports });
      }
      for (const link of group.links) {
        if (link.status === "boundary-conflict") {
          const before = group.rows.find(row => row.reportId === link.beforeId);
          add("boundary-conflict", "conflict", { ...context,
            fromBlock: before.end, toBlock: before.end,
            reportIds: [link.beforeId, link.afterId] });
        }
      }
      for (const conflict of group.balanceConflicts) {
        add("balance-conflict", "conflict", { ...context,
          fromBlock: conflict.block, toBlock: conflict.block,
          reportIds: conflict.observations.map(row => row.reportId),
          observations: conflict.observations.map(row => ({
            reportId: row.reportId, agent: token.agent,
            position: row.position, hash: conflict.hash, value: row.value,
          })),
        });
      }
    }
  }

  for (const conflict of result.anchors.conflicts) {
    add("hash-conflict", "conflict", {
      agents: REPORT_SET_AGENTS.filter(agent => conflict.observations.some(row => row.agent === agent)),
      chainId: conflict.chainId, fromBlock: conflict.block, toBlock: conflict.block,
      reportIds: conflict.observations.map(row => row.reportId),
      observations: conflict.observations.map(row => ({ ...row, position: null, value: null })),
    });
  }
  for (const invalid of result.anchors.invalid) {
    add("invalid-anchors", "conflict", { agents: [invalid.agent], reportIds: [invalid.reportId] });
  }
  const archived = input.entries.filter(entry => entry.archived);
  if (archived.length) {
    add("archived-report", "information", { reportIds: archived.map(entry => entry.id) });
  }

  // Highest-priority evidence contradictions first; insertion order breaks ties.
  items.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  return freezeSet({
    count: items.length,
    counts: Object.fromEntries(SEVERITIES.map(severity => [severity,
      items.filter(row => row.severity === severity).length])),
    items,
    historicalOnly: true,
    automaticRepairs: false,
    liveChainRechecked: false,
  });
}

export function diagnosticQuery(value = {}) {
  if (!value || typeof value !== "object") periodFail("PERIOD_SET_DIAGNOSTIC_QUERY");
  periodShape(value, Object.keys(value));
  const result = { agent: "all", severity: "all", search: "", ...value };
  periodShape(result, ["agent", "severity", "search"]);
  if (!["all", ...REPORT_SET_AGENTS].includes(result.agent) ||
      !["all", ...SEVERITIES].includes(result.severity) ||
      typeof result.search !== "string" || result.search.length > 100 ||
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(result.search)) {
    periodFail("PERIOD_SET_DIAGNOSTIC_QUERY");
  }
  return Object.freeze({ ...result, search: result.search.trim().toLowerCase() });
}

export function querySetDiagnostics(value, queryValue) {
  const source = reportSetDiagnostics(value), query = diagnosticQuery(queryValue);
  const items = source.items.filter(item => {
    if (query.agent !== "all" && !item.agents.includes(query.agent)) return false;
    if (query.severity !== "all" && item.severity !== query.severity) return false;
    const search = [item.title, item.action, item.kind, ...item.reportLabels,
      ...item.agents, item.chainId, item.account, item.fromBlock, item.toBlock]
      .filter(value => value !== null).join(" ").toLowerCase();
    return !query.search || search.includes(query.search);
  });
  return freezeSet({ ...source, query, matched: items.length, items });
}

export function diagnosticText(item, { shortAddresses = true, includeObservations = false } = {}) {
  const short = value => !value ? "—" : shortAddresses ? value.slice(0, 8) + "…" + value.slice(-6) : value;
  const lines = [item.severityLabel + " / " + item.title];
  if (item.agents.length) lines.push(item.agents.join("・"));
  if (item.chainId !== null) lines.push("Chain " + item.chainId + (item.account ? " / " + short(item.account) : ""));
  if (item.fromBlock !== null) {
    lines.push(item.fromBlock === item.toBlock ? "Block " + item.fromBlock :
      "計画範囲 (" + item.fromBlock + ", " + item.toBlock + "] / " + item.blocks + "ブロック");
  }
  if (item.reportLabels.length) lines.push("対象: " + item.reportLabels.join(" / "));
  lines.push(item.action);
  if (includeObservations) {
    for (const observation of item.observations) {
      lines.push(observation.agent + " / " + observation.reportId + " / hash " + short(observation.hash) +
        (observation.value !== null ? " / 保存値（最小単位） " + observation.value : ""));
    }
  }
  return lines.join("\n");
}
