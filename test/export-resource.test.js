import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserExportResource, inspectExportURL } from "../examples/export-resource.js";
import { inspectExportPayload } from "../src/export-payload.js";
import { createExportGuard } from "../src/export-guard.js";
import { browserFixture, prepared, ORIGIN, PRIVATE } from "./helpers/export-fixtures.js";

function setup() {
  const f = browserFixture();
  const guard = createExportGuard({ now: f.clock.now, schedule: f.clock.schedule,
    unschedule: f.clock.unschedule,
    createResource: (payload, current) => createBrowserExportResource(f.document, payload, current),
  });
  return { ...f, guard, offer: (input = prepared()) => guard.offer(input) };
}

test("resource allocates nothing until activation and supports release before activation", () => {
  const f = browserFixture();
  const resource = createBrowserExportResource(f.document, inspectExportPayload(prepared()), () => true);
  assert.equal(f.blobs.length, 0);
  assert.equal(f.anchors.length, 0);
  assert.equal(f.liveURLs.size, 0);
  assert.equal(resource.release(), true);
  assert.throws(() => resource.activate(), { code: "EXPORT_CANCELLED" });
  assert.equal(f.blobs.length, 0);
});

test("resource clicks one same-origin hidden download and immediately removes the anchor", () => {
  const f = setup();
  const receipt = f.offer();
  assert.equal(f.blobs.length, 1);
  assert.equal(f.blobs[0].size, 16);
  assert.equal(f.blobs[0].type, "application/json;charset=utf-8");
  assert.equal(f.anchors.length, 1);
  const anchor = f.anchors[0];
  assert.equal(anchor.hidden, true);
  assert.equal(anchor.download, prepared().filename);
  assert.equal(anchor.rel, "noopener noreferrer");
  assert.equal(anchor.referrerPolicy, "no-referrer");
  assert.match(anchor.href, /^blob:http:\/\/127\.0\.0\.1:4204\/synthetic-/);
  assert.equal(f.events.filter(event => event === "click").length, 1);
  assert.equal(f.body.children.length, 0);
  assert.equal(f.liveURLs.size, 1);
  assert.equal(receipt.downloadComplete, false);
  f.clock.advance(1000); f.clock.due();
  assert.equal(f.liveURLs.size, 0);
  assert.equal(f.revoked.length, 1);
});

for (const stage of ["blob", "url", "element", "hidden", "rel", "referrerPolicy", "download", "href", "append", "after-append", "click"]) {
  test("resource cleans reachable allocations after failure at " + stage, () => {
    const f = setup();
    f.throwAt(stage);
    assert.throws(() => f.offer(), { code: "EXPORT_FAILED" });
    assert.equal(f.liveURLs.size, 0);
    assert.equal(f.body.children.length, 0);
    assert.equal(f.guard.state().active, 0);
    assert.equal(f.guard.state().offered, 0);
    assert.equal(f.clock.timers.size, 0);
    assert(!JSON.stringify(f.guard.state()).includes(PRIVATE));
  });
}

for (const stage of ["blob", "after-url", "element", "hidden", "rel", "referrerPolicy", "download", "href", "append", "after-append", "click"]) {
  test("resource stops at a reentrant clear during " + stage, () => {
    const f = setup();
    f.hooks.set(stage, () => { f.guard.clear(); });
    assert.throws(() => f.offer(), { code: "EXPORT_CANCELLED" });
    assert.equal(f.liveURLs.size, 0);
    assert.equal(f.body.children.length, 0);
    assert.equal(f.guard.state().active, 0);
    assert.equal(f.guard.state().offered, 0);
    if (stage !== "click") assert.equal(f.events.includes("click"), false);
  });
}

for (const stage of ["blob", "after-url", "href", "after-append", "click"]) {
  test("resource stops at reentrant disposal during " + stage, () => {
    const f = setup();
    f.hooks.set(stage, () => { f.guard.dispose(); });
    assert.throws(() => f.offer(), { code: "EXPORT_CANCELLED" });
    assert.equal(f.liveURLs.size, 0);
    assert.equal(f.body.children.length, 0);
    assert.equal(f.guard.state().disposed, true);
  });
}

test("failed DOM removal still attempts URL revocation and retains cleanup quota", () => {
  const f = setup();
  f.throwAt("remove");
  assert.throws(() => f.offer());
  assert.equal(f.liveURLs.size, 0);
  assert.equal(f.body.children.length, 1);
  assert.equal(f.guard.state().cleanupBlocked, true);
  assert.equal(f.guard.state().active, 1);
  assert.throws(() => f.offer(), { code: "EXPORT_CLEANUP" });
  f.hooks.delete("remove");
  assert.equal(f.guard.retryCleanup(), true);
  assert.equal(f.body.children.length, 0);
  assert.equal(f.guard.state().active, 0);
});

test("failed URL revoke does not restore removed anchors or allow more exports", () => {
  const f = setup();
  f.offer(); f.throwAt("revoke");
  assert.equal(f.guard.clear(), false);
  assert.equal(f.body.children.length, 0);
  assert.equal(f.liveURLs.size, 1);
  assert.equal(f.guard.state().reservedBytes, 16);
  f.hooks.delete("revoke");
  assert.equal(f.guard.retryCleanup(), true);
  assert.equal(f.liveURLs.size, 0);
});

