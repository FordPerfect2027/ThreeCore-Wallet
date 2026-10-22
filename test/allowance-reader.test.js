import test from "node:test";
import assert from "node:assert/strict";
import { readAllowanceSnapshot } from "../src/allowance-reader.js";
import { UINT256_MAX } from "../src/token-identity-codec.js";
import { targets, record, fakeReader, S1, S2, HASH, OTHER, deferred, tick, code } from "./helpers/allowance-fixtures.js";

test("allowance reader: all requests pinned and targets observed in caller order", async () => {
  const f = fakeReader();
  const result = await readAllowanceSnapshot(f.session, targets());
  assert.deepEqual(result, record());
  assert.deepEqual(f.calls.filter(c => c[0] === "allowance"), [
    ["allowance", targets().tokenAddress, S1, HASH],
    ["allowance", targets().tokenAddress, S2, HASH],
  ]);
  assert.equal(f.calls.at(-1)[0], "block");
  assert.equal(f.calls.at(-1)[1], "0x2a");
  assert(f.calls.filter(c => c[0] !== "block").every(c => c.at(-1) === HASH));
});
for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chain of [8453, 84532]) {
    test("allowance reader: independent catalog scope " + agent + "/" + chain, async () => {
      const f = fakeReader({}, agent, chain);
      const result = await readAllowanceSnapshot(f.session, targets(agent, chain));
      assert.equal(result.identity.agent, agent);
      assert.equal(result.identity.chainId, chain);
      assert.equal(result.targets.tokenAddress, targets(agent, chain).tokenAddress);
    });
  }
}
test("allowance reader: absent spender code does not skip allowance read", async () => {
  const f = fakeReader();
  const original = f.session.getContractCode;
  f.session.getContractCode = async (address, hash) => {
    if (address === S2) return { address, deployed: false };
    return original(address, hash);
  };
  const result = await readAllowanceSnapshot(f.session, targets());
  assert.equal(result.rows[1].hasCode, false);
  assert.equal(result.rows[1].allowanceBaseUnits, "10");
  assert.equal(f.calls.filter(c => c[0] === "allowance").length, 2);
});
test("allowance reader: absent token code skips every allowance call", async () => {
  const f = fakeReader({ hasCode: false, metadata: null, balanceBaseUnits: null });
  const result = await readAllowanceSnapshot(f.session, targets());
  assert(result.rows.every(r => r.allowanceError === "TOKEN_UNAVAILABLE"));
  assert.equal(f.calls.filter(c => c[0] === "allowance").length, 0);
});
test("allowance reader: one failing amount preserves other independent rows", async () => {
  const f = fakeReader();
  const original = f.session.getTokenAllowance;
  f.session.getTokenAllowance = async (token, spender, hash) => {
    if (spender === S1) throw Error("provider private details");
    return original(token, spender, hash);
  };
  const result = await readAllowanceSnapshot(f.session, targets());
  assert.equal(result.rows[0].allowanceBaseUnits, null);
  assert.equal(result.rows[0].allowanceError, "READ_FAILED");
  assert.equal(result.rows[1].allowanceBaseUnits, "10");
  assert(!JSON.stringify(result).includes("private details"));
});
test("allowance reader: code failure and amount success are independent", async () => {
  const f = fakeReader();
  const original = f.session.getContractCode;
  f.session.getContractCode = async (address, hash) => {
    if (address === S1) throw Error("failed");
    return original(address, hash);
  };
  const result = await readAllowanceSnapshot(f.session, targets());
  assert.equal(result.rows[0].hasCode, null);
  assert.equal(result.rows[0].codeError, "READ_FAILED");
  assert.equal(result.rows[0].allowanceBaseUnits, "0");
});
for (const invalid of [0, "0", -1n, UINT256_MAX + 1n, null, {}, undefined]) {
  test("allowance reader: malformed amount remains unknown " + String(invalid), async () => {
    const f = fakeReader();
    f.session.getTokenAllowance = async () => invalid;
    const result = await readAllowanceSnapshot(f.session, targets());
    assert(result.rows.every(r => r.allowanceError === "INVALID_RESPONSE" && r.allowanceBaseUnits === null));
  });
}
for (const invalid of [null, {}, { address: S2, deployed: true }, { address: S1, deployed: 1 }]) {
  test("allowance reader: malformed spender code " + JSON.stringify(invalid), async () => {
    const f = fakeReader();
    const original = f.session.getContractCode;
    f.session.getContractCode = async (address, hash) => address === S1 ? invalid : original(address, hash);
    const result = await readAllowanceSnapshot(f.session, targets());
    assert.equal(result.rows[0].codeError, "INVALID_RESPONSE");
    assert.equal(result.rows[0].allowanceBaseUnits, "0");
  });
}
for (const value of [0, -1, 1.5, NaN, Infinity, 120001, "100"]) {
  test("allowance reader: invalid timeout " + String(value), async () => {
    const f = fakeReader();
    await assert.rejects(readAllowanceSnapshot(f.session, targets(), { timeoutMs: value }), code("ALLOWANCE_TIMEOUT_OPTION"));
    assert.equal(f.calls.length, 0);
  });
}
for (const [options, expected] of [
  [{ signal: {} }, "ALLOWANCE_SIGNAL"], [{ onProgress: true }, "ALLOWANCE_OBSERVER"],
]) {
  test("allowance reader: validate options before RPC " + expected, async () => {
    const f = fakeReader();
    await assert.rejects(readAllowanceSnapshot(f.session, targets(), options), code(expected));
    assert.equal(f.calls.length, 0);
  });
}
for (const capability of ["canSign", "canSendTransactions", "canBridge"]) {
  test("allowance reader: accepts only read-only session " + capability, async () => {
    const f = fakeReader();
    f.state[capability] = true;
    await assert.rejects(readAllowanceSnapshot(f.session, targets()), code("ALLOWANCE_CAPABILITIES"));
    assert.equal(f.calls.length, 0);
  });
}
test("allowance reader: disconnected and wrong catalog rejected before RPC", async () => {
  const f = fakeReader();
  f.state.connected = false;
  await assert.rejects(readAllowanceSnapshot(f.session, targets()), code("ALLOWANCE_NOT_CONNECTED"));
  f.state.connected = true;
  await assert.rejects(readAllowanceSnapshot(f.session, targets("EMA")), code("ALLOWANCE_CONTEXT_CHANGED"));
  assert.equal(f.calls.length, 0);
});
for (const field of ["account", "chainId", "agent", "connectionEpoch", "siteOrigin", "connected"]) {
  for (const reject of [false, true]) {
    test("allowance reader: session change during amount is fatal " + field + "/" + reject, async () => {
      const f = fakeReader();
      f.session.getTokenAllowance = async () => {
        f.state[field] = { account: OTHER, chainId: 84532, agent: "EMA",
          connectionEpoch: 9, siteOrigin: "http://127.0.0.1:9999", connected: false }[field];
        if (reject) throw Error("disconnected");
        return 0n;
      };
      await assert.rejects(readAllowanceSnapshot(f.session, targets()), code("ALLOWANCE_SESSION_CHANGED"));
      assert.equal(f.calls.filter(c => c[0] === "code" && c[1] === S2).length, 0);
    });
  }
}
test("allowance reader: pre-aborted signal does not touch session RPC", async () => {
  const f = fakeReader();
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(readAllowanceSnapshot(f.session, targets(), { signal: abort.signal }), code("ALLOWANCE_CANCELLED"));
  assert.equal(f.calls.length, 0);
});
test("allowance reader: cancellation releases caller and makes late reply inert", async () => {
  const f = fakeReader();
  const pending = deferred();
  f.session.getTokenAllowance = () => pending.promise;
  const abort = new AbortController();
  const promise = readAllowanceSnapshot(f.session, targets(), { signal: abort.signal });
  await tick();
  abort.abort();
  await assert.rejects(promise, code("ALLOWANCE_CANCELLED"));
  const calls = f.calls.length;
  pending.resolve(0n);
  await tick();
  assert.equal(f.calls.length, calls);
});
test("allowance reader: whole operation timeout includes stalled spender response", async () => {
  const f = fakeReader();
  const pending = deferred();
  f.session.getTokenAllowance = () => pending.promise;
  const promise = readAllowanceSnapshot(f.session, targets(), { timeoutMs: 20 });
  await assert.rejects(promise, code("ALLOWANCE_TIMEOUT"));
  const calls = f.calls.length;
  pending.reject(Error("late"));
  await tick();
  assert.equal(f.calls.length, calls);
});
test("allowance reader: timeout while token read is pending uses allowance timeout", async () => {
  const f = fakeReader();
  const pending = deferred();
  f.session.getBlockSnapshot = () => pending.promise;
  await assert.rejects(readAllowanceSnapshot(f.session, targets(), { timeoutMs: 20 }), code("ALLOWANCE_TIMEOUT"));
  pending.resolve({ number: "0x2a", hash: HASH });
  await tick();
  assert.equal(f.calls.length, 0);
});
test("allowance reader: progress cancellation stops next provider call", async () => {
  const f = fakeReader();
  const abort = new AbortController();
  await assert.rejects(readAllowanceSnapshot(f.session, targets(), {
    signal: abort.signal,
    onProgress(value) { if (value.stage === "spender-code") abort.abort(); },
  }), code("ALLOWANCE_CANCELLED"));
  assert.equal(f.calls.filter(c => c[0] === "allowance").length, 0);
});
test("allowance reader: progress has bounded immutable totals and reaches completion", async () => {
  const f = fakeReader();
  const events = [];
  await readAllowanceSnapshot(f.session, targets(), { onProgress: value => events.push(value) });
  assert.equal(events[0].stage, "token");
  assert.equal(events.at(-1).stage, "complete");
  assert.equal(events.at(-1).completed, 2);
  assert(events.every(e => e.total === 2 && Object.isFrozen(e)));
  assert(events.every((e, i) => i === 0 || e.completed >= events[i - 1].completed));
});
for (const asyncFailure of [false, true]) {
  test("allowance reader: failed progress observer cannot fail observation " + asyncFailure, async () => {
    const f = fakeReader();
    const result = await readAllowanceSnapshot(f.session, targets(), {
      onProgress() { if (asyncFailure) return Promise.reject(Error("observer")); throw Error("observer"); },
    });
    assert.equal(result.rows.length, 2);
    await tick();
  });
}
for (const final of [
  { number: "0x2b", hash: HASH }, { number: "0x2a", hash: "0x" + "cd".repeat(32) },
  { number: 42, hash: HASH }, { number: "0x", hash: HASH }, null,
]) {
  test("allowance reader: final canonical block mismatch " + JSON.stringify(final), async () => {
    const f = fakeReader();
    let count = 0;
    const original = f.session.getBlockSnapshot;
    f.session.getBlockSnapshot = async tag => ++count === 3 ? final : original(tag);
    await assert.rejects(readAllowanceSnapshot(f.session, targets()), code("ALLOWANCE_BLOCK_CHANGED"));
  });
}
test("allowance reader: caller mutation during asynchronous reads cannot alter targets", async () => {
  const f = fakeReader();
  const pending = deferred();
  const original = f.session.getBlockSnapshot;
  let first = true;
  f.session.getBlockSnapshot = async tag => {
    if (first) { first = false; await pending.promise; }
    return original(tag);
  };
  const plan = targets();
  const promise = readAllowanceSnapshot(f.session, plan);
  plan.targets[0].address = OTHER;
  plan.targets[0].label = "changed";
  pending.resolve();
  const result = await promise;
  assert.equal(result.targets.targets[0].address, S1);
  assert.equal(result.targets.targets[0].label, "Exchange A");
});
