import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { withDiagnosticInterrupt, DiagnosticInterruptError } from "../scripts/public-diagnostic-interrupt.js";

test("normal and failed diagnostic operations restore existing signal handlers", async () => {
  const events = new EventEmitter(), keep = () => {};
  events.on("SIGINT", keep); events.on("SIGTERM", keep);
  for (let i = 0; i < 20; i++) {
    assert.equal(await withDiagnosticInterrupt(signal => {
      assert.equal(signal.aborted, false); return 42;
    }, events), 42);
    const failure = new Error("fixture");
    await assert.rejects(withDiagnosticInterrupt(() => { throw failure; }, events), error => error === failure);
    assert.deepEqual(events.listeners("SIGINT"), [keep]);
    assert.deepEqual(events.listeners("SIGTERM"), [keep]);
  }
});

test("first interrupt controls exit status and a late successful result is never returned", async () => {
  const events = new EventEmitter();
  await assert.rejects(withDiagnosticInterrupt(signal => {
    let aborted = 0; signal.addEventListener("abort", () => aborted++);
    events.emit("SIGTERM"); events.emit("SIGINT"); events.emit("SIGTERM");
    assert.equal(signal.aborted, true); assert.equal(aborted, 1);
    return "late success";
  }, events), error => error instanceof DiagnosticInterruptError && error.exitCode === 143);
  assert.equal(events.listenerCount("SIGINT"), 0);
  assert.equal(events.listenerCount("SIGTERM"), 0);
});

test("a cancelled transport failure uses the interruption result without private detail", async () => {
  const events = new EventEmitter();
  await assert.rejects(withDiagnosticInterrupt(() => {
    events.emit("SIGINT"); throw new Error("PRIVATE_TRANSPORT_DETAIL");
  }, events), error => error.code === "CLI_INTERRUPTED" && error.exitCode === 130 && !error.message.includes("PRIVATE"));
  assert.equal(events.eventNames().length, 0);
});
