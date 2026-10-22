import test from "node:test";
import assert from "node:assert/strict";
import { previewWorkspace, encodeWorkspace, workspaceFromDraft } from "../src/workspace-format.js";
import { AGENTS, ACCOUNTS, CONTRACTS, draft, text, bundle, clone, OPTIONS, snapshot } from "./helpers/workspace-fixtures.js";
import { archive } from "./helpers/history-fixtures.js";

test("workspace restore defaults supplied by UI preserve existing observations", () => {
  const current = draft({ block: "10" });
  const result = previewWorkspace(text({ block: "20" }), current, OPTIONS);
  assert.deepEqual(result.changes.map(row => row.afterCount), [2, 2, 2]);
  assert.deepEqual(result.changes.map(row => row.added), [1, 1, 1]);
  assert.equal(result.removed, 0);
  assert.equal(JSON.parse(current[0].history).reports.length, 1);
});

test("workspace preview alone cannot mutate any current form or history", () => {
  const current = draft();
  const saved = clone(current);
  const incoming = bundle({ block: "43" });
  incoming.entries[0].account = "0x" + "99".repeat(20);
  previewWorkspace(encodeWorkspace(incoming), current, OPTIONS);
  assert.deepEqual(current, saved);
});

test("workspace duplicate imports are idempotent with visible duplicate counts", () => {
  const current = draft();
  const result = previewWorkspace(text(), current, OPTIONS);
  assert.equal(result.changed, false);
  assert.deepEqual(result.changes.map(row => row.duplicates), [1, 1, 1]);
  assert.deepEqual(result.changes.map(row => row.added), [0, 0, 0]);
});

test("workspace history replacement reports exactly what would be removed", () => {
  const current = draft({ block: "10" });
  const incoming = text({ block: "20" });
  const result = previewWorkspace(incoming, current, { ...OPTIONS, mode: "replace" });
  assert.equal(result.removed, 3);
  assert.deepEqual(result.changes.map(row => row.removed), [1, 1, 1]);
  assert.deepEqual(result.changes.map(row => row.afterCount), [1, 1, 1]);
  assert.equal(JSON.parse(result.after[0].history).reports[0].snapshot.blockNumber, "20");
});

test("workspace replacement retains matching records and counts only actual loss", () => {
  const current = draft();
  current[0].history = archive([snapshot(0, "10"), snapshot(0, "20")]);
  const incoming = draft();
  incoming[0].history = archive([snapshot(0, "20"), snapshot(0, "30")]);
  const result = previewWorkspace(encodeWorkspace(workspaceFromDraft(incoming)), current,
    { ...OPTIONS, mode: "replace" });
  assert.equal(result.changes[0].removed, 1);
  assert.equal(result.changes[0].afterCount, 2);
  assert.equal(result.removed, 1);
});

test("workspace empty incoming history never clears existing records in merge mode", () => {
  const result = previewWorkspace(text({ populated: false }), draft(), OPTIONS);
  assert.equal(result.changed, false);
  assert.deepEqual(result.changes.map(row => row.afterCount), [1, 1, 1]);
});

test("workspace empty incoming replacement makes three deletions explicit", () => {
  const result = previewWorkspace(text({ populated: false }), draft(), { ...OPTIONS, mode: "replace" });
  assert.equal(result.removed, 3);
  assert.deepEqual(result.changes.map(row => row.afterCount), [0, 0, 0]);
});

test("workspace settings-only import preserves every existing history byte", () => {
  const current = draft({ block: "10" });
  const incoming = bundle({ block: "20" });
  incoming.entries[0].chainId = 8453;
  const result = previewWorkspace(encodeWorkspace(incoming), current,
    { settings: true, histories: false, mode: "replace" });
  assert.equal(result.after[0].chainId, 8453);
  assert.deepEqual(result.after.map(row => row.history), current.map(row => row.history));
  assert.equal(result.removed, 0);
  assert.equal(result.changes[0].configurationChanged, true);
});

test("workspace history-only import cannot overwrite configured addresses or tokens", () => {
  const current = draft({ block: "10" });
  current[0].tokens = CONTRACTS.join("\n");
  const incoming = bundle({ block: "20", accounts: false });
  incoming.entries[0].chainId = 8453;
  const result = previewWorkspace(encodeWorkspace(incoming), current,
    { settings: false, histories: true, mode: "merge" });
  for (let index = 0; index < 3; index++) {
    assert.equal(result.after[index].account, current[index].account);
    assert.equal(result.after[index].chainId, current[index].chainId);
    assert.equal(result.after[index].tokens, current[index].tokens);
    assert.equal(result.changes[index].configurationChanged, false);
  }
});

test("workspace valid settings may repair incomplete live form entries", () => {
  const current = draft();
  current[0].account = "unfinished";
  current[1].tokenAddress = "half a token address";
  current[2].tokens = "bad list";
  const result = previewWorkspace(text(), current, OPTIONS);
  assert.equal(result.after[0].account, ACCOUNTS[0]);
  assert.equal(result.after[1].tokenAddress, CONTRACTS[1]);
  assert.equal(result.after[2].tokens, CONTRACTS[2]);
  assert.equal(result.changed, true);
});

