import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryRecovery, HistoryRecoveryError } from "../src/history-recovery.js";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { observation, archive, OTHER, MAX } from "./helpers/history-fixtures.js";

function fixture(rows = [observation("1"), observation("2")], capacity = 64) {
  const history = createPortfolioHistory({ capacity });
  history.merge(rows);
  return { history, recovery: createHistoryRecovery(history) };
}
function code(action, expected) {
  assert.throws(action, error => error instanceof HistoryRecoveryError && error.code === expected);
}

test("initial recovery does not retain an extra archive or grant permissions", () => {
  const { recovery } = fixture();
  const state = recovery.state();
  assert.equal(state.hasBackup, false);
  assert.equal(state.canPreview, false);
  assert.equal(state.previewPending, false);
  assert.equal(state.storage, "memory-only");
  assert.equal(state.canAuthorizeConnection, false);
  assert.equal(state.canAuthorizeTransaction, false);
  code(() => recovery.preview(), "NO_RECOVERY");
  code(() => recovery.exportText(), "NO_RECOVERY");
});

test("removing a selected record retains a bounded prior archive", () => {
  const { history, recovery } = fixture();
  const original = history.exportText();
  recovery.remove(0, 1);
  assert.equal(history.state().size, 1);
  assert.equal(history.state().snapshots[0].blockNumber, "2");
  assert.equal(recovery.exportText(), original);
  const state = recovery.state();
  assert.equal(state.kind, "remove");
  assert.equal(state.previousCount, 2);
  assert.equal(state.resultingCount, 1);
  assert.equal(state.canPreview, true);
});

test("preview does not restore until explicit apply", () => {
  const { history, recovery } = fixture();
  recovery.remove(0, 1);
  const result = recovery.preview();
  assert.equal(result.impact.resultingCount, 2);
  assert.equal(history.state().size, 1);
  recovery.apply(result.previewId);
  assert.equal(history.state().size, 2);
  assert.equal(history.state().snapshots[0].blockNumber, "1");
  assert.equal(recovery.state().hasBackup, false);
});

test("clearing all records can be restored in original insertion order", () => {
  const { history, recovery } = fixture([observation("9"), observation("1"), observation("5")]);
  const original = history.exportText();
  recovery.clear(1);
  assert.equal(history.state().size, 0);
  assert.equal(recovery.state().kind, "clear");
  const preview = recovery.preview();
  recovery.apply(preview.previewId);
  assert.equal(history.exportText(), original);
});

test("explicit replacement can be reversed without treating it as merge", () => {
  const { history, recovery } = fixture();
  const original = history.exportText();
  const result = recovery.replace(archive([observation("99")]), 1);
  assert.equal(result.state.size, 1);
  assert.equal(history.state().snapshots[0].blockNumber, "99");
  assert.equal(recovery.state().kind, "replace");
  const preview = recovery.preview();
  assert.equal(preview.impact.removed[0].blockNumber, "99");
  recovery.apply(preview.previewId);
  assert.equal(history.exportText(), original);
});

test("same-position changed hash and balance can be restored exactly", () => {
  const { history, recovery } = fixture([observation("1", { nativeBalanceBaseUnits: MAX })]);
  const original = history.exportText();
  recovery.replace(archive([observation("1", { blockHash: "0x" + "cd".repeat(32) })]), 1);
  const preview = recovery.preview();
  assert.equal(preview.impact.changed.length, 1);
  recovery.apply(preview.previewId);
  assert.equal(history.exportText(), original);
});

test("new observations after deletion block direct restoration", () => {
  const { history, recovery } = fixture();
  recovery.remove(0, 1);
  history.add(observation("3"));
  const before = history.exportText();
  assert.equal(recovery.state().canPreview, false);
  assert.equal(recovery.state().hasBackup, true);
  code(() => recovery.preview(), "STALE_HISTORY");
  assert.equal(history.exportText(), before);
  assert.equal(JSON.parse(recovery.exportText()).reports.length, 2);
});

test("changes after preview are rechecked at the final apply", () => {
  const { history, recovery } = fixture();
  recovery.clear(1);
  const review = recovery.preview();
  history.add(observation("99"));
  code(() => recovery.apply(review.previewId), "STALE_HISTORY");
  assert.equal(history.state().snapshots[0].blockNumber, "99");
  assert.equal(recovery.state().hasBackup, true);
});

test("same contents at another revision still invalidate old restoration", () => {
  const { history, recovery } = fixture();
  recovery.remove(0, 1);
  history.add(observation("99"));
  history.remove(1, history.state().revision);
  assert.equal(history.state().size, 1);
  code(() => recovery.preview(), "STALE_HISTORY");
});

test("old preview cannot be reused or applied twice", () => {
  const { recovery } = fixture();
  recovery.clear(1);
  const preview = recovery.preview();
  recovery.apply(preview.previewId);
  code(() => recovery.apply(preview.previewId), "MISSING_RECOVERY_PREVIEW");
});

test("a new preview supersedes the previous preview identifier", () => {
  const { recovery } = fixture();
  recovery.clear(1);
  const old = recovery.preview();
  const current = recovery.preview();
  assert.notEqual(old.previewId, current.previewId);
  code(() => recovery.apply(old.previewId), "MISSING_RECOVERY_PREVIEW");
  code(() => recovery.apply(current.previewId), "MISSING_RECOVERY_PREVIEW");
});

