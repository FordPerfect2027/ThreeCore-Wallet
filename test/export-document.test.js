import test from "node:test";
import assert from "node:assert/strict";
import { getDocumentExportGuard, offerWalletDownload } from "../examples/export-download.js";
import { offerHistoryDownload } from "../examples/history-files.js";
import { browserFixture, prepared, PRIVATE } from "./helpers/export-fixtures.js";

test("document registry returns the same guard to all save entry points", () => {
  const f = browserFixture();
  const guard = getDocumentExportGuard(f.document);
  assert.equal(getDocumentExportGuard(f.document), guard);
  offerWalletDownload({ document: f.document, prepared: prepared() });
  offerHistoryDownload({ document: f.document, prepared: prepared() });
  assert.equal(guard.state().active, 2);
  assert.equal(f.listeners.get("pagehide").size, 1);
  assert.equal(f.listeners.get("pageshow").size, 1);
  guard.clear();
});

test("history and general exports consume one shared four-file budget", () => {
  const f = browserFixture();
  for (let i = 0; i < 4; i++) {
    const offer = i % 2 ? offerHistoryDownload : offerWalletDownload;
    offer({ document: f.document, prepared: prepared() });
  }
  assert.throws(() => offerHistoryDownload({ document: f.document, prepared: prepared() }), { code: "EXPORT_BUSY" });
  assert.equal(f.liveURLs.size, 4);
  f.dispatch("pagehide");
  assert.equal(f.liveURLs.size, 0);
});

for (const type of ["pagehide", "pageshow"]) {
  test("document lifecycle releases exports on " + type, () => {
    const f = browserFixture();
    const guard = getDocumentExportGuard(f.document);
    guard.offer(prepared());
    f.dispatch(type);
    assert.equal(guard.state().active, 0);
    assert.equal(f.liveURLs.size, 0);
    assert.equal(guard.state().disposed, false);
    guard.offer(prepared());
    assert.equal(guard.state().active, 1);
    guard.clear();
  });
}

test("pagehide cannot release URLs owned by a different document", () => {
  const first = browserFixture(), second = browserFixture();
  const a = getDocumentExportGuard(first.document), b = getDocumentExportGuard(second.document);
  a.offer(prepared()); b.offer(prepared());
  first.dispatch("pagehide");
  assert.equal(first.liveURLs.size, 0);
  assert.equal(second.liveURLs.size, 1);
  b.clear();
});

test("lifecycle cleanup failure remains visible and blocks later saves", () => {
  const f = browserFixture(), guard = getDocumentExportGuard(f.document);
  guard.offer(prepared()); f.throwAt("revoke");
  f.dispatch("pagehide");
  assert.equal(guard.state().cleanupBlocked, true);
  f.dispatch("pageshow");
  assert.throws(() => guard.offer(prepared()), { code: "EXPORT_CLEANUP" });
  f.hooks.delete("revoke");
  guard.retryCleanup();
  assert.equal(guard.state().active, 0);
});

test("registration failure removes already installed lifecycle listeners", () => {
  const f = browserFixture();
  f.throwAt("listen-pageshow");
  assert.throws(() => getDocumentExportGuard(f.document), { code: "EXPORT_UNAVAILABLE" });
  assert.equal(f.listeners.get("pagehide")?.size ?? 0, 0);
  f.hooks.delete("listen-pageshow");
  const guard = getDocumentExportGuard(f.document);
  assert.equal(f.listeners.get("pagehide").size, 1);
  guard.clear();
});

for (const field of ["setTimeout", "clearTimeout", "addEventListener", "removeEventListener"]) {
  test("missing document lifecycle dependency fails before allocation: " + field, () => {
    const f = browserFixture();
    delete f.view[field];
    assert.throws(() => getDocumentExportGuard(f.document), { code: "EXPORT_UNAVAILABLE" });
    assert.equal(f.blobs.length, 0);
    assert.equal(f.liveURLs.size, 0);
  });
}

test("missing monotonic clock refuses the document", () => {
  const f = browserFixture();
  delete f.view.performance;
  assert.throws(() => getDocumentExportGuard(f.document), { code: "EXPORT_UNAVAILABLE" });
});

for (const value of [null, undefined, "document", 1, false, {}, []]) {
  test("document registry refuses incomplete surface " + typeof value, () => {
    assert.throws(() => getDocumentExportGuard(value));
  });
}

test("throwing document getter does not leak a sensitive browser exception", () => {
  const document = Object.defineProperty({}, "defaultView", { get() { throw Error(PRIVATE); } });
  assert.throws(() => getDocumentExportGuard(document), { code: "EXPORT_FAILED", message: "EXPORT_FAILED" });
});

test("captured document clock and timer functions survive later replacement", () => {
  const f = browserFixture(), guard = getDocumentExportGuard(f.document);
  f.view.setTimeout = () => { throw Error(PRIVATE); };
  f.view.clearTimeout = () => { throw Error(PRIVATE); };
  f.view.performance.now = () => -1;
  guard.offer(prepared());
  f.clock.advance(1000); f.clock.due();
  assert.equal(guard.state().active, 0);
  assert.equal(guard.state().clockFault, false);
});

test("history export wrapper propagates a truthful handoff receipt", () => {
  const f = browserFixture();
  const receipt = offerHistoryDownload({ document: f.document, prepared: prepared() });
  assert.equal(receipt.offered, true);
  assert.equal(receipt.downloadComplete, false);
  assert.equal(receipt.kind, "json");
  getDocumentExportGuard(f.document).clear();
});

test("history wrapper validates fields before allocating any browser URL", () => {
  const f = browserFixture();
  assert.throws(() => offerHistoryDownload({ document: f.document, prepared: { text: "{}" } }), { code: "EXPORT_FORMAT" });
  assert.equal(f.blobs.length, 0);
  assert.equal(f.anchors.length, 0);
});

test("history click failure revokes immediately instead of relying on a timer", () => {
  const f = browserFixture();
  f.throwAt("click");
  assert.throws(() => offerHistoryDownload({ document: f.document, prepared: prepared() }), { code: "EXPORT_FAILED" });
  assert.equal(f.body.children.length, 0);
  assert.equal(f.liveURLs.size, 0);
  assert.equal(f.clock.timers.size, 0);
});
