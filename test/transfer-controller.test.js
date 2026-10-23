import test from "node:test";
import assert from "node:assert/strict";
import { createTransferController } from "../src/transfer-controller.js";
import { encodeTransferFile } from "../src/transfer-file.js";
import { ACCOUNT, OTHER, REQUEST, clone, context, deferred, fileFromText, snapshot, tick } from "./helpers/transfer-fixtures.js";

function fixture(options = {}) {
  let selected = context();
  const changes = [];
  const calls = [];
  const controller = createTransferController({
    getContext: () => selected,
    read: async (request, extras) => { calls.push({ request, extras }); return snapshot(); },
    onChange: state => changes.push(state),
    ...options,
  });
  return { controller, calls, changes, select: value => { selected = value; } };
}

test("transfer controller: construction has no provider or storage side effects", () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  assert.equal(f.changes.length, 0);
  assert.equal(f.controller.state.phase, "idle");
  f.controller.dispose();
});

test("transfer controller: explicit read publishes immutable live observation", async () => {
  const f = fixture();
  assert.equal(await f.controller.inspect(REQUEST), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.state.phase, "ready");
  assert.equal(f.controller.state.provenance, "live");
  assert.equal(f.controller.state.snapshot.context.account, ACCOUNT);
  assert.equal(Object.isFrozen(f.controller.state), true);
  assert.ok(f.calls[0].extras.signal instanceof AbortSignal);
});

test("transfer controller: input request is copied before awaited work", async () => {
  const pending = deferred();
  let captured;
  const f = fixture({ read: async request => { captured = request; return pending.promise; } });
  const request = clone(REQUEST);
  const running = f.controller.inspect(request);
  request.fromBlock = "999";
  assert.equal(captured.fromBlock, "30");
  pending.resolve(snapshot());
  assert.equal(await running, true);
});

test("transfer controller: second request supersedes and aborts first", async () => {
  const one = deferred(), two = deferred();
  const signals = [];
  const f = fixture({ read: async (request, options) => {
    signals.push(options.signal);
    return signals.length === 1 ? one.promise : two.promise;
  } });
  const first = f.controller.inspect(REQUEST);
  const second = f.controller.inspect(REQUEST);
  assert.equal(signals[0].aborted, true);
  const next = snapshot({ events: [] });
  two.resolve(next);
  assert.equal(await second, true);
  one.resolve(snapshot());
  assert.equal(await first, false);
  assert.equal(f.controller.state.snapshot.events.length, 0);
});

test("transfer controller: cancellation discards successful late result", async () => {
  const pending = deferred();
  const f = fixture({ read: () => pending.promise });
  const reading = f.controller.inspect(REQUEST);
  f.controller.cancel();
  pending.resolve(snapshot());
  assert.equal(await reading, false);
  assert.equal(f.controller.state.snapshot, null);
  assert.equal(f.controller.state.phase, "cancelled");
});

test("transfer controller: cancellation also discards late failure", async () => {
  const pending = deferred();
  const f = fixture({ read: () => pending.promise });
  const reading = f.controller.inspect(REQUEST);
  f.controller.cancel();
  pending.reject(Error("late provider error"));
  assert.equal(await reading, false);
  assert.equal(f.controller.state.error, null);
});

test("transfer controller: invalid new request supersedes an in-flight read", async () => {
  const pending = deferred();
  const f = fixture({ read: () => pending.promise });
  const first = f.controller.inspect(REQUEST);
  assert.equal(await f.controller.inspect({ ...REQUEST, lookback: 0 }), false);
  pending.resolve(snapshot());
  assert.equal(await first, false);
  assert.equal(f.controller.state.error, "TRANSFER_LOOKBACK");
  assert.equal(f.controller.state.snapshot, null);
});

test("transfer controller: asynchronous view rejection cannot escape as unhandled", async () => {
  const f = fixture({ onChange: async () => { throw Error("rejected observer"); } });
  assert.equal(await f.controller.inspect(REQUEST), true);
  await tick();
});

for (const selected of [context("EMA"), context("DAT", 84532), context("DAT", 8453, OTHER)]) {
  test("transfer controller: silent form context change drops pending response " + JSON.stringify(selected), async () => {
    const pending = deferred();
    const f = fixture({ read: () => pending.promise });
    const reading = f.controller.inspect(REQUEST);
    f.select(selected);
    pending.resolve(snapshot());
    assert.equal(await reading, false);
    assert.equal(f.controller.state.snapshot, null);
  });
}

