import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountSecurityPanel } from "../examples/security-panel.js";
import { fakeClock } from "./helpers/security-fixtures.js";

function fixture(options = {}) {
  const document = Object.assign(new EventTarget(), { createElement: tag => new Element(tag), visibilityState: "visible" });
  const parent = new Element("div"), eventTarget = new EventTarget(), clock = fakeClock(), stops = [];
  const mounted = mountSecurityPanel({ document, parent, eventTarget, onLock: state => stops.push(state),
    lockOptions: clock.options, ...options });
  const q = name => parent.find("security-" + name);
  return { document, parent, eventTarget, clock, stops, mounted, q, close: () => mounted.dispose() };
}

test("protection panel explains scope without requesting or storing wallet information", () => {
  const f = fixture();
  assert.equal(f.q("panel").getAttribute("aria-label"), "ウォレット接続の保護");
  assert.equal(f.q("status").getAttribute("role"), "status");
  assert.equal(f.q("status").getAttribute("aria-live"), "polite");
  assert.equal(f.q("resume").disabled, true);
  assert.equal(f.q("stop").disabled, false);
  assert.equal(f.q("idle").value, "300000");
  assert.match(f.q("scope").textContent, /Wallet側/);
  assert.match(f.q("policy").textContent, /暗号化されていない/);
  f.close();
});

test("manual stop and explicit resume update controls without a connection action", () => {
  const f = fixture();
  f.q("stop").click();
  assert.equal(f.mounted.check(), false);
  assert.equal(f.q("stop").disabled, true);
  assert.equal(f.q("resume").disabled, false);
  assert.match(f.q("status").textContent, /操作により/);
  f.q("resume").click();
  assert.equal(f.mounted.check(), true);
  assert.equal(f.stops.length, 1);
  f.close();
});

test("hiding the page stops access by default", () => {
  const f = fixture();
  f.document.visibilityState = "hidden";
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.mounted.state().reason, "hidden");
  f.document.visibilityState = "visible";
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.mounted.check(), false);
  f.close();
});

test("optional hide behavior does not disable the idle deadline", () => {
  const f = fixture(); f.q("hidden").checked = false;
  f.document.visibilityState = "hidden"; f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.mounted.check(), true);
  f.clock.advance(300_000);
  assert.equal(f.mounted.state().reason, "idle");
  f.close();
});

test("pagehide locks even when hide-on-tab-change is disabled", () => {
  const f = fixture(); f.q("hidden").checked = false;
  f.eventTarget.dispatchEvent(new Event("pagehide"));
  assert.equal(f.mounted.state().reason, "page-exit");
  f.eventTarget.dispatchEvent(new Event("pageshow"));
  assert.equal(f.mounted.check(), false);
  f.close();
});

test("synthetic activity events cannot indefinitely postpone the deadline", () => {
  const f = fixture(); f.clock.advance(250_000, false);
  f.eventTarget.dispatchEvent(new Event("pointerdown"));
  f.eventTarget.dispatchEvent(new Event("keydown"));
  f.clock.advance(50_000);
  assert.equal(f.mounted.state().reason, "idle");
  f.close();
});

test("idle selector configures the actual gate rather than just its label", () => {
  const f = fixture(); f.q("idle").value = "60000";
  f.q("idle").dispatchEvent(new Event("change"));
  assert.equal(f.mounted.state().idleMs, 60_000);
  f.clock.advance(60_000);
  assert.equal(f.mounted.check(), false);
  assert.match(f.q("status").textContent, /一定時間/);
  f.close();
});

test("dispose removes event listeners, controls and timers", () => {
  const f = fixture(); const resume = f.q("resume");
  f.close(); f.close();
  assert.equal(f.parent.children.length, 0);
  f.eventTarget.dispatchEvent(new Event("pagehide"));
  f.document.dispatchEvent(new Event("visibilitychange"));
  resume.click();
  assert.equal(f.mounted.state().disposed, true);
  assert.equal(f.clock.timers().length, 0);
  assert.equal(f.stops.length, 1);
});
