import test from "node:test";
import assert from "node:assert/strict";
import { mountSecurityPanel } from "../examples/security-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { fakeClock, flush } from "./helpers/access-lifecycle.js";

function fixture(t, options = {}) {
  const document = Object.assign(new EventTarget(), { createElement: tag => new Element(tag), visibilityState: "visible" });
  const host = new Element("main"), eventTarget = new EventTarget(), clock = fakeClock();
  const panel = mountSecurityPanel({ document, parent: host, eventTarget, lockOptions: clock.options, ...options });
  t.after(() => panel.dispose());
  return { panel, document, eventTarget, clock, host, q: name => host.find("security-" + name) };
}

for (const fault of ["clock", "timer"]) {
  test(`${fault} fault disables resume and shows recovery guidance`, t => {
    const f = fixture(t);
    f.panel.lock(fault);
    assert.equal(f.panel.state().canRead, false);
    assert.equal(f.q("resume").disabled, true);
    assert.equal(f.q("cleanup-warning").hidden, false);
    assert.match(f.q("cleanup-warning").textContent, /ページを開き直/);
    assert(!f.q("cleanup-warning").textContent.includes("秘密鍵"));
    f.q("resume").dispatchEvent(new Event("click"));
    assert.equal(f.panel.check(), false);
  });
}

test("scheduler failure during initial mount renders a stopped panel", t => {
  const clock = fakeClock();
  const f = fixture(t, { lockOptions: { ...clock.options, schedule() { throw Error("test failure"); } } });
  assert.equal(f.panel.state().reason, "timer");
  assert.equal(f.q("resume").disabled, true);
  assert.match(f.q("status").textContent, /監視/);
});

test("clock rollback discovered by a read check renders a stopped panel", t => {
  const f = fixture(t);
  f.clock.set(100); f.panel.check();
  f.clock.set(50);
  assert.equal(f.panel.check(), false);
  assert.equal(f.q("resume").disabled, true);
  assert.match(f.q("cleanup-warning").textContent, /ページを開き直/);
});

for (const fault of ["throw", "reject", "false", "pending"]) {
  test(`cleanup ${fault} requires retry before explicit resume`, async t => {
    let broken = true, calls = 0;
    const f = fixture(t, { onLock() {
      calls++;
      if (!broken) return true;
      if (fault === "throw") throw Error("secret fixture error");
      if (fault === "reject") return Promise.reject(Error("secret fixture error"));
      if (fault === "pending") return new Promise(() => {});
      return false;
    } });
    f.q("stop").click();
    assert.equal(f.q("resume").disabled, true);
    assert.equal(f.q("cleanup-retry").hidden, false);
    f.q("resume").dispatchEvent(new Event("click"));
    assert.equal(f.panel.check(), false);
    broken = false;
    f.q("cleanup-retry").click();
    assert.equal(calls, 2);
    assert.equal(f.q("resume").disabled, false);
    assert.equal(f.panel.check(), false);
    f.q("resume").click();
    assert.equal(f.panel.check(), true);
    await flush();
  });
}

test("nested stop from cleanup is bounded and cannot start another cleanup", t => {
  let panel, calls = 0;
  const f = fixture(t, { onLock() { calls++; if (panel) panel.lock(); } });
  panel = f.panel;
  f.q("stop").click();
  assert.equal(calls, 1);
  assert.equal(f.panel.check(), false);
});

test("new stop during a resume eligibility check defeats that resume", t => {
  let panel, stop = false;
  const f = fixture(t, { canResume() {
    if (stop) { stop = false; panel.lock("hidden"); }
    return true;
  } });
  panel = f.panel;
  f.q("stop").click();
  assert.equal(f.q("resume").disabled, false);
  stop = true;
  f.q("resume").click();
  assert.equal(panel.check(), false);
  f.q("resume").click();
  assert.equal(panel.check(), true);
});

test("asynchronous eligibility never enables resume or leaks rejection", async t => {
  const f = fixture(t, { canResume: () => Promise.reject(Error("private eligibility")) });
  f.q("stop").click();
  f.q("resume").dispatchEvent(new Event("click"));
  await flush();
  assert.equal(f.panel.check(), false);
  assert.equal(f.q("resume").disabled, true);
});

test("a stop from the resume observer is rendered as stopped, not as open", t => {
  let panel;
  const f = fixture(t, { onChange(state) {
    if (panel && !state.locked) panel.lock("hidden");
  } });
  panel = f.panel;
  f.q("stop").click();
  f.q("resume").click();
  assert.equal(panel.check(), false);
  assert.equal(f.q("panel").getAttribute("data-locked"), "true");
  assert.equal(f.q("stop").disabled, true);
  assert.match(f.q("status").textContent, /画面を離れたため/);
});

test("then accessor is captured once per eligibility call", async t => {
  let checks = 0;
  const f = fixture(t, { canResume() {
    checks++;
    let reads = 0;
    return Object.defineProperty({}, "then", { get() {
      assert.equal(++reads, 1);
      return (resolve, reject) => reject(Error("fixture rejection"));
    } });
  } });
  f.q("stop").click();
  await flush();
  assert(checks > 0);
  assert.equal(f.q("resume").disabled, true);
});

for (const name of ["pagehide", "freeze", "pageshow"]) {
  test(`lifecycle ${name} remains stopped after return`, t => {
    const f = fixture(t);
    const event = new Event(name);
    if (name === "pageshow") Object.defineProperty(event, "persisted", { value: true });
    (name === "freeze" ? f.document : f.eventTarget).dispatchEvent(event);
    assert.equal(f.panel.check(), false);
    f.eventTarget.dispatchEvent(new Event("pageshow"));
    assert.equal(f.panel.check(), false);
    assert.equal(f.q("stop").disabled, true);
    assert.equal(f.q("resume").disabled, false);
  });
}

test("timer stop history contains a finite reason, not exception text", t => {
  const f = fixture(t);
  f.panel.lock("timer");
  const journal = f.host.find("security-journal-output");
  f.host.find("security-journal-prepare").click();
  const parsed = JSON.parse(journal.value);
  assert.equal(parsed.counts.timer, 1);
  assert.equal(parsed.containsWalletAddresses, false);
  assert.equal(parsed.containsBalances, false);
  assert.equal(parsed.containsPrivateKeys, false);
});