test("transfer controller: invalid context during completion resets view", async () => {
  const pending = deferred();
  const f = fixture({ read: () => pending.promise });
  const reading = f.controller.inspect(REQUEST);
  f.select({ agent: "DAT", chainId: 8453, account: "unfinished" });
  pending.resolve(snapshot());
  assert.equal(await reading, false);
  assert.equal(f.controller.state.snapshot, null);
});

test("transfer controller: refuses reader result for a different account", async () => {
  const f = fixture({ read: async () => snapshot({}, context("DAT", 8453, OTHER)) });
  assert.equal(await f.controller.inspect(REQUEST), false);
  assert.equal(f.controller.state.error, "TRANSFER_IMPORT_CONTEXT");
  assert.equal(f.controller.state.snapshot, null);
});

test("transfer controller: failed refresh does not keep old result as current", async () => {
  let count = 0;
  const f = fixture({ read: async () => {
    if (++count > 1) throw Object.assign(Error("private endpoint details"), { code: "TRANSFER_RPC_FAILED" });
    return snapshot();
  } });
  await f.controller.inspect(REQUEST);
  await f.controller.inspect(REQUEST);
  assert.equal(f.controller.state.snapshot, null);
  assert.equal(f.controller.state.error, "TRANSFER_RPC_FAILED");
  assert.equal(JSON.stringify(f.controller.state).includes("private endpoint"), false);
});

test("transfer controller: progress callback is bounded and obsolete updates ignored", async () => {
  const pending = deferred();
  let options;
  const f = fixture({ read: (request, extras) => { options = extras; return pending.promise; } });
  const reading = f.controller.inspect(REQUEST);
  options.onProgress({ stage: "blocks", completed: 2, total: 5 });
  assert.equal(f.controller.state.progress.completed, 2);
  options.onProgress({ stage: "blocks", completed: 999, total: 999 });
  assert.equal(f.controller.state.progress.completed, 2);
  options.onProgress({ stage: "<script>", completed: 0, total: 0 });
  assert.equal(f.controller.state.progress.stage, "blocks");
  f.controller.cancel();
  options.onProgress({ stage: "complete", completed: 5, total: 5 });
  assert.equal(f.controller.state.progress, null);
  pending.resolve(snapshot());
  await reading;
});

test("transfer controller: file is previewed before it can replace displayed data", async () => {
  const f = fixture();
  const file = fileFromText(await encodeTransferFile(snapshot()));
  assert.equal(await f.controller.stageFile(file), true);
  assert.equal(f.controller.state.snapshot, null);
  assert.equal(f.controller.state.phase, "preview");
  assert.equal(f.controller.state.preview.authenticated, false);
  const id = f.controller.state.preview.id;
  assert.equal(f.controller.applyImport(id), true);
  assert.equal(f.controller.state.provenance, "imported");
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.state.preview, null);
});

test("transfer controller: review id cannot be reused", async () => {
  const f = fixture();
  await f.controller.stageFile(fileFromText(await encodeTransferFile(snapshot())));
  const id = f.controller.state.preview.id;
  assert.equal(f.controller.applyImport(id), true);
  assert.equal(f.controller.applyImport(id), false);
  assert.equal(f.controller.state.error, "TRANSFER_REVIEW_REQUIRED");
});

test("transfer controller: cancelled preview does not authorize import", async () => {
  const f = fixture();
  await f.controller.stageFile(fileFromText(await encodeTransferFile(snapshot())));
  const id = f.controller.state.preview.id;
  f.controller.cancel();
  assert.equal(f.controller.applyImport(id), false);
  assert.equal(f.controller.state.snapshot, null);
});

test("transfer controller: changing account between preview and apply prevents import", async () => {
  const f = fixture();
  await f.controller.stageFile(fileFromText(await encodeTransferFile(snapshot())));
  const id = f.controller.state.preview.id;
  f.select(context("DAT", 8453, OTHER));
  assert.equal(f.controller.applyImport(id), false);
  assert.equal(f.controller.state.snapshot, null);
});

