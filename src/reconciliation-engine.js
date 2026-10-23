import { assessTokenObservation } from "./token-identity-model.js";
import { identityUnits } from "./token-identity-codec.js";
import { catalogToken } from "./token-catalog.js";
import { compareTransferOrder, transferEventKey, transferDirection } from "./transfer-codec.js";
import { validateReconciliationWorkspace, reconciliationFail } from "./reconciliation-model.js";

export const RECONCILIATION_REPORT_SCHEMA = "threecore.reconciliation-report.v1";

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Signed totals can exceed uint256 when thousands of uint256 events are summed. */
export function formatReconciliationAmount(value, decimals = 18) {
  if (typeof value !== "string" || !/^(?:0|-?[1-9][0-9]{0,83})$/.test(value) ||
      !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    reconciliationFail("RECONCILIATION_AMOUNT");
  }
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  if (decimals === 0) return value;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return (negative ? "-" : "") + whole + (fraction ? "." + fraction : "");
}

/** Merge at most twelve queried ranges; never iterate over block numbers. */
export function reconciliationCoverage(earlierBlock, laterBlock, ranges) {
  const earlier = BigInt(identityUnits(earlierBlock));
  const later = BigInt(identityUnits(laterBlock));
  if (earlier > later) reconciliationFail("RECONCILIATION_ORDER");
  if (!Array.isArray(ranges) || ranges.length > 12) reconciliationFail("RECONCILIATION_RANGES");
  const candidates = ranges.map(range => {
    const from = BigInt(identityUnits(range.fromBlock));
    const to = BigInt(identityUnits(range.toBlock));
    if (from > to) reconciliationFail("RECONCILIATION_ORDER");
    return { from, to };
  });
  const start = earlier + 1n;
  const clipped = candidates.map(range => ({
    from: range.from < start ? start : range.from,
    to: range.to > later ? later : range.to,
  })).filter(range => range.from <= range.to)
    .sort((a, b) => a.from === b.from ? 0 : a.from < b.from ? -1 : 1);
  const merged = [];
  for (const range of clipped) {
    const last = merged.at(-1);
    if (last && range.from <= last.to + 1n) {
      if (range.to > last.to) last.to = range.to;
    } else merged.push({ ...range });
  }
  const gaps = [];
  let cursor = start;
  for (const range of merged) {
    if (range.from > cursor) gaps.push({ from: cursor, to: range.from - 1n });
    cursor = range.to + 1n;
  }
  if (cursor <= later) gaps.push({ from: cursor, to: later });
  const serialize = range => ({ fromBlock: range.from.toString(), toBlock: range.to.toString() });
  const covered = merged.reduce((sum, range) => sum + range.to - range.from + 1n, 0n);
  return freeze({
    fromBlockExclusive: earlier.toString(),
    toBlockInclusive: later.toString(),
    expectedBlocks: (later - earlier).toString(),
    coveredBlocks: covered.toString(),
    missingBlocks: (later - earlier - covered).toString(),
    ranges: merged.map(serialize),
    gaps: gaps.map(serialize),
    queriedEveryBlock: gaps.length === 0,
    provesCompleteHistory: false,
  });
}

function sameAsset(a, b) {
  return a.agent === b.agent && a.account === b.account && a.chainId === b.chainId &&
    a.tokenAddress === b.tokenAddress;
}

function anchorMap(archive) {
  const anchors = new Map();
  for (const record of archive?.records ?? []) {
    anchors.set(record.range.fromBlock, record.fromBlockHash);
    anchors.set(record.range.toBlock, record.toBlockHash);
    for (const event of record.events) anchors.set(event.blockNumber, event.blockHash);
  }
  return anchors;
}

function anchorCheck(observation, anchors) {
  const archiveHash = anchors.get(observation.blockNumber) ?? null;
  return {
    blockNumber: observation.blockNumber,
    observationHash: observation.blockHash,
    archiveHash,
    status: archiveHash === null ? "unchecked" : archiveHash === observation.blockHash ? "agrees" : "conflict",
  };
}

