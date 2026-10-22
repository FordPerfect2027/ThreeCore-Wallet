import { ThreeCoreWalletSession } from "../../src/wallet-session.js";
import { catalogToken } from "../../src/token-catalog.js";
import { TOKEN_IDENTITY_SCHEMA } from "../../src/token-identity-model.js";
import { prepareTokenIdentityFile } from "../../src/token-identity-report.js";

export const ACCOUNT = "0x" + "11".repeat(20);
export const OTHER = "0x" + "22".repeat(20);
export const HASH = "0x" + "ab".repeat(32);
export const ORIGIN = "http://127.0.0.1:4188";
export const clone = value => JSON.parse(JSON.stringify(value));
export const word = value => "0x" + BigInt(value).toString(16).padStart(64, "0");
export const code = value => error => error?.code === value;
export const tick = () => new Promise(resolve => setImmediate(resolve));

export function abiText(text) {
  const bytes = new TextEncoder().encode(text);
  const data = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return word(32) + word(bytes.length).slice(2) + data.padEnd(Math.ceil(bytes.length / 32) * 64, "0");
}

export function observation(changes = {}, agent = "DAT", chainId = 8453) {
  const token = catalogToken({ agent, chainId });
  return {
    schema: TOKEN_IDENTITY_SCHEMA,
    catalogVersion: token.catalogVersion,
    agent,
    account: ACCOUNT,
    chainId,
    siteOrigin: ORIGIN,
    connectionEpoch: 1,
    blockNumber: "42",
    blockHash: HASH,
    tokenAddress: token.address,
    hasCode: true,
    metadata: { name: token.name, symbol: token.symbol, decimals: token.decimals, totalSupply: token.initialSupply },
    balanceBaseUnits: "1234567890123456789",
    nativeBalanceBaseUnits: "9007199254740993123",
    readOnly: true,
    securityAudit: false,
    ...changes,
  };
}

export function readerSession(changes = {}, agent = "DAT", chainId = 8453) {
  const row = observation(changes, agent, chainId);
  const calls = [];
  const state = {
    agent, chainId, account: row.account, siteOrigin: row.siteOrigin,
    connectionEpoch: row.connectionEpoch, connected: true,
    canSign: false, canSendTransactions: false, canBridge: false,
  };
  const session = {
    state,
    async getBlockSnapshot(tag = "latest") {
      calls.push(["block", tag]);
      return { number: "0x" + BigInt(row.blockNumber).toString(16), hash: row.blockHash };
    },
    async getContractCode(address, hash) {
      calls.push(["code", address, hash]);
      return { address, deployed: row.hasCode };
    },
    async getNativeBalance(hash) {
      calls.push(["native", hash]);
      return BigInt(row.nativeBalanceBaseUnits);
    },
    async getTokenMetadata(address, hash) {
      calls.push(["metadata", address, hash]);
      return clone(row.metadata);
    },
    async getTokenBalance(address, hash) {
      calls.push(["balance", address, hash]);
      return BigInt(row.balanceBaseUnits);
    },
  };
  return { row, session, calls, state };
}

export function providerFixture({ agent = "DAT", chainId = 8453, override = async () => undefined,
  readTimeoutMs = 1000 } = {}) {
  const row = observation({}, agent, chainId);
  const listeners = new Map();
  const calls = [];
  const provider = {
    account: ACCOUNT,
    chain: "0x" + chainId.toString(16),
    on(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeListener(name, handler) { listeners.get(name)?.delete(handler); },
    emit(name, data) { for (const handler of [...listeners.get(name) ?? []]) handler(data); },
    async request(args) {
      calls.push(args);
      const custom = await override(args, provider);
      if (custom !== undefined) return custom;
      switch (args.method) {
        case "eth_requestAccounts":
        case "eth_accounts": return [provider.account];
        case "eth_chainId": return provider.chain;
        case "eth_getBlockByNumber": return { number: "0x2a", hash: HASH };
        case "eth_getCode": return "0x6000";
        case "eth_getBalance": return "0x" + BigInt(row.nativeBalanceBaseUnits).toString(16);
        case "eth_call": {
          const selector = args.params[0].data;
          if (selector === "0x06fdde03") return abiText(row.metadata.name);
          if (selector === "0x95d89b41") return abiText(row.metadata.symbol);
          if (selector === "0x313ce567") return word(row.metadata.decimals);
          if (selector === "0x18160ddd") return word(row.metadata.totalSupply);
          if (selector.startsWith("0x70a08231")) return word(row.balanceBaseUnits);
          throw Error("Unexpected ABI selector: " + selector);
        }
        default: throw Error("Unexpected RPC: " + args.method);
      }
    },
  };
  const session = new ThreeCoreWalletSession({ provider, agent, chainId,
    siteOrigin: ORIGIN, approvedOrigins: [ORIGIN], expectedAccount: ACCOUNT, readTimeoutMs });
  return { row, provider, session, calls, listeners };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function fileFor(row = observation(), changes = {}) {
  const prepared = await prepareTokenIdentityFile(row);
  const bytes = new TextEncoder().encode(prepared.text);
  return { name: prepared.filename, size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer, ...changes };
}
