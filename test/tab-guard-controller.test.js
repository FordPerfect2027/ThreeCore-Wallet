import test from "node:test";
import assert from "node:assert/strict";
import { createTabGuard } from "../src/tab-guard-controller.js";
import { TabGuardError, createStopSignal, createStopReceipt, TAB_GUARD_BUDGET,
  TAB_GUARD_RECEIPTS, TAB_GUARD_REPLAYS, TAB_GUARD_TTL } from "../src/tab-guard-protocol.js";
import { guardFixture, transportFixture, deterministicCrypto, clockFixture, hubFixture,
  ID_A, ID_B, ID_C, ID_D, EPOCH, idFor, signal } from "./helpers/tab-guard-fixtures.js";

test("construction is inert; start opens once without sending or stopping", () => {
  const f = guardFixture();
  assert.equal(f.guard.state().phase, "idle");
  assert.equal(f.wire.calls.length, 0);
  assert(f.guard.start());
  assert(!f.guard.start());
  assert.deepEqual(f.wire.calls, ["subscribe"]);
  assert.deepEqual(f.stops, []);
  assert.equal(f.guard.state().available, true);
  f.guard.dispose();
});

test("public state contains aggregate counts but no transport identifiers", () => {
  const f = guardFixture(); f.guard.start(); f.guard.stop();
  const value = f.guard.state();
  assert.deepEqual(Object.keys(value), ["phase", "errorCode", "available", "disposed", "pending",
    "sent", "received", "ignored", "receiptCount", "maxReceipts"]);
  assert(!JSON.stringify(value).includes(f.wire.posts[0].source));
  assert(Object.isFrozen(value));
  assert.throws(() => { value.received = 999; }, TypeError);
  f.guard.dispose();
});

test("explicit stop closes the local gate before publishing and waits for receipts", () => {
  const order = [], wire = transportFixture({ post(value) { order.push("post"); return true; } });
  const f = guardFixture({ transport: wire.transport, onStop: reason => { order.push(reason); return true; } });
  f.guard.start();
  assert(f.guard.stop());
  assert.deepEqual(order, ["broadcast-stop", "post"]);
  assert.equal(f.guard.state().phase, "waiting");
  assert.equal(f.guard.state().pending, true);
  assert.equal(f.clock.pending().length, 1);
  f.guard.dispose();
});

test("stop is still local when the optional channel is unavailable", () => {
  const wire = transportFixture({ subscribe() { throw new TabGuardError("TAB_UNAVAILABLE"); } });
  const f = guardFixture({ transport: wire.transport });
  assert.equal(f.guard.start(), false);
  assert.deepEqual(f.stops, []);
  assert.equal(f.guard.stop(), false);
  assert.deepEqual(f.stops, ["broadcast-stop"]);
  assert.equal(f.guard.state().errorCode, "TAB_UNAVAILABLE");
  assert.equal(f.clock.pending().length, 0);
  f.guard.dispose();
});

test("one request permits no overlapping stop publication", () => {
  const f = guardFixture(); f.guard.start();
  assert(f.guard.stop());
  assert(!f.guard.stop());
  assert.equal(f.wire.posts.length, 1);
  assert.equal(f.stops.length, 1);
  f.clock.advance(2000);
  assert(f.guard.stop());
  assert.equal(f.wire.posts.length, 2);
  assert.notEqual(f.wire.posts[0].id, f.wire.posts[1].id);
  f.guard.dispose();
});

test("valid remote stop invokes cleanup once and emits one directed receipt", () => {
  const f = guardFixture(); f.guard.start();
  f.wire.deliver(signal());
  assert.deepEqual(f.stops, ["peer-stop"]);
  assert.equal(f.guard.state().received, 1);
  assert.equal(f.guard.state().phase, "received");
  assert.equal(f.wire.posts.length, 1);
  const receipt = f.wire.posts[0];
  assert.equal(receipt.kind, "receipt");
  assert.equal(receipt.id, ID_C);
  assert.equal(receipt.target, ID_B);
  assert.equal(receipt.issuedAt, EPOCH);
  f.guard.dispose();
});

