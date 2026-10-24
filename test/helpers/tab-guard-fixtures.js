import { createTabGuard } from "../../src/tab-guard-controller.js";
import { createStopSignal, createStopReceipt } from "../../src/tab-guard-protocol.js";

export const EPOCH = 1780000000000;
export const ID_A = "11".repeat(16);
export const ID_B = "22".repeat(16);
export const ID_C = "33".repeat(16);
export const ID_D = "44".repeat(16);
export const idFor = value => value.toString(16).padStart(32, "0");
export const signal = (overrides = {}) => ({ ...createStopSignal(ID_B, ID_C, EPOCH), ...overrides });
export function clockFixture() {
  let time = EPOCH, id = 0;
  const pending = new Map(), history = new Map();
  const options = {
    now: () => time,
    schedule(callback, delay) {
      const key = ++id;
      pending.set(key, { callback, at: time + delay });
      history.set(key, callback);
      return key;
    },
    unschedule(key) { pending.delete(key); },
  };
  return { options, now: options.now, set: value => { time = value; },
    advance(ms, run = true) {
      time += ms;
      if (run) for (const [key, item] of [...pending]) {
        if (item.at <= time) { pending.delete(key); item.callback(); }
      }
    },
    pending: () => [...pending.keys()],
    invoke: key => history.get(key)?.(),
  };
}
export function deterministicCrypto(seed = 0) {
  let sequence = seed;
  return { getRandomValues(bytes) {
    sequence++;
    bytes.fill(0);
    new DataView(bytes.buffer).setUint32(bytes.length - 4, sequence);
    return bytes;
  } };
}
export function transportFixture(overrides = {}) {
  let receive, fault, closed = false;
  const posts = [], calls = [];
  const transport = {
    subscribe(message, error) { calls.push("subscribe"); receive = message; fault = error; return true; },
    post(value) { calls.push("post"); posts.push(structuredClone(value)); return true; },
    close() { calls.push("close"); closed = true; },
    ...overrides,
  };
  return { transport, posts, calls, deliver: value => receive?.(value),
    error: () => fault?.(), closed: () => closed };
}
export function guardFixture(options = {}) {
  const clock = clockFixture(), wire = transportFixture(), stops = [], changes = [];
  const guard = createTabGuard({ transport: wire.transport, crypto: deterministicCrypto(),
    ...clock.options, onStop: reason => { stops.push(reason); return true; },
    onChange: value => changes.push(value), ...options });
  return { clock, wire, stops, changes, guard,
    receipt(peer = ID_B, overrides = {}) {
      const original = wire.posts.find(value => value.kind === "stop");
      wire.deliver({ ...createStopReceipt(original, peer), ...overrides });
    } };
}
/** Deterministic queued delivery retains native BroadcastChannel's asynchronous ordering. */
export function hubFixture() {
  const endpoints = new Set(), queue = [], traffic = [];
  function endpoint() {
    const peer = { receive: null, fault: null, closed: false };
    endpoints.add(peer);
    return {
      subscribe(receive, fault) { peer.receive = receive; peer.fault = fault; return true; },
      post(value) {
        if (peer.closed) throw Error("closed");
        traffic.push(structuredClone(value));
        for (const target of endpoints) if (target !== peer && !target.closed) {
          queue.push(() => { if (!target.closed) target.receive?.(structuredClone(value)); });
        }
        return true;
      },
      close() { peer.closed = true; },
    };
  }
  return { endpoint, traffic, pending: () => queue.length,
    flush(limit = 1000) {
      let count = 0;
      while (queue.length) {
        if (++count > limit) throw Error("Unexpected notification loop");
        queue.shift()();
      }
    },
    once() { queue.shift()?.(); },
  };
}
