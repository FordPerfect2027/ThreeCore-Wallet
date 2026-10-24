import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { fakeClock } from "./helpers/security-fixtures.js";
import { mountSecurityPanel } from "../examples/security-panel.js";

function fixture() {
  const document = Object.assign(new EventTarget(), { createElement: tag => new Element(tag), visibilityState: "visible" });
  const parent = new Element("div"), eventTarget = new EventTarget(), clock = fakeClock();
  const panel = mountSecurityPanel({ document, parent, eventTarget, lockOptions: clock.options });
  const q = name => parent.find("security-" + name);
  const j = name => parent.find("security-journal-" + name);
  function report() { j("prepare").click(); return JSON.parse(j("output").value); }
  return { document, parent, eventTarget, clock, panel, q, j, report, close: () => panel.dispose() };
}

test("protection history starts with one ready event and hides its export", () => {
  const f = fixture();
  assert.equal(f.j("list").children.length, 1);
  assert.equal(f.j("export-label").hidden, true);
  assert.equal(f.j("output").value, "");
  assert.equal(f.report().events[0].kind, "ready");
  assert.equal(f.j("output").readOnly, true);
  f.close();
});

test("manual stop and resume record two distinct actions with no implicit reconnect", () => {
  const f = fixture();
  f.q("stop").click(); f.q("resume").click();
  assert.deepEqual(f.report().events.map(event => event.kind), ["ready", "manual", "resumed"]);
  assert.equal(f.panel.check(), true);
  f.close();
});

test("repeated stop clicks cannot inflate the event record", () => {
  const f = fixture();
  f.q("stop").click(); f.q("stop").click(); f.panel.lock();
  assert.equal(f.report().counts.manual, 1);
  f.close();
});

test("idle timer records the actual reason once", () => {
  const f = fixture();
  f.clock.advance(300_000);
  f.panel.check(); f.panel.check();
  assert.equal(f.report().counts.idle, 1);
  assert.equal(f.report().events.at(-1).kind, "idle");
  f.close();
});

test("hidden page records a stop but visible page never records an automatic resume", () => {
  const f = fixture();
  f.document.visibilityState = "hidden"; f.document.dispatchEvent(new Event("visibilitychange"));
  f.document.visibilityState = "visible"; f.document.dispatchEvent(new Event("visibilitychange"));
  const report = f.report();
  assert.equal(report.counts.hidden, 1);
  assert.equal(report.counts.resumed, 0);
  f.close();
});

test("page lifecycle exit is recorded independently of tab hiding preference", () => {
  const f = fixture(); f.q("hidden").checked = false;
  f.eventTarget.dispatchEvent(new Event("pagehide"));
  f.eventTarget.dispatchEvent(new Event("pageshow"));
  assert.equal(f.report().counts["page-exit"], 1);
  assert.equal(f.panel.check(), false);
  f.close();
});

test("configuration changes record typed values without reading wallet state", () => {
  const f = fixture();
  f.q("idle").value = "60000"; f.q("idle").dispatchEvent(new Event("change"));
  f.q("hidden").checked = false; f.q("hidden").dispatchEvent(new Event("change"));
  const report = f.report();
  assert.deepEqual(report.events.at(-2).detail, { idleMs: 60_000 });
  assert.deepEqual(report.events.at(-1).detail, { enabled: false });
  assert.equal(report.counts.manual, 0);
  f.close();
});

test("selecting the current idle policy does not record a false change", () => {
  const f = fixture(); f.q("idle").dispatchEvent(new Event("change"));
  assert.equal(f.report().total, 1);
  f.close();
});

test("new stop invalidates displayed report instead of retaining an outdated summary", () => {
  const f = fixture(); f.report();
  assert.ok(f.j("output").value.length > 0);
  f.q("stop").click();
  assert.equal(f.j("output").value, "");
  assert.equal(f.j("export-label").hidden, true);
  assert.match(f.j("notice").textContent, /新しい記録/);
  assert.equal(f.report().counts.manual, 1);
  f.close();
});

test("closing the report removes its visible text without erasing the session history", () => {
  const f = fixture(); f.q("stop").click(); const first = f.report();
  f.j("close").click();
  assert.equal(f.j("output").value, "");
  assert.equal(f.j("export-label").hidden, true);
  assert.deepEqual(f.report(), first);
  f.close();
});

test("UI shows eight recent entries and explicitly reports eviction", () => {
  const f = fixture();
  for (let i = 0; i < 40; i++) { f.q("stop").click(); f.q("resume").click(); }
  assert.equal(f.j("list").children.length, 8);
  assert.match(f.j("summary").textContent, /17 件/);
  const report = f.report();
  assert.equal(report.events.length, 64);
  assert.equal(report.total, 81);
  assert.equal(report.dropped, 17);
  f.close();
});

test("disposal erases the export and removes its handlers", () => {
  const f = fixture(); f.report();
  const button = f.j("prepare"), output = f.j("output");
  f.close(); button.click();
  assert.equal(output.value, "");
  assert.equal(f.parent.children.length, 0);
});

test("a new page session does not inherit the previous protection report", () => {
  const old = fixture(); old.q("stop").click(); old.close();
  const fresh = fixture();
  assert.equal(fresh.report().total, 1);
  assert.equal(fresh.report().counts.manual, 0);
  fresh.close();
});
