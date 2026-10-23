import { TOKEN_IDENTITY_SCHEMA } from "../../src/token-identity-model.js";
import { TOKEN_CATALOG_VERSION, catalogToken } from "../../src/token-catalog.js";
import { emptyReconciliationWorkspace, validateReconciliationWorkspace } from "../../src/reconciliation-model.js";
import { addTransferArchiveRecord } from "../../src/transfer-archive.js";
import { ACCOUNT, OTHER, THIRD, hash, context, event, snapshot } from "./transfer-fixtures.js";

export { ACCOUNT, OTHER, THIRD, hash, context, event, snapshot };
export const UNIT = 10n ** 18n;
export const clone = value => JSON.parse(JSON.stringify(value));
export const bytes = text => new TextEncoder().encode(text);
export const errorCode = code => value => value?.code === code;
export const tick = () => new Promise(resolve => setTimeout(resolve, 0));

export function observation(changes = {}, selected = context()) {
  const token = catalogToken({ agent: selected.agent, chainId: selected.chainId });
  return {
    schema: TOKEN_IDENTITY_SCHEMA,
    catalogVersion: TOKEN_CATALOG_VERSION,
    ...selected,
    siteOrigin: "http://127.0.0.1:4192",
    connectionEpoch: 1,
    blockNumber: "30",
    blockHash: hash(30),
    tokenAddress: token.address,
    hasCode: true,
    metadata: { name: token.name, symbol: token.symbol, decimals: token.decimals, totalSupply: token.initialSupply },
    balanceBaseUnits: (100n * UNIT).toString(),
    nativeBalanceBaseUnits: UNIT.toString(),
    readOnly: true,
    securityAudit: false,
    ...changes,
  };
}

export function record(from = 30, to = 42, rows = [], selected = context()) {
  return snapshot({ range: { fromBlock: String(from), toBlock: String(to) },
    fromBlockHash: hash(from), toBlockHash: hash(to), events: rows }, selected);
}

export function archive(records) {
  return records.reduce((value, row) => addTransferArchiveRecord(value, row), null);
}

export function scenario(agent = "DAT", changes = {}, chainId = 8453, account = ACCOUNT) {
  const selected = context(agent, chainId, account);
  const partner = account === OTHER ? THIRD : OTHER;
  const rows = [
    event({ from: partner, to: account, amountBaseUnits: (10n * UNIT).toString(), blockNumber: "35", blockHash: hash(35) }, 1),
    event({ from: account, to: partner, amountBaseUnits: (3n * UNIT).toString(), blockNumber: "40", blockHash: hash(40) }, 2),
  ];
  return {
    agent,
    earlier: observation({}, selected),
    later: observation({ blockNumber: "42", blockHash: hash(42), balanceBaseUnits: (107n * UNIT).toString() }, selected),
    archive: archive([record(30, 42, rows, selected)]),
    ...changes,
  };
}

export function workspace(slots = [scenario()]) {
  const empty = emptyReconciliationWorkspace();
  return validateReconciliationWorkspace({ ...empty,
    slots: empty.slots.map(slot => slots.find(value => value.agent === slot.agent) ?? slot) });
}

export function previewWorkspace() {
  const dat = scenario("DAT", {}, 84532, ACCOUNT);
  const ema = scenario("EMA", {}, 84532, OTHER);
  ema.later.balanceBaseUnits = (109n * UNIT).toString();
  const cawelon = scenario("CAWELON", {}, 84532, THIRD);
  const selected = context("CAWELON", 84532, THIRD);
  cawelon.archive = archive([
    record(30, 36, [cawelon.archive.records[0].events[0]], selected),
    record(40, 42, [cawelon.archive.records[0].events[1]], selected),
  ]);
  return workspace([dat, ema, cawelon]);
}

export function fileFrom(text, name = "fixture.json") {
  const data = bytes(text);
  return { name, size: data.byteLength, arrayBuffer: async () => data.slice().buffer };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
