import { validateReportSet, freezeSet, REPORT_SET_AGENTS } from "./report-set-model.js";
import { periodContextKey } from "./period-plan.js";
import { periodDraftKey, periodDraftAnchors } from "./period-draft.js";
import { analyzePeriodReport } from "./period-report-engine.js";
import { inspectReportContinuity } from "./report-history-continuity.js";
import { catalogToken } from "./token-catalog.js";

const compareBlocks = (a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
const sameEvidence = row => row.evidenceKey;

/** Sweep planned intervals; never infer missing events or a verified chain range. */
function segmentsFor(rows) {
  const endpoints = [...new Set(rows.flatMap(row => [row.start, row.end]))].sort(compareBlocks);
  const segments = [];
  for (let index = 0; index + 1 < endpoints.length; index++) {
    const start = endpoints[index], end = endpoints[index + 1];
    const covering = rows.filter(row => compareBlocks(row.start, start) <= 0 && compareBlocks(row.end, end) >= 0);
    const repeated = covering.length > 1 && new Set(covering.map(sameEvidence)).size === 1;
    const kind = !covering.length ? "gap" : covering.length === 1 ? "single" : repeated ? "repeated" : "overlap";
    segments.push({ start, end, blocks: (BigInt(end) - BigInt(start)).toString(), kind,
      reportIds: covering.map(row => row.reportId),
      allArithmeticAgreement: covering.length > 0 && covering.every(row => row.status === "arithmetic-agreement"),
      eventsCombined: false });
  }
  return segments;
}

function balanceConflicts(rows) {
  const blocks = new Map();
  for (const row of rows) {
    for (const [position, endpoint] of [["start", row.entry.draft.earlier], ["end", row.entry.draft.later]]) {
      if (!endpoint || endpoint.balanceBaseUnits === null) continue;
      const key = endpoint.blockNumber + ":" + endpoint.blockHash;
      if (!blocks.has(key)) blocks.set(key, { block: endpoint.blockNumber, hash: endpoint.blockHash, observations: [] });
      blocks.get(key).observations.push({ reportId: row.reportId, position, value: endpoint.balanceBaseUnits });
    }
  }
  return [...blocks.values()].filter(row => new Set(row.observations.map(item => item.value)).size > 1)
    .sort((a, b) => compareBlocks(a.block, b.block));
}

/** Shared block numbers are comparable only within one chain, including different accounts. */
function anchorConflicts(allRows) {
  const blocks = new Map(), invalid = [];
  for (const row of allRows) {
    let anchors;
    try { anchors = periodDraftAnchors(row.entry.draft); }
    catch {
      invalid.push({ reportId: row.reportId, agent: row.agent });
      continue;
    }
    for (const anchor of anchors) {
      const chainId = row.context.chainId, key = chainId + ":" + anchor.number;
      if (!blocks.has(key)) blocks.set(key, { chainId, block: anchor.number, observations: [] });
      blocks.get(key).observations.push({ reportId: row.reportId, agent: row.agent, hash: anchor.hash });
    }
  }
  return { invalid, conflicts: [...blocks.values()]
    .filter(row => new Set(row.observations.map(item => item.hash)).size > 1)
    .sort((a, b) => a.chainId - b.chainId || compareBlocks(a.block, b.block)) };
}

function summarizeGroup(rows, entriesById) {
  rows.sort((a, b) => compareBlocks(a.start, b.start) || compareBlocks(a.end, b.end) || a.reportId.localeCompare(b.reportId));
  const segments = segmentsFor(rows);
  const links = [];
  for (let index = 1; index < rows.length; index++) {
    const before = rows[index - 1], after = rows[index];
    const continuity = inspectReportContinuity(entriesById.get(before.reportId).report,
      entriesById.get(after.reportId).report).slots.find(slot => slot.agent === before.agent);
    links.push({ ...continuity, beforeId: before.reportId, afterId: after.reportId });
  }
  const duplicateSets = new Map();
  rows.forEach(row => {
    if (!duplicateSets.has(row.evidenceKey)) duplicateSets.set(row.evidenceKey, []);
    duplicateSets.get(row.evidenceKey).push(row.reportId);
  });
  const duplicateEvidence = [...duplicateSets.values()].filter(ids => ids.length > 1);
  const conflicts = balanceConflicts(rows);
  const sum = predicate => segments.filter(predicate).reduce((n, row) => n + BigInt(row.blocks), 0n).toString();
  const allRowsAgree = rows.every(row => row.status === "arithmetic-agreement");
  const continuous = rows.length > 1 && allRowsAgree && links.every(row => row.continuousEvidence) && conflicts.length === 0;
  return {
    context: rows[0].context,
    tokenAddress: catalogToken({ agent: rows[0].agent, chainId: rows[0].context.chainId }).address,
    rows: rows.map(({ entry, evidenceKey, ...row }) => row),
    start: segments[0]?.start ?? rows[0].start,
    end: segments.at(-1)?.end ?? rows[0].end,
    segments, links, duplicateEvidence, balanceConflicts: conflicts,
    plannedUniqueBlocks: sum(row => row.kind !== "gap"),
    gapBlocks: sum(row => row.kind === "gap"),
    overlapBlocks: sum(row => ["overlap", "repeated"].includes(row.kind)),
    incompleteReports: rows.filter(row => row.status !== "arithmetic-agreement").map(row => row.reportId),
    allRowsAgree, continuous,
  };
}

/** Group by full token/chain/contract/account context. No cross-context arithmetic. */
export function analyzeReportSet(value) {
  const input = validateReportSet(value);
  const entriesById = new Map(input.entries.map(entry => [entry.id, entry]));
  const reports = input.entries.map(entry => ({ entry, analysis: analyzePeriodReport(entry.report) }));
  const allRows = [];
  const tokens = REPORT_SET_AGENTS.map(agent => {
    const groups = new Map(), missing = [];
    for (const { entry: report, analysis } of reports) {
      const source = report.report.slots.find(slot => slot.agent === agent).entry;
      if (!source) { missing.push(report.id); continue; }
      const slot = analysis.slots.find(row => row.agent === agent);
      const context = source.draft.plan.context, key = periodContextKey(context);
      const row = { reportId: report.id, reportLabel: report.label, agent, context,
        sourceId: source.id, start: source.draft.plan.earlierBlock, end: source.draft.plan.laterBlock,
        status: slot.status, archivedReport: report.archived, archivedSource: source.archived,
        restricted: source.requiresNewPlan, entry: source,
        evidenceKey: periodDraftKey(source.draft) + ":" + source.requiresNewPlan };
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row); allRows.push(row);
    }
    const result = [...groups.values()].map(rows => summarizeGroup(rows, entriesById))
      .sort((a, b) => periodContextKey(a.context).localeCompare(periodContextKey(b.context)));
    return { agent, groups: result, missingReportIds: missing, contextCount: result.length,
      continuous: missing.length === 0 && result.length === 1 && result[0].continuous };
  });
  const anchors = anchorConflicts(allRows);
  // A token's boundaries alone can match while its block hashes disagree with
  // another token on the same chain. Surface that conflict on the affected card.
  for (const token of tokens) {
    token.hashConflictCount = anchors.conflicts.filter(block =>
      block.observations.some(row => row.agent === token.agent)).length;
    token.invalidAnchorCount = anchors.invalid.filter(row => row.agent === token.agent).length;
    if (token.hashConflictCount || token.invalidAnchorCount) token.continuous = false;
  }
  const issues = [];
  if (input.entries.length < 2) issues.push("SINGLE_REPORT");
  if (tokens.some(token => token.missingReportIds.length)) issues.push("MISSING_TOKEN");
  if (tokens.some(token => token.groups.length > 1)) issues.push("MIXED_CONTEXTS");
  if (tokens.some(token => token.groups.some(group => group.gapBlocks !== "0"))) issues.push("GAPS");
  if (tokens.some(token => token.groups.some(group => group.overlapBlocks !== "0"))) issues.push("OVERLAPS");
  if (tokens.some(token => token.groups.some(group => group.duplicateEvidence.length))) issues.push("REPEATED_EVIDENCE");
  if (tokens.some(token => token.groups.some(group => group.incompleteReports.length))) issues.push("INCOMPLETE_EVIDENCE");
  if (tokens.some(token => token.groups.some(group => group.balanceConflicts.length))) issues.push("BALANCE_CONFLICTS");
  if (anchors.conflicts.length || anchors.invalid.length) issues.push("HASH_CONFLICTS");
  if (reports.some(row => !row.analysis.allArithmeticAgreement)) issues.push("REPORTS_NEED_REVIEW");
  const allContinuous = issues.length === 0 && tokens.every(token => token.continuous);
  return freezeSet({ title: input.title, createdAt: input.createdAt, reportCount: input.entries.length,
    sourceRevision: input.sourceRevision, archivedCount: input.entries.filter(entry => entry.archived).length,
    reports: reports.map(({ entry, analysis }) => ({ id: entry.id, label: entry.label,
      title: entry.report.title, status: analysis.status, savedAt: entry.savedAt,
      reportCreatedAt: entry.report.createdAt, archived: entry.archived, issues: analysis.issues })),
    tokens, anchors, issues, allContinuous, status: allContinuous ? "continuous" : "review-needed",
    eventsCombined: false, tokenAmountsSummed: false, liveChainRechecked: false,
    independentlyVerified: false, provesProfit: false });
}
