import test from "node:test";
import assert from "node:assert/strict";
import { describeTransferWindow, planTransferWindow } from "../src/transfer-window.js";
import { code, hash, snapshot } from "./helpers/transfer-fixtures.js";

function range(from, to) {
  return snapshot({ range: { fromBlock: String(from), toBlock: String(to) },
    fromBlockHash: hash(from), toBlockHash: hash(to), events: [] });
}

test("transfer window: pin uses observed bounds rather than moving latest", () => {
  assert.deepEqual(planTransferWindow(range(30, 42), "pin"), { fromBlock: "30", toBlock: "42", lookback: 13 });
});

test("transfer window: previous window neither overlaps nor skips a block", () => {
  assert.deepEqual(planTransferWindow(range(30, 42), "previous"), { fromBlock: "17", toBlock: "29", lookback: 13 });
});

test("transfer window: previous range clamps safely at block zero", () => {
  assert.deepEqual(planTransferWindow(range(3, 15), "previous"), { fromBlock: "0", toBlock: "2", lookback: 13 });
  assert.deepEqual(planTransferWindow(range(1, 1), "previous"), { fromBlock: "0", toBlock: "0", lookback: 1 });
  assert.throws(() => planTransferWindow(range(0, 0), "previous"), code("TRANSFER_WINDOW_GENESIS"));
});

test("transfer window: latest draft keeps the observed width and resolves at next read", () => {
  assert.deepEqual(planTransferWindow(range(30, 42), "latest"), { fromBlock: null, toBlock: null, lookback: 13 });
});

test("transfer window: narrowing keeps the newer half of the observed range", () => {
  assert.deepEqual(planTransferWindow(range(30, 42), "narrow"), { fromBlock: "36", toBlock: "42", lookback: 7 });
  assert.deepEqual(planTransferWindow(range(30, 41), "narrow"), { fromBlock: "36", toBlock: "41", lookback: 6 });
  assert.deepEqual(planTransferWindow(range(30, 31), "narrow"), { fromBlock: "31", toBlock: "31", lookback: 1 });
  assert.throws(() => planTransferWindow(range(30, 30), "narrow"), code("TRANSFER_WINDOW_MINIMUM"));
});

test("transfer window: large heights retain exact adjacent boundaries", () => {
  const from = 900719925474099312345n;
  const to = from + 1999n;
  const result = planTransferWindow(range(from, to), "previous");
  assert.equal(result.toBlock, (from - 1n).toString());
  assert.equal(result.fromBlock, (from - 2000n).toString());
  assert.equal(result.lookback, 2000);
});

test("transfer window: unknown actions do not produce a read plan", () => {
  for (const action of ["next", "send", "", null, {}]) assert.throws(() => planTransferWindow(range(30, 42), action), code("TRANSFER_WINDOW_ACTION"));
});

test("transfer window: fixed draft explains inclusive size", () => {
  const description = describeTransferWindow({ fromBlock: "30", toBlock: "42", lookback: 250 });
  assert.equal(description.mode, "fixed");
  assert.equal(description.blocks, "13");
  assert.match(description.text, /取得ボタン/);
});

test("transfer window: open end explicitly leaves size unresolved", () => {
  const description = describeTransferWindow({ fromBlock: "30", toBlock: null, lookback: 250 });
  assert.equal(description.mode, "open-end");
  assert.equal(description.blocks, null);
  assert.match(description.text, /最新/);
});

test("transfer window: recent draft explains genesis clamp", () => {
  const description = describeTransferWindow({ fromBlock: null, toBlock: "42", lookback: 250 });
  assert.equal(description.mode, "recent");
  assert.equal(description.blocks, "250");
  assert.match(description.text, /42まで/);
  assert.match(description.text, /0未満/);
});

test("transfer window: repeated previous windows are contiguous across varied widths", () => {
  for (const width of [1, 2, 7, 13, 250, 1999, 2000]) {
    let current = range(10000, 10000 + width - 1);
    for (let step = 0; step < 5; step++) {
      const plan = planTransferWindow(current, "previous");
      assert.equal(BigInt(plan.toBlock) + 1n, BigInt(current.range.fromBlock));
      assert.equal(BigInt(plan.toBlock) - BigInt(plan.fromBlock) + 1n, BigInt(width));
      current = range(plan.fromBlock, plan.toBlock);
    }
  }
});

test("transfer window: repeatedly narrowing terminates at one block", () => {
  let current = range(10000, 11999);
  let iterations = 0;
  while (current.range.fromBlock !== current.range.toBlock) {
    const previousWidth = BigInt(current.range.toBlock) - BigInt(current.range.fromBlock) + 1n;
    const plan = planTransferWindow(current, "narrow");
    const nextWidth = BigInt(plan.toBlock) - BigInt(plan.fromBlock) + 1n;
    assert.ok(nextWidth < previousWidth);
    assert.equal(plan.toBlock, "11999");
    current = range(plan.fromBlock, plan.toBlock);
    assert.ok(++iterations < 12);
  }
  assert.equal(current.range.fromBlock, "11999");
});
