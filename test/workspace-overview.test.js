import test from "node:test";
import assert from "node:assert/strict";
import { summarizeWorkspace, describeWorkspaceOverview, describeWorkspacePreview,
  describeWorkspaceUndo, formatWorkspaceUnits } from "../src/workspace-overview.js";
import { previewWorkspace } from "../src/workspace-format.js";
import { draft, snapshot, ACCOUNTS, CONTRACTS, OPTIONS, text } from "./helpers/workspace-fixtures.js";
import { archive } from "./helpers/history-fixtures.js";

test("workspace overview reports three independently configured cards and histories", () => {
  const summary = summarizeWorkspace(draft());
  assert.equal(summary.configured, 3);
  assert.equal(summary.totalObservations, 3);
  assert.equal(summary.cards[0].remainingCapacity, 63);
  assert.equal(summary.connectionVerified, false);
  assert.equal(summary.securityAudit, false);
  assert.equal(summary.monetaryValuation, false);
});

test("workspace overview does not treat saved observations as current connections", () => {
  const summary = summarizeWorkspace(draft());
  assert.equal(summary.historicalObservation, true);
  for (const card of summary.cards) {
    assert.equal(card.accountStatus, "configured");
    assert.equal(card.groups[0].historicalObservation, true);
    assert.equal(card.groups[0].matchesConfiguration, true);
  }
});

test("workspace overview reports missing accounts without manufacturing zero balances", () => {
  const summary = summarizeWorkspace(draft({ accounts: false, populated: false }));
  assert.equal(summary.configured, 0);
  assert.equal(summary.totalObservations, 0);
  assert.ok(summary.cards.every(card => card.accountStatus === "missing"));
  assert.ok(summary.cards.every(card => card.groups.length === 0));
});

test("workspace overview distinguishes invalid duplicate and missing assignments", () => {
  const current = draft();
  current[0].account = "broken";
  current[1].account = "";
  let summary = summarizeWorkspace(current);
  assert.deepEqual(summary.cards.map(card => card.accountStatus), ["invalid", "missing", "configured"]);
  current[0].account = current[2].account;
  summary = summarizeWorkspace(current);
  assert.deepEqual(summary.cards.map(card => card.accountStatus), ["duplicate", "missing", "duplicate"]);
  assert.equal(summary.configured, 0);
});

test("workspace overview marks historical accounts that differ from the current assignment", () => {
  const current = draft();
  current[0].account = "0x" + "99".repeat(20);
  const summary = summarizeWorkspace(current);
  assert.equal(summary.cards[0].unrelatedObservations, 1);
  assert.equal(summary.cards[0].groups[0].matchesConfiguration, false);
  assert.equal(summary.cards[0].groups[0].account, ACCOUNTS[0]);
});

test("workspace overview marks historical network mismatch independently of account", () => {
  const current = draft();
  current[0].chainId = 8453;
  const summary = summarizeWorkspace(current);
  assert.equal(summary.cards[0].unrelatedObservations, 1);
  assert.equal(summary.cards[0].groups[0].chainId, 84532);
});

test("workspace overview groups origins separately without mixing their balances", () => {
  const current = draft();
  current[0].history = archive([
    snapshot(0, "10", { nativeBalanceBaseUnits: "100" }),
    snapshot(0, "20", { siteOrigin: "https://example.org", nativeBalanceBaseUnits: "900" }),
  ]);
  const groups = summarizeWorkspace(current).cards[0].groups;
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.nativeBalanceBaseUnits), ["100", "900"]);
  assert.ok(groups.every(group => group.nativeChangeBaseUnits === null));
});

test("workspace overview uses integer ordering for blocks beyond Number precision", () => {
  const current = draft();
  current[0].history = archive([
    snapshot(0, "9007199254740993", { nativeBalanceBaseUnits: "25" }),
    snapshot(0, "9007199254740992", { nativeBalanceBaseUnits: "10" }),
  ]);
  const group = summarizeWorkspace(current).cards[0].groups[0];
  assert.equal(group.latestBlock, "9007199254740993");
  assert.equal(group.earliestBlock, "9007199254740992");
  assert.equal(group.nativeChangeBaseUnits, "15");
});

test("workspace overview allows negative observation differences without calling them loss", () => {
  const current = draft();
  current[0].history = archive([
    snapshot(0, "1", { nativeBalanceBaseUnits: "100" }),
    snapshot(0, "2", { nativeBalanceBaseUnits: "40" }),
  ]);
  const group = summarizeWorkspace(current).cards[0].groups[0];
  assert.equal(group.nativeChangeBaseUnits, "-60");
  assert.equal(group.previousBlock, "1");
  assert.equal(group.latestBlock, "2");
});

test("workspace overview never converts unknown token balances to zero", () => {
  const current = draft();
  current[0].history = archive([snapshot(0, "1", {
    holdings: [{ address: CONTRACTS[0], hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }],
  })]);
  const summary = summarizeWorkspace(current);
  assert.equal(summary.unknownBalances, 1);
  assert.equal(summary.cards[0].groups[0].unknownTokens, 1);
  assert.equal(summary.cards[0].groups[0].knownTokens, 0);
  assert.equal(summary.cards[0].groups[0].holdings[0].balanceBaseUnits, null);
});