test("both removal and revocation failures are retried independently", () => {
  const f = setup();
  f.throwAt("remove"); f.throwAt("revoke");
  assert.throws(() => f.offer());
  assert.equal(f.liveURLs.size, 1);
  assert.equal(f.body.children.length, 1);
  f.hooks.delete("remove");
  assert.equal(f.guard.retryCleanup(), false);
  assert.equal(f.body.children.length, 0);
  f.hooks.delete("revoke");
  assert.equal(f.guard.retryCleanup(), true);
  assert.equal(f.liveURLs.size, 0);
});

test("replaced URL revocation method cannot redirect captured cleanup", () => {
  const f = setup();
  f.offer();
  f.view.URL.revokeObjectURL = () => { throw Error(PRIVATE); };
  assert.equal(f.guard.clear(), true);
  assert.equal(f.liveURLs.size, 0);
});

test("replaced anchor remove method cannot redirect captured cleanup", () => {
  const f = setup();
  f.hooks.set("click", anchor => { anchor.remove = () => { throw Error(PRIVATE); }; });
  f.offer();
  assert.equal(f.body.children.length, 0);
  f.guard.clear();
  assert.equal(f.liveURLs.size, 0);
});

for (const returned of ["https://attacker.invalid/file", "data:text/html,hello", "javascript:alert(1)",
  "blob:https://attacker.invalid/id", "blob:null/id", `blob:${ORIGIN}/id?x=1`, `blob:${ORIGIN}/id#x`,
  `blob:${ORIGIN}/../id`, `blob:${ORIGIN}/a/b`, `blob:${ORIGIN}/%20`, `blob:${ORIGIN}/`,
  `blob:${ORIGIN}/${"x".repeat(129)}`, null, {}, 1]) {
  test("resource refuses unexpected object URL before click " + String(returned).slice(0, 70), () => {
    const f = setup(), revoked = [];
    f.view.URL.createObjectURL = () => returned;
    f.view.URL.revokeObjectURL = url => revoked.push(url);
    assert.throws(() => f.offer(), { code: "EXPORT_FAILED" });
    assert.equal(f.events.includes("click"), false);
    if (returned !== null) assert.deepEqual(revoked, [returned]);
    assert.equal(f.guard.state().active, 0);
  });
}

for (const suffix of ["a", "7cd034aa-1234-4567-890a-abcdef123456", "x".repeat(128)]) {
  test("object URL parser accepts same-origin opaque identifier " + suffix.slice(0, 25), () => {
    assert.equal(inspectExportURL(`blob:${ORIGIN}/${suffix}`, ORIGIN), `blob:${ORIGIN}/${suffix}`);
  });
}

for (const href of ["file:///C:/private.html", "data:text/html,hello", "about:blank",
  "https://name:password@example.invalid", "not a URL", undefined]) {
  test("resource requires a normal HTTP document origin " + href, () => {
    const f = setup();
    f.document.location.href = href;
    assert.throws(() => f.offer(), { code: "EXPORT_UNAVAILABLE" });
    assert.equal(f.blobs.length, 0);
    assert.equal(f.guard.state().active, 0);
  });
}

for (const field of ["size", "type"]) {
  test("resource rejects a Blob implementation that changes " + field, () => {
    const f = setup();
    f.view.Blob = class {
      constructor() { this.size = field === "size" ? 17 : 16;
        this.type = field === "type" ? "text/html" : "application/json;charset=utf-8"; }
    };
    assert.throws(() => f.offer(), { code: "EXPORT_FAILED" });
    assert.equal(f.events.includes("url"), false);
    assert.equal(f.events.includes("click"), false);
  });
}

test("resource activation cannot be repeated to create additional URLs", () => {
  const f = browserFixture();
  const resource = createBrowserExportResource(f.document, inspectExportPayload(prepared()), () => true);
  resource.activate();
  assert.throws(() => resource.activate(), { code: "EXPORT_FAILED" });
  assert.equal(f.liveURLs.size, 1);
  resource.release(); resource.release();
  assert.equal(f.revoked.length, 1);
});

test("inactive checkpoint prevents all allocation", () => {
  const f = browserFixture();
  const resource = createBrowserExportResource(f.document, inspectExportPayload(prepared()), () => false);
  assert.throws(() => resource.activate(), { code: "EXPORT_CANCELLED" });
  assert.equal(f.blobs.length, 0);
  assert.equal(resource.release(), true);
});

test("promise-returning click is not accepted as successful navigation", async () => {
  const f = setup();
  f.hooks.set("click", () => Promise.reject(Error(PRIVATE)));
  assert.throws(() => f.offer(), { code: "EXPORT_FAILED" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.liveURLs.size, 0);
  assert.equal(f.body.children.length, 0);
});

test("a reentrant revoke cannot recurse forever through guard cleanup", () => {
  const f = setup();
  f.hooks.set("revoke", () => { f.guard.clear(); });
  f.offer();
  assert.equal(f.guard.clear(), true);
  assert.equal(f.revoked.length, 1);
  assert.equal(f.guard.state().reservedBytes, 0);
});
