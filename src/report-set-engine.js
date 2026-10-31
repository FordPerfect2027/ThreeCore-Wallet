import { validateReportSet, freezeSet, REPORT_SET_AGENTS } from "./report-set-model.js";
import { periodContextKey, periodShape, periodFail } from "./period-plan.js";
import { periodDraftKey, periodDraftAnchors } from "./period-draft.js";
import { analyzePeriodReport } from "./period-report-engine.js";
import { inspectReportContinuity } from "./report-history-continuity.js";
import { catalogToken } from "./token-catalog.js";
import { comparePeriodReports } from "./period-report-comparison.js";

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

const analyses = new WeakMap();

/** Group by full token/chain/contract/account context. No cross-context arithmetic. */
export function analyzeReportSet(value) {
  const input = validateReportSet(value);
  const previous = analyses.get(input);
  if (previous) return Object.freeze({ ...previous });
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
  const result = freezeSet({ title: input.title, createdAt: input.createdAt, reportCount: input.entries.length,
    sourceRevision: input.sourceRevision, archivedCount: input.entries.filter(entry => entry.archived).length,
    reports: reports.map(({ entry, analysis }) => ({ id: entry.id, label: entry.label,
      title: entry.report.title, status: analysis.status, savedAt: entry.savedAt,
      reportCreatedAt: entry.report.createdAt, archived: entry.archived, issues: analysis.issues })),
    tokens, anchors, issues, allContinuous, status: allContinuous ? "continuous" : "review-needed",
    eventsCombined: false, tokenAmountsSummed: false, liveChainRechecked: false,
    independentlyVerified: false, provesProfit: false });
  analyses.set(input, result);
  return Object.freeze({ ...result });
}


/** Compare accepted/proposed saved sets by source ID; never merge or remove storage entries. */
export function compareReportSets(beforeValue, afterValue) {
  const before = validateReportSet(beforeValue), after = validateReportSet(afterValue);
  const beforeAnalysis = analyzeReportSet(before), afterAnalysis = analyzeReportSet(after);
  const oldRows = new Map(before.entries.map(row => [row.id, row])), newRows = new Map(after.entries.map(row => [row.id, row]));
  const oldStatuses = new Map(beforeAnalysis.reports.map(row => [row.id, row.status]));
  const newStatuses = new Map(afterAnalysis.reports.map(row => [row.id, row.status]));
  const metadata = ["label", "note", "tags", "savedAt", "updatedAt", "archived"];
  const ids = [...new Set([...oldRows.keys(), ...newRows.keys()])].sort();
  const rows = ids.map(id => {
    const old = oldRows.get(id), next = newRows.get(id);
    const fields = old && next ? metadata.filter(key => JSON.stringify(old[key]) !== JSON.stringify(next[key])) : [];
    const comparison = old && next ? comparePeriodReports(old.report, next.report) : null;
    const reportMetadata = comparison ? [...(comparison.titleChanged ? ["title"] : []), ...(comparison.timestampChanged ? ["createdAt"] : [])] : [];
    const tokenChanges = comparison ? comparison.slots.map(slot => ({
      agent: slot.agent, kind: slot.kind, sameContext: slot.sameContext, samePeriod: slot.samePeriod,
      evidenceChanged: slot.evidenceChanged, metadataChanges: slot.metadataChanges,
      beforeStatus: slot.beforeStatus, afterStatus: slot.afterStatus, beforeSteps: slot.beforeSteps, afterSteps: slot.afterSteps,
      eventChanges: slot.eventChanges, endpointChanges: slot.endpointChanges,
      changedAnchorCount: slot.anchorChanges.length, restrictionChange: slot.restrictionChange,
      archiveChange: slot.archiveChange, needsAttention: slot.attention,
    })) : [];
    const evidenceChanged = tokenChanges.some(slot => slot.evidenceChanged);
    const changed = fields.length || reportMetadata.length || tokenChanges.some(slot => slot.kind !== "unchanged");
    const kind = !old ? "added" : !next ? "removed" : evidenceChanged ? "changed" : changed ? "metadata-only" : "unchanged";
    return { id, kind, beforeLabel: old?.label ?? null, afterLabel: next?.label ?? null,
      beforeStatus: oldStatuses.get(id) ?? null, afterStatus: newStatuses.get(id) ?? null,
      metadataChanges: fields, reportMetadataChanges: reportMetadata, tokenChanges,
      needsAttention: ["added", "removed", "changed"].includes(kind) || comparison?.needsAttention === true };
  });
  const counts = Object.fromEntries(["added", "removed", "changed", "metadata-only", "unchanged"].map(kind => [kind, rows.filter(row => row.kind === kind).length]));
  const metadataChanges = ["title", "createdAt", "sourceRevision"].filter(key => before[key] !== after[key]);
  return freezeSet({ schema: "threecore.report-set-comparison.v1",
    beforeTitle: before.title, afterTitle: after.title, beforeCount: before.entries.length, afterCount: after.entries.length,
    metadataChanges, orderChanged: JSON.stringify(before.entries.map(row => row.id)) !== JSON.stringify(after.entries.map(row => row.id)),
    beforeSummary: { allContinuous: beforeAnalysis.allContinuous, issues: beforeAnalysis.issues },
    afterSummary: { allContinuous: afterAnalysis.allContinuous, issues: afterAnalysis.issues },
    counts, rows, needsAttention: rows.some(row => row.needsAttention), sameContents: metadataChanges.length === 0 &&
      JSON.stringify(before.entries.map(row => row.id)) === JSON.stringify(after.entries.map(row => row.id)) &&
      rows.every(row => row.kind === "unchanged"),
    historicalOnly: true, liveChainRechecked: false, independentlyVerified: false, automaticMerge: false, deletesStoredReports: false });
}

