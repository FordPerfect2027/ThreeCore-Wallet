import { identityObject } from "./token-identity-codec.js";
import { validateTokenObservation } from "./token-identity-model.js";
import { validateTransferArchive } from "./transfer-archive.js";

export const RECONCILIATION_SCHEMA = "threecore.reconciliation-workspace.v1";
export const RECONCILIATION_AGENTS = Object.freeze(["DAT", "EMA", "CAWELON"]);
export const RECONCILIATION_PARTS = Object.freeze(["earlier", "later", "archive"]);
export const RECONCILIATION_LIMIT = 16 * 1024 * 1024;

export class ReconciliationError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReconciliationError";
    this.code = code;
  }
}

export function reconciliationFail(code) {
  throw new ReconciliationError(code);
}

export function reconciliationShape(input, fields) {
  try { identityObject(input, fields); }
  catch { reconciliationFail("RECONCILIATION_SHAPE"); }
}

export function reconciliationAgent(agent) {
  if (!RECONCILIATION_AGENTS.includes(agent)) reconciliationFail("RECONCILIATION_AGENT");
  return agent;
}

export function reconciliationPart(part) {
  if (!RECONCILIATION_PARTS.includes(part)) reconciliationFail("RECONCILIATION_PART");
  return part;
}

export function emptyReconciliationWorkspace() {
  return validateReconciliationWorkspace({
    schema: RECONCILIATION_SCHEMA,
    slots: RECONCILIATION_AGENTS.map(agent => ({ agent, earlier: null, later: null, archive: null })),
    readOnly: true,
    independentlyVerified: false,
  });
}

function validatePart(agent, part, input) {
  if (input === null) return null;
  const value = part === "archive" ? validateTransferArchive(input) : validateTokenObservation(input);
  const actual = part === "archive" ? value.records[0].context.agent : value.agent;
  if (actual !== agent) reconciliationFail("RECONCILIATION_SLOT_AGENT");
  return value;
}

/** Partial and conflicting evidence is retained for review; it is never corrected silently. */
export function validateReconciliationWorkspace(input) {
  reconciliationShape(input, ["schema", "slots", "readOnly", "independentlyVerified"]);
  if (input.schema !== RECONCILIATION_SCHEMA || input.readOnly !== true || input.independentlyVerified !== false) {
    reconciliationFail("RECONCILIATION_SCHEMA");
  }
  if (!Array.isArray(input.slots) || input.slots.length !== RECONCILIATION_AGENTS.length) {
    reconciliationFail("RECONCILIATION_SLOTS");
  }
  const slots = RECONCILIATION_AGENTS.map((agent, index) => {
    const slot = input.slots[index];
    reconciliationShape(slot, ["agent", ...RECONCILIATION_PARTS]);
    if (slot.agent !== agent) reconciliationFail("RECONCILIATION_SLOTS");
    return Object.freeze({
      agent,
      earlier: validatePart(agent, "earlier", slot.earlier),
      later: validatePart(agent, "later", slot.later),
      archive: validatePart(agent, "archive", slot.archive),
    });
  });
  const value = Object.freeze({
    schema: RECONCILIATION_SCHEMA,
    slots: Object.freeze(slots),
    readOnly: true,
    independentlyVerified: false,
  });
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > RECONCILIATION_LIMIT) {
    reconciliationFail("RECONCILIATION_SIZE");
  }
  return value;
}

export function reconciliationKey(input) {
  return JSON.stringify(validateReconciliationWorkspace(input));
}

export function replaceReconciliationPart(input, agent, part, value) {
  const workspace = validateReconciliationWorkspace(input);
  reconciliationAgent(agent);
  reconciliationPart(part);
  return validateReconciliationWorkspace({
    ...workspace,
    slots: workspace.slots.map(slot => slot.agent === agent ? { ...slot, [part]: value } : slot),
  });
}

export function clearReconciliationSlot(input, agent) {
  const workspace = validateReconciliationWorkspace(input);
  reconciliationAgent(agent);
  return validateReconciliationWorkspace({
    ...workspace,
    slots: workspace.slots.map(slot => slot.agent === agent ? { agent, earlier: null, later: null, archive: null } : slot),
  });
}

export function describeReconciliationPart(part, value) {
  reconciliationPart(part);
  if (value === null) return null;
  if (part === "archive") {
    const archive = validateTransferArchive(value);
    return Object.freeze({
      agent: archive.records[0].context.agent,
      account: archive.records[0].context.account,
      chainId: archive.records[0].context.chainId,
      records: archive.records.length,
      firstBlock: archive.records[0].range.fromBlock,
      lastBlock: archive.records.reduce((last, record) =>
        BigInt(record.range.toBlock) > BigInt(last) ? record.range.toBlock : last, "0"),
    });
  }
  const observation = validateTokenObservation(value);
  return Object.freeze({
    agent: observation.agent,
    account: observation.account,
    chainId: observation.chainId,
    blockNumber: observation.blockNumber,
    blockHash: observation.blockHash,
    balanceBaseUnits: observation.balanceBaseUnits,
    siteOrigin: observation.siteOrigin,
  });
}

/** A review is bound to the entire prior workspace, not just a selected UI row. */
export function reviewReconciliationReplacement(beforeInput, afterInput) {
  const before = validateReconciliationWorkspace(beforeInput);
  const after = validateReconciliationWorkspace(afterInput);
  const changes = [];
  for (let index = 0; index < before.slots.length; index++) {
    for (const part of RECONCILIATION_PARTS) {
      const previous = before.slots[index][part];
      const next = after.slots[index][part];
      if (JSON.stringify(previous) === JSON.stringify(next)) continue;
      changes.push(Object.freeze({
        agent: before.slots[index].agent,
        part,
        action: next === null ? "remove" : previous === null ? "add" : "replace",
        before: describeReconciliationPart(part, previous),
        after: describeReconciliationPart(part, next),
      }));
    }
  }
  return Object.freeze({
    beforeKey: reconciliationKey(before),
    after,
    changes: Object.freeze(changes),
    requiresReplacementAcknowledgement: changes.some(change => change.action !== "add"),
  });
}
