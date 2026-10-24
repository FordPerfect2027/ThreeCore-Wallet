import test from "node:test";
import assert from "node:assert/strict";
import { mountTabGuardPanel } from "../examples/tab-guard-panel.js";
import { mountSecurityPanel } from "../examples/security-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { fakeClock } from "./helpers/security-fixtures.js";
import { clockFixture, transportFixture, deterministicCrypto, signal, EPOCH } from "./helpers/tab-guard-fixtures.js";
import { createStopReceipt, TabGuardError } from "../src/tab-guard-protocol.js";

function fixture(overrides = {}) {
  const document = Object.assign(new EventTarget(), { createElement: tag => new Element(tag), visibilityState: "visible" });
  const parent = new Element("div"), wire = transportFixture(), clock = clockFixture(), stops = [];
  const panel = mountTabGuardPanel({ document, parent, onStop: reason => { stops.push(reason); return true; },
    options: { transport: wire.transport, crypto: deterministicCrypto(), ...clock.options }, ...overrides });
  return { document, parent, panel, wire, clock, stops, q: name => parent.find("tab-guard-" + name) };
}

test("notification panel describes exact browser/origin/port scope and uncertainty", () => {
  const f = fixture();
  assert.equal(f.q("panel").getAttribute("aria-label"), "同じアドレスの画面へ停止を通知");
  assert.match(f.q("scope").textContent, /別のポート番号/);
  assert.match(f.q("limits").textContent, /全画面の停止を保証しません/);
  assert.match(f.q("limits").textContent, /自動再開は行わず/);
  assert.equal(f.q("status").getAttribute("role"), "status");
  assert.equal(f.q("status").getAttribute("aria-live"), "polite");
  assert.equal(f.wire.posts.length, 0);
  f.panel.dispose();
});

test("one click first stops locally then starts a bounded response wait", () => {
  const f = fixture(); f.q("stop").click();
  assert.deepEqual(f.stops, ["broadcast-stop"]);
  assert.equal(f.wire.posts[0].kind, "stop");
  assert.equal(f.q("stop").disabled, true);
  assert.match(f.q("status").textContent, /応答を待っています/);
  f.clock.advance(2000);
  assert.equal(f.q("stop").disabled, false);
  assert.match(f.q("status").textContent, /個別に確認/);
  assert.match(f.q("receipts").textContent, /0 件/);
  f.panel.dispose();
});

test("receipts update counts without displaying sender identity", () => {
  const f = fixture(); f.q("stop").click();
  const receipt = createStopReceipt(f.wire.posts[0], "22".repeat(16));
  f.wire.deliver(receipt);
  assert.match(f.q("receipts").textContent, /1 件/);
  assert(!f.q("receipts").textContent.includes(receipt.source));
  assert(!f.q("status").textContent.includes(receipt.id));
  f.panel.dispose();
});

test("remote stop updates status without creating a second stop publication", () => {
  const f = fixture(); f.wire.deliver(signal());
  assert.match(f.q("status").textContent, /停止通知を受け/);
  assert.deepEqual(f.stops, ["peer-stop"]);
  assert.equal(f.wire.posts.length, 1);
  assert.equal(f.wire.posts[0].kind, "receipt");
  f.panel.dispose();
});

test("failed startup still offers a local stop and explains notification unavailability", () => {
  const wire = transportFixture({ subscribe() { throw new TabGuardError("TAB_UNAVAILABLE"); } });
  const f = fixture({ options: { transport: wire.transport } });
  assert.match(f.q("status").textContent, /この画面の停止は利用/);
  assert.equal(f.q("stop").disabled, false);
  f.q("stop").click();
  assert.deepEqual(f.stops, ["broadcast-stop"]);
  assert.equal(wire.posts.length, 0);
  f.panel.dispose();
});

test("failure text never renders the external error or an HTML payload", () => {
  const wire = transportFixture({ subscribe() { throw Error('<img src=x onerror="secret">'); } });
  const f = fixture({ options: { transport: wire.transport } });
  assert.match(f.q("status").textContent, /通信を確認できません/);
  assert(!f.q("status").textContent.includes("img"));
  f.panel.dispose();
});

test("removing the panel disposes the channel and detaches event handlers", () => {
  const f = fixture(); const button = f.q("stop");
  f.q("stop").click();
  f.panel.dispose(); f.panel.dispose();
  assert.equal(f.parent.children.length, 0);
  assert.equal(f.clock.pending().length, 0);
  assert(f.wire.closed());
  button.click(); f.wire.deliver(signal());
  assert.equal(f.stops.length, 1);
});

test("resume acknowledgment invalidates a visible receipt wait without any outgoing command", () => {
  const f = fixture(); f.q("stop").click();
  f.clock.advance(1, false); f.panel.noteResume();
  assert.equal(f.q("stop").disabled, false);
  assert.equal(f.wire.posts.length, 1);
  assert.match(f.q("status").textContent, /再開の指示は受け付けません/);
  f.panel.dispose();
});

