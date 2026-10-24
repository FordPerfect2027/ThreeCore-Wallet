import { ThreeCoreWalletSession } from "../../src/wallet-session.js";
import { catalogToken } from "../../src/token-catalog.js";

export const A = "0x" + "11".repeat(20);
export const B = "0x" + "22".repeat(20);
export const HASH = "0x" + "ab".repeat(32);
export const WORD = "0x" + "0".repeat(63) + "1";
export const SITE = "http://127.0.0.1:4198";
export const wordAddress = value => value.slice(2).padStart(64, "0");
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}

export function fakeClock() {
  let current = 0, nextId = 0;
  const timers = new Map(), all = new Map();
  const options = {
    now: () => current,
    schedule(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, at: current + delay });
      all.set(id, callback);
      return id;
    },
    unschedule(id) { timers.delete(id); },
  };
  return {
    options,
    advance(ms, run = true) {
      current += ms;
      if (run) for (const [id, timer] of [...timers]) {
        if (timer.at <= current) { timers.delete(id); timer.callback(); }
      }
    },
    set(value) { current = value; },
    timers: () => [...timers.keys()],
    invokeOld(id) { all.get(id)?.(); },
  };
}

export function providerFixture(override = () => undefined, sessionOptions = {}) {
  const calls = [], listeners = new Map();
  const provider = {
    async request(args) {
      calls.push(args);
      const custom = override(args);
      if (custom !== undefined) return custom;
      if (args.method === "eth_chainId") return "0x14a34";
      if (["eth_accounts", "eth_requestAccounts"].includes(args.method)) return [A];
      if (args.method === "eth_getBlockByNumber") return { number: "0x2a", hash: HASH };
      if (args.method === "eth_getBalance") return "0x1";
      if (args.method === "eth_getCode") return "0x6000";
      if (args.method === "eth_call") return WORD;
      if (args.method === "eth_getLogs") return [];
      throw Error("Unexpected fixture method");
    },
    on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeListener(name, callback) { listeners.get(name)?.delete(callback); },
    emit(name, value) { for (const callback of listeners.get(name) ?? []) callback(value); },
  };
  const wallet = new ThreeCoreWalletSession({ provider, agent: "DAT", expectedAccount: A,
    chainId: 84532, siteOrigin: SITE, approvedOrigins: [SITE], ...sessionOptions });
  return { provider, wallet, calls, listeners, token: catalogToken({ agent: "DAT", chainId: 84532 }).address };
}
