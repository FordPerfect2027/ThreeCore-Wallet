import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { createHistoryRecovery } from "../src/history-recovery.js";
import { observation, archive, MAX, OTHER } from "./helpers/history-fixtures.js";

function holdings(count) {
  return Array.from({ length: count }, (_, index) => ({
    address: "0x" + (index + 1).toString(16).padStart(40, "0"),
    hasCode: index % 3 !== 0,
    balanceBaseUnits: index % 3 === 0 ? null : MAX,
    notice: index % 3 === 0 ? "TOKEN_CODE_MISSING" : null,
  }));
}
function collection(rows, capacity = 64) {
  const history = createPortfolioHistory({ capacity });
  history.merge(rows);
  return { history, recovery: createHistoryRecovery(history) };
}
function restored(f) {
  const preview = f.recovery.preview();
  f.recovery.apply(preview.previewId);
}

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test(agent + " restores the full 64-record, 32-contract boundary exactly", () => {
    const rows = Array.from({ length: 64 }, (_, index) => observation(String(index), {
      agent, holdings: holdings(32), nativeBalanceBaseUnits: MAX,
    }));
    const f = collection(rows);
    const original = f.history.exportText();
    f.recovery.clear(f.history.state().revision);
    assert.equal(f.history.state().size, 0);
    assert.equal(f.recovery.state().previousCount, 64);
    assert.equal(f.recovery.exportText(), original);
    restored(f);
    assert.equal(f.history.exportText(), original);
    assert.equal(f.history.state().size, 64);
    assert.equal(f.recovery.state().hasBackup, false);
  });
}

test("recovery preserves mixed identities without joining their balances", () => {
  const rows = [
    observation("2", { agent: "DAT" }),
    observation("2", { agent: "EMA", account: OTHER }),
    observation("2", { agent: "CAWELON", chainId: 8453 }),
    observation("2", { siteOrigin: "https://example.com" }),
  ];
  const f = collection(rows);
  const groups = f.history.groups();
  f.recovery.clear(1);
  restored(f);
  assert.equal(f.history.groups().length, 4);
  assert.deepEqual(f.history.groups(), groups);
  assert.equal(f.history.state().snapshots[1].account, OTHER);
});

test("removal at first, middle and last positions restores insertion order", () => {
  for (const index of [0, 31, 63]) {
    const f = collection(Array.from({ length: 64 }, (_, i) => observation(String(63 - i))));
    const original = f.history.exportText();
    f.recovery.remove(index, 1);
    assert.equal(f.history.state().size, 63);
    restored(f);
    assert.equal(f.history.exportText(), original, "removed position " + index);
  }
});

test("a full history backup cannot conceal newer records after a removal", () => {
  const f = collection(Array.from({ length: 64 }, (_, i) => observation(String(i))));
  f.recovery.remove(0, 1);
  const removedArchive = f.recovery.exportText();
  const reviewed = f.recovery.preview();
  f.history.add(observation("100"));
  const current = f.history.exportText();
  assert.throws(() => f.recovery.apply(reviewed.previewId), { code: "STALE_HISTORY" });
  assert.equal(f.history.exportText(), current);
  assert.equal(f.history.state().size, 64);
  assert.equal(f.recovery.exportText(), removedArchive);
  assert.equal(f.recovery.state().canPreview, false);
});

test("a conflicting same-height replacement recovers all original fields", () => {
  const original = observation("42", { holdings: holdings(32) });
  const changed = observation("42", {
    blockHash: "0x" + "cd".repeat(32),
    nativeBalanceBaseUnits: MAX,
    connectionEpoch: 100,
  });
  const f = collection([original]);
  const text = f.history.exportText();
  f.recovery.replace(archive([changed]), 1);
  const preview = f.recovery.preview();
  assert.equal(preview.impact.changed.length, 1);
  assert.equal(preview.impact.added.length, 0);
  assert.equal(preview.impact.removed.length, 0);
  f.recovery.apply(preview.previewId);
  assert.equal(f.history.exportText(), text);
});

test("an empty replacement retains the populated archive", () => {
  const f = collection([observation("1")]);
  const text = f.history.exportText();
  f.recovery.replace(archive([]), 1);
  assert.equal(f.history.state().size, 0);
  assert.equal(f.recovery.state().kind, "replace");
  restored(f);
  assert.equal(f.history.exportText(), text);
});