test("transfer controller: damaged file leaves prior snapshot available as prior data", async () => {
  const f = fixture();
  await f.controller.inspect(REQUEST);
  assert.equal(await f.controller.stageFile(fileFromText("broken")), false);
  assert.equal(f.controller.state.error, "TRANSFER_FILE_JSON");
  assert.equal(f.controller.state.snapshot.events.length, 1);
  assert.equal(f.controller.state.preview, null);
});

test("transfer controller: stale file completion cannot replace a newer read", async () => {
  const f = fixture();
  const pending = deferred();
  const text = await encodeTransferFile(snapshot({ events: [] }));
  const file = fileFromText(text, { arrayBuffer: () => pending.promise });
  const loading = f.controller.stageFile(file);
  await f.controller.inspect(REQUEST);
  pending.resolve(new TextEncoder().encode(text).buffer);
  assert.equal(await loading, false);
  assert.equal(f.controller.state.snapshot.events.length, 1);
});

test("transfer controller: baseline import is separate from displayed record", async () => {
  const f = fixture();
  await f.controller.inspect(REQUEST);
  await f.controller.stageFile(fileFromText(await encodeTransferFile(snapshot({ events: [] }))), "baseline");
  assert.equal(f.controller.applyImport(f.controller.state.preview.id), true);
  assert.equal(f.controller.state.snapshot.events.length, 1);
  assert.equal(f.controller.state.baseline.events.length, 0);
  assert.equal(f.controller.compare(), true);
  assert.equal(f.controller.state.comparison.added.length, 1);
});

test("transfer controller: baseline retained across a fresh same-context read", async () => {
  const f = fixture();
  await f.controller.inspect(REQUEST);
  assert.equal(f.controller.keepBaseline(), true);
  await f.controller.inspect(REQUEST);
  assert.equal(f.controller.compare(), true);
  assert.equal(f.controller.state.comparison.identical, true);
});

test("transfer controller: new context clears prior baseline and snapshot", async () => {
  const f = fixture({ read: async () => snapshot() });
  await f.controller.inspect(REQUEST);
  f.controller.keepBaseline();
  f.select(context("EMA"));
  assert.equal(await f.controller.prepare(), null);
  assert.equal(f.controller.state.baseline, null);
  assert.equal(f.controller.state.snapshot, null);
});

test("transfer controller: JSON preparation is checked again after async digest", async () => {
  const pending = deferred();
  const f = fixture({ subtle: { digest: () => pending.promise } });
  await f.controller.inspect(REQUEST);
  const preparing = f.controller.prepare();
  f.select(context("DAT", 8453, OTHER));
  pending.resolve(new ArrayBuffer(32));
  assert.equal(await preparing, null);
  assert.equal(f.controller.state.snapshot, null);
});

test("transfer controller: successful export does not call provider again", async () => {
  const f = fixture();
  await f.controller.inspect(REQUEST);
  const result = await f.controller.prepare();
  assert.match(result.filename, /\.json$/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.state.phase, "ready");
});

test("transfer controller: rendering exception does not turn valid read into failure", async () => {
  const f = fixture({ onChange: () => { throw Error("view error"); } });
  assert.equal(await f.controller.inspect(REQUEST), true);
});

test("transfer controller: callback invalidation prevents initiating an RPC", async () => {
  let controller;
  let called = false;
  controller = createTransferController({ getContext: () => context(), read: async () => { called = true; return snapshot(); },
    onChange: state => { if (state.phase === "reading") controller.invalidate(); } });
  assert.equal(await controller.inspect(REQUEST), false);
  assert.equal(called, false);
});

test("transfer controller: disposal clears records and suppresses late callbacks", async () => {
  const pending = deferred();
  const f = fixture({ read: () => pending.promise });
  const reading = f.controller.inspect(REQUEST);
  f.controller.dispose();
  const count = f.changes.length;
  pending.resolve(snapshot());
  assert.equal(await reading, false);
  assert.equal(f.controller.state.phase, "disposed");
  assert.equal(f.changes.length, count);
  assert.equal(await f.controller.inspect(REQUEST), false);
  assert.equal(await f.controller.prepare(), null);
  f.controller.cancel();
  f.controller.invalidate();
  assert.equal(f.controller.state.phase, "disposed");
  await tick();
});
