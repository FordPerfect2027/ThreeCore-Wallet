import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRehearsal as evaluate, validateRehearsal as validate, decodeRehearsal,
  encodeRehearsal, parseRehearsalUnits, formatRehearsalUnits, REHEARSAL_LIMIT } from "../src/operation-rehearsal.js";
import { rehearsalExample } from "../src/operation-rehearsal-examples.js";

const clone = (agent = "DAT", scenario = "profit") => JSON.parse(encodeRehearsal(rehearsalExample(agent, scenario)));
const code = expected => error => error.code === expected;
const reject = (change, expected, scenario = "profit") => {
  const input = clone("DAT", scenario); change(input); assert.throws(() => validate(input), code(expected));
};
for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test(agent + ": exact profit, fees, principal and conditional allocation", () => {
    const report = evaluate(clone(agent));
    assert.equal(report.cash, "1028000000");
    assert.equal(report.realizedPnl, "28000000");
    assert.equal(report.fees, "2000000");
    assert.equal(report.outstanding, "0");
    assert.equal(report.proposedOwnTokenBuybackBudget, "2800000");
    assert.equal(report.rows[0].realizedPnl, "-1000000");
    assert.equal(report.rows[0].outstanding, "100000000");
    assert.equal(report.authorizesExecution, false);
    assert.equal(report.sourceVerified, false);
    assert.equal(report.simulationOnly, true);
  });
  test(agent + ": losses carry forward before allocation", () => {
    const report = evaluate(clone(agent, "recovery"));
    assert.equal(report.rows[1].realizedPnl, "-42000000");
    assert.equal(report.realizedPnl, "16000000");
    assert.equal(report.proposedOwnTokenBuybackBudget, "1600000");
  });
  test(agent + ": unresolved principal and fees are distinct", () => {
    const report = evaluate(clone(agent, "pending"));
    assert.equal(report.cash, "899000000");
    assert.equal(report.outstanding, "100000000");
    assert.equal(report.realizedPnl, "-1000000");
    assert.equal(report.proposedOwnTokenBuybackBudget, "0");
    assert.ok(report.allocationBlockers.includes("UNSETTLED_POSITIONS"));
  });
  test(agent + ": capital deposits never become profit", () => {
    const report = evaluate(clone(agent, "deposit"));
    assert.equal(report.cash, "1500000000");
    assert.equal(report.realizedPnl, "0");
    assert.equal(report.deposits, "500000000");
    assert.equal(report.proposedOwnTokenBuybackBudget, "0");
  });
  test(agent + ": over-limit proposals do not change cash or charge fees", () => {
    const report = evaluate(clone(agent, "limit"));
    assert.equal(report.cash, "1000000000");
    assert.equal(report.fees, "0");
    assert.equal(report.outstanding, "0");
    assert.ok(report.rows[0].reasons.includes("PER_OPERATION_LIMIT"));
    assert.ok(report.allocationBlockers.includes("REJECTED_RECORDS"));
  });
  test(agent + ": loss records produce zero allocation", () => {
    const report = evaluate(clone(agent, "loss"));
    assert.equal(report.realizedPnl, "-42000000");
    assert.equal(report.proposedOwnTokenBuybackBudget, "0");
  });
}

