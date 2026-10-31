import test from "node:test";
import assert from "node:assert/strict";
import { checkBrowserShard, checkBrowserShards, checkBrowserErrorControl } from "../scripts/browser-result.js";

function page(index, registered = 906, overrides = {}) {
  const indices = Array.from({ length: registered }, (_, i) => i).filter(i => i % 2 === index);
  const values = { "shard-index": index, "shard-count": 2, "registered-count": registered,
    "registered-digest": "ab".repeat(32), "selected-indices": indices.join(","), "suite-filter": "", "control-only": "false",
    "suite-status": "passed", "tests-count": indices.length, "tests-passed": indices.length,
    "tests-failed": 0, "unexpected-errors": 0, "error-kinds": "", "injected-fault": "", ...overrides };
  return '<body ' + Object.entries(values).map(([k, v]) => `data-${k}="${v}"`).join(" ") + '></body>';
}

for (const total of [289, 906, 907]) test("shards include every registered index exactly once: " + total, () => {
  const result = checkBrowserShards([page(0, total), page(1, total)]);
  assert.equal(result.total, total); assert.equal(result.passed, total); assert.ok(Object.isFrozen(result));
});

test("half a suite, duplicated halves and reversed halves cannot pass the full run", () => {
  for (const pages of [[], [page(0)], [page(0), page(0)], [page(1), page(0)], [page(0), page(1), page(0)]])
    assert.throws(() => checkBrowserShards(pages));
});

test("different registry order or count between halves is rejected", () => {
  assert.throws(() => checkBrowserShards([page(0), page(1, 906, { "registered-digest": "cd".repeat(32) })]), /registry changed/);
  assert.throws(() => checkBrowserShards([page(0), page(1, 907)]), /registry changed/);
});

for (const overrides of [
  { "selected-indices": "0,2" }, { "selected-indices": "0,0,2" }, { "selected-indices": "1,3" },
  { "selected-indices": "00,2" }, { "suite-filter": "file-read" }, { "shard-count": 3 },
  { "registered-count": 0 }, { "registered-count": 10001 }, { "registered-count": "0906" },
  { "registered-digest": "not-a-digest" }, { "tests-count": 454, "tests-passed": 454 },
  { "tests-count": 452, "tests-passed": 452 }, { "tests-passed": 452, "tests-failed": 1 },
  { "unexpected-errors": 1, "error-kinds": "error" }, { "suite-status": "running" },
]) test("invalid shard evidence cannot hide omissions or failures: " + JSON.stringify(overrides), () => {
  assert.throws(() => checkBrowserShard(page(0, 906, overrides), 0));
});

test("missing and duplicate shard summary attributes cannot be supplied by nested fixtures", () => {
  assert.throws(() => checkBrowserShard(page(0).replace('data-shard-count="2"', '') + '<div data-shard-count="2"></div>', 0));
  assert.throws(() => checkBrowserShard(page(0).replace('<body ', '<body data-shard-index="0" '), 0));
  for (const index of [-1, 2, "0", null]) assert.throws(() => checkBrowserShard(page(0), index));
});

for (const fault of ["error", "unhandledrejection"]) test("sharded control requires exactly its injected fault: " + fault, () => {
  const attributes = { "suite-status": "failed", "unexpected-errors": 1, "error-kinds": fault, "injected-fault": fault };
  const html = page(0, 906, attributes);
  assert.equal(checkBrowserShard(html, 0, fault).passed, 453);
  assert.throws(() => checkBrowserShards([html, page(1)]));
  assert.throws(() => checkBrowserShard(page(0, 906, { ...attributes, "unexpected-errors": 0 }), 0, fault));
  assert.throws(() => checkBrowserShard(page(0, 906, { ...attributes, "unexpected-errors": 2 }), 0, fault));
});

for (const fault of ["error", "unhandledrejection"]) test("one-case dedicated fault control cannot satisfy normal shard coverage: " + fault, () => {
  const attributes = { "suite-status": "failed", "unexpected-errors": 1, "error-kinds": fault, "injected-fault": fault,
    "control-only": "true", "selected-indices": "0", "tests-count": 1, "tests-passed": 1 };
  const html = page(0, 906, attributes);
  assert.equal(checkBrowserErrorControl(html, fault).passed, 1);
  assert.throws(() => checkBrowserShard(html, 0, fault));
  assert.throws(() => checkBrowserShards([html, page(1)]));
  assert.throws(() => checkBrowserErrorControl(html));
  assert.throws(() => checkBrowserErrorControl(page(0, 906, { ...attributes, "unexpected-errors": 0 }), fault));
  assert.throws(() => checkBrowserErrorControl(page(0, 906, { ...attributes, "selected-indices": "2" }), fault));
});
