import test from "node:test";
import assert from "node:assert/strict";
import { readTokenIdentity } from "../src/token-identity-reader.js";
import { catalogToken } from "../src/token-catalog.js";
import { readerSession, code, HASH, OTHER, deferred, tick } from "./helpers/identity-fixtures.js";

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chain of [8453, 84532]) {
    test(`${agent} ${chain} uses one pinned block for every token field`, async () => {
      const f = readerSession({}, agent, chain);
      const result = await readTokenIdentity(f.session);
      assert.deepEqual(result, f.row);
      assert.deepEqual(f.calls.map(call => call[0]), ["block", "code", "native", "metadata", "balance", "block"]);
      assert.equal(f.calls[1][2], HASH);
      assert.equal(f.calls[2][1], HASH);
      assert.equal(f.calls[3][2], HASH);
      assert.equal(f.calls[4][2], HASH);
      assert.equal(f.calls[5][1], "0x2a");
      assert.equal(Object.isFrozen(result), true);
    });
  }
}

test("wrong token address is rejected before any provider access", async () => {
  const f = readerSession();
  await assert.rejects(readTokenIdentity(f.session, { tokenAddress: OTHER }), code("IDENTITY_CONTRACT_MISMATCH"));
  assert.deepEqual(f.calls, []);
});

test("mainnet and Sepolia addresses cannot be interchanged", async () => {
  const f = readerSession();
  const testToken = catalogToken({ agent: "DAT", chainId: 84532 });
  await assert.rejects(readTokenIdentity(f.session, { tokenAddress: testToken.address }), code("IDENTITY_CONTRACT_MISMATCH"));
  assert.deepEqual(f.calls, []);
});

test("no code means metadata and balance RPCs are skipped", async () => {
  const f = readerSession({ hasCode: false, metadata: null, balanceBaseUnits: null });
  const result = await readTokenIdentity(f.session);
  assert.equal(result.metadata, null);
  assert.equal(result.balanceBaseUnits, null);
  assert.deepEqual(f.calls.map(call => call[0]), ["block", "code", "native", "block"]);
});

for (const field of ["connected", "canSign", "canSendTransactions", "canBridge"]) {
  test("refuses unsafe session state: " + field, async () => {
    const f = readerSession();
    f.state[field] = field !== "connected";
    await assert.rejects(readTokenIdentity(f.session));
    assert.deepEqual(f.calls, []);
  });
}

for (const method of ["getBlockSnapshot", "getContractCode", "getNativeBalance", "getTokenMetadata", "getTokenBalance"]) {
  test("missing session reader fails before use: " + method, async () => {
    const f = readerSession();
    delete f.session[method];
    await assert.rejects(readTokenIdentity(f.session), code("IDENTITY_SESSION"));
    assert.deepEqual(f.calls, []);
  });
}

for (const [field, value] of [["account", OTHER], ["chainId", 84532], ["agent", "EMA"],
  ["connectionEpoch", 2], ["siteOrigin", "http://localhost:4188"], ["connected", false]]) {
  test("mid-read identity change rejects observation: " + field, async () => {
    const f = readerSession();
    const original = f.session.getTokenMetadata;
    f.session.getTokenMetadata = async (...args) => {
      const result = await original(...args);
      f.state[field] = value;
      return result;
    };
    await assert.rejects(readTokenIdentity(f.session), code("IDENTITY_SESSION_CHANGED"));
    assert.equal(f.calls.some(call => call[0] === "balance"), false);
  });
}

test("canonical block change causes the entire observation to fail", async () => {
  const f = readerSession();
  const original = f.session.getBlockSnapshot;
  f.session.getBlockSnapshot = async tag => {
    const result = await original(tag);
    return tag === undefined ? result : { ...result, hash: "0x" + "cd".repeat(32) };
  };
  await assert.rejects(readTokenIdentity(f.session), code("IDENTITY_BLOCK_CHANGED"));
});

for (const value of [null, { number: "42", hash: HASH }, { number: "0x02a", hash: HASH },
  { number: "0x2a", hash: "0x12" }, { number: "0x-1", hash: HASH }]) {
  test("invalid header is rejected: " + JSON.stringify(value), async () => {
    const f = readerSession();
    f.session.getBlockSnapshot = async () => value;
    await assert.rejects(readTokenIdentity(f.session), code("IDENTITY_BLOCK"));
    assert.deepEqual(f.calls, []);
  });
}

test("code result must belong to the exact requested address", async () => {
  const f = readerSession();
  f.session.getContractCode = async () => ({ address: OTHER, deployed: true });
  await assert.rejects(readTokenIdentity(f.session), code("IDENTITY_CODE"));
});

