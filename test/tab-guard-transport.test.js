import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserTabTransport } from "../src/tab-guard-transport.js";
import { TAB_GUARD_CHANNEL } from "../src/tab-guard-protocol.js";
import { signal } from "./helpers/tab-guard-fixtures.js";

function fixture(options = {}) {
  const instances = [], received = [], faults = [];
  class Channel {
    constructor(name) { this.name = name; this.listeners = new Map(); this.posts = []; this.closed = 0; instances.push(this); }
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(callback);
    }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
    postMessage(value) { this.posts.push(structuredClone(value)); }
    close() { this.closed++; }
    emit(name, data) { for (const callback of [...this.listeners.get(name) ?? []]) callback({ data }); }
  }
  const host = { isSecureContext: true, location: { origin: "http://127.0.0.1:4201" }, BroadcastChannel: Channel };
  const transport = createBrowserTabTransport({ host, ...options });
  return { host, Channel, instances, received, faults, transport,
    start: () => transport.subscribe(value => received.push(value), () => faults.push(true)) };
}

test("transport is lazy and opens only the fixed notification namespace", () => {
  const f = fixture();
  assert.equal(f.instances.length, 0);
  f.start();
  assert.equal(f.instances.length, 1);
  assert.equal(f.instances[0].name, TAB_GUARD_CHANNEL);
  assert.equal(f.instances[0].posts.length, 0);
  f.transport.close();
});

test("transport only exposes subscribe, post and close capabilities", () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.transport), ["subscribe", "post", "close"]);
  assert(Object.isFrozen(f.transport));
  f.transport.close();
});

test("post copies validated data and never forwards arbitrary additional fields", () => {
  const f = fixture(); f.start();
  const original = signal();
  f.transport.post(original); original.source = "changed";
  assert.notEqual(f.instances[0].posts[0].source, original.source);
  assert.throws(() => f.transport.post(signal({ password: "secret" })));
  assert.equal(f.instances[0].posts.length, 1);
  f.transport.close();
});

test("message delivery and messageerror remain separate callbacks", () => {
  const f = fixture(); f.start();
  f.instances[0].emit("message", signal());
  f.instances[0].emit("messageerror");
  assert.equal(f.received.length, 1);
  assert.equal(f.faults.length, 1);
  f.transport.close();
});

test("closing removes both listeners and closes native channel exactly once", () => {
  const f = fixture(); f.start();
  const channel = f.instances[0];
  f.transport.close(); f.transport.close();
  assert.equal(channel.closed, 1);
  assert.equal(channel.listeners.get("message").size, 0);
  assert.equal(channel.listeners.get("messageerror").size, 0);
  channel.emit("message", signal()); channel.emit("messageerror");
  assert.deepEqual(f.received, []);
  assert.deepEqual(f.faults, []);
});

test("previously captured native listeners become inert after close", () => {
  const f = fixture(); f.start();
  const message = [...f.instances[0].listeners.get("message")][0];
  const error = [...f.instances[0].listeners.get("messageerror")][0];
  f.transport.close(); message({ data: signal() }); error();
  assert.equal(f.received.length, 0);
  assert.equal(f.faults.length, 0);
});

test("captured methods retain their original receiver despite later replacements", () => {
  const f = fixture(); f.start();
  const channel = f.instances[0];
  channel.postMessage = channel.removeEventListener = channel.close = () => { throw Error("replaced"); };
  f.transport.post(signal());
  assert.equal(channel.posts.length, 1);
  f.transport.close();
  assert.equal(channel.closed, 1);
  assert.equal(channel.listeners.get("message").size, 0);
});

test("native post errors have a static outward error", () => {
  const f = fixture();
  f.Channel.prototype.postMessage = () => { throw Error("private channel detail"); };
  f.start();
  assert.throws(() => f.transport.post(signal()), { code: "TAB_TRANSPORT", message: "TAB_TRANSPORT" });
  f.transport.close();
});

test("a failing event data accessor is not interpreted as a command", () => {
  const f = fixture(); f.start();
  const listener = [...f.instances[0].listeners.get("message")][0];
  const event = { get data() { throw Error("private event"); } };
  listener(event);
  assert.equal(f.received.length, 0);
  assert.equal(f.faults.length, 1);
  f.transport.close();
});

