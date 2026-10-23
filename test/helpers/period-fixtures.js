import { catalogToken } from "../../src/token-catalog.js";
import { createPeriodPlan, periodWindows } from "../../src/period-plan.js";
import { emptyPeriodDraft, appendPeriodObservation, appendPeriodRecord } from "../../src/period-draft.js";
import { collectPeriod } from "../../src/period-reader.js";
import { context, observation, record, event, hash, ACCOUNT, OTHER, THIRD, UNIT, clone, deferred, tick, fileFrom } from "./reconciliation-fixtures.js";

export { context, observation, record, event, hash, ACCOUNT, OTHER, THIRD, UNIT, clone, deferred, tick, fileFrom };
export const code = expected => error => error?.code === expected;

export function plan(changes = {}, selected = context()) {
  return createPeriodPlan({ context: selected, earlierBlock: "30", laterBlock: "42", windowSize: 5, ...changes });
}

export function rows(selected = context()) {
  const partner = selected.account === OTHER ? THIRD : OTHER;
  return [
    event({ blockNumber: "35", blockHash: hash(35), from: partner, to: selected.account, amountBaseUnits: (10n * UNIT).toString() }, 1),
    event({ blockNumber: "40", blockHash: hash(40), from: selected.account, to: partner, amountBaseUnits: (3n * UNIT).toString() }, 2),
  ];
}

export function checkpoint(count = 5, selected = plan()) {
  let draft = emptyPeriodDraft(selected);
  const events = rows(selected.context);
  if (count > 0) draft = appendPeriodObservation(draft, "earlier", observation({ blockNumber: selected.earlierBlock,
    blockHash: hash(selected.earlierBlock) }, selected.context));
  if (count > 1) draft = appendPeriodObservation(draft, "later", observation({ blockNumber: selected.laterBlock,
    blockHash: hash(selected.laterBlock), balanceBaseUnits: (107n * UNIT).toString() }, selected.context));
  for (const window of periodWindows(selected).slice(0, Math.max(0, count - 2))) {
    draft = appendPeriodRecord(draft, record(window.fromBlock, window.toBlock,
      events.filter(row => BigInt(row.blockNumber) >= BigInt(window.fromBlock) && BigInt(row.blockNumber) <= BigInt(window.toBlock)), selected.context));
  }
  return draft;
}

/** Deterministic session double; no provider, global fetch, browser wallet or secret. */
export function periodSession(selected = plan(), options = {}) {
  const calls = [];
  const token = catalogToken({ agent: selected.context.agent, chainId: selected.context.chainId });
  const metadata = { name: token.name, symbol: token.symbol, decimals: token.decimals, totalSupply: token.initialSupply };
  const state = { ...selected.context, connected: true, connectionEpoch: 1, siteOrigin: "http://127.0.0.1:4193",
    canSign: false, canSendTransactions: false, canBridge: false };
  const events = options.events ?? rows(selected.context);
  const hashes = new Map();
  const latest = BigInt(selected.laterBlock) + 100n;
  async function touch(method, ...args) {
    calls.push([method, ...args]);
    if (options.before) await options.before(method, args, calls);
  }
  const session = {
    get state() { return { ...state }; },
    async getBlockSnapshot(tag) {
      await touch("block", tag);
      const number = tag === undefined ? latest : BigInt(tag);
      if (number > latest) throw Error("Synthetic unavailable block");
      return { number: "0x" + number.toString(16), hash: hashes.get(number.toString()) ?? hash(number) };
    },
    async getContractCode(address, blockHash) {
      await touch("code", address, blockHash);
      return { address, deployed: true };
    },
    async getTokenMetadata(address, blockHash) {
      await touch("metadata", address, blockHash);
      return { ...metadata };
    },
    async getNativeBalance(blockHash) {
      await touch("native", blockHash);
      return UNIT;
    },
    async getTokenBalance(address, blockHash) {
      await touch("balance", address, blockHash);
      const block = BigInt(blockHash) - 1000n;
      let balance = 100n * UNIT;
      for (const row of events) {
        if (BigInt(row.blockNumber) <= BigInt(selected.earlierBlock) || BigInt(row.blockNumber) > block) continue;
        if (row.from === state.account) balance -= BigInt(row.amountBaseUnits);
        if (row.to === state.account) balance += BigInt(row.amountBaseUnits);
      }
      return balance;
    },
    async getTransferEvents(request) {
      await touch("logs", { ...request });
      return events.filter(row => BigInt(row.blockNumber) >= BigInt(request.fromBlock) &&
        BigInt(row.blockNumber) <= BigInt(request.toBlock) &&
        row[request.direction === "incoming" ? "to" : "from"] === state.account).map(clone);
    },
  };
  return { session, state, calls, metadata, events, hashes, token };
}

export async function runFixture(options = {}, selected = plan()) {
  const f = periodSession(selected, options);
  const checkpoints = [];
  const progress = [];
  const draft = await collectPeriod(f.session, selected, {
    onCheckpoint: value => checkpoints.push(value), onProgress: value => progress.push(value),
  });
  return { ...f, draft, checkpoints, progress };
}
