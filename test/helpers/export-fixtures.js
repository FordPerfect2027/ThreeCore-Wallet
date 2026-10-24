import { createExportGuard } from "../../src/export-guard.js";
import { Element } from "./panel-dom.js";

export const ORIGIN = "http://127.0.0.1:4204";
export const PRIVATE = "synthetic-private-export-canary";
export const prepared = (changes = {}) => ({
  text: '{"example":true}',
  filename: "ThreeCore-DAT-20261024.json",
  mimeType: "application/json;charset=utf-8",
  ...changes,
});

/** Deterministic clock that also retains cancelled callbacks for stale tests. */
export function clockFixture() {
  let time = 0, next = 0;
  const timers = new Map(), cancelled = [], installed = [];
  return {
    timers, cancelled, installed,
    now: () => time,
    set(value) { time = value; },
    advance(value) { time += value; },
    schedule(fn, delay) {
      const id = ++next;
      const item = { id, fn, delay, due: time + delay };
      timers.set(id, item);
      installed.push(item);
      return id;
    },
    unschedule(id) {
      const item = timers.get(id);
      if (item) cancelled.push(item);
      timers.delete(id);
    },
    fire(id = [...timers.keys()][0]) {
      const item = timers.get(id);
      if (!item) throw Error("Missing synthetic timer");
      timers.delete(id);
      item.fn();
    },
    due() {
      for (const [id, item] of [...timers]) if (item.due <= time) this.fire(id);
    },
  };
}

/** No native files, network, wallets, URLs or timers are used by this fixture. */
export function guardFixture(options = {}) {
  const clock = clockFixture(), resources = [], events = [];
  let factory = options.createResource;
  const guard = createExportGuard({
    now: clock.now,
    schedule: clock.schedule,
    unschedule: clock.unschedule,
    ...options,
    createResource(payload, current) {
      if (factory) return factory(payload, current);
      const item = { payload, current, activations: 0, releases: 0, live: false };
      resources.push(item);
      return {
        activate() {
          events.push("activate");
          item.activations++;
          item.live = true;
        },
        release() {
          events.push("release");
          item.releases++;
          item.live = false;
          return true;
        },
      };
    },
  });
  return {
    guard, clock, resources, events,
    factory(value) { factory = value; },
    offer(value = prepared()) { return guard.offer(value); },
    expire() { clock.advance(1000); clock.due(); },
  };
}

/** Hostile browser surface with an observable fault point at each allocation. */
export function browserFixture() {
  const clock = clockFixture(), events = [], anchors = [], blobs = [];
  const liveURLs = new Set(), revoked = [], hooks = new Map();
  const listeners = new Map();
  let serial = 0;
  function run(stage, value) {
    events.push(stage);
    const hook = hooks.get(stage);
    return hook ? hook(value) : undefined;
  }
  class SyntheticBlob extends Blob {
    constructor(parts, options) {
      run("blob", { parts, options });
      super(parts, options);
      blobs.push(this);
    }
  }
  const body = new Element("body");
  const originalAppend = body.append.bind(body);
  body.append = anchor => {
    run("append", anchor);
    originalAppend(anchor);
    return run("after-append", anchor);
  };
  const view = {
    Blob: SyntheticBlob,
    URL: {
      createObjectURL(blob) {
        run("url", blob);
        const url = `blob:${ORIGIN}/synthetic-${++serial}`;
        liveURLs.add(url);
        run("after-url", url);
        return url;
      },
      revokeObjectURL(url) {
        run("revoke", url);
        liveURLs.delete(url);
        revoked.push(url);
        return run("after-revoke", url);
      },
    },
    performance: { now: clock.now },
    setTimeout: clock.schedule,
    clearTimeout: clock.unschedule,
    addEventListener(type, fn) {
      run("listen-" + type, fn);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };
  const document = {
    location: { href: ORIGIN + "/" },
    body, defaultView: view,
    createElement(tag) {
      run("element", tag);
      const anchor = new Element(tag);
      anchor.dataset = {};
      if (tag === "a") {
        const values = {};
        for (const name of ["hidden", "rel", "referrerPolicy", "download", "href"]) {
          Object.defineProperty(anchor, name, {
            configurable: true,
            get() { return values[name]; },
            set(value) { run(name, value); values[name] = value; },
          });
        }
        const remove = anchor.remove.bind(anchor);
        anchor.remove = () => {
          run("remove", anchor);
          remove();
          return run("after-remove", anchor);
        };
        anchor.click = () => run("click", anchor);
        anchors.push(anchor);
      }
      return anchor;
    },
  };
  return {
    document, view, body, clock, events, anchors, blobs, hooks, liveURLs, revoked, listeners,
    throwAt(stage) { hooks.set(stage, () => { throw Error(PRIVATE); }); },
    dispatch(type) { for (const fn of [...listeners.get(type) ?? []]) fn(new Event(type)); },
  };
}

export function assertPrivate(assert, value) {
  const text = JSON.stringify(value);
  for (const forbidden of [PRIVATE, "ThreeCore-DAT-20261024", "blob:", "example", "0x1234"]) {
    assert.equal(text.includes(forbidden), false, "diagnostic leaked " + forbidden);
  }
}
