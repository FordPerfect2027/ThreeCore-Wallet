import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioController } from "../src/portfolio-controller.js";

const result = label => Object.freeze({ readOnly: true, securityAudit: false,
  holdings: Object.freeze([]), label });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const requests = [];
  const controller = createPortfolioController({ reader(session, options) {
    const task = deferred();
    requests.push({ ...task, session, options });
    return task.promise;
  } });
  return { controller, requests };
}

test("ready observer clearing the result cannot leave a successful stale return value", async () => {
  const f = fixture();
  f.controller.subscribe(state => {
    if (state.status === "ready") f.controller.clear();
  });
  const pending = f.controller.refresh({});
  f.requests[0].resolve(result("obsolete"));
  assert.equal((await pending).accepted, false);
  assert.equal(f.controller.state.status, "idle");
  assert.equal(f.controller.state.result, null);
});

test("refresh publishes one current immutable result", async () => {
  const f = fixture();
  assert.equal(f.controller.state.status, "idle");
  const pending = f.controller.refresh({}, { tokens: ["one"] });
  assert.equal(f.controller.state.status, "loading");
  const value = result("first");
  f.requests[0].resolve(value);
  assert.deepEqual(await pending, { accepted: true, result: value });
  assert.equal(f.controller.state.status, "ready");
  assert.equal(f.controller.state.result, value);
  assert.ok(Object.isFrozen(f.controller.state));
});

for (const oldOutcome of ["resolve", "reject"]) {
  test("new refresh suppresses previous late " + oldOutcome, async () => {
    const f = fixture();
    const first = f.controller.refresh({ name: "old" });
    const second = f.controller.refresh({ name: "new" });
    assert.equal(f.requests[0].options.signal.aborted, true);
    f.requests[1].resolve(result("new"));
    assert.equal((await second).accepted, true);
    f.requests[0][oldOutcome](oldOutcome === "resolve" ? result("old") : Error("old"));
    assert.equal((await first).accepted, false);
    assert.equal(f.controller.state.result.label, "new");
  });
}

for (const action of ["cancel", "clear", "dispose"]) {
  for (const outcome of ["resolve", "reject"]) {
    test(action + " suppresses a late " + outcome, async () => {
      const f = fixture();
      const pending = f.controller.refresh({});
      f.controller[action]();
      const expected = f.controller.state;
      assert.equal(f.requests[0].options.signal.aborted, true);
      f.requests[0][outcome](outcome === "resolve" ? result("late") : Error("late"));
      assert.equal((await pending).accepted, false);
      assert.equal(f.controller.state, expected);
      assert.equal(f.controller.state.result, null);
    });
  }
}

test("caller abort is forwarded even when a custom reader resolves successfully", async () => {
  const f = fixture();
  const abort = new AbortController();
  const pending = f.controller.refresh({}, { signal: abort.signal });
  abort.abort();
  assert.equal(f.requests[0].options.signal.aborted, true);
  f.requests[0].resolve(result("late"));
  assert.equal((await pending).accepted, false);
  assert.equal(f.controller.state.status, "cancelled");
});

test("loading notification can cancel before any reader call", async () => {
  const f = fixture();
  f.controller.subscribe(state => { if (state.status === "loading") f.controller.cancel(); });
  assert.equal((await f.controller.refresh({})).accepted, false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.controller.state.status, "cancelled");
});

test("loading notification can dispose before any reader call", async () => {
  const f = fixture();
  f.controller.subscribe(state => { if (state.status === "loading") f.controller.dispose(); });
  assert.equal((await f.controller.refresh({})).accepted, false);
  assert.equal(f.requests.length, 0);
});

test("observer exceptions do not prevent successful read or cleanup", async () => {
  const f = fixture();
  f.controller.subscribe(() => { throw Error("broken rendering"); });
  const pending = f.controller.refresh({});
  f.requests[0].resolve(result("ok"));
  assert.equal((await pending).accepted, true);
  assert.equal(f.controller.state.status, "ready");
});

test("unsubscribe stops notifications without cancelling refresh", async () => {
  const f = fixture();
  let notifications = 0;
  const unsubscribe = f.controller.subscribe(() => notifications++);
  const pending = f.controller.refresh({});
  unsubscribe();
  f.requests[0].resolve(result("ok"));
  await pending;
  assert.equal(notifications, 1);
});

test("caller changes to the token plan do not affect the reader", async () => {
  const f = fixture();
  const tokens = ["one"];
  const pending = f.controller.refresh({}, { tokens });
  tokens[0] = "two";
  assert.deepEqual(f.requests[0].options.tokens, ["one"]);
  f.requests[0].resolve(result("ok"));
  await pending;
});

for (const bad of [null, {}, { readOnly: false }, Object.freeze({readOnly: true, securityAudit: true, holdings: []})]) {
  test("invalid reader result cannot become ready: " + JSON.stringify(bad), async () => {
    const f = fixture();
    const pending = f.controller.refresh({});
    f.requests[0].resolve(bad);
    assert.equal((await pending).accepted, false);
    assert.equal(f.controller.state.status, "error");
    assert.equal(f.controller.state.errorCode, "INVALID_SNAPSHOT");
  });
}

test("raw error messages and hostile error code getters are not exposed", async () => {
  const f = fixture();
  const pending = f.controller.refresh({});
  f.requests[0].reject({ get code() { throw Error("secret"); }, message: "sensitive payload" });
  await pending;
  assert.equal(f.controller.state.errorCode, "SNAPSHOT_FAILED");
  assert.equal(JSON.stringify(f.controller.state).includes("sensitive"), false);
});

test("known structured error code remains available without the raw error", async () => {
  const f = fixture();
  const pending = f.controller.refresh({});
  f.requests[0].reject(Object.assign(Error("provider raw error"), { code: "WRONG_CHAIN" }));
  await pending;
  assert.equal(f.controller.state.errorCode, "WRONG_CHAIN");
  assert.equal(f.controller.state.result, null);
});

test("disposed controller forbids new operations and disposal is idempotent", async () => {
  const f = fixture();
  f.controller.dispose();
  f.controller.dispose();
  await assert.rejects(f.controller.refresh({}), /disposed/);
  assert.throws(() => f.controller.cancel(), /disposed/);
  assert.throws(() => f.controller.clear(), /disposed/);
  assert.throws(() => f.controller.subscribe(() => {}), /disposed/);
  assert.equal(f.requests.length, 0);
});