/** Compare two explicitly selected saved event lists only where both actually saved a query. */
export function compareReportSetEvents(value, queryValue) {
  const input = validateReportSet(value);
  let query;
  try { query = periodShape(queryValue, ["beforeId", "afterId", "agent"]); }
  catch { periodFail("PERIOD_SET_EVENT_QUERY"); }
  if (typeof query.beforeId !== "string" || typeof query.afterId !== "string" ||
      query.beforeId === query.afterId || !REPORT_SET_AGENTS.includes(query.agent)) periodFail("PERIOD_SET_EVENT_QUERY");
  const selected = [query.beforeId, query.afterId].map(id => input.entries.find(row => row.id === id));
  if (selected.some(row => !row)) periodFail("PERIOD_SET_EVENT_SOURCE");
  const sources = selected.map(row => row.report.slots.find(slot => slot.agent === query.agent).entry);
  if (sources.some(row => !row)) periodFail("PERIOD_SET_EVENT_SLOT");
  const drafts = sources.map(row => row.draft);
  if (periodContextKey(drafts[0].plan.context) !== periodContextKey(drafts[1].plan.context)) periodFail("PERIOD_SET_EVENT_CONTEXT");
  const ranges = [];
  for (const left of drafts[0].records) for (const right of drafts[1].records) {
    const from = BigInt(left.range.fromBlock) > BigInt(right.range.fromBlock) ? left.range.fromBlock : right.range.fromBlock;
    const to = BigInt(left.range.toBlock) < BigInt(right.range.toBlock) ? left.range.toBlock : right.range.toBlock;
    if (BigInt(from) <= BigInt(to)) ranges.push({ fromBlock: from, toBlock: to });
  }
  ranges.sort((a, b) => compareBlocks(a.fromBlock, b.fromBlock));
  const commonRanges = [];
  for (const row of ranges) {
    const previous = commonRanges.at(-1);
    if (previous && BigInt(row.fromBlock) <= BigInt(previous.toBlock) + 1n) {
      if (BigInt(row.toBlock) > BigInt(previous.toBlock)) previous.toBlock = row.toBlock;
    } else commonRanges.push({ ...row });
  }
  const inside = block => commonRanges.some(range => BigInt(block) >= BigInt(range.fromBlock) && BigInt(block) <= BigInt(range.toBlock));
  const observed = drafts.map(draft => draft.records.flatMap((record, recordIndex) => record.events.map((event, eventIndex) => ({ recordIndex, eventIndex, event }))));
  const included = observed.map(rows => rows.filter(row => inside(row.event.blockNumber)));
  const key = row => row.event.transactionHash + ":" + row.event.logIndex;
  const maps = included.map(rows => new Map(rows.map(row => [key(row), row])));
  const counts = { matching: 0, changed: 0, onlyBefore: 0, onlyAfter: 0 };
  const differences = [];
  const fields = ["blockNumber", "blockHash", "transactionIndex", "from", "to", "amountBaseUnits"];
  for (const id of new Set([...maps[0].keys(), ...maps[1].keys()])) {
    const before = maps[0].get(id) ?? null, after = maps[1].get(id) ?? null;
    const changedFields = before && after ? fields.filter(field => before.event[field] !== after.event[field]) : [];
    const kind = !before ? "onlyAfter" : !after ? "onlyBefore" : changedFields.length ? "changed" : "matching";
    counts[kind]++;
    if (kind !== "matching") differences.push({ kind, transactionHash: (before ?? after).event.transactionHash,
      logIndex: (before ?? after).event.logIndex, changedFields, before, after });
  }
  differences.sort((a, b) => compareBlocks((a.before ?? a.after).event.blockNumber, (b.before ?? b.after).event.blockNumber) ||
    a.transactionHash.localeCompare(b.transactionHash) || compareBlocks(a.logIndex, b.logIndex));
  const anchorSets = drafts.map(draft => {
    try { return { valid: true, rows: periodDraftAnchors(draft) }; }
    catch { return { valid: false, rows: [] }; }
  });
  const afterAnchors = new Map(anchorSets[1].rows.filter(row => inside(row.number)).map(row => [row.number, row.hash]));
  const sharedAnchors = anchorSets[0].rows.filter(row => inside(row.number) && afterAnchors.has(row.number));
  const anchorDifferences = sharedAnchors.filter(row => afterAnchors.get(row.number) !== row.hash)
    .map(row => ({ blockNumber: row.number, beforeHash: row.hash, afterHash: afterAnchors.get(row.number) }));
  const source = index => ({ reportId: selected[index].id, label: selected[index].label,
    archivedReport: selected[index].archived, archivedSource: sources[index].archived,
    restricted: sources[index].requiresNewPlan, internallyConsistentHashes: anchorSets[index].valid,
    savedQueryRecords: drafts[index].records.length, totalSavedEvents: observed[index].length,
    comparedEvents: included[index].length, excludedEvents: observed[index].length - included[index].length });
  return freezeSet({ schema: "threecore.saved-event-comparison.v1", query: { ...query }, context: drafts[0].plan.context,
    tokenAddress: catalogToken({ agent: query.agent, chainId: drafts[0].plan.context.chainId }).address, before: source(0), after: source(1),
    commonRanges, comparedBlocks: commonRanges.reduce((n, row) => n + BigInt(row.toBlock) - BigInt(row.fromBlock) + 1n, 0n).toString(),
    counts, differences, sharedAnchorCount: sharedAnchors.length, anchorDifferences,
    status: !commonRanges.length ? "no-common-coverage" : differences.length || anchorDifferences.length || anchorSets.some(row => !row.valid)
      ? "differences" : "saved-observations-match",
    rangeNotation: "inclusive", eventsCombined: false, absenceProvesNoTransfer: false,
    historicalOnly: true, liveChainRechecked: false, authenticated: false, authorizesExecution: false });
}
