import test from "node:test";
import assert from "node:assert/strict";
import { mountSecurityPanel } from "../examples/security-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { fakeClock } from "./helpers/security-fixtures.js";
import { clockFixture, transportFixture, deterministicCrypto, signal, EPOCH } from "./helpers/tab-guard-fixtures.js";
import { runProtectionBatch } from "../src/protection-batch.js";

function fixture(onLock = () => true) {
  const document = Object.assign(new EventTarget(), {
    createElement: tag => new Element(tag), visibilityState: "visible",
  });
  const parent = new Element("div"), eventTarget = new EventTarget();
  const idle = fakeClock(), clock = clockFixture(), wire = transportFixture();
  const panel = mountSecurityPanel({ document, parent, eventTarget, onLock,
    lockOptions: idle.options,
    tabGuardOptions: { transport: wire.transport, crypto: deterministicCrypto(), ...clock.options } });
  return { panel, parent, wire, document, eventTarget, clock, idle,
    q: name => parent.find("security-" + name),
    close: () => panel.dispose() };
}

for (const [name, callback] of [
  ["negative return", () => false],
  ["throw", () => { throw Error("synthetic private data"); }],
  ["resolved promise", () => Promise.resolve(true)],
  ["rejected promise", () => Promise.reject(Error("synthetic private data"))],
]) {
  for (const prelocked of [false, true]) {
    test("peer receipt withheld after " + name + "; initially locked=" + prelocked, async () => {
      let broken = false;
      const f = fixture(() => broken ? callback() : true);
      try {
        if (prelocked) f.q("stop").click();
        broken = true; f.wire.deliver(signal());
        assert.equal(f.panel.check(), false);
        assert.equal(f.q("resume").disabled, true);
        assert.equal(f.q("cleanup-warning").hidden, false);
        assert.equal(f.q("cleanup-warning").getAttribute("role"), "alert");
        assert.equal(f.q("cleanup-retry").hidden, false);
        assert.equal(f.wire.posts.length, 0);
        assert.equal(f.wire.closed(), true);
        assert(!f.q("cleanup-warning").textContent.includes("synthetic private data"));
        // A scripted event must not bypass a disabled Resume button either.
        f.q("resume").dispatchEvent(new Event("click"));
        assert.equal(f.panel.check(), false);
        await new Promise(resolve => setImmediate(resolve));
      } finally { f.close(); }
    });
  }
}

test("cleanup failure is recoverable through an explicit retry but never auto-reconnects", () => {
  let broken = true, calls = 0;
  const f = fixture(() => { calls++; return !broken; });
  try {
    f.q("stop").click();
    assert.equal(calls, 1);
    assert.equal(f.q("cleanup-warning").hidden, false);
    assert.equal(f.q("resume").disabled, true);
    f.q("cleanup-retry").click();
    assert.equal(calls, 2);
    assert.equal(f.panel.check(), false);
    broken = false;
    f.q("cleanup-retry").click();
    assert.equal(calls, 3);
    assert.equal(f.q("cleanup-warning").hidden, true);
    assert.equal(f.q("cleanup-warning").textContent, "");
    assert.equal(f.q("cleanup-retry").hidden, true);
    assert.equal(f.panel.check(), false);
    assert.equal(f.wire.posts.length, 0);
    f.q("resume").click();
    assert.equal(f.panel.check(), true);
    assert.equal(calls, 3);
  } finally { f.close(); }
});

test("successful retry cannot retroactively issue an old peer receipt", () => {
  let broken = true;
  const f = fixture(() => !broken);
  try {
    f.wire.deliver(signal());
    assert.equal(f.wire.posts.length, 0);
    broken = false; f.q("cleanup-retry").click();
    f.clock.advance(10000);
    assert.equal(f.wire.posts.length, 0);
    assert.equal(f.panel.check(), false);
    assert.equal(f.wire.closed(), true);
  } finally { f.close(); }
});

test("asynchronous success does not clear a warning after the failed synchronous cleanup", async () => {
  let resolve;
  const pending = new Promise(yes => { resolve = yes; });
  const f = fixture(() => pending);
  try {
    f.wire.deliver(signal());
    resolve(true); await pending; await Promise.resolve();
    assert.equal(f.panel.check(), false);
    assert.equal(f.q("cleanup-warning").hidden, false);
    assert.equal(f.q("resume").disabled, true);
    assert.equal(f.wire.posts.length, 0);
  } finally { f.close(); }
});

