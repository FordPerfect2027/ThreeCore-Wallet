import { catalogToken } from "../../src/token-catalog.js";
import { ThreeCoreWalletSession } from "../../src/wallet-session.js";
import { TRANSFER_SCHEMA, TRANSFER_TOPIC } from "../../src/transfer-codec.js";

export const ACCOUNT = "0x" + "11".repeat(20);
export const OTHER = "0x" + "22".repeat(20);
export const THIRD = "0x" + "33".repeat(20);
export const ORIGIN = "http://127.0.0.1:4190";
export const REQUEST = Object.freeze({ fromBlock: "30", toBlock: "42", lookback: 250 });
export const clone = value => JSON.parse(JSON.stringify(value));
export const hash = value => "0x" + (BigInt(value) + 1000n).toString(16).padStart(64, "0");
export const word = value => "0x" + BigInt(value).toString(16).padStart(64, "0");
export const topic = value => "0x" + value.slice(2).padStart(64, "0");
export const code = value => error => error?.code === value;
export const tick = () => new Promise(resolve => setTimeout(resolve, 0));

export function context(agent = "DAT", chainId = 8453, account = ACCOUNT) {
  return { agent, chainId, account };
}

export function event(changes = {}, index = 0) {
  return {
    blockNumber: "40",
    blockHash: hash(40),
    transactionHash: hash(100 + index),
    transactionIndex: String(index),
    logIndex: String(index),
    from: OTHER,
    to: ACCOUNT,
    amountBaseUnits: "1234567890123456789",
    ...changes,
  };
}

export function snapshot(changes = {}, selected = context()) {
  const token = catalogToken({ agent: selected.agent, chainId: selected.chainId });
  return {
    schema: TRANSFER_SCHEMA,
    context: { ...selected },
    tokenAddress: token.address,
    metadata: { name: token.name, symbol: token.symbol, decimals: token.decimals, totalSupply: token.initialSupply },
    range: { fromBlock: "30", toBlock: "42" },
    fromBlockHash: hash(30),
    toBlockHash: hash(42),
    events: [event({ to: selected.account })],
    readOnly: true,
    completeHistory: false,
    independentVerification: false,
    ...changes,
  };
}

export function rawLog(changes = {}, row = event(), selected = context()) {
  const token = catalogToken({ agent: selected.agent, chainId: selected.chainId });
  return {
    address: token.address,
    topics: [TRANSFER_TOPIC, topic(row.from), topic(row.to)],
    data: word(row.amountBaseUnits),
    blockNumber: "0x" + BigInt(row.blockNumber).toString(16),
    blockHash: row.blockHash,
    transactionHash: row.transactionHash,
    transactionIndex: "0x" + BigInt(row.transactionIndex).toString(16),
    logIndex: "0x" + BigInt(row.logIndex).toString(16),
    removed: false,
    ...changes,
  };
}

export function readerFixture({ selected = context(), rows = [event()], override = async () => undefined } = {}) {
  const observed = snapshot({ events: rows }, selected);
  const calls = [];
  const state = { ...selected, connected: true, connectionEpoch: 1, siteOrigin: ORIGIN,
    canSign: false, canSendTransactions: false, canBridge: false };
  async function invoke(method, args, fallback) {
    calls.push({ method, args });
    const custom = await override(method, args, state);
    return custom === undefined ? fallback() : custom;
  }
  const session = {
    state,
    getBlockSnapshot(tag = "latest") {
      return invoke("block", [tag], () => {
        const number = tag === "latest" ? 42n : BigInt(tag);
        return { number: "0x" + number.toString(16), hash: hash(number) };
      });
    },
    getContractCode(address, blockHash) {
      return invoke("code", [address, blockHash], () => ({ address, deployed: true }));
    },
    getTokenMetadata(address, blockHash) {
      return invoke("metadata", [address, blockHash], () => clone(observed.metadata));
    },
    getTransferEvents(options) {
      return invoke("events", [options], () => rows.filter(row =>
        options.direction === "incoming" ? row.to === selected.account : row.from === selected.account).map(clone));
    },
  };
  return { session, state, calls, observed };
}

function abiText(value) {
  const bytes = new TextEncoder().encode(value);
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return word(32) + word(bytes.length).slice(2) + hex.padEnd(Math.ceil(bytes.length / 32) * 64, "0");
}

/** This provider does not reference browser Wallet extensions or external URLs. */
export function providerFixture({ selected = context(), rows = [event()], override = async () => undefined,
  readTimeoutMs = 1000, siteOrigin = ORIGIN } = {}) {
  const observed = snapshot({ events: rows }, selected);
  const calls = [];
  const listeners = new Map();
  const provider = {
    account: selected.account,
    chain: "0x" + selected.chainId.toString(16),
    on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeListener(name, callback) { listeners.get(name)?.delete(callback); },
    emit(name, value) { for (const callback of [...listeners.get(name) ?? []]) callback(value); },
    async request(args) {
      calls.push(args);
      const custom = await override(args, provider);
      if (custom !== undefined) return custom;
      switch (args.method) {
        case "eth_requestAccounts":
        case "eth_accounts": return [provider.account];
        case "eth_chainId": return provider.chain;
        case "eth_getCode": return "0x6000";
        case "eth_getBlockByNumber": {
          const number = args.params[0] === "latest" ? 42n : BigInt(args.params[0]);
          return { number: "0x" + number.toString(16), hash: hash(number) };
        }
        case "eth_getLogs": {
          const filter = args.params[0];
          return rows.filter(row =>
            BigInt(row.blockNumber) >= BigInt(filter.fromBlock) && BigInt(row.blockNumber) <= BigInt(filter.toBlock) &&
            (filter.topics[1] ? topic(row.from) === filter.topics[1] : topic(row.to) === filter.topics[2]))
            .map(row => rawLog({}, row, selected));
        }
        case "eth_call": {
          const data = args.params[0].data;
          if (data === "0x06fdde03") return abiText(observed.metadata.name);
          if (data === "0x95d89b41") return abiText(observed.metadata.symbol);
          if (data === "0x313ce567") return word(observed.metadata.decimals);
          if (data === "0x18160ddd") return word(observed.metadata.totalSupply);
          throw Error("Unexpected read selector");
        }
        default: throw Error("Forbidden synthetic provider method: " + args.method);
      }
    },
  };
  const session = new ThreeCoreWalletSession({ provider, agent: selected.agent, chainId: selected.chainId,
    expectedAccount: selected.account, siteOrigin, approvedOrigins: [siteOrigin], readTimeoutMs });
  return { provider, session, calls, listeners, observed };
}

export function fileFromText(text, changes = {}) {
  const bytes = new TextEncoder().encode(text);
  return { name: "transfers.json", size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer, ...changes };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