test("workspace history-only preview preserves incomplete form edits for later correction", () => {
  const current = draft({ block: "10" });
  current[0].account = "unfinished";
  const result = previewWorkspace(text({ block: "20" }), current,
    { settings: false, histories: true, mode: "merge" });
  assert.equal(result.after[0].account, "unfinished");
  assert.equal(result.changes[0].configurationChanged, false);
});

for (const index of [0, 1, 2]) {
  test("workspace refuses conflicting observations before any mutation: " + AGENTS[index], () => {
    const current = draft();
    const incoming = bundle();
    incoming.entries[index].history.reports[0].snapshot.nativeBalanceBaseUnits = "999";
    const untouched = clone(current);
    assert.throws(() => previewWorkspace(encodeWorkspace(incoming), current, OPTIONS), { code: "WORKSPACE_CONFLICT" });
    assert.deepEqual(current, untouched);
  });
}

test("workspace replacement can explicitly supersede conflicting old observations", () => {
  const incoming = bundle();
  incoming.entries[0].history.reports[0].snapshot.nativeBalanceBaseUnits = "999";
  const result = previewWorkspace(encodeWorkspace(incoming), draft(), { ...OPTIONS, mode: "replace" });
  assert.equal(result.changes[0].removed, 1);
  assert.equal(JSON.parse(result.after[0].history).reports[0].snapshot.nativeBalanceBaseUnits, "999");
});

test("workspace maximum capacity is checked independently for every card", () => {
  const current = draft();
  current[2].history = archive(Array.from({ length: 64 }, (_, index) => snapshot(2, String(index))));
  const before = clone(current);
  assert.throws(() => previewWorkspace(text({ block: "100" }), current, OPTIONS), { code: "WORKSPACE_CAPACITY" });
  assert.deepEqual(current, before);
});

test("workspace full history accepts a duplicate without eviction", () => {
  const current = draft();
  current[0].history = archive(Array.from({ length: 64 }, (_, index) => snapshot(0, String(index))));
  const result = previewWorkspace(text({ block: "42" }), current, OPTIONS);
  assert.equal(result.changes[0].afterCount, 64);
  assert.equal(result.changes[0].duplicates, 1);
  assert.equal(result.changes[0].removed, 0);
});

test("workspace remains independent across site origins at the same block", () => {
  const incoming = bundle();
  incoming.entries[0].history.reports[0].snapshot.siteOrigin = "https://example.org";
  const result = previewWorkspace(encodeWorkspace(incoming), draft(), OPTIONS);
  assert.equal(result.changes[0].afterCount, 2);
  assert.equal(result.changes[0].duplicates, 0);
});

test("workspace remains independent across accounts at the same block", () => {
  const incoming = bundle();
  incoming.entries[0].history.reports[0].snapshot.account = ACCOUNTS[1];
  const result = previewWorkspace(encodeWorkspace(incoming), draft(), OPTIONS);
  assert.equal(result.changes[0].afterCount, 2);
});

test("workspace remains independent across networks at the same block", () => {
  const incoming = bundle();
  incoming.entries[0].history.reports[0].snapshot.chainId = 8453;
  const result = previewWorkspace(encodeWorkspace(incoming), draft(), OPTIONS);
  assert.equal(result.changes[0].afterCount, 2);
});

test("workspace compares effective form configuration without disconnecting for case alone", () => {
  const current = draft();
  current[0].account = "0x" + "AB".repeat(20);
  current[0].tokens = " " + CONTRACTS[0] + "\r\n";
  const incoming = workspaceFromDraft(current);
  const result = previewWorkspace(encodeWorkspace(incoming), current, OPTIONS);
  assert.equal(result.changed, false);
  assert.equal(result.after[0].account, current[0].account);
  assert.equal(result.after[0].tokens, current[0].tokens);
});

test("workspace token-list order is a reviewed configuration change", () => {
  const current = draft();
  current[0].tokens = CONTRACTS.join("\n");
  const incoming = workspaceFromDraft(current);
  const editable = clone(incoming);
  editable.entries[0].tokens.reverse();
  const result = previewWorkspace(encodeWorkspace(editable), current, OPTIONS);
  assert.equal(result.changes[0].configurationChanged, true);
  assert.equal(result.changes[0].tokenCount, 3);
});

test("workspace invalid incoming histories cannot be smuggled through settings-only mode", () => {
  const incoming = bundle();
  incoming.entries[1].history.reports[0].snapshot.readOnly = false;
  assert.throws(() => previewWorkspace(JSON.stringify(incoming), draft(),
    { settings: true, histories: false, mode: "merge" }), { code: "WORKSPACE_HISTORY" });
});

test("workspace partial agent histories are retained without fabricating missing records", () => {
  const current = draft({ populated: false });
  const incoming = bundle({ populated: false });
  incoming.entries[1].history = JSON.parse(archive([snapshot(1)]));
  const result = previewWorkspace(encodeWorkspace(incoming), current, OPTIONS);
  assert.deepEqual(result.changes.map(row => row.afterCount), [0, 1, 0]);
  assert.deepEqual(result.changes.map(row => row.historyChanged), [false, true, false]);
});

test("workspace preview reports cannot authorize connections or transactions", () => {
  const preview = previewWorkspace(text(), draft({ populated: false }), OPTIONS);
  assert.equal(preview.authorizesConnection, false);
  assert.equal(preview.authorizesTransaction, false);
  assert.ok(Object.isFrozen(preview.after[0]));
  assert.ok(Object.isFrozen(preview.changes[0]));
});