test("cancelled recovery preview cannot be applied", () => {
  const { recovery, history } = fixture();
  recovery.clear(1);
  const preview = recovery.preview();
  recovery.cancelPreview();
  code(() => recovery.apply(preview.previewId), "MISSING_RECOVERY_PREVIEW");
  assert.equal(history.state().size, 0);
  assert.equal(recovery.state().hasBackup, true);
});

test("the latest destructive operation replaces only the single recovery slot", () => {
  const { history, recovery } = fixture([observation("1"), observation("2"), observation("3")]);
  recovery.remove(0, 1);
  const firstId = recovery.state().recoveryId;
  const afterFirst = history.exportText();
  recovery.remove(0, 2);
  assert.notEqual(recovery.state().recoveryId, firstId);
  assert.equal(recovery.exportText(), afterFirst);
  const preview = recovery.preview();
  recovery.apply(preview.previewId);
  assert.deepEqual(history.state().snapshots.map(row => row.blockNumber), ["2", "3"]);
});

test("failed deletion preserves both records and existing recovery archive", () => {
  const { history, recovery } = fixture();
  recovery.remove(0, 1);
  const backup = recovery.exportText();
  const id = recovery.state().recoveryId;
  assert.throws(() => recovery.remove(99, 2));
  assert.equal(history.state().size, 1);
  assert.equal(recovery.exportText(), backup);
  assert.equal(recovery.state().recoveryId, id);
});

test("failed replacement does not displace the recovery slot", () => {
  const { history, recovery } = fixture();
  recovery.remove(0, 1);
  const backup = recovery.exportText();
  assert.throws(() => recovery.replace("broken", 2));
  assert.equal(recovery.exportText(), backup);
  assert.equal(history.state().size, 1);
});

test("no-op clearing does not discard an existing undo archive", () => {
  const { history, recovery } = fixture();
  recovery.clear(1);
  const backup = recovery.exportText();
  const id = recovery.state().recoveryId;
  recovery.clear(history.state().revision);
  assert.equal(recovery.state().recoveryId, id);
  assert.equal(recovery.exportText(), backup);
});

test("no-op replacement never manufactures a recovery entry", () => {
  const { history, recovery } = fixture();
  recovery.replace(history.exportText(), 1);
  assert.equal(recovery.state().hasBackup, false);
  assert.equal(history.state().revision, 1);
});

for (const revision of [0, -1, "1", null, NaN, 1.5]) {
  test("destructive operations require current revision " + String(revision), () => {
    const { history, recovery } = fixture();
    code(() => recovery.remove(0, revision), "STALE_HISTORY");
    code(() => recovery.clear(revision), "STALE_HISTORY");
    code(() => recovery.replace(archive([]), revision), "STALE_HISTORY");
    assert.equal(history.state().size, 2);
    assert.equal(recovery.state().hasBackup, false);
  });
}

test("discard affects only the recovery archive, not current observations", () => {
  const { history, recovery } = fixture();
  recovery.remove(0, 1);
  const original = history.exportText();
  recovery.discard(recovery.state().recoveryId);
  assert.equal(recovery.state().hasBackup, false);
  assert.equal(history.exportText(), original);
});

test("stale recovery ID cannot discard a newer backup", () => {
  const { history, recovery } = fixture([observation("1"), observation("2"), observation("3")]);
  recovery.remove(0, 1);
  const first = recovery.state().recoveryId;
  recovery.remove(0, history.state().revision);
  code(() => recovery.discard(first), "STALE_RECOVERY");
  assert.equal(recovery.state().hasBackup, true);
});

test("recovery export remains an ordinary importable history archive", () => {
  const { recovery } = fixture();
  recovery.clear(1);
  const restored = createPortfolioHistory();
  restored.importText(recovery.exportText());
  assert.equal(restored.state().size, 2);
});

test("unknown balances and different accounts remain separate after recovery", () => {
  const missing = [{ address: "0x" + "33".repeat(20), hasCode: false,
    balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }];
  const { history, recovery } = fixture([observation("1", { holdings: missing }), observation("2", { account: OTHER })]);
  recovery.clear(1);
  recovery.apply(recovery.preview().previewId);
  assert.equal(history.groups().length, 2);
  assert.equal(history.state().snapshots[0].holdings[0].balanceBaseUnits, null);
});

test("disposed recovery releases all retained data and cannot mutate history", () => {
  const { history, recovery } = fixture();
  recovery.clear(1);
  recovery.dispose();
  recovery.dispose();
  assert.equal(recovery.state().hasBackup, false);
  assert.equal(recovery.state().canPreview, false);
  for (const operation of [() => recovery.preview(), () => recovery.apply(1),
    () => recovery.exportText(), () => recovery.clear(2), () => recovery.remove(0, 2),
    () => recovery.replace(archive(), 2), () => recovery.discard(1)]) {
    code(operation, "RECOVERY_DISPOSED");
  }
  assert.equal(history.state().size, 0);
});

test("recovery state and preview are immutable data", () => {
  const { recovery } = fixture();
  recovery.clear(1);
  assert.ok(Object.isFrozen(recovery.state()));
  const preview = recovery.preview();
  assert.ok(Object.isFrozen(preview));
  assert.ok(Object.isFrozen(preview.impact));
});