const limitCases = [
  ["PAUSED", d => { d.policy.paused = true; }],
  ["UNLISTED_ORIGIN", d => { d.events[0].origin = "https://other.example"; }],
  ["UNLISTED_SPENDER", d => { d.events[0].spender = "0x" + "9".repeat(40); }],
  ["ZERO_PRINCIPAL", d => { d.events[0].principal = "0"; }],
  ["PER_OPERATION_LIMIT", d => { d.policy.maxPerOperation = "99999999"; }],
  ["OUTSTANDING_LIMIT", d => { d.policy.maxOutstanding = "99999999"; }],
  ["RESERVE_FLOOR", d => { d.policy.reserveFloor = "900000000"; }],
  ["LOSS_LIMIT", d => { d.policy.lossLimit = "100999999"; }],
  ["INSUFFICIENT_BALANCE", d => { d.openingBalance = "100"; }],
  ["WRONG_AGENT", d => { d.events[0].agent = "EMA"; }],
  ["WRONG_CHAINID", d => { d.events[0].chainId = 8453; }],
  ["WRONG_ACCOUNT", d => { d.events[0].account = "0x" + "2".repeat(40); }],
];
for (const [reason, change] of limitCases) test("proposal blocked: " + reason, () => {
  const data = clone("DAT", "pending"); change(data);
  const result = evaluate(data);
  assert.ok(result.rows[0].reasons.includes(reason));
  assert.equal(result.cash, data.openingBalance);
  assert.equal(result.realizedPnl, "0");
  assert.equal(result.proposedOwnTokenBuybackBudget, "0");
});
test("exact boundary is admitted; next outstanding principal is rejected", () => {
  const d = clone("DAT", "pending");
  d.policy.lossLimit = "101000000"; d.policy.reserveFloor = "899000000";
  assert.equal(evaluate(d).rows[0].withinEnteredLimits, true);
  d.events.push({ ...d.events[0], id: "open-two", operationId: "two" });
  assert.equal(evaluate(d).rows[1].withinEnteredLimits, false);
});
test("settlement cannot be repeated or consume a foreign account's position", () => {
  const d = clone(); d.events.push({ ...d.events[1], id: "replay" });
  let report = evaluate(d);
  assert.ok(report.rows[2].reasons.includes("NO_OPEN_POSITION"));
  assert.equal(report.realizedPnl, "28000000");
  assert.equal(report.proposedOwnTokenBuybackBudget, "0");
  d.events = d.events.slice(0, 2); d.events[1].account = "0x" + "2".repeat(40);
  report = evaluate(d);
  assert.equal(report.outstanding, "100000000");
  assert.equal(report.rows[1].withinEnteredLimits, false);
});
test("operation ID stays consumed after settlement", () => {
  const d = clone(); d.events.push({ ...d.events[0], id: "again" });
  assert.ok(evaluate(d).rows[2].reasons.includes("REUSED_OPERATION"));
});
test("deposit/withdrawal changes capital and never PnL", () => {
  const d = clone("DAT", "deposit");
  d.events.push({ ...d.events[0], id: "withdraw", kind: "withdraw", amount: "200000000" });
  const result = evaluate(d);
  assert.equal(result.cash, "1300000000"); assert.equal(result.realizedPnl, "0");
  assert.equal(result.withdrawals, "200000000");
});
test("settlement fees are included even when they exceed the returned amount", () => {
  const d = clone(); d.events[1].grossReturn = "0"; d.events[1].fee = "2000000";
  const result = evaluate(d);
  assert.equal(result.realizedPnl, "-103000000"); assert.equal(result.cash, "897000000");
});
test("invalid settlement funding never invents negative cash", () => {
  const d = clone(); d.events[1].grossReturn = "0"; d.events[1].fee = "1000000000";
  const result = evaluate(d);
  assert.ok(result.rows[1].reasons.includes("INSUFFICIENT_FEE_BALANCE"));
  assert.equal(result.outstanding, "100000000");
});
test("allocation floors fractional units and cannot use reserve funds", () => {
  const d = clone(); d.events[1].grossReturn = "130000001"; d.policy.buybackBps = 3333;
  assert.equal(evaluate(d).proposedOwnTokenBuybackBudget, "9332400");
  d.events.push({ id: "withdraw", kind: "withdraw", agent: d.agent, chainId: d.chainId,
    account: d.account, amount: "825000001" });
  assert.equal(evaluate(d).proposedOwnTokenBuybackBudget, "3000000");
});
test("one unresolved position blocks allocation despite already realized profit", () => {
  const d = clone(); d.events.push({ ...d.events[0], id: "second", operationId: "two" });
  const result = evaluate(d);
  assert.equal(result.realizedPnl, "27000000"); assert.equal(result.proposedOwnTokenBuybackBudget, "0");
});
test("zero share means no allocation", () => {
  const d = clone(); d.policy.buybackBps = 0;
  assert.equal(evaluate(d).proposedOwnTokenBuybackBudget, "0");
});
test("18-decimal single units survive values beyond Number safe integer", () => {
  const d = clone();
  d.asset.decimals = 18; d.openingBalance = "100000000000000000000";
  Object.assign(d.policy, { reserveFloor: "0", maxPerOperation: d.openingBalance,
    maxOutstanding: d.openingBalance, lossLimit: d.openingBalance, buybackBps: 10000 });
  Object.assign(d.events[0], { principal: "10000000000000000001", fee: "1" });
  Object.assign(d.events[1], { grossReturn: "10000000000000000004", fee: "1" });
  const result = evaluate(d);
  assert.equal(result.realizedPnl, "1"); assert.equal(result.proposedOwnTokenBuybackBudget, "1");
  assert.equal(formatRehearsalUnits(result.realizedPnl, 18), "0.000000000000000001");
});
test("balance cannot overflow uint256 through capital or settlement", () => {
  const d = clone("DAT", "deposit"); d.openingBalance = ((1n << 256n) - 1n).toString();
  assert.ok(evaluate(d).rows[0].reasons.includes("BALANCE_OVERFLOW"));
});
test("every accepted and rejected prefix obeys capital/PnL identity", () => {
  const d = clone("DAT", "recovery");
  d.events.push({ ...d.events[0], id: "bad", principal: "101000000", operationId: "three" });
  for (let n = 0; n <= d.events.length; n++) {
    const r = evaluate({ ...d, events: d.events.slice(0, n) });
    assert.equal(BigInt(r.cash) + BigInt(r.outstanding),
      BigInt(d.openingBalance) + BigInt(r.deposits) - BigInt(r.withdrawals) + BigInt(r.realizedPnl));
  }
});