function uniqueEvents(archive) {
  const events = new Map();
  for (const record of archive?.records ?? []) {
    for (const event of record.events) events.set(transferEventKey(event), event);
  }
  return [...events.values()].sort(compareTransferOrder);
}

function tokenResult(slot) {
  const { agent, earlier, later, archive } = slot;
  const issues = [];
  const warnings = [];
  const result = {
    agent,
    status: "missing-input",
    account: earlier?.account ?? later?.account ?? archive?.records[0].context.account ?? null,
    chainId: earlier?.chainId ?? later?.chainId ?? archive?.records[0].context.chainId ?? null,
    tokenAddress: earlier?.tokenAddress ?? later?.tokenAddress ?? archive?.records[0].tokenAddress ?? null,
    earlierBlock: earlier?.blockNumber ?? null,
    laterBlock: later?.blockNumber ?? null,
    earlierBalanceBaseUnits: earlier?.balanceBaseUnits ?? null,
    laterBalanceBaseUnits: later?.balanceBaseUnits ?? null,
    assessments: {
      earlier: earlier ? assessTokenObservation(earlier).status : null,
      later: later ? assessTokenObservation(later).status : null,
    },
    origins: { earlier: earlier?.siteOrigin ?? null, later: later?.siteOrigin ?? null },
    anchors: null,
    coverage: null,
    totals: null,
    events: [],
    archiveRecords: archive?.records.length ?? 0,
    excludedEvents: 0,
    issues,
    warnings,
    historicalOnly: true,
    completeHistory: false,
    independentlyVerified: false,
    provesProfit: false,
  };
  if (!earlier) issues.push("EARLIER_MISSING");
  if (!later) issues.push("LATER_MISSING");
  if (!earlier || !later) return result;
  if (!sameAsset(earlier, later)) issues.push("OBSERVATION_CONTEXT_CONFLICT");
  if (BigInt(earlier.blockNumber) > BigInt(later.blockNumber)) issues.push("BLOCK_ORDER_CONFLICT");
  if (earlier.siteOrigin !== later.siteOrigin) warnings.push("DIFFERENT_OBSERVATION_ORIGINS");
  if (earlier.connectionEpoch !== later.connectionEpoch) warnings.push("DIFFERENT_CONNECTION_EPOCHS");
  if (result.assessments.earlier !== "matched") issues.push("EARLIER_METADATA_UNUSABLE");
  if (result.assessments.later !== "matched") issues.push("LATER_METADATA_UNUSABLE");
  const sameBlock = earlier.blockNumber === later.blockNumber;
  if (sameBlock && earlier.blockHash !== later.blockHash) issues.push("SAME_BLOCK_HASH_CONFLICT");
  if (sameBlock && ["hasCode", "metadata", "balanceBaseUnits", "nativeBalanceBaseUnits"].some(field =>
    JSON.stringify(earlier[field]) !== JSON.stringify(later[field]))) issues.push("SAME_BLOCK_STATE_CONFLICT");
  if (archive && !sameAsset(earlier, { ...archive.records[0].context, tokenAddress: archive.records[0].tokenAddress })) {
    issues.push("ARCHIVE_CONTEXT_CONFLICT");
  }
  const anchors = anchorMap(archive);
  result.anchors = { earlier: anchorCheck(earlier, anchors), later: anchorCheck(later, anchors) };
  if (Object.values(result.anchors).some(anchor => anchor.status === "conflict")) issues.push("ARCHIVE_ANCHOR_CONFLICT");
  if (issues.length) {
    result.status = "not-comparable";
    return result;
  }
  result.coverage = reconciliationCoverage(earlier.blockNumber, later.blockNumber,
    (archive?.records ?? []).map(record => record.range));
  if (!archive && !sameBlock) warnings.push("ARCHIVE_MISSING");
  if (Object.values(result.anchors).some(anchor => anchor.status === "unchecked")) warnings.push("ENDPOINT_HASH_UNCHECKED");
  if (!result.coverage.queriedEveryBlock) warnings.push("HISTORY_GAPS");
  const all = uniqueEvents(archive);
  const included = all.filter(event => BigInt(event.blockNumber) > BigInt(earlier.blockNumber) &&
    BigInt(event.blockNumber) <= BigInt(later.blockNumber));
  result.excludedEvents = all.length - included.length;
  let incoming = 0n;
  let outgoing = 0n;
  let cumulative = 0n;
  let negativeIntermediate = false;
  let exceedsIssuance = false;
  let impossibleSelfTransfer = false;
  const initialSupply = BigInt(catalogToken({ agent, chainId: earlier.chainId }).initialSupply);
  const transactions = new Set();
  for (const event of included) {
    const value = BigInt(event.amountBaseUnits);
    const receive = event.to === earlier.account;
    const send = event.from === earlier.account;
    const delta = (receive ? value : 0n) - (send ? value : 0n);
    const openingBalance = BigInt(earlier.balanceBaseUnits) + cumulative;
    if (receive && send && value > openingBalance) impossibleSelfTransfer = true;
    incoming += receive ? value : 0n;
    outgoing += send ? value : 0n;
    cumulative += delta;
    const impliedBalance = BigInt(earlier.balanceBaseUnits) + cumulative;
    if (impliedBalance < 0n) negativeIntermediate = true;
    if (impliedBalance > initialSupply) exceedsIssuance = true;
    transactions.add(event.transactionHash);
    result.events.push({
      ...event,
      direction: transferDirection(event, earlier.account),
      deltaBaseUnits: delta.toString(),
      cumulativeBaseUnits: cumulative.toString(),
      impliedBalanceBaseUnits: impliedBalance.toString(),
    });
  }
  const observedDelta = BigInt(later.balanceBaseUnits) - BigInt(earlier.balanceBaseUnits);
  const residual = observedDelta - cumulative;
  result.totals = {
    observedDeltaBaseUnits: observedDelta.toString(),
    incomingBaseUnits: incoming.toString(),
    outgoingBaseUnits: outgoing.toString(),
    netTransferBaseUnits: cumulative.toString(),
    residualBaseUnits: residual.toString(),
    impliedLaterBalanceBaseUnits: (BigInt(earlier.balanceBaseUnits) + cumulative).toString(),
    eventCount: included.length,
    transactionCount: transactions.size,
    selfTransferCount: result.events.filter(event => event.direction === "self").length,
    zeroValueCount: result.events.filter(event => event.amountBaseUnits === "0").length,
    decimals: earlier.metadata.decimals,
    symbol: earlier.metadata.symbol,
  };
  if (negativeIntermediate) warnings.push("NEGATIVE_IMPLIED_BALANCE");
  if (exceedsIssuance) warnings.push("IMPLIED_BALANCE_EXCEEDS_ISSUANCE");
  if (impossibleSelfTransfer) warnings.push("SELF_TRANSFER_EXCEEDS_BALANCE");
  if (!result.coverage.queriedEveryBlock) result.status = "incomplete-history";
  else if (negativeIntermediate || exceedsIssuance || impossibleSelfTransfer) result.status = "inconsistent-history";
  else result.status = residual === 0n ? "arithmetic-agreement" : "unexplained-difference";
  return result;
}

/** Recalculate from original evidence every time. Never accept an imported conclusion. */
export function reconcileWorkspace(input) {
  const workspace = validateReconciliationWorkspace(input);
  return freeze({
    schema: RECONCILIATION_REPORT_SCHEMA,
    slots: workspace.slots.map(tokenResult),
    readOnly: true,
    independentlyVerified: false,
    completeHistory: false,
    securityAudit: false,
  });
}
