import { createSecurityLock } from "../../src/security-lock.js";
import { createWalletCardController } from "../../src/wallet-card-controller.js";
import { fakeClock, A, SITE, HASH } from "./security-fixtures.js";
export { fakeClock, A, SITE, HASH, deferred } from "./security-fixtures.js";
export const agents = ["DAT", "EMA", "CAWELON"];
export const flush = () => new Promise(resolve => setImmediate(resolve));

export function lockFixture(t, overrides = {}) {
  const clock = fakeClock(), stops = [], states = [];
  const lock = createSecurityLock({ ...clock.options,
    onLock: state => stops.push(state), onChange: state => states.push(state), ...overrides });
  t.after(() => lock.dispose());
  return { lock, clock, stops, states };
}

export function cardFixture(t, { agent = "DAT", hook = () => {}, override = {}, onChange = () => {} } = {}) {
  const calls = [], listeners = new Map(), oldListeners = [], sessions = [], snapshots = [];
  let card;
  const provider = {
    request() { throw Error("Synthetic session must not call a real provider"); },
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      oldListeners.push([name, fn]);
      hook("on", { name, fn, card });
      return this;
    },
    removeListener(name, fn) {
      listeners.get(name)?.delete(fn);
      hook("remove", { name, fn, card });
      return this;
    },
  };
  const createSession = options => {
    let connected = false, epoch = 0;
    const session = {
      get state() {
        hook("state", { card, session });
        return { agent, siteOrigin: SITE, chainId: 84532, account: connected ? A : null,
          connected, connectionEpoch: epoch, canSign: false, canSendTransactions: false, canBridge: false };
      },
      connect() { calls.push("connect"); connected = true; hook("connect", { card, session }); return Promise.resolve(session.state); },
      disconnect() { calls.push("disconnect"); connected = false; epoch++; return hook("disconnect", { card, session }); },
      async getBlockSnapshot() { calls.push("block"); return { number: "0x2a", hash: HASH }; },
      async getNativeBalance() { calls.push("native"); return 1n; },
      async getContractCode(address) { calls.push("code"); return { address, deployed: true }; },
      async getTokenBalance() { calls.push("balance"); return 3n; },
      async getTokenAllowance() { calls.push("allowance"); return 0n; },
      ...override,
    };
    sessions.push(session);
    hook("factory", { card, session, options });
    return session;
  };
  card = createWalletCardController({ agent, siteOrigin: SITE, createSession,
    onChange(state) { snapshots.push(state); return onChange(state, card); } });
  t.after(() => card.dispose());
  return { card, calls, listeners, oldListeners, sessions, snapshots, provider,
    connect: () => card.connect({ provider, account: A, chainId: 84532 }) };
}