for (const origin of ["https://wallet.example", "https://wallet.example:8443", "http://localhost:4201",
  "http://127.0.0.1:4201", "http://[::1]:4201"]) {
  test("secure or exact loopback origins are allowed: " + origin, () => {
    const f = fixture(); f.host.location.origin = origin;
    assert(f.start());
    f.transport.close();
  });
}

for (const origin of ["http://wallet.example", "http://localhost.evil:4201", "http://127.0.0.2:4201",
  "http://localhost:4201/", "file:///tmp/wallet", "null", "data:text/html,test", "about:blank",
  "https://a:b@wallet.example", "https://wallet.example/path", "https://wallet.example#hash", ""]) {
  test("unacceptable origin has no storage or network fallback: " + origin, () => {
    const f = fixture(); f.host.location.origin = origin;
    assert.throws(() => f.start());
    assert.equal(f.instances.length, 0);
    assert.equal(f.received.length, 0);
    f.transport.close();
  });
}

for (const value of [false, undefined, null, 1, "true"]) {
  test("secure context requires the browser boolean: " + value, () => {
    const f = fixture(); f.host.isSecureContext = value;
    assert.throws(() => f.start(), { code: "TAB_UNAVAILABLE" });
    assert.equal(f.instances.length, 0);
  });
}

test("missing host and missing API are a supported unavailable state", () => {
  const transport = createBrowserTabTransport();
  assert.throws(() => transport.subscribe(() => {}, () => {}), { code: "TAB_UNAVAILABLE" });
  const f = fixture(); delete f.host.BroadcastChannel;
  assert.throws(() => f.start(), { code: "TAB_UNAVAILABLE" });
});

test("constructor failure closes the adapter without exposing hostile error properties", () => {
  let touched = 0;
  const f = fixture();
  f.host.BroadcastChannel = class {
    constructor() { throw { get code() { touched++; throw Error("secret"); } }; }
  };
  assert.throws(() => f.start(), { code: "TAB_TRANSPORT" });
  assert.equal(touched, 0);
  assert.throws(() => f.start(), { code: "TAB_CLOSED" });
});

test("partial listener registration is cleaned up if the second listener fails", () => {
  const f = fixture();
  const original = f.Channel.prototype.addEventListener;
  f.Channel.prototype.addEventListener = function(name, callback) {
    if (name === "messageerror") throw Error("listener unavailable");
    original.call(this, name, callback);
  };
  assert.throws(() => f.start(), { code: "TAB_TRANSPORT" });
  assert.equal(f.instances[0].closed, 1);
  assert.equal(f.instances[0].listeners.get("message").size, 0);
});

test("cleanup continues even if removing one listener fails", () => {
  const f = fixture();
  f.Channel.prototype.removeEventListener = () => { throw Error("remove failed"); };
  f.start(); f.transport.close();
  assert.equal(f.instances[0].closed, 1);
  f.instances[0].emit("message", signal());
  assert.equal(f.received.length, 0);
});

test("repeated subscriptions and send-before-open are refused", () => {
  const f = fixture();
  assert.throws(() => f.transport.post(signal()), { code: "TAB_CLOSED" });
  f.start(); assert.throws(() => f.start(), { code: "TAB_CLOSED" });
  f.transport.close();
  assert.throws(() => f.transport.post(signal()), { code: "TAB_CLOSED" });
});

test("dispose-before-start never constructs a channel", () => {
  const f = fixture(); f.transport.close();
  assert.throws(() => f.start(), { code: "TAB_CLOSED" });
  assert.equal(f.instances.length, 0);
});

for (const name of ["", "wallet", "threecore-", "threecore-FOO", "threecore-../x",
  "threecore-" + "x".repeat(101), null, 1, {}]) {
  test("invalid transport namespace refused: " + String(name), () => {
    assert.throws(() => fixture({ name }), { code: "TAB_CONFIG" });
  });
}

test("a test-only distinct channel name is bounded and never inferred from wallet data", () => {
  const f = fixture({ name: "threecore-test-stop-123" }); f.start();
  assert.equal(f.instances[0].name, "threecore-test-stop-123");
  f.transport.close();
});
