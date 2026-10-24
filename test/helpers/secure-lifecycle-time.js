/** Deterministic elapsed time; callbacks can be delivered late, early or twice. */
export function manualTime(start = 100) {
  let time = start;
  let sequence = 0;
  const pending = new Map();
  const all = new Map();
  const removed = [];
  const delays = [];
  const now = () => time;
  function schedule(fn, delay) {
    const id = ++sequence;
    const item = { fn, delay, at: time + delay };
    pending.set(id, item);
    all.set(id, item);
    delays.push(delay);
    return id;
  }
  function unschedule(id) {
    removed.push(id);
    pending.delete(id);
  }
  function fire(id, { stale = false } = {}) {
    const item = (stale ? all : pending).get(id);
    if (!item) return false;
    pending.delete(id);
    item.fn();
    return true;
  }
  function flush() {
    const due = [...pending].filter(([, item]) => item.at <= time);
    for (const [id] of due) fire(id);
    return due.length;
  }
  return {
    now, schedule, unschedule, fire, flush, removed, delays,
    options: { now, schedule, unschedule },
    set(value) { time = value; },
    advance(ms) { time += ms; },
    ids: () => [...pending.keys()],
    allIds: () => [...all.keys()],
    get value() { return time; },
    get pending() { return pending.size; },
  };
}

export function controlledSignal() {
  const listeners = new Set();
  const removed = [];
  let aborted = false;
  const signal = {
    get aborted() { return aborted; },
    addEventListener(name, callback) {
      if (name !== "abort") throw Error("wrong signal event");
      listeners.add(callback);
    },
    removeEventListener(name, callback) {
      removed.push(callback);
      listeners.delete(callback);
    },
  };
  return {
    signal, listeners, removed,
    abort({ notify = true } = {}) {
      aborted = true;
      if (notify) for (const callback of [...listeners]) callback();
    },
    notify() { for (const callback of [...listeners]) callback(); },
  };
}
export const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