for (const value of ["-1", "01", "1e6", "1.2", "", 1, "9".repeat(79), (1n << 256n).toString()])
  test("reject noncanonical/out-of-range amount: " + String(value).slice(0, 24), () =>
    reject(d => { d.openingBalance = value; }, "INVALID_AMOUNT"));
test("strict schema, simulation flag, duplicate event and unsupported chain", () => {
  reject(d => { d.extra = true; }, "INVALID_STRUCTURE");
  reject(d => { d.simulationOnly = false; }, "SIMULATION_REQUIRED");
  reject(d => { d.events.push(d.events[0]); }, "DUPLICATE_EVENT");
  reject(d => { d.chainId = 1; }, "INVALID_CONTEXT");
  reject(d => { d.events[0].asset = "OTHER"; }, "INVALID_STRUCTURE");
});
for (const value of ["http://training.example", "https://training.example/", "https://u:p@training.example", "https://training.example/path"])
  test("reject non-origin policy: " + value, () => reject(d => { d.policy.origin = value; }, "INVALID_ORIGIN"));
test("input getters and custom kind coercion are not invoked", () => {
  const d = clone(); let called = false;
  Object.defineProperty(d.policy, "lossLimit", { get() { called = true; return "0"; } });
  assert.throws(() => validate(d), code("INVALID_STRUCTURE")); assert.equal(called, false);
  const e = clone(); e.events[0].kind = { toString() { called = true; return "open"; } };
  assert.throws(() => validate(e), code("INVALID_KIND")); assert.equal(called, false);
});
test("sparse and oversized arrays are rejected", () => {
  reject(d => { d.events = new Array(1); }, "INVALID_STRUCTURE");
  reject(d => { d.events = Array(201).fill(d.events[0]); }, "INVALID_STRUCTURE");
});
test("files round-trip inputs, reject derived reports, duplicate keys and oversize text", () => {
  const d = clone(); assert.deepEqual(decodeRehearsal(encodeRehearsal(d)), validate(d));
  assert.throws(() => decodeRehearsal(JSON.stringify(evaluate(d))), code("INVALID_STRUCTURE"));
  assert.throws(() => decodeRehearsal('{"schema":1,"schema":2}'), code("INVALID_JSON"));
  assert.throws(() => decodeRehearsal(" ".repeat(REHEARSAL_LIMIT + 1)), code("FILE_TOO_LARGE"));
});
test("results are immutable snapshots and callers are not mutated", () => {
  const d = clone(), before = JSON.stringify(d); const result = evaluate(d);
  assert.equal(JSON.stringify(d), before);
  d.events[0].principal = "0"; assert.equal(result.rows[0].outstanding, "100000000");
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.rows[0]));
  assert.throws(() => { result.rows[0].cash = "0"; }, TypeError);
});
test("human-unit conversion is exact and rejects excess precision", () => {
  assert.equal(parseRehearsalUnits("123.000001", 6), "123000001");
  assert.equal(formatRehearsalUnits("-123000001", 6), "-123.000001");
  assert.equal(formatRehearsalUnits("12000000", 6), "12");
  assert.equal(parseRehearsalUnits("10.25", 2), "1025");
  assert.throws(() => parseRehearsalUnits("0.0000001", 6), code("EXCESS_PRECISION"));
  for (const value of ["1e2", "+1", " 1", ".5", "1.", "01", "1x2"])
    assert.throws(() => parseRehearsalUnits(value, 6), code("INVALID_DECIMAL"));
});
