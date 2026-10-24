import test from "node:test";
import assert from "node:assert/strict";
import { mountExportGuardPanel } from "../examples/export-guard-panel.js";
import { guardFixture, browserFixture, prepared, PRIVATE } from "./helpers/export-fixtures.js";

function setup(guard) {
  const dom = browserFixture(), f = guard ? { guard } : guardFixture();
  const panel = mountExportGuardPanel({ document: dom.document, parent: dom.body, guard: f.guard });
  return { ...f, dom, panel,
    field: name => dom.body.find("export-guard-" + name),
    host: dom.body.find("export-guard-panel"),
  };
}

test("export panel begins ready with accessible fixed labels", () => {
  const f = setup();
  assert.equal(f.host.dataset.phase, "ready");
  assert.equal(f.host.getAttribute("aria-label"), "保存ファイルの保護");
  assert.equal(f.field("title").getAttribute("aria-live"), "polite");
  assert.equal(f.field("title").getAttribute("role"), "status");
  assert.equal(f.field("clear").type, "button");
  assert.equal(f.field("retry").type, "button");
  assert.equal(f.field("clear").disabled, true);
  assert.equal(f.field("retry").disabled, true);
  assert(f.field("scope").textContent.includes("保存済みのファイルは削除されません"));
  f.panel.dispose();
});

test("export panel updates counts without rendering file contents or names", () => {
  const f = setup();
  f.guard.offer(prepared({ text: PRIVATE }));
  assert.equal(f.host.dataset.phase, "retaining");
  assert(f.field("counts").textContent.includes("1 / 4"));
  assert.equal(f.field("clear").disabled, false);
  const text = f.host.children.map(child => child.textContent).join("\n");
  assert(!text.includes(PRIVATE)); assert(!text.includes("ThreeCore-DAT-20261024"));
  f.guard.clear(); f.panel.dispose();
});

test("export panel clear button releases all leases and explains saved files remain", () => {
  const f = setup();
  f.offer(); f.offer();
  f.field("clear").click();
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.host.dataset.phase, "ready");
  assert(f.field("outcome").textContent.includes("保存済みファイルは変更していません"));
  f.panel.dispose();
});

test("export panel retry button is enabled only for unconfirmed cleanup", () => {
  let broken = true;
  const fixture = guardFixture({ createResource: () => ({ activate() {}, release: () => !broken }) });
  const f = setup(fixture.guard);
  fixture.offer(); f.field("clear").click();
  assert.equal(f.host.dataset.phase, "cleanup");
  assert.equal(f.field("retry").disabled, false);
  assert(f.field("outcome").textContent.includes("まだ解放を確認できない"));
  broken = false; f.field("retry").click();
  assert.equal(f.host.dataset.phase, "ready");
  assert.equal(f.field("retry").disabled, true);
  assert.equal(f.guard.state().reservedBytes, 0);
  f.panel.dispose();
});

test("export panel disposal unsubscribes without destroying shared document guard", () => {
  const f = setup();
  const title = f.field("title"), clear = f.field("clear");
  f.offer();
  const before = title.textContent;
  f.panel.dispose(); f.panel.dispose();
  assert.equal(f.dom.body.children.length, 0);
  assert.equal(f.guard.state().active, 1);
  clear.click();
  assert.equal(f.guard.state().active, 1);
  f.guard.clear();
  assert.equal(title.textContent, before);
});

test("export panel subscription failure is fixed text and disables controls", () => {
  const f = setup({ subscribe() { throw Error(PRIVATE); } });
  assert.equal(f.host.dataset.phase, "unavailable");
  assert.equal(f.field("clear").disabled, true);
  assert.equal(f.field("retry").disabled, true);
  assert(!f.field("title").textContent.includes(PRIVATE));
  f.panel.dispose();
});

test("export panel refuses forged state without evaluating an accessor", () => {
  let reads = 0;
  const fake = Object.defineProperty({}, "schema", { get() { reads++; throw Error(PRIVATE); } });
  const f = setup({ subscribe(callback) { callback(fake); return () => {}; } });
  assert.equal(reads, 0);
  assert.equal(f.host.dataset.phase, "unavailable");
  f.panel.dispose();
});

test("export panel cleanup exception shows no thrown string", () => {
  const source = guardFixture(); source.offer();
  const f = setup({ subscribe: source.guard.subscribe, clear() { throw Error(PRIVATE); } });
  f.field("clear").click();
  assert(f.field("outcome").textContent.includes("確認できませんでした"));
  assert(!f.field("outcome").textContent.includes(PRIVATE));
  source.guard.clear(); f.panel.dispose();
});

test("export panel remains safe if unsubscribe itself throws", () => {
  const source = guardFixture();
  const f = setup({ subscribe(callback) { callback(source.guard.state()); return () => { throw Error(PRIVATE); }; } });
  assert.doesNotThrow(() => f.panel.dispose());
  assert.equal(f.dom.body.children.length, 0);
});
