import { createPeriodReportInput } from "../../src/period-report-model.js";
import { library, entry, id, TIME, LATER, checkpoint, plan, context, clone, memoryStorage,
  fileFrom, deferred, tick, code, ACCOUNT, OTHER, THIRD, walk } from "./period-library-fixtures.js";
import { hash, UNIT, event, record, observation } from "./period-fixtures.js";

export { library, entry, id, TIME, LATER, checkpoint, plan, context, clone, memoryStorage,
  fileFrom, deferred, tick, code, ACCOUNT, OTHER, THIRD, hash, UNIT, event, record, observation, walk };
export const AGENTS = Object.freeze(["DAT", "EMA", "CAWELON"]);
export const ACCOUNTS = Object.freeze([ACCOUNT, OTHER, THIRD]);
export const selection = () => ({ DAT: id(1), EMA: id(2), CAWELON: id(3) });

export function reportLibrary({ chainId = 84532, counts = [5, 5, 5], changes = {} } = {}) {
  return library(AGENTS.map((agent, index) => entry(index + 1, {
    label: agent + " 期間30–42", draft: checkpoint(counts[index], plan({}, context(agent, chainId, ACCOUNTS[index]))),
    ...changes[agent],
  })), 3);
}

export function reportInput(options = {}) {
  return createPeriodReportInput(options.library ?? reportLibrary(options), options.selection ?? selection(),
    options.title ?? "3トークンの期間確認", options.time ?? LATER);
}

export function changedSlot(input, agent, transform) {
  const copy = clone(input);
  const slot = copy.slots.find(row => row.agent === agent);
  transform(slot.entry, slot, copy);
  return copy;
}

/** Alternate consistent chain history for one slot, not a malformed single event. */
export function forkedInput(agent = "EMA", input = reportInput()) {
  return changedSlot(input, agent, entry => {
    const draft = entry.draft;
    for (const endpoint of [draft.earlier, draft.later]) if (endpoint) endpoint.blockHash = hash(BigInt(endpoint.blockNumber) + 500n);
    for (const record of draft.records) {
      record.fromBlockHash = hash(BigInt(record.range.fromBlock) + 500n);
      record.toBlockHash = hash(BigInt(record.range.toBlock) + 500n);
      for (const event of record.events) event.blockHash = hash(BigInt(event.blockNumber) + 500n);
    }
  });
}

export function manyEventsInput(count = 57, agent = "DAT") {
  const index = AGENTS.indexOf(agent), selected = context(agent, 84532, ACCOUNTS[index]);
  const partner = selected.account === OTHER ? THIRD : OTHER;
  const draft = clone(checkpoint(2, plan({ windowSize: 12 }, selected)));
  const events = Array.from({ length: count }, (_, number) => event({
    blockNumber: "35", blockHash: hash(35), from: partner, to: selected.account,
    amountBaseUnits: "1", transactionHash: hash(10000 + number), transactionIndex: String(number), logIndex: String(number),
  }, number + 1));
  draft.later.balanceBaseUnits = (100n * UNIT + BigInt(count)).toString();
  draft.records = [record(31, 42, events, selected)];
  return reportInput({ changes: { [agent]: { draft } } });
}

export async function waitUntil(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 6000) throw Error("Report test timeout");
    await tick();
  }
}
