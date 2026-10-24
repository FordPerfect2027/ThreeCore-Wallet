import test from "node:test";
import assert from "node:assert/strict";
import { validateRpcStatus, describeRpcStatus } from "../src/rpc-status.js";
import { status } from "./helpers/rpc-supervisor-fixtures.js";
import { mountRpcStatusPanel } from "../examples/rpc-status-panel.js";
import { Element } from "./helpers/panel-dom.js";

test("valid request diagnostic snapshot is copied and frozen", () => {
  const input = status();
  const result = validateRpcStatus(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert(Object.isFrozen(result));
  input.pending = 900;
  assert.equal(result.pending, 0);
});
for (const input of [null, undefined, 1, true, "private", [], () => {}]) {
  test("non-record status rejected without echo: " + typeof input, () => {
    assert.equal(validateRpcStatus(input), null);
    assert.equal(describeRpcStatus(input).level, "unavailable");
    assert(!JSON.stringify(describeRpcStatus(input)).includes("private"));
  });
}
for (const key of Object.keys(status())) {
  test("every diagnostic field must be present as own data: " + key, () => {
    const missing = status(); delete missing[key];
    assert.equal(validateRpcStatus(missing), null);
    let reads = 0;
    const accessor = status();
    Object.defineProperty(accessor, key, { get() { reads++; return status()[key]; } });
    assert.equal(validateRpcStatus(accessor), null);
    assert.equal(reads, 0);
  });
}
for (const key of ["account", "balance", "request", "payload", "error", "__proto__", Symbol("data")]) {
  test("unknown diagnostic field refused: " + String(key), () => {
    const input = status();
    Object.defineProperty(input, key, { value: "private" });
    assert.equal(validateRpcStatus(input), null);
    assert(!JSON.stringify(describeRpcStatus(input)).includes("private"));
  });
}
for (const field of ["pending", "waiting", "abandoned", "occupiedProviders", "started",
  "completed", "failed", "timedOut", "cancelled", "denied", "late"]) {
  for (const value of [-1, 0.5, 1_000_000_001, Infinity, NaN, "1"]) {
    test("bounded integer diagnostic " + field + " rejects " + String(value), () => {
      assert.equal(validateRpcStatus(status({ [field]: value })), null);
    });
  }
}
for (const patch of [
  { pending: 1 }, { waiting: 1 }, { abandoned: 1 }, { occupiedProviders: 1 },
  { pending: 2, waiting: 1, occupiedProviders: 1 },
  { pending: 1, waiting: 1, occupiedProviders: 2 },
  { pending: 1, waiting: 1 },
  { pending: 97, waiting: 97, occupiedProviders: 4 },
  { perProvider: 0 }, { perProvider: 33 }, { perPage: 97 }, { perPage: 31 },
  { schema: "future" }, { fault: "secret" }, { fault: "RPC_CLOCK" },
  { disposed: true }, { disposed: 1 }, { canStart: false }, { canStart: 1 },
]) {
  test("inconsistent diagnostic snapshot rejected " + JSON.stringify(patch), () => {
    assert.equal(validateRpcStatus(status(patch)), null);
  });
}
test("null-prototype snapshots are supported without inherited fields", () => {
  const input = Object.assign(Object.create(null), status());
  assert(validateRpcStatus(input));
  assert.equal(validateRpcStatus(Object.create(status())), null);
});
test("throwing snapshot proxy cannot escape the diagnostic boundary", () => {
  for (const trap of ["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"]) {
    const input = new Proxy(status(), { [trap]() { throw Error("private proxy"); } });
    assert.equal(validateRpcStatus(input), null);
  }
});
test("ready status does not imply wallet authenticity or automatic retry", () => {
  const view = describeRpcStatus(status());
  assert.equal(view.level, "ready");
  assert.match(view.heading, /応答待ち/);
  assert.match(view.detail, /自動接続は行いません/);
});
test("waiting status shows only aggregate counts", () => {
  const view = describeRpcStatus(status({ pending: 3, waiting: 3, occupiedProviders: 2 }));
  assert.equal(view.level, "waiting");
  assert.match(view.counts, /未完了: 3 \/ 96/);
  assert.match(view.counts, /待機中: 3/);
});
test("abandoned work is described as unresolved, not successfully cancelled", () => {
  const view = describeRpcStatus(status({ pending: 2, waiting: 1, abandoned: 1, occupiedProviders: 1 }));
  assert.equal(view.level, "pending");
  assert.match(view.heading, /Wallet側で未完了/);
  assert.match(view.detail, /取消できません/);
  assert.match(view.detail, /遅れて返る結果は使いません/);
});
test("page-full status explains why reconnect cannot clear outstanding work", () => {
  const view = describeRpcStatus(status({ pending: 96, waiting: 0, abandoned: 96, occupiedProviders: 3 }));
  assert.equal(view.level, "limited");
  assert.match(view.detail, /やり直しても未完了件数は消えません/);
});
test("clock failure takes precedence over any activity status", () => {
  const view = describeRpcStatus(status({ fault: "RPC_CLOCK", canStart: false,
    pending: 1, abandoned: 1, occupiedProviders: 1 }));
  assert.equal(view.level, "stopped");
  assert.match(view.detail, /経過時間/);
});
test("disposed status never claims external work has finished", () => {
  const view = describeRpcStatus(status({ disposed: true, canStart: false }));
  assert.equal(view.level, "stopped");
  assert.match(view.detail, /処理完了を意味するものではありません/);
});

function panelFixture(overrides = {}) {
  const host = new Element("div");
  const document = { createElement: tag => new Element(tag) };
  let listener = null, unsubscribed = 0;
  const supervisor = {
    state: () => status(),
    subscribe(fn) { listener = fn; return () => { unsubscribed++; }; },
    ...overrides,
  };
  const panel = mountRpcStatusPanel({ document, parent: host, supervisor });
  return { host, panel, field: name => host.find("rpc-status-" + name),
    emit: value => listener?.(value), unsubscribeCount: () => unsubscribed };
}
test("diagnostic panel is read-only and exposes no reset, retry or signing controls", () => {
  const f = panelFixture();
  const section = f.host.find("rpc-status-panel");
  assert(!section.children.some(element => ["BUTTON", "INPUT", "TEXTAREA"].includes(element.tagName)));
  assert.match(f.field("scope").textContent, /他のタブ・ブラウザーは含みません/);
  assert.match(f.field("scope").textContent, /アドレス・残高・要求内容は記録しません/);
  f.panel.dispose();
});
test("headline updates are announced politely while rapidly changing counters are not", () => {
  const f = panelFixture();
  assert.equal(f.field("headline").getAttribute("role"), "status");
  assert.equal(f.field("headline").getAttribute("aria-live"), "polite");
  assert.equal(f.field("counts").getAttribute("aria-live"), undefined);
  f.panel.dispose();
});
test("new observations update the status level and text without reading provider data", () => {
  const f = panelFixture();
  f.emit(status({ pending: 1, abandoned: 1, occupiedProviders: 1 }));
  assert.equal(f.host.find("rpc-status-panel").getAttribute("data-level"), "pending");
  assert.match(f.field("headline").textContent, /未完了/);
  f.emit(status());
  assert.equal(f.host.find("rpc-status-panel").getAttribute("data-level"), "ready");
  f.panel.dispose();
});
test("malformed observation clears previous trusted-looking counts", () => {
  const f = panelFixture();
  f.emit({ ...status(), account: "<img src=x onerror=alert(1)>" });
  assert.equal(f.host.find("rpc-status-panel").getAttribute("data-level"), "unavailable");
  assert(!f.field("counts").textContent.includes("img"));
  assert.match(f.field("counts").textContent, /ありません/);
  f.panel.dispose();
});
test("status service errors are replaced by fixed unavailable text", () => {
  for (const name of ["state", "subscribe"]) {
    const f = panelFixture({ [name]() { throw Error("password private error"); } });
    assert.equal(f.host.find("rpc-status-panel").getAttribute("data-level"), "unavailable");
    assert(!f.field("detail").textContent.includes("password"));
    f.panel.dispose();
  }
});
test("malformed unsubscribe contract is treated as unavailable", () => {
  const f = panelFixture({ subscribe() { return null; } });
  assert.equal(f.host.find("rpc-status-panel").getAttribute("data-level"), "unavailable");
  f.panel.dispose();
});
test("panel disposal removes its observer exactly once and ignores retained callbacks", () => {
  const f = panelFixture();
  const headline = f.field("headline");
  const original = headline.textContent;
  f.panel.dispose(); f.panel.dispose();
  f.emit(status({ disposed: true, canStart: false }));
  assert.equal(f.unsubscribeCount(), 1);
  assert.equal(f.host.children.length, 0);
  assert.equal(headline.textContent, original);
});
test("throwing unsubscribe cannot prevent local panel removal", () => {
  const f = panelFixture({ subscribe() { return () => { throw Error("cleanup"); }; } });
  assert.doesNotThrow(() => f.panel.dispose());
  assert.equal(f.host.children.length, 0);
});
