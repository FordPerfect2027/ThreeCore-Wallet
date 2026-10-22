import test from "node:test";
import assert from "node:assert/strict";
import { parseAllowanceTargets, formatAllowanceTargets, validateAllowanceTargets } from "../src/allowance-targets.js";
import { validateAllowanceObservation, summarizeAllowances, compareAllowances, filterAllowances } from "../src/allowance-observation.js";
import { readAllowanceSnapshot } from "../src/allowance-reader.js";
import { prepareAllowanceFile, decodeAllowanceFile } from "../src/allowance-file.js";
import { captureAllowanceBundle, prepareAllowanceBundle, decodeAllowanceBundle } from "../src/allowance-bundle.js";
import { record, targets, fakeReader, clone, nextRecord, S1, S2, OTHER, HASH, deferred, tick, code } from "./helpers/allowance-fixtures.js";

function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value;
  };
}
function varied(seed, count, agent = "DAT", chainId = 8453) {
  const random = seeded(seed);
  const value = record({}, agent, chainId);
  value.targets.targets = Array.from({ length: count }, (_, i) => ({
    address: "0x" + (BigInt(seed) * 100n + BigInt(i + 1)).toString(16).padStart(40, "0"),
    label: "Target " + seed + "-" + i,
  }));
  value.rows = value.targets.targets.map((target, i) => {
    const mode = random() % 5;
    const amount = mode === 0 ? null : mode === 1 ? "0" : mode === 2 ? (2n ** 256n - 1n).toString()
      : (BigInt(random()) * 900719925474099312345n + BigInt(i)).toString();
    return {
      spenderAddress: target.address, label: target.label,
      hasCode: mode === 3 ? null : mode !== 4,
      codeError: mode === 3 ? "READ_FAILED" : null,
      allowanceBaseUnits: amount, allowanceError: amount === null ? "READ_FAILED" : null,
    };
  });
  return value;
}
for (const [seed, count] of [[1, 1], [2, 2], [9, 9], [17, 17], [20, 20]]) {
  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    for (const chainId of [8453, 84532]) {
      test("allowance invariants: bounded mixed rows round trip " + [seed, count, agent, chainId].join("/"), async () => {
        const value = varied(seed, count, agent, chainId);
        const original = clone(value);
        const valid = validateAllowanceObservation(value);
        const prepared = await prepareAllowanceFile("observation", valid);
        const decoded = await decodeAllowanceFile(new TextEncoder().encode(prepared.text));
        assert.deepEqual(decoded.payload, original);
        const s = summarizeAllowances(decoded.payload);
        assert.equal(s.knownAmounts + s.unknownAmounts, count);
        assert.equal(s.zeroAmounts + s.positiveAmounts + s.unknownAmounts, count);
        assert(s.maximumAmounts <= s.positiveAmounts);
        assert(s.completeRows <= count);
        assert.equal(s.totalExposure, null);
        for (const row of s.rows) {
          if (row.allowanceBaseUnits !== null) {
            assert.equal(row.smallerOfBalanceAndAllowance,
              (BigInt(row.allowanceBaseUnits) < BigInt(value.identity.balanceBaseUnits)
                ? BigInt(row.allowanceBaseUnits) : BigInt(value.identity.balanceBaseUnits)).toString());
          } else {
            assert.equal(row.smallerOfBalanceAndAllowance, null);
          }
        }
        assert.deepEqual(value, original);
        assert.deepEqual(parseAllowanceTargets(formatAllowanceTargets(valid.targets), valid.targets), valid.targets);
      });
    }
  }
}
for (const seed of [11, 21, 31, 41, 51]) {
  test("allowance invariants: filter partition never loses or duplicates a row " + seed, () => {
    const value = varied(seed, 20);
    const groups = ["zero", "nonzero", "unknown"].map(status => filterAllowances(value, { status }));
    assert.equal(groups.reduce((sum, rows) => sum + rows.length, 0), 20);
    assert.equal(new Set(groups.flat().map(row => row.spenderAddress)).size, 20);
    const source = clone(value);
    for (const row of value.rows) {
      assert.equal(filterAllowances(value, { search: row.spenderAddress }).length, 1);
    }
    assert.deepEqual(source, value);
  });
}
for (const raw of ["0", "1", "900719925474099312345", (2n ** 256n - 1n).toString()]) {
  test("allowance invariants: compare maximum boundary amount " + raw, () => {
    const before = record();
    const after = nextRecord(before);
    before.rows[0].allowanceBaseUnits = raw;
    after.rows[0].allowanceBaseUnits = "0";
    const compared = compareAllowances(before, after);
    assert.equal(compared.rows[0].deltaBaseUnits, (-BigInt(raw)).toString());
    const reversed = nextRecord(after);
    reversed.rows[0].allowanceBaseUnits = raw;
    assert.equal(compareAllowances(after, reversed).rows[0].deltaBaseUnits, raw);
  });
}
test("allowance invariants: partial observation can improve within the same block without inventing a delta", () => {
  const before = record();
  Object.assign(before.rows[0], { allowanceBaseUnits: null, allowanceError: "READ_FAILED" });
  const after = record();
  const result = compareAllowances(before, after);
  assert.equal(result.rows[0].status, "unknown");
  assert.equal(result.rows[0].deltaAmount, null);
});
test("allowance invariants: same-block comparison with relabelled rows still detects contradictions", () => {
  const before = record();
  const after = clone(before);
  after.rows.reverse();
  after.targets.targets.reverse();
  after.rows[1].allowanceBaseUnits = "1";
  assert.throws(() => compareAllowances(before, after), code("ALLOWANCE_SAME_BLOCK_CONFLICT"));
});
for (const stage of ["token", "spender-code", "allowance", "row-complete", "canonical", "complete"]) {
  test("allowance reader lifecycle: cancellation from each progress stage " + stage, async () => {
    const f = fakeReader();
    const abort = new AbortController();
    const promise = readAllowanceSnapshot(f.session, targets(), {
      signal: abort.signal,
      onProgress(event) { if (event.stage === stage) abort.abort(); },
    });
    await assert.rejects(promise, code("ALLOWANCE_CANCELLED"));
    const count = f.calls.length;
    await tick();
    assert.equal(f.calls.length, count);
  });
}
for (const stage of ["token", "spender-code", "allowance", "row-complete", "canonical", "complete"]) {
  test("allowance reader lifecycle: context mutation from each progress stage " + stage, async () => {
    const f = fakeReader();
    await assert.rejects(readAllowanceSnapshot(f.session, targets(), {
      onProgress(event) { if (event.stage === stage) f.state.account = OTHER; },
    }), code("ALLOWANCE_SESSION_CHANGED"));
  });
}
for (const method of ["getBlockSnapshot", "getContractCode", "getNativeBalance", "getTokenMetadata", "getTokenBalance"]) {
  test("allowance reader lifecycle: cancellation with stalled identity dependency " + method, async () => {
    const f = fakeReader();
    const original = f.session[method];
    const gate = deferred();
    let entered = false;
    f.session[method] = async (...args) => { entered = true; await gate.promise; return original(...args); };
    const abort = new AbortController();
    const promise = readAllowanceSnapshot(f.session, targets(), { signal: abort.signal });
    const rejected = assert.rejects(promise, code("ALLOWANCE_CANCELLED"));
    for (let i = 0; i < 100 && !entered; i++) await tick();
    assert(entered);
    abort.abort();
    await rejected;
    gate.resolve();
    await tick();
    assert.equal(f.calls.filter(call => call[0] === "allowance").length, 0);
  });
}
test("allowance reader lifecycle: stalled final canonical lookup can be cancelled", async () => {
  const f = fakeReader();
  const original = f.session.getBlockSnapshot;
  const gate = deferred();
  let calls = 0;
  f.session.getBlockSnapshot = async (...args) => {
    if (++calls === 3) await gate.promise;
    return original(...args);
  };
  const abort = new AbortController();
  const promise = readAllowanceSnapshot(f.session, targets(), { signal: abort.signal });
  const rejected = assert.rejects(promise, code("ALLOWANCE_CANCELLED"));
  for (let i = 0; i < 100 && calls < 3; i++) await tick();
  assert.equal(calls, 3);
  abort.abort();
  await rejected;
  gate.resolve();
  await tick();
});
test("allowance reader lifecycle: response getter cannot silently change account", async () => {
  const f = fakeReader();
  const original = f.session.getContractCode;
  f.session.getContractCode = async (address, hash) => {
    if (address !== S1) return original(address, hash);
    return { address, get deployed() { f.state.account = OTHER; return true; } };
  };
  await assert.rejects(readAllowanceSnapshot(f.session, targets()), code("ALLOWANCE_SESSION_CHANGED"));
});
test("allowance reader lifecycle: oversized final block number rejected before BigInt conversion", async () => {
  const f = fakeReader();
  let calls = 0;
  const original = f.session.getBlockSnapshot;
  f.session.getBlockSnapshot = async tag => ++calls === 3
    ? { number: "0x" + "0".repeat(50000) + "2a", hash: HASH } : original(tag);
  await assert.rejects(readAllowanceSnapshot(f.session, targets()), code("ALLOWANCE_BLOCK_CHANGED"));
});
test("allowance reader lifecycle: maximum target count makes exactly one allowance read per target", async () => {
  const f = fakeReader();
  const value = varied(7, 20);
  const result = await readAllowanceSnapshot(f.session, value.targets);
  assert.equal(result.rows.length, 20);
  const calls = f.calls.filter(call => call[0] === "allowance");
  assert.equal(calls.length, 20);
  assert.equal(new Set(calls.map(call => call[2])).size, 20);
});
test("allowance bundle invariants: mixed partial records remain partial after combined round trip", async () => {
  const input = ["DAT", "EMA", "CAWELON"].map((agent, i) => varied(i + 7, 20, agent));
  const prepared = await prepareAllowanceBundle(captureAllowanceBundle(input));
  const result = await decodeAllowanceBundle(new TextEncoder().encode(prepared.text));
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(summarizeAllowances(result.bundle.records[i]), summarizeAllowances(input[i]));
  }
});
test("allowance target invariants: local label pipe is rejected to preserve text round trip", () => {
  const input = targets();
  input.targets[0].label = "name|extra";
  assert.throws(() => validateAllowanceTargets(input), code("ALLOWANCE_LABEL"));
});
