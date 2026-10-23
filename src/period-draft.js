import { validateTokenObservation, assessTokenObservation } from "./token-identity-model.js";
import { validateTransferSnapshot } from "./transfer-codec.js";
import { addTransferArchiveRecord } from "./transfer-archive.js";
import { emptyReconciliationWorkspace, validateReconciliationWorkspace } from "./reconciliation-model.js";
import { periodFail, periodShape, periodContextKey, validatePeriodPlan, periodWindows } from "./period-plan.js";

export const PERIOD_DRAFT_SCHEMA = "threecore.period-draft.v1";
export const PERIOD_DRAFT_LIMIT = 16 * 1024 * 1024;

function observation(input, plan, endpoint) {
  if (input === null) return null;
  const value = validateTokenObservation(input);
  if (periodContextKey({ agent: value.agent, chainId: value.chainId, account: value.account }) !==
      periodContextKey(plan.context)) periodFail("PERIOD_CONTEXT_MISMATCH");
  if (value.blockNumber !== plan[endpoint + "Block"]) periodFail("PERIOD_ENDPOINT_MISMATCH");
  if (assessTokenObservation(value).status !== "matched") periodFail("PERIOD_TOKEN_MISMATCH");
  return value;
}

export function emptyPeriodDraft(plan) {
  return validatePeriodDraft({ schema: PERIOD_DRAFT_SCHEMA, plan, earlier: null,
    later: null, records: [], readOnly: true, independentlyVerified: false });
}

/** Only a contiguous completed prefix is resumable; incomplete RPC results are absent. */
export function validatePeriodDraft(input) {
  periodShape(input, ["schema", "plan", "earlier", "later", "records", "readOnly", "independentlyVerified"]);
  if (input.schema !== PERIOD_DRAFT_SCHEMA || input.readOnly !== true || input.independentlyVerified !== false) {
    periodFail("PERIOD_DRAFT_SCHEMA");
  }
  const plan = validatePeriodPlan(input.plan);
  const windows = periodWindows(plan);
  if (!Array.isArray(input.records) || input.records.length > windows.length) periodFail("PERIOD_RECORDS");
  const earlier = observation(input.earlier, plan, "earlier");
  const later = observation(input.later, plan, "later");
  if ((!earlier && later) || (!later && input.records.length)) periodFail("PERIOD_PREFIX");
  let archive = null;
  const records = input.records.map((inputRecord, index) => {
    const record = validateTransferSnapshot(inputRecord);
    if (periodContextKey(record.context) !== periodContextKey(plan.context)) periodFail("PERIOD_CONTEXT_MISMATCH");
    if (record.range.fromBlock !== windows[index].fromBlock || record.range.toBlock !== windows[index].toBlock) {
      periodFail("PERIOD_RECORD_RANGE");
    }
    archive = addTransferArchiveRecord(archive, record);
    if (record.range.toBlock === plan.laterBlock && record.toBlockHash !== later.blockHash) {
      periodFail("PERIOD_ANCHOR_CONFLICT");
    }
    return record;
  });
  const result = Object.freeze({ schema: PERIOD_DRAFT_SCHEMA, plan, earlier, later,
    records: Object.freeze(records), readOnly: true, independentlyVerified: false });
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PERIOD_DRAFT_LIMIT) periodFail("PERIOD_DRAFT_SIZE");
  return result;
}

export function periodDraftKey(input) { return JSON.stringify(validatePeriodDraft(input)); }

export function periodDraftProgress(input) {
  const draft = validatePeriodDraft(input);
  const windows = periodWindows(draft.plan);
  const completed = Number(draft.earlier !== null) + Number(draft.later !== null) + draft.records.length;
  return Object.freeze({
    completed, total: windows.length + 2, complete: completed === windows.length + 2,
    windowsCompleted: draft.records.length, windowsTotal: windows.length,
    events: draft.records.reduce((total, row) => total + row.events.length, 0),
    next: !draft.earlier ? "earlier" : !draft.later ? "later" :
      draft.records.length < windows.length ? "history" : "recheck",
    nextWindow: windows[draft.records.length] ?? null,
  });
}

export function appendPeriodObservation(input, part, value) {
  const draft = validatePeriodDraft(input);
  if (!["earlier", "later"].includes(part)) periodFail("PERIOD_PART");
  if (draft[part] !== null) periodFail("PERIOD_ALREADY_COLLECTED");
  return validatePeriodDraft({ ...draft, [part]: value });
}

export function appendPeriodRecord(input, record) {
  const draft = validatePeriodDraft(input);
  return validatePeriodDraft({ ...draft, records: [...draft.records, record] });
}

/** Complete means all planned reads are present, not that the provider's logs are exhaustive. */
export function periodDraftWorkspace(input, base = emptyReconciliationWorkspace()) {
  const draft = validatePeriodDraft(input);
  if (!periodDraftProgress(draft).complete) periodFail("PERIOD_INCOMPLETE");
  const workspace = validateReconciliationWorkspace(base);
  const archive = draft.records.reduce((previous, row) => addTransferArchiveRecord(previous, row), null);
  return validateReconciliationWorkspace({ ...workspace,
    slots: workspace.slots.map(slot => slot.agent === draft.plan.context.agent
      ? { agent: slot.agent, earlier: draft.earlier, later: draft.later, archive } : slot),
  });
}

/** Anchors are unique and bounded: endpoints, each window boundary, every observed event block. */
export function periodDraftAnchors(input) {
  const draft = validatePeriodDraft(input);
  const hashes = new Map();
  function add(number, hash) {
    if (hashes.has(number) && hashes.get(number) !== hash) periodFail("PERIOD_ANCHOR_CONFLICT");
    hashes.set(number, hash);
  }
  for (const value of [draft.earlier, draft.later]) if (value) add(value.blockNumber, value.blockHash);
  for (const row of draft.records) {
    add(row.range.fromBlock, row.fromBlockHash);
    add(row.range.toBlock, row.toBlockHash);
    for (const event of row.events) add(event.blockNumber, event.blockHash);
  }
  return Object.freeze([...hashes].sort(([a], [b]) => BigInt(a) < BigInt(b) ? -1 : 1)
    .map(([number, hash]) => Object.freeze({ number, hash })));
}
