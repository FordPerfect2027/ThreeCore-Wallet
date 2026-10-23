import { validatePeriodReportInput } from "./period-report-model.js";
import { periodDraftProgress, periodDraftAnchors } from "./period-draft.js";
import { addTransferArchiveRecord } from "./transfer-archive.js";
import { emptyReconciliationWorkspace, validateReconciliationWorkspace } from "./reconciliation-model.js";
import { reconcileWorkspace } from "./reconciliation-engine.js";

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function workspaceFor(input) {
  const base = emptyReconciliationWorkspace();
  return validateReconciliationWorkspace({ ...base, slots: input.slots.map(({ agent, entry }) => {
    if (!entry) return base.slots.find(row => row.agent === agent);
    return { agent, earlier: entry.draft.earlier, later: entry.draft.later,
      archive: entry.draft.records.reduce((archive, record) => addTransferArchiveRecord(archive, record), null) };
  }) });
}

/** Only equal chain IDs share block numbers; never compare hashes across chains. */
function crossAnchors(input) {
  const byBlock = new Map(), invalidAgents = [];
  for (const { agent, entry } of input.slots) {
    if (!entry) continue;
    let anchors;
    try { anchors = periodDraftAnchors(entry.draft); }
    catch (error) {
      if (error?.code !== "PERIOD_ANCHOR_CONFLICT") throw error;
      invalidAgents.push(agent);
      continue;
    }
    for (const { number, hash } of anchors) {
      const chainId = entry.draft.plan.context.chainId, key = chainId + ":" + number;
      if (!byBlock.has(key)) byBlock.set(key, { chainId, number, observations: [] });
      byBlock.get(key).observations.push({ agent, hash });
    }
  }
  let comparedBlocks = 0;
  const conflicts = [];
  for (const block of byBlock.values()) {
    if (block.observations.length < 2) continue;
    comparedBlocks++;
    if (new Set(block.observations.map(row => row.hash)).size > 1) conflicts.push(block);
  }
  conflicts.sort((a, b) => a.chainId - b.chainId || (BigInt(a.number) < BigInt(b.number) ? -1 : 1));
  return { comparedBlocks, conflicts, invalidAgents, liveChainRechecked: false };
}

/** Reuse exact integer reconciliation. Never add balances belonging to different tokens. */
export function analyzePeriodReport(inputValue) {
  const input = validatePeriodReportInput(inputValue);
  const reconciliation = reconcileWorkspace(workspaceFor(input));
  const anchors = crossAnchors(input);
  const selected = input.slots.filter(slot => slot.entry);
  const chains = [...new Set(selected.map(slot => slot.entry.draft.plan.context.chainId))];
  const periods = [...new Set(selected.map(slot => {
    const plan = slot.entry.draft.plan;
    return plan.earlierBlock + ":" + plan.laterBlock;
  }))];
  const issues = [], warnings = [];
  if (selected.length !== 3) issues.push("MISSING_TOKEN");
  if (chains.length > 1) issues.push("DIFFERENT_CHAINS");
  if (periods.length > 1) issues.push("DIFFERENT_PERIODS");
  if (anchors.conflicts.length || anchors.invalidAgents.length) issues.push("BLOCK_HASH_CONFLICT");
  const sharedAccounts = [];
  for (let a = 0; a < selected.length; a++) {
    for (let b = a + 1; b < selected.length; b++) {
      const left = selected[a].entry.draft.plan.context, right = selected[b].entry.draft.plan.context;
      if (left.chainId === right.chainId && left.account === right.account) {
        sharedAccounts.push({ agents: [left.agent, right.agent], chainId: left.chainId, account: left.account });
      }
    }
  }
  if (sharedAccounts.length) warnings.push("SHARED_ACCOUNT");
  if (selected.some(slot => slot.entry.archived)) warnings.push("ARCHIVED_SOURCE");
  const slots = input.slots.map(({ agent, entry }, index) => {
    const arithmetic = reconciliation.slots[index];
    const progress = entry ? periodDraftProgress(entry.draft) : null;
    const conflicting = anchors.invalidAgents.includes(agent) || anchors.conflicts.some(row =>
      row.observations.some(observation => observation.agent === agent));
    const status = !entry ? "missing" : entry.requiresNewPlan ? "requires-new-plan" :
      conflicting ? "anchor-conflict" : !progress.complete ? "partial" : arithmetic.status;
    return { agent, entryId: entry?.id ?? null, label: entry?.label ?? null,
      archived: entry?.archived ?? false, requiresNewPlan: entry?.requiresNewPlan ?? false,
      plan: entry?.draft.plan ?? null, progress, status, arithmetic };
  });
  if (slots.some(slot => slot.requiresNewPlan)) issues.push("QUARANTINED_SOURCE");
  if (slots.some(slot => slot.status === "partial")) issues.push("INCOMPLETE_ACQUISITION");
  if (slots.some(slot => slot.status === "unexplained-difference")) issues.push("UNEXPLAINED_DIFFERENCE");
  if (slots.some(slot => ["not-comparable", "inconsistent-history", "incomplete-history"].includes(slot.status))) {
    issues.push("UNUSABLE_HISTORY");
  }
  const sameChainAndPeriod = selected.length === 3 && chains.length === 1 && periods.length === 1;
  const allArithmeticAgreement = sameChainAndPeriod && issues.length === 0 &&
    slots.every(slot => slot.status === "arithmetic-agreement");
  const status = allArithmeticAgreement ? "arithmetic-agreement" :
    issues.some(code => ["BLOCK_HASH_CONFLICT", "QUARANTINED_SOURCE", "UNEXPLAINED_DIFFERENCE", "UNUSABLE_HISTORY"].includes(code))
      ? "attention" : "incomplete";
  return freeze({ schema: "threecore.period-report-analysis.v1", title: input.title,
    createdAt: input.createdAt, status, slots, issues, warnings, anchors, sharedAccounts,
    selectedCount: selected.length, sameChainAndPeriod, allArithmeticAgreement,
    chainId: sameChainAndPeriod ? chains[0] : null,
    earlierBlock: sameChainAndPeriod ? selected[0].entry.draft.plan.earlierBlock : null,
    laterBlock: sameChainAndPeriod ? selected[0].entry.draft.plan.laterBlock : null,
    eventCount: slots.reduce((count, slot) => count + (slot.arithmetic.totals?.eventCount ?? 0), 0),
    eventCountsArePerToken: true, combinesTokenValues: false, historicalOnly: true,
    liveChainRechecked: false, independentlyVerified: false, completeHistory: false,
    securityAudit: false, provesProfit: false });
}