test("received stops are never broadcast again, preventing message loops", () => {
  const hub = hubFixture(), clock = clockFixture(), all = [];
  for (let index = 0; index < 4; index++) {
    const stops = [];
    const guard = createTabGuard({ transport: hub.endpoint(), ...clock.options,
      crypto: deterministicCrypto(index * 100), onStop: value => { stops.push(value); return true; } });
    guard.start(); all.push({ guard, stops });
  }
  all[0].guard.stop(); hub.flush();
  assert.equal(hub.traffic.filter(value => value.kind === "stop").length, 1);
  assert.equal(hub.traffic.filter(value => value.kind === "receipt").length, 3);
  assert.equal(all[0].guard.state().receiptCount, 3);
  for (const peer of all.slice(1)) assert.deepEqual(peer.stops, ["peer-stop"]);
  assert.equal(hub.pending(), 0);
  all.forEach(peer => peer.guard.dispose());
});

test("duplicates and a local source cannot repeatedly stop a resumed screen", () => {
  const f = guardFixture(); f.guard.start(); f.guard.stop();
  f.wire.deliver(f.wire.posts[0]);
  assert.equal(f.stops.length, 1);
  f.wire.deliver(signal()); f.wire.deliver(signal());
  assert.equal(f.stops.length, 2);
  assert.equal(f.guard.state().received, 1);
  assert.equal(f.guard.state().ignored, 2);
  f.guard.dispose();
});

test("resume is local and rejects notifications issued before or at the resume boundary", () => {
  const f = guardFixture(); f.guard.start();
  f.wire.deliver(signal());
  f.clock.advance(100);
  assert(f.guard.noteResume());
  const outbound = f.wire.posts.length;
  f.wire.deliver(signal({ id: ID_D }));
  f.wire.deliver(signal({ id: ID_A, issuedAt: EPOCH + 100 }));
  assert.equal(f.guard.state().received, 1);
  assert.equal(f.wire.posts.length, outbound);
  f.clock.advance(1);
  f.wire.deliver(signal({ id: ID_A, issuedAt: EPOCH + 101 }));
  assert.equal(f.guard.state().received, 2);
  f.guard.dispose();
});

test("resume consumes an outbound receipt window and its late timer", () => {
  const f = guardFixture(); f.guard.start(); f.guard.stop();
  const timer = f.clock.pending()[0];
  f.clock.advance(10, false);
  assert(f.guard.noteResume());
  f.receipt(); f.clock.invoke(timer);
  assert.equal(f.guard.state().phase, "ready");
  assert.equal(f.guard.state().receiptCount, 0);
  assert.equal(f.guard.state().pending, false);
  assert.equal(f.clock.pending().length, 0);
  f.guard.dispose();
});

test("receipt count deduplicates responders, not just message objects", () => {
  const f = guardFixture(); f.guard.start(); f.guard.stop();
  f.receipt(ID_B); f.receipt(ID_B); f.receipt(ID_C);
  assert.equal(f.guard.state().receiptCount, 2);
  assert.equal(f.guard.state().ignored, 1);
  assert.equal(f.stops.length, 1);
  f.guard.dispose();
});

for (const alteration of [{ target: ID_D }, { id: ID_D }, { issuedAt: EPOCH - 1 },
  { issuedAt: EPOCH + 1 }, { kind: "unlock" }, { secret: "password" }]) {
  test("unmatched or malformed receipt does not count: " + JSON.stringify(alteration), () => {
    const f = guardFixture(); f.guard.start(); f.guard.stop();
    f.receipt(ID_B, alteration);
    assert.equal(f.guard.state().receiptCount, 0);
    assert.equal(f.guard.state().ignored, 1);
    assert.equal(f.stops.length, 1);
    f.guard.dispose();
  });
}

test("receipt after the wall-clock deadline is ignored even if its timer was suspended", () => {
  const f = guardFixture(); f.guard.start(); f.guard.stop();
  f.clock.advance(2000, false); f.receipt();
  assert.equal(f.guard.state().receiptCount, 0);
  f.clock.advance(1);
  assert.equal(f.guard.state().phase, "complete");
  f.guard.dispose();
});

