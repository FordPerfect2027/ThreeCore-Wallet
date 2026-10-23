import { ThreeCoreWalletSession } from "../../src/wallet-session.js";
import { catalogToken } from "../../src/token-catalog.js";
import { TRANSFER_TOPIC, addressTopic } from "../../src/transfer-codec.js";
import { abiText, word } from "./identity-fixtures.js";
import { plan, rows, hash, UNIT, clone } from "./period-fixtures.js";

/** EIP-1193 fixture for testing the real session adapter, not a mocked collector. */
export function periodProvider(selected = plan(), options = {}) {
  const calls = [];
  const listeners = new Map();
  const token = catalogToken({ agent: selected.context.agent, chainId: selected.context.chainId });
  const events = options.events ?? rows(selected.context);
  const provider = {
    account: selected.context.account,
    chain: "0x" + selected.context.chainId.toString(16),
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeListener(name, listener) { listeners.get(name)?.delete(listener); },
    emit(name, value) { for (const listener of [...listeners.get(name) ?? []]) listener(value); },
    async request(input) {
      calls.push(clone(input));
      if (options.before) {
        const override = await options.before(input, provider);
        if (override !== undefined) return override;
      }
      const { method, params } = input;
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [provider.account];
      if (method === "eth_chainId") return provider.chain;
      if (method === "eth_getBlockByNumber") {
        const number = params[0] === "latest" ? BigInt(selected.laterBlock) + 100n : BigInt(params[0]);
        return { number: "0x" + number.toString(16), hash: hash(number) };
      }
      if (method === "eth_getCode") return "0x6000";
      if (method === "eth_getBalance") return "0x" + UNIT.toString(16);
      if (method === "eth_call") {
        const data = params[0].data;
        if (data === "0x06fdde03") return abiText(token.name);
        if (data === "0x95d89b41") return abiText(token.symbol);
        if (data === "0x313ce567") return word(token.decimals);
        if (data === "0x18160ddd") return word(token.initialSupply);
        if (data.startsWith("0x70a08231")) {
          const block = BigInt(params[1].blockHash) - 1000n;
          let balance = 100n * UNIT;
          for (const event of events) {
            if (BigInt(event.blockNumber) <= BigInt(selected.earlierBlock) || BigInt(event.blockNumber) > block) continue;
            if (event.from === selected.context.account) balance -= BigInt(event.amountBaseUnits);
            if (event.to === selected.context.account) balance += BigInt(event.amountBaseUnits);
          }
          return word(balance);
        }
        throw Error("Unexpected contract selector");
      }
      if (method === "eth_getLogs") {
        const filter = params[0];
        if (filter.address !== token.address || filter.topics[0] !== TRANSFER_TOPIC) throw Error("Wrong token query");
        const hex = value => "0x" + BigInt(value).toString(16);
        return events.filter(event =>
          BigInt(event.blockNumber) >= BigInt(filter.fromBlock) && BigInt(event.blockNumber) <= BigInt(filter.toBlock) &&
          (filter.topics[1] === null || filter.topics[1] === addressTopic(event.from)) &&
          (filter.topics[2] === null || filter.topics[2] === undefined || filter.topics[2] === addressTopic(event.to)))
          .map(event => ({ address: token.address, topics: [TRANSFER_TOPIC, addressTopic(event.from), addressTopic(event.to)],
            data: word(event.amountBaseUnits), blockNumber: hex(event.blockNumber), blockHash: event.blockHash,
            transactionHash: event.transactionHash, transactionIndex: hex(event.transactionIndex),
            logIndex: hex(event.logIndex), removed: false }));
      }
      throw Error("Forbidden RPC in period fixture: " + method);
    },
  };
  const origin = "http://127.0.0.1:4193";
  const session = new ThreeCoreWalletSession({ provider,
    agent: selected.context.agent, expectedAccount: selected.context.account, chainId: selected.context.chainId,
    siteOrigin: origin, approvedOrigins: [origin], readTimeoutMs: options.readTimeoutMs ?? 1000 });
  return { session, provider, calls, listeners, origin, token, events };
}