for (const mode of ["local", "peer", "broadcast", "freeze", "restored", "hidden", "page-exit", "idle"]) {
  test("cleanup failure from " + mode + " leaves a retryable closed gate", () => {
    const f = fixture(() => false);
    try {
      if (mode === "local") f.q("stop").click();
      if (mode === "peer") f.wire.deliver(signal());
      if (mode === "broadcast") f.parent.find("tab-guard-stop").click();
      if (mode === "freeze") f.document.dispatchEvent(new Event("freeze"));
      if (mode === "restored") {
        const event = new Event("pageshow"); Object.defineProperty(event, "persisted", { value: true });
        f.eventTarget.dispatchEvent(event);
      }
      if (mode === "hidden") {
        f.document.visibilityState = "hidden"; f.document.dispatchEvent(new Event("visibilitychange"));
      }
      if (mode === "page-exit") f.eventTarget.dispatchEvent(new Event("pagehide"));
      if (mode === "idle") f.idle.advance(300000);
      assert.equal(f.panel.check(), false);
      assert.equal(f.q("resume").disabled, true);
      assert.equal(f.q("cleanup-retry").hidden, false);
      assert.equal(f.wire.posts.length, 0);
    } finally { f.close(); }
  });
}

for (const mode of ["freeze", "restored", "hidden", "page-exit"]) {
  test(mode + " also clears credentials entered while the gate was already stopped", () => {
    let password = "", cleaned = 0;
    const f = fixture(() => { password = ""; cleaned++; return true; });
    try {
      f.q("stop").click();
      password = "synthetic password entered while locked";
      if (mode === "freeze") f.document.dispatchEvent(new Event("freeze"));
      if (mode === "page-exit") f.eventTarget.dispatchEvent(new Event("pagehide"));
      if (mode === "hidden") {
        f.document.visibilityState = "hidden"; f.document.dispatchEvent(new Event("visibilitychange"));
      }
      if (mode === "restored") {
        const event = new Event("pageshow"); Object.defineProperty(event, "persisted", { value: true });
        f.eventTarget.dispatchEvent(event);
      }
      assert.equal(password, "");
      assert.equal(cleaned, 2);
      assert.equal(f.panel.check(), false);
      assert.equal(f.wire.posts.length, 0);
    } finally { f.close(); }
  });
}

test("retry cannot clear history or trigger a notification while protection is healthy", () => {
  let calls = 0;
  const f = fixture(() => { calls++; return true; });
  try {
    f.q("cleanup-retry").dispatchEvent(new Event("click"));
    assert.equal(calls, 0);
    assert.equal(f.panel.check(), true);
    f.q("stop").click();
    f.q("cleanup-retry").dispatchEvent(new Event("click"));
    assert.equal(calls, 1);
    assert.equal(f.wire.posts.length, 0);
  } finally { f.close(); }
});

test("batch cleanup failure prevents a receipt but still clears unrelated views", () => {
  let password = "fixture", DAT = true, EMA = true, CAWELON = true;
  const f = fixture(() => runProtectionBatch([
    { name: "backup", run() { password = ""; } },
    { name: "period", run() { throw Error("fixture"); } },
    { name: "DAT", run() { DAT = false; } },
    { name: "EMA", run() { EMA = false; } },
    { name: "CAWELON", run() { CAWELON = false; } },
  ]).completed);
  try {
    f.wire.deliver(signal());
    assert.equal(password, "");
    assert.deepEqual([DAT, EMA, CAWELON], [false, false, false]);
    assert.equal(f.wire.posts.length, 0);
    assert.equal(f.q("cleanup-warning").hidden, false);
  } finally { f.close(); }
});

test("successful cleanup receipt is sent only after every view was processed", () => {
  const cleaned = [];
  const f = fixture(() => runProtectionBatch(["backup", "period", "DAT", "EMA", "CAWELON"].map(name => ({
    name, run() { assert.equal(f.wire.posts.length, 0); cleaned.push(name); },
  }))).completed);
  try {
    f.wire.deliver(signal());
    assert.deepEqual(cleaned, ["backup", "period", "DAT", "EMA", "CAWELON"]);
    assert.equal(f.wire.posts[0].kind, "receipt");
    assert.equal(f.q("cleanup-warning").hidden, true);
  } finally { f.close(); }
});

test("dispose removes retry handlers and cannot reopen a failed gate", () => {
  let calls = 0;
  const f = fixture(() => { calls++; return false; });
  f.q("stop").click();
  const retry = f.q("cleanup-retry"), resume = f.q("resume");
  f.close(); retry.dispatchEvent(new Event("click")); resume.dispatchEvent(new Event("click"));
  assert.equal(calls, 1);
  assert.equal(f.panel.check(), false);
  assert.equal(f.parent.children.length, 0);
});