test("receipt from an earlier request does not satisfy a new one", () => {
  const f = guardFixture(); f.guard.start(); f.guard.stop();
  const receipt = createStopReceipt(f.wire.posts[0], ID_B);
  f.clock.advance(2000); f.guard.stop();
  f.wire.deliver(receipt);
  assert.equal(f.guard.state().receiptCount, 0);
  assert.equal(f.guard.state().sent, 2);
  f.guard.dispose();
});

test("bounded receipt count never implies how many unresponsive pages exist", () => {
  const f = guardFixture(); f.guard.start(); f.guard.stop();
  for (let index = 100; index < 150; index++) f.receipt(idFor(index));
  assert.equal(f.guard.state().receiptCount, TAB_GUARD_RECEIPTS);
  assert.equal(f.guard.state().ignored, 50 - TAB_GUARD_RECEIPTS);
  assert.equal(Object.hasOwn(f.guard.state(), "allStopped"), false);
  f.guard.dispose();
});

for (const difference of [-10001, 1001]) {
  test("stale and excessively future notifications cannot stop a page: " + difference, () => {
    const f = guardFixture(); f.guard.start();
    f.wire.deliver(signal({ issuedAt: EPOCH + difference }));
    assert.equal(f.stops.length, 0);
    assert.equal(f.wire.posts.length, 0);
    assert.equal(f.guard.state().ignored, 1);
    f.guard.dispose();
  });
}

test("an invalid-message flood closes notification processing and protects the local gate", () => {
  const f = guardFixture(); f.guard.start();
  for (let index = 0; index <= TAB_GUARD_BUDGET; index++) f.wire.deliver({ kind: "unlock" });
  assert.equal(f.guard.state().errorCode, "TAB_FLOOD");
  assert.equal(f.guard.state().available, false);
  assert.equal(f.guard.state().ignored, TAB_GUARD_BUDGET);
  assert.deepEqual(f.stops, ["channel-error"]);
  assert(f.wire.closed());
  f.wire.deliver(signal());
  assert.equal(f.stops.length, 1);
  f.guard.dispose();
});

test("replay-cache overflow cannot evict a still-valid stop and make it reusable", () => {
  const f = guardFixture(); f.guard.start();
  for (let index = 100; index <= 100 + TAB_GUARD_REPLAYS; index++) {
    f.wire.deliver(signal({ id: idFor(index) }));
  }
  assert.equal(f.guard.state().received, TAB_GUARD_REPLAYS);
  assert.equal(f.guard.state().errorCode, "TAB_FLOOD");
  assert.equal(f.stops.at(-1), "channel-error");
  f.guard.dispose();
});

test("ingress budget renews after its bounded interval", () => {
  const f = guardFixture(); f.guard.start();
  for (let round = 0; round < 3; round++) {
    for (let index = 0; index < TAB_GUARD_BUDGET; index++) f.wire.deliver(null);
    assert(f.guard.state().available);
    f.clock.advance(TAB_GUARD_TTL);
  }
  assert.equal(f.guard.state().ignored, TAB_GUARD_BUDGET * 3);
  assert.equal(f.stops.length, 0);
  f.guard.dispose();
});

for (const transition of ["stop", "noteResume", "receive", "timer"]) {
  test("clock rollback fails closed while handling " + transition, () => {
    const f = guardFixture(); f.guard.start();
    if (transition === "timer") f.guard.stop();
    f.clock.set(EPOCH - 1);
    if (transition === "receive") f.wire.deliver(signal());
    else if (transition === "timer") f.clock.invoke(f.clock.pending()[0]);
    else f.guard[transition]();
    assert.equal(f.guard.state().errorCode, "TAB_CLOCK");
    assert.equal(f.guard.state().available, false);
    assert(f.stops.includes("channel-error"));
    f.guard.dispose();
  });
}