function integrated(overrides = {}) {
  const document = Object.assign(new EventTarget(), { createElement: tag => new Element(tag), visibilityState: "visible" });
  const parent = new Element("div"), eventTarget = new EventTarget(), stops = [];
  const lockClock = fakeClock(), clock = clockFixture(), wire = transportFixture();
  const panel = mountSecurityPanel({ document, parent, eventTarget,
    onLock: state => stops.push(state), lockOptions: lockClock.options,
    tabGuardOptions: { transport: wire.transport, crypto: deterministicCrypto(), ...clock.options }, ...overrides });
  return { document, parent, eventTarget, stops, clock, wire, lockClock, panel,
    q: name => parent.find(name), close: () => panel.dispose() };
}

test("integrated remote notification closes the access gate and records a safe event", () => {
  const f = integrated();
  f.wire.deliver(signal());
  assert.equal(f.panel.check(), false);
  assert.equal(f.panel.state().reason, "peer-stop");
  assert.equal(f.q("security-resume").disabled, false);
  assert.match(f.q("security-journal-event").textContent, /他の画面/);
  assert.equal(f.stops.length, 1);
  f.close();
});

test("the existing local stop deliberately does not broadcast", () => {
  const f = integrated(); f.q("security-stop").click();
  assert.equal(f.panel.state().reason, "manual");
  assert.equal(f.wire.posts.length, 0);
  f.close();
});

test("the all-screen button also works when the local gate was already stopped", () => {
  const f = integrated(); f.q("security-stop").click();
  f.q("tab-guard-stop").click();
  assert.equal(f.panel.check(), false);
  assert.equal(f.stops.length, 2);
  assert.equal(f.wire.posts.length, 1);
  assert.equal(f.wire.posts[0].kind, "stop");
  f.close();
});

test("remote stop repeats sensitive-view cleanup even if gate was already locked", () => {
  const f = integrated(); f.q("security-stop").click();
  f.wire.deliver(signal());
  assert.equal(f.stops.length, 2);
  assert.equal(f.panel.check(), false);
  f.close();
});

test("resume permits explicit reconnect locally and sends no resume notification", () => {
  const f = integrated(); f.wire.deliver(signal());
  const sent = f.wire.posts.length;
  f.clock.advance(10, false); f.q("security-resume").click();
  assert.equal(f.panel.check(), true);
  assert.equal(f.q("security-stop").disabled, false);
  assert.equal(f.q("security-resume").disabled, true);
  assert.equal(f.wire.posts.length, sent);
  assert.match(f.q("security-journal-event").textContent, /自動接続は行いません/);
  f.close();
});

test("a stopped and resumed page is protected from a queued pre-resume notification", () => {
  const f = integrated(); f.q("security-stop").click();
  f.clock.advance(100, false); f.q("security-resume").click();
  f.wire.deliver(signal());
  assert(f.panel.check());
  f.clock.advance(1, false);
  f.wire.deliver(signal({ issuedAt: EPOCH + 101 }));
  assert(!f.panel.check());
  f.close();
});

test("clock failure cannot allow local resume through the notification panel", () => {
  const f = integrated(); f.q("security-stop").click();
  f.clock.set(EPOCH - 1); f.q("security-resume").click();
  assert.equal(f.panel.check(), false);
  assert.match(f.q("tab-guard-status").textContent, /時刻を確認できません/);
  f.close();
});

test("channel fault stops the local screen even after hiding protection was disabled", () => {
  const f = integrated(); f.q("security-hidden").checked = false;
  f.wire.error();
  assert.equal(f.panel.state().reason, "channel-error");
  assert.equal(f.panel.check(), false);
  f.close();
});

test("page freeze is a mandatory local stop and never broadcast", () => {
  const f = integrated(); f.q("security-hidden").checked = false;
  f.document.dispatchEvent(new Event("freeze"));
  assert.equal(f.panel.state().reason, "page-freeze");
  assert.equal(f.wire.posts.length, 0);
  f.close();
});

test("bfcache restoration cannot silently keep a previous connection gate open", () => {
  const f = integrated();
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  f.eventTarget.dispatchEvent(event);
  assert.equal(f.panel.state().reason, "page-restored");
  assert.equal(f.wire.posts.length, 0);
  f.close();
});

test("ordinary initial pageshow does not lock a fresh page", () => {
  const f = integrated(); f.eventTarget.dispatchEvent(new Event("pageshow"));
  assert.equal(f.panel.check(), true);
  assert.equal(f.stops.length, 0);
  f.close();
});

test("idle and hidden stops remain local, avoiding a background-tab stop cascade", () => {
  const f = integrated();
  f.document.visibilityState = "hidden";
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.panel.state().reason, "hidden");
  assert.equal(f.wire.posts.length, 0);
  f.clock.advance(1); f.q("security-resume").click();
  f.lockClock.advance(300000);
  assert.equal(f.panel.state().reason, "idle");
  assert.equal(f.wire.posts.length, 0);
  f.close();
});

test("disposing integrated protection closes channel before emitting final lock cleanup", () => {
  const f = integrated(); const button = f.q("tab-guard-stop");
  f.close();
  assert(f.wire.closed());
  assert.equal(f.parent.children.length, 0);
  button.click(); f.wire.deliver(signal());
  assert.equal(f.wire.posts.length, 0);
  assert.equal(f.stops.length, 1);
});