test("replacing empty history can be reverted to empty without phantom rows", () => {
  const f = collection([]);
  const text = f.history.exportText();
  f.recovery.replace(archive([observation("1")]), 0);
  assert.equal(f.recovery.state().previousCount, 0);
  restored(f);
  assert.equal(f.history.exportText(), text);
  assert.equal(f.history.state().size, 0);
});

test("replacement above a smaller destination capacity is atomic", () => {
  const f = collection([observation("1"), observation("2")], 2);
  f.recovery.remove(0, 1);
  const before = f.history.exportText();
  const backup = f.recovery.exportText();
  const preview = f.recovery.preview();
  assert.throws(() => f.recovery.replace(archive([
    observation("3"), observation("4"), observation("5"),
  ]), f.history.state().revision));
  assert.equal(f.history.exportText(), before);
  assert.equal(f.recovery.exportText(), backup);
  f.recovery.apply(preview.previewId);
  assert.equal(f.history.state().size, 2);
});

test("invalid replacement documents preserve both pending preview and backup", () => {
  const invalid = [
    "", "{", "null", "[]", "{}", "x".repeat(1048577),
    JSON.stringify({ schema: "threecore-portfolio-history-v1", historicalObservation: false, reports: [] }),
    JSON.stringify({ schema: "threecore-portfolio-history-v1", historicalObservation: true, reports: [], extra: true }),
  ];
  for (const text of invalid) {
    const f = collection([observation("1"), observation("2")]);
    f.recovery.remove(0, 1);
    const preview = f.recovery.preview();
    const backup = f.recovery.exportText();
    const current = f.history.exportText();
    assert.throws(() => f.recovery.replace(text, f.history.state().revision));
    assert.equal(f.history.exportText(), current);
    assert.equal(f.recovery.exportText(), backup);
    assert.equal(f.recovery.state().previewId, preview.previewId);
    restored(f);
    assert.equal(f.history.state().size, 2);
  }
});

test("invalid selection does not replace the last usable recovery slot", () => {
  for (const index of [-1, 99, 0.5, NaN, "0", null, undefined]) {
    const f = collection([observation("1"), observation("2")]);
    f.recovery.remove(0, 1);
    const backup = f.recovery.exportText();
    const current = f.history.exportText();
    const id = f.recovery.state().recoveryId;
    assert.throws(() => f.recovery.remove(index, f.history.state().revision));
    assert.equal(f.history.exportText(), current);
    assert.equal(f.recovery.exportText(), backup);
    assert.equal(f.recovery.state().recoveryId, id);
  }
});

test("caller-owned row edits cannot modify the retained archive", () => {
  const row = observation("1");
  const f = collection([row, observation("2")]);
  f.recovery.remove(0, 1);
  const backup = f.recovery.exportText();
  row.nativeBalanceBaseUnits = MAX;
  row.holdings[0].balanceBaseUnits = MAX;
  row.blockHash = "0x" + "ff".repeat(32);
  assert.equal(f.recovery.exportText(), backup);
  restored(f);
  assert.equal(f.history.state().snapshots[0].nativeBalanceBaseUnits, "16");
});

test("repeated delete/restore cycles never accumulate an undo stack", () => {
  const f = collection([observation("1"), observation("2")]);
  const original = f.history.exportText();
  let priorId = 0;
  for (let i = 0; i < 100; i++) {
    f.recovery.remove(i % 2, f.history.state().revision);
    assert.ok(f.recovery.state().recoveryId > priorId);
    priorId = f.recovery.state().recoveryId;
    restored(f);
    assert.equal(f.history.exportText(), original);
    assert.equal(f.recovery.state().hasBackup, false);
    assert.throws(() => f.recovery.preview(), { code: "NO_RECOVERY" });
  }
});

test("separate recovery controllers cannot restore through another controller's edit", () => {
  const f = collection([observation("1"), observation("2"), observation("3")]);
  const second = createHistoryRecovery(f.history);
  f.recovery.remove(0, 1);
  const preview = f.recovery.preview();
  second.remove(0, f.history.state().revision);
  assert.throws(() => f.recovery.apply(preview.previewId), { code: "STALE_HISTORY" });
  assert.equal(f.history.state().size, 1);
  second.apply(second.preview().previewId);
  assert.equal(f.history.state().size, 2);
  assert.equal(f.recovery.state().canPreview, false);
});
