import test from "node:test";
import assert from "node:assert/strict";
import { describeAllowanceTargets, describeAllowanceObservation, describeAllowanceComparison,
  describeAllowanceProgress, allowanceErrorMessage } from "../src/allowance-view.js";
import { allowanceOverview, describeAllowanceOverview } from "../src/allowance-overview.js";
import { UINT256_MAX } from "../src/token-identity-codec.js";
import { record, targets, S1, S2, ACCOUNT, OTHER, clone, nextRecord } from "./helpers/allowance-fixtures.js";

test("allowance view: exact scope and historical provenance", () => {
  const r = record();
  const text = describeAllowanceObservation(r);
  for (const value of [ACCOUNT, S1, S2, r.identity.tokenAddress, r.identity.blockHash, "Base Mainnet",
    "ファイルから読み込んだ", "指定外", "署名による許可", "NFT", "承認額は相手ごとに重なる", "真正性の証明ではありません"]) {
    assert(text.includes(value), value);
  }
});
test("allowance view: fresh read describes block observation, not perpetual balance", () => {
  const text = describeAllowanceObservation(record(), "read");
  assert(text.startsWith("今回読み取ったブロック時点"));
  assert(text.includes("記録は現在の許可や所有権の証明ではありません"));
});
test("allowance view: exact decimal representation for very large allowance", () => {
  const r = record();
  r.rows[0].allowanceBaseUnits = "900719925474099312345";
  const text = describeAllowanceObservation(r);
  assert(text.includes("900.719925474099312345 DAT"));
  assert(text.includes("900719925474099312345"));
});
test("allowance view: maximum, missing amount and code absence use separate explanations", () => {
  const r = record();
  r.rows[0].allowanceBaseUnits = UINT256_MAX.toString();
  r.rows[0].hasCode = false;
  Object.assign(r.rows[1], { allowanceBaseUnits: null, allowanceError: "READ_FAILED" });
  const text = describeAllowanceObservation(r);
  for (const value of ["uint256最大値", "相手のコード: なし", "承認額は未確認", "ゼロとして扱っていません"]) {
    assert(text.includes(value), value);
  }
});
test("allowance view: empty filter retains scope and total requested count", () => {
  const text = describeAllowanceObservation(record(), "read", { search: "missing" });
  assert(text.includes("表示対象: 0 / 2件"));
  assert(text.includes("確認対象 2件"));
  assert(text.includes(ACCOUNT));
  assert(!text.includes(S1));
});
test("allowance view: local labels are disclosed as unverified labels", () => {
  const plan = targets();
  plan.targets[0].label = "<img src=x onerror=alert(1)>";
  const text = describeAllowanceTargets(plan);
  assert(text.includes(plan.targets[0].label));
  assert(text.includes("名前はこのPCで付けたラベル"));
  assert(text.includes("すべて発見する機能ではありません"));
});
test("allowance view: comparison explains newly/omitted observed targets", () => {
  const a = record(), b = nextRecord(a);
  b.rows[1].spenderAddress = b.targets.targets[1].address = OTHER;
  const text = describeAllowanceComparison(a, b);
  assert(text.includes(S2));
  assert(text.includes(OTHER));
  assert(text.includes("今回は指定しなかった相手"));
  assert(text.includes("承認を取り消した、という意味ではありません"));
});
test("allowance view: progress known stages and finite limits", () => {
  for (const stage of ["token", "spender-code", "allowance", "row-complete", "canonical", "complete"]) {
    assert(describeAllowanceProgress({ stage, completed: 1, total: 2 }).includes("1 / 2"));
  }
  for (const value of [null, {}, { stage: "__proto__", completed: 1, total: 2 },
    { stage: "token", completed: NaN, total: 2 }, { stage: "token", completed: 3, total: 2 },
    { stage: "token", completed: 0, total: 21 }]) assert.equal(describeAllowanceProgress(value), "");
});
test("allowance view: errors never reflect arbitrary raw provider strings", () => {
  const message = allowanceErrorMessage("<script>private provider error</script>");
  assert(!message.includes("<script>"));
  assert(!message.includes("private"));
  for (const value of ["ALLOWANCE_CHECKSUM", "ALLOWANCE_CONTEXT_CHANGED", "ALLOWANCE_NOT_CONNECTED",
    "ALLOWANCE_SESSION_CHANGED", "ALLOWANCE_BLOCK_CHANGED", "ALLOWANCE_TIMEOUT", "IDENTITY_NOT_CONNECTED"]) {
    assert.equal(typeof allowanceErrorMessage(value), "string");
    assert(allowanceErrorMessage(value).length > 5);
  }
});
const empty = () => ["DAT", "EMA", "CAWELON"].map(agent => ({ agent, observation: null, provenance: null }));
test("allowance overview: empty cards never imply zero permissions", () => {
  const result = allowanceOverview(empty());
  assert.equal(result.independentWallets, 0);
  assert.equal(result.totalExposure, null);
  assert(result.cards.every(c => c.summary === null));
  assert.equal(describeAllowanceOverview(empty()).match(/未確認/g).length, 3);
});
test("allowance overview: independent addresses and chain-specific historical observations", () => {
  const rows = ["DAT", "EMA", "CAWELON"].map((agent, index) => {
    const observation = record({}, agent, index === 1 ? 84532 : 8453);
    observation.identity.account = "0x" + String(index + 1).repeat(40);
    return { agent, observation, provenance: index === 1 ? "imported" : "read" };
  });
  rows.reverse();
  const result = allowanceOverview(rows);
  assert.deepEqual(result.cards.map(c => c.agent), ["DAT", "EMA", "CAWELON"]);
  assert.equal(result.independentWallets, 3);
  const text = describeAllowanceOverview(rows);
  assert(text.includes("保存ファイルの過去記録"));
  assert(text.includes("Base Sepolia"));
});
test("allowance overview: same account shared by observations counted once", () => {
  const rows = ["DAT", "EMA", "CAWELON"].map(agent => ({ agent, observation: record({}, agent), provenance: "read" }));
  assert.equal(allowanceOverview(rows).independentWallets, 1);
});
for (const mutate of [
  rows => rows.pop(),
  rows => { rows[1].agent = "DAT"; },
  rows => { rows[0].provenance = "read"; },
  rows => { rows[0].observation = record({}, "EMA"); rows[0].provenance = "read"; },
  rows => { rows.extra = true; },
  rows => { rows[0].phase = "ready"; },
]) {
  test("allowance overview: reject inconsistent cards " + mutate.toString(), () => {
    const rows = empty();
    mutate(rows);
    assert.throws(() => allowanceOverview(rows));
  });
}
test("allowance overview: accessor array rejected without invoking getter", () => {
  const rows = empty();
  let reads = 0;
  Object.defineProperty(rows, "0", { get() { reads++; return {}; } });
  assert.throws(() => allowanceOverview(rows));
  assert.equal(reads, 0);
});
test("allowance overview: input observations are not mutated by display", () => {
  const rows = empty();
  rows[0] = { agent: "DAT", observation: record(), provenance: "read" };
  const original = clone(rows);
  describeAllowanceOverview(rows);
  assert.deepEqual(rows, original);
});