test("invalid code result flags are rejected", async () => {
  const f = readerSession();
  f.session.getContractCode = async address => ({ address, deployed: 1 });
  await assert.rejects(readTokenIdentity(f.session), code("IDENTITY_CODE"));
});

for (const amount of ["1", 1, -1n, 1n << 256n]) {
  test("native result must be valid bigint units: " + String(amount), async () => {
    const f = readerSession();
    f.session.getNativeBalance = async () => amount;
    await assert.rejects(readTokenIdentity(f.session), code("IDENTITY_AMOUNT"));
  });
}

for (const amount of ["1", 1, -1n, 1n << 256n]) {
  test("token result must be valid bigint units: " + String(amount), async () => {
    const f = readerSession();
    f.session.getTokenBalance = async () => amount;
    await assert.rejects(readTokenIdentity(f.session), code("IDENTITY_AMOUNT"));
  });
}

test("already aborted request performs no reads", async () => {
  const f = readerSession();
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(readTokenIdentity(f.session, { signal: abort.signal }), code("IDENTITY_CANCELLED"));
  assert.deepEqual(f.calls, []);
});

test("cancellation stops the local wait and no delayed result is exposed", async () => {
  const f = readerSession();
  const gate = deferred();
  const abort = new AbortController();
  f.session.getTokenMetadata = () => gate.promise;
  const reading = readTokenIdentity(f.session, { signal: abort.signal });
  await tick();
  abort.abort();
  await assert.rejects(reading, code("IDENTITY_CANCELLED"));
  gate.resolve(f.row.metadata);
  await tick();
  assert.equal(f.calls.some(call => call[0] === "balance"), false);
});

test("deadline expires a stuck metadata read", async () => {
  const f = readerSession();
  const gate = deferred();
  f.session.getTokenMetadata = () => gate.promise;
  await assert.rejects(readTokenIdentity(f.session, { timeoutMs: 10 }), code("IDENTITY_TIMEOUT"));
  gate.resolve(f.row.metadata);
  await tick();
  assert.equal(f.calls.some(call => call[0] === "balance"), false);
});

for (const timeoutMs of [0, -1, 120001, 1.5, "100", NaN]) {
  test("invalid deadline is rejected: " + String(timeoutMs), async () => {
    const f = readerSession();
    await assert.rejects(readTokenIdentity(f.session, { timeoutMs }), code("IDENTITY_TIMEOUT_OPTION"));
    assert.deepEqual(f.calls, []);
  });
}

test("invalid signal and observer rejected without provider reads", async () => {
  const f = readerSession();
  await assert.rejects(readTokenIdentity(f.session, { signal: {} }), code("IDENTITY_SIGNAL"));
  await assert.rejects(readTokenIdentity(f.session, { onProgress: "yes" }), code("IDENTITY_OBSERVER"));
  assert.deepEqual(f.calls, []);
});

test("progress callback errors cannot alter a complete observation", async () => {
  const f = readerSession();
  let calls = 0;
  const result = await readTokenIdentity(f.session, { onProgress() { calls++; throw Error("Display"); } });
  assert.equal(result.blockNumber, "42");
  assert.equal(calls, 7);
});

test("async observer rejection is handled without leaking an unhandled rejection", async () => {
  const f = readerSession();
  const result = await readTokenIdentity(f.session, { onProgress: async () => { throw Error("Display"); } });
  assert.equal(result.blockNumber, "42");
  await tick();
});

test("observer-triggered abort prevents the first RPC", async () => {
  const f = readerSession();
  const abort = new AbortController();
  await assert.rejects(readTokenIdentity(f.session, { signal: abort.signal,
    onProgress() { abort.abort(); } }), code("IDENTITY_CANCELLED"));
  assert.deepEqual(f.calls, []);
});

test("complete-stage invalidation is still rejected before return", async () => {
  const f = readerSession();
  await assert.rejects(readTokenIdentity(f.session, { onProgress(event) {
    if (event.stage === "complete") f.state.connectionEpoch++;
  } }), code("IDENTITY_SESSION_CHANGED"));
});

test("options are captured before caller mutation", async () => {
  const f = readerSession();
  const gate = deferred();
  const original = f.session.getBlockSnapshot;
  f.session.getBlockSnapshot = async tag => { if (!tag) await gate.promise; return original(tag); };
  const options = { tokenAddress: f.row.tokenAddress };
  const pending = readTokenIdentity(f.session, options);
  options.tokenAddress = OTHER;
  gate.resolve();
  assert.equal((await pending).tokenAddress, f.row.tokenAddress);
});
