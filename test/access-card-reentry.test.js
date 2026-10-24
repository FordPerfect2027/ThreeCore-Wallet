import test from "node:test";
import assert from "node:assert/strict";
import { cardFixture, agents, A, flush } from "./helpers/access-lifecycle.js";

for (const agent of agents) {
  for (const action of ["disconnect", "dispose"]) {
    test(`${agent}: ${action} in connecting observer prevents session construction`, async t => {
      const f = cardFixture(t, { agent, onChange(state, card) {
        if (state.phase === "connecting") card[action]();
      } });
      assert.equal(await f.connect(), false);
      assert.equal(f.sessions.length, 0);
      assert.equal(f.calls.length, 0);
      assert.equal(f.card.state.phase, action === "dispose" ? "disposed" : "disconnected");
    });
    for (const phase of ["factory", "on"]) {
      test(`${agent}: ${action} during ${phase} disposes a newly produced session`, async t => {
        let acted = false;
        const f = cardFixture(t, { agent, hook(name, { card }) {
          if (name === phase && !acted) { acted = true; card[action](); }
        } });
        assert.equal(await f.connect(), false);
        assert.equal(f.sessions.length, 1);
        assert.equal(f.calls.filter(name => name === "connect").length, 0);
        assert.equal(f.calls.filter(name => name === "disconnect").length, 1);
        assert([...f.listeners.values()].every(set => set.size === 0));
        for (const [, fn] of f.oldListeners) fn([A]);
        assert.equal(f.card.state.result, null);
      });
    }
  }
  for (const phase of ["remove", "disconnect"]) {
    test(`${agent}: cleanup ${phase} cannot create a replacement session`, async t => {
      const attempts = [];
      let active = false, f;
      f = cardFixture(t, { agent, hook(name) {
        if (active && name === phase) attempts.push(f.connect());
      } });
      assert.equal(await f.connect(), true);
      active = true;
      f.card.disconnect();
      assert((await Promise.all(attempts)).every(value => value === false));
      assert.equal(f.sessions.length, 1);
      assert.equal(f.card.state.phase, "disconnected");
      assert.equal(f.card.state.connection, null);
      assert([...f.listeners.values()].every(set => set.size === 0));
    });
  }
  test(`${agent}: disposed state is visible during extension cleanup`, async t => {
    let active = false;
    const observed = [];
    const f = cardFixture(t, { agent, hook(name, { card }) {
      if (active && name === "disconnect") observed.push(card.connect({}), card.readBalances());
    } });
    await f.connect();
    active = true;
    f.card.dispose();
    assert.deepEqual(await Promise.all(observed), [false, false]);
    assert.equal(f.sessions.length, 1);
    assert.equal(f.card.state.phase, "disposed");
  });
}

for (const outcome of ["throw", "reject", "thenThrow"]) {
  test(`an observer ${outcome} cannot interrupt disconnect cleanup`, async t => {
    const f = cardFixture(t, { onChange() {
      if (outcome === "throw") throw Error("private observer failure");
      if (outcome === "reject") return Promise.reject(Error("private observer failure"));
      return { then() { throw Error("private observer failure"); } };
    } });
    assert.equal(await f.connect(), true);
    assert.equal(await f.card.readBalances(), true);
    assert.equal(f.card.disconnect(), true);
    await flush();
    assert.equal(f.card.state.phase, "disconnected");
    assert.equal(f.card.state.error, null);
    assert.equal(f.card.state.result, null);
    assert([...f.listeners.values()].every(set => set.size === 0));
  });
}

for (const kind of ["throw", "reject", "false"]) {
  test(`session cleanup ${kind} is reported without retaining its view`, async t => {
    let fail = false;
    const f = cardFixture(t, { hook(name) {
      if (name !== "disconnect" || !fail) return;
      if (kind === "throw") throw Error("private close error");
      if (kind === "reject") return Promise.reject(Error("private async close"));
      return false;
    } });
    await f.connect();
    await f.card.readBalances();
    fail = true;
    assert.equal(f.card.disconnect(), false);
    await flush();
    assert.equal(f.card.state.phase, "disconnected");
    assert.equal(f.card.state.result, null);
    assert.equal(f.card.state.connection, null);
    assert.equal(f.card.state.error, null);
    assert.equal(await f.card.readBalances(), false);
  });
}

test("recursive stop from disconnected observer does not recurse notifications", async t => {
  let notifications = 0;
  const f = cardFixture(t, { onChange(state, card) {
    notifications++;
    if (state.phase === "disconnected") card.disconnect();
  } });
  await f.connect();
  const before = notifications;
  f.card.disconnect();
  assert.equal(notifications, before + 1);
  assert.equal(f.card.state.phase, "disconnected");
});

test("observer cannot automatically launch a balance read after connect", async t => {
  const attempts = [];
  const f = cardFixture(t, { onChange(state, card) {
    if (state.phase === "connected") attempts.push(card.readBalances());
  } });
  assert.equal(await f.connect(), true);
  assert.deepEqual(await Promise.all(attempts), [false]);
  assert(!f.calls.includes("block"));
  assert.equal(await f.card.readBalances(), true, "Later explicit reads remain enabled");
});

test("state getter disposal during publish cannot overwrite terminal state", async t => {
  let terminate = false;
  const f = cardFixture(t, { hook(name, { card }) {
    if (name === "state" && terminate) { terminate = false; card.dispose(); }
  } });
  await f.connect();
  terminate = true;
  f.card.clearResult();
  assert.equal(f.card.state.phase, "disposed");
  assert.equal(f.card.state.connection, null);
});

for (const agent of agents) {
  for (const action of ["disconnect", "dispose"]) {
    test(`${agent}: ${action} while publishing connected cannot return success`, async t => {
      const f = cardFixture(t, { agent, onChange(state, card) {
        if (state.phase === "connected") card[action]();
      } });
      assert.equal(await f.connect(), false);
      assert.equal(f.card.state.result, null);
      assert.equal(f.card.state.phase, action === "dispose" ? "disposed" : "disconnected");
    });
  }
  for (const action of ["clearResult", "disconnect", "dispose"]) {
    test(`${agent}: ${action} while publishing a result cannot return an accepted result`, async t => {
      const f = cardFixture(t, { agent, onChange(state, card) {
        if (state.result) card[action]();
      } });
      assert.equal(await f.connect(), true);
      assert.equal(await f.card.readBalances(), false);
      assert.equal(f.card.state.result, null);
    });
  }
}