test("workspace overview recognizes a known zero as distinct from unknown", () => {
  const current = draft();
  current[0].history = archive([snapshot(0, "1", {
    holdings: [{ address: CONTRACTS[0], hasCode: true, balanceBaseUnits: "0", notice: null }],
  })]);
  const summary = summarizeWorkspace(current);
  assert.equal(summary.cards[0].groups[0].knownTokens, 1);
  assert.equal(summary.cards[0].groups[0].holdings[0].balanceBaseUnits, "0");
});

test("workspace overview reports token-list input problems without throwing away histories", () => {
  const current = draft();
  current[0].tokens = CONTRACTS[0] + "\n" + CONTRACTS[0] + "\nnot-an-address";
  const card = summarizeWorkspace(current).cards[0];
  assert.deepEqual(card.tokens, { count: 3, distinct: 1, duplicate: 1, invalid: 1, overLimit: false });
  assert.equal(card.historyCount, 1);
});

test("workspace overview marks oversized lists and zero-address token inputs", () => {
  const current = draft();
  current[0].tokens = Array(33).fill(CONTRACTS[0]).join("\n");
  current[1].tokenAddress = "0x" + "00".repeat(20);
  const summary = summarizeWorkspace(current);
  assert.equal(summary.cards[0].tokens.overLimit, true);
  assert.equal(summary.cards[1].singleToken.status, "invalid");
});

for (const [raw, decimals, display] of [
  ["0", 18, "0"],
  ["1", 18, "0.000000000000000001"],
  ["1000000000000000000", 18, "1"],
  ["1234500000000000000", 18, "1.2345"],
  ["9007199254740993123456789", 18, "9007199.254740993123456789"],
  ["42", 0, "42"],
  ["1200000", 6, "1.2"],
  ["10", 36, "0.00000000000000000000000000000000001"],
]) {
  test("workspace exact unit display " + raw + " / " + decimals, () => {
    assert.equal(formatWorkspaceUnits(raw, decimals), display);
  });
}

for (const raw of ["-1", "01", "1e18", "1.2", "", 10, null, (1n << 256n).toString()]) {
  test("workspace exact unit display rejects " + JSON.stringify(raw), () => {
    assert.throws(() => formatWorkspaceUnits(raw), { code: "WORKSPACE_AMOUNT" });
  });
}

for (const decimals of [-1, 37, 1.1, "18", NaN]) {
  test("workspace exact unit display rejects decimals " + decimals, () => {
    assert.throws(() => formatWorkspaceUnits("1", decimals), { code: "WORKSPACE_DECIMALS" });
  });
}

test("workspace exact units preserve the maximum uint256 without rounding", () => {
  const raw = ((1n << 256n) - 1n).toString();
  const displayed = formatWorkspaceUnits(raw, 18);
  assert.equal(displayed.replace(".", ""), raw);
});

test("workspace readable overview labels history boundaries and privacy content", () => {
  const result = describeWorkspaceOverview(draft());
  assert.match(result, /過去の観測値/);
  assert.match(result, /現在の残高・接続・所有・安全性を証明しません/);
  assert.match(result, /合算しません/);
  assert.match(result, /公開アドレスと残高を含みます/);
  assert.match(result, /0.000000000000000016/);
  assert.match(result, /最小単位/);
});

test("workspace readable overview shows unknown rather than a numeric replacement", () => {
  const current = draft();
  current[2].history = archive([snapshot(2, "1", {
    holdings: [{ address: CONTRACTS[2], hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }],
  })]);
  assert.ok(describeWorkspaceOverview(current).includes(CONTRACTS[2] + ": 不明"));
});

test("workspace preview text identifies replacement and removed record count", () => {
  const result = previewWorkspace(text({ populated: false }), draft(), { ...OPTIONS, mode: "replace" });
  const description = describeWorkspacePreview(result);
  assert.match(description, /ファイルの履歴に置き換え/);
  assert.match(description, /取り除く既存記録: 1件/);
  assert.match(description, /自動接続しません/);
});

test("workspace preview text labels section exclusions and unchanged connection settings", () => {
  const result = previewWorkspace(text(), draft(), { settings: false, histories: true, mode: "merge" });
  const description = describeWorkspacePreview(result);
  assert.match(description, /現在の入力を保持/);
  assert.match(description, /既存履歴へ追加/);
  assert.match(description, /設定に変更なし/);
});

test("workspace undo text distinguishes old and new data without claiming connection restoration", () => {
  const before = draft();
  const after = draft({ populated: false });
  const description = describeWorkspaceUndo({ before, after });
  assert.match(description, /履歴: 1 → 0件/);
  assert.match(description, /接続許可や残高照会は復元しません/);
});

test("workspace overview is detached and deeply immutable", () => {
  const current = draft();
  const summary = summarizeWorkspace(current);
  current[0].history = archive([]);
  assert.equal(summary.cards[0].historyCount, 1);
  assert.ok(Object.isFrozen(summary.cards[0].groups[0].holdings[0]));
});
