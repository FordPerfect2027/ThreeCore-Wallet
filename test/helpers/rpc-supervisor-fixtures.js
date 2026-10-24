import { createRpcSupervisor } from "../../src/rpc-supervisor.js";

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function drain() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
export function clockFixture() {
  let time = 1000;
  let sequence = 0;
  const timers = new Map();
  const history = new Map();
  const options = {
    now: () => time,
    schedule(fn, delay) {
      const id = ++sequence;
      timers.set(id, { fn, due: time + delay, delay });
      history.set(id, fn);
      return id;
    },
    unschedule(id) { timers.delete(id); },
  };
  return {
    options,
    now: () => time,
    set(value) { time = value; },
    advance(value) { time += value; },
    run() {
      for (const [id, timer] of [...timers]) {
        if (timer.due <= time) { timers.delete(id); timer.fn(); }
      }
    },
    fire(id) {
      timers.delete(id);
      history.get(id)?.();
    },
    timers: () => [...timers].map(([id, item]) => ({ id, ...item })),
  };
}
export function fixture(overrides = {}) {
  const clock = clockFixture();
  const supervisor = createRpcSupervisor({ ...clock.options, ...overrides });
  const provider = {};
  const requests = [];
  function pending(options = {}) {
    const result = deferred();
    let calls = 0;
    const operation = supervisor.start({ provider, timeoutMs: 100,
      invoke() { calls++; return result.promise; }, ...options });
    const outcome = operation.promise.then(value => ({ ok: true, value }),
      error => ({ ok: false, code: error.code, error }));
    const record = { ...operation, result, outcome, calls: () => calls };
    requests.push(record);
    return record;
  }
  async function cleanup() {
    supervisor.dispose();
    for (const item of requests) item.result.resolve("discarded fixture response");
    await drain();
  }
  return { clock, supervisor, provider, pending, requests, cleanup };
}
export function status(overrides = {}) {
  const supervisor = createRpcSupervisor();
  const state = { ...supervisor.state(), ...overrides };
  supervisor.dispose();
  return state;
}