test("unavailable entropy does not fall back to an incrementing public identity", () => {
  const f = guardFixture({ crypto: {} });
  assert.equal(f.guard.start(), false);
  assert.equal(f.guard.state().errorCode, "TAB_ENTROPY");
  assert.equal(f.wire.posts.length, 0);
  assert.equal(f.wire.calls.includes("subscribe"), false);
  f.guard.stop();
  assert.deepEqual(f.stops, ["broadcast-stop"]);
  f.guard.dispose();
});

test("transport errors after startup protect the screen and clear receipt state", () => {
  const f = guardFixture(); f.guard.start(); f.guard.stop();
  f.wire.error();
  assert.equal(f.guard.state().errorCode, "TAB_TRANSPORT");
  assert.equal(f.guard.state().pending, false);
  assert.equal(f.clock.pending().length, 0);
  assert.equal(f.stops.at(-1), "channel-error");
  f.guard.dispose();
});

for (const outcome of [false, undefined, 1, "true", {}, Promise.resolve(true)]) {
  test("cleanup requires a synchronous literal success: " + String(outcome), () => {
    const f = guardFixture({ onStop: () => outcome });
    f.guard.start(); f.wire.deliver(signal());
    assert.equal(f.guard.state().errorCode, "TAB_CLEANUP");
    assert.equal(f.guard.state().received, 0);
    assert.equal(f.wire.posts.length, 0);
    f.guard.dispose();
  });
}

test("throwing cleanup and transport errors never leak their message", () => {
  const f = guardFixture({ onStop() { throw Error("private fixture secret"); } });
  f.guard.start(); f.guard.stop();
  assert.equal(f.guard.state().errorCode, "TAB_CLEANUP");
  assert(!JSON.stringify(f.changes).includes("private"));
  f.guard.dispose();
});

test("disposal is idempotent and no queued callback can repopulate the panel", () => {
  const f = guardFixture(); f.guard.start(); f.guard.stop();
  const timer = f.clock.pending()[0];
  f.guard.dispose();
  const after = f.guard.state();
  f.guard.dispose(); f.wire.deliver(signal()); f.wire.error(); f.clock.invoke(timer);
  assert.equal(f.guard.start(), false);
  assert.equal(f.guard.stop(), false);
  assert.equal(f.guard.noteResume(), false);
  assert.deepEqual(f.guard.state(), after);
  assert.equal(f.clock.pending().length, 0);
});

test("observer exceptions cannot stop protection or reactivate transport", () => {
  const f = guardFixture({ onChange() { throw Error("observer"); } });
  assert(f.guard.start());
  assert(f.guard.stop());
  f.clock.advance(2000);
  assert.equal(f.guard.state().phase, "complete");
  assert.equal(f.stops.length, 1);
  f.guard.dispose();
});

test("dispose during the cleanup callback prevents message publication", () => {
  let f;
  f = guardFixture({ onStop() { f.guard.dispose(); return true; } });
  f.guard.start();
  assert.equal(f.guard.stop(), false);
  assert.equal(f.wire.posts.length, 0);
  assert.equal(f.clock.pending().length, 0);
  assert.equal(f.guard.state().phase, "disposed");
});

test("reentrant resume and stop from cleanup cannot bypass the active transition", () => {
  let f, resumed, repeated;
  f = guardFixture({ onStop() {
    resumed = f.guard.noteResume(); repeated = f.guard.stop(); return true;
  } });
  f.guard.start(); f.guard.stop();
  assert.equal(resumed, false);
  assert.equal(repeated, false);
  assert.equal(f.wire.posts.length, 1);
  f.guard.dispose();
});

for (const value of [0, -1, 1.5, 5001, Infinity, "2000", null]) {
  test("invalid receipt deadline rejected: " + value, () => {
    assert.throws(() => guardFixture({ receiptMs: value }), { code: "TAB_CONFIG" });
  });
}

for (const key of ["onStop", "onChange", "now", "schedule", "unschedule"]) {
  test("invalid capability rejected at construction: " + key, () => {
    assert.throws(() => guardFixture({ [key]: null }), { code: "TAB_CONFIG" });
  });
}
