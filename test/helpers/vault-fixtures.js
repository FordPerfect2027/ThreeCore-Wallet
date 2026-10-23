import { VAULT_AGENTS, vaultBundle, emptyVaultDocument, mutateVaultDocument, validateVaultDocument } from "../../src/transfer-vault-model.js";
import { addTransferArchiveRecord } from "../../src/transfer-archive.js";
import { createVaultController } from "../../src/transfer-vault-controller.js";
import { ACCOUNT, OTHER, THIRD, context, snapshot, event, hash, clone } from "./transfer-fixtures.js";

export const TIME = "2026-10-23T15:00:00.000Z";
export const id = n => "10000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const accounts = [ACCOUNT, OTHER, THIRD];

export function archiveFor(agent = "DAT", { account = accounts[VAULT_AGENTS.indexOf(agent)], chainId = 8453,
  start = 30, end = 42, count = 1, amount = "1000000000000000001" } = {}) {
  const selected = context(agent, chainId, account);
  const rows = Array.from({ length: count }, (_, index) => event({ blockNumber: String(end), blockHash: hash(end),
    transactionHash: hash(BigInt(end) * 1000n + BigInt(index)), to: account,
    from: account === ACCOUNT ? OTHER : ACCOUNT, amountBaseUnits: amount }, index));
  return addTransferArchiveRecord(null, snapshot({ range: { fromBlock: String(start), toBlock: String(end) },
    fromBlockHash: hash(start), toBlockHash: hash(end), events: rows }, selected));
}

export function bundleFor(agents = VAULT_AGENTS, options = {}) {
  return vaultBundle(VAULT_AGENTS.map(agent => agents.includes(agent) ? archiveFor(agent, options) : null));
}

export function saveOperation(bundle = bundleFor(), n = 1, label = "Local history") {
  return { kind: "save", id: id(n), label, time: TIME, bundle };
}

/** Synchronous CAS models storage policy; native IndexedDB is exercised in-browser. */
export function memoryVault(initial = emptyVaultDocument(), { beforeRead, beforeChange } = {}) {
  let value = validateVaultDocument(initial), closed = false;
  const calls = [];
  return {
    calls,
    get value() { return value; },
    replace(next) { value = validateVaultDocument(next); },
    async read() {
      calls.push({ method: "read" });
      if (beforeRead) await beforeRead();
      if (closed) throw Object.assign(Error(), { code: "CHECKPOINT_CLOSED" });
      return value;
    },
    async change(expected, operation, options = {}) {
      calls.push({ method: "change", expected, operation, options });
      if (beforeChange) await beforeChange();
      if (closed || options.signal?.aborted || options.canCommit?.() === false) {
        throw Object.assign(Error(), { code: "CHECKPOINT_CANCELLED" });
      }
      value = mutateVaultDocument(value, expected, operation);
      return value;
    },
    close() { closed = true; calls.push({ method: "close" }); },
  };
}

export function controllerFixture(options = {}) {
  const storage = options.storage ?? memoryVault();
  let cards = bundleFor(), counter = 0;
  const states = [], staged = [];
  const controller = createVaultController({ storage, readCards: () => cards,
    stageArchive: async (...args) => { staged.push(args); return true; },
    now: () => TIME, createId: () => id(++counter), onChange: state => states.push(state), ...options });
  return { controller, storage, states, staged,
    setCards(value) { cards = value; },
    async capture(merge = false) {
      if (!controller.capture(merge)) throw Error(controller.state.error);
      if (!await controller.apply(controller.state.review.id, { acknowledgeRemoval: true })) throw Error(controller.state.error);
    },
    async save(label = "Local history") {
      await controller.refresh();
      if (!await controller.save(label)) throw Error(controller.state.error);
    },
  };
}

export function corruptBundle(change) {
  const copy = clone(bundleFor());
  change(copy);
  return copy;
}
