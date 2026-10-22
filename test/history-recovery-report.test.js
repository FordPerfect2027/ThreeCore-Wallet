import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { createHistoryRecovery } from "../src/history-recovery.js";
import { mountHistoryRecovery } from "../examples/history-recovery-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { observation, archive, MAX, OTHER } from "./helpers/history-fixtures.js";

function fixture(rows = [observation("1"), observation("2")]) {
  const history = createPortfolioHistory();
  history.merge(rows);
  const recovery = createHistoryRecovery(history);
  const parent = new Element("section");
  const panel = mountHistoryRecovery({
    document: { createElement: tag => new Element(tag) }, parent, agent: "DAT", recovery,
    onRestore() {}, onCopyArchive() {}, download() {},
  });
  const field = name => parent.find("history-recovery-" + name);
  const remove = () => { recovery.remove(0, history.state().revision); panel.refresh(); };
  return { history, recovery, parent, panel, field, remove };
}

test("a recovery report is unavailable until a destructive operation exists", () => {
  const f = fixture();
  assert.throws(() => f.recovery.report());
  assert.equal(f.field("report").disabled, true);
  f.panel.dispose();
});

test("the detailed report names deletion and both record counts", () => {
  const f = fixture();
  f.remove();
  const text = f.recovery.report().text;
  assert.match(text, /対象操作: 選択した記録の削除/);
  assert.match(text, /控えの記録数: 2/);
  assert.match(text, /現在の記録数: 1/);
  assert.match(text, /現在 1件 → 適用後 2件/);
  assert.match(text, /直接復元の確認が可能/);
  assert.match(text, /ページを閉じると失われます/);
  f.panel.dispose();
});

test("reporting preserves current history, backup and existing preview", () => {
  const f = fixture();
  f.remove();
  const current = f.history.exportText();
  const backup = f.recovery.exportText();
  const preview = f.recovery.preview();
  const before = f.recovery.state();
  f.recovery.report();
  assert.equal(f.history.exportText(), current);
  assert.equal(f.recovery.exportText(), backup);
  assert.deepEqual(f.recovery.state(), before);
  f.recovery.apply(preview.previewId);
  assert.equal(f.history.state().size, 2);
  f.panel.dispose();
});

test("report metadata is immutable and grants no Wallet authority", () => {
  const f = fixture();
  f.remove();
  const report = f.recovery.report();
  assert.ok(Object.isFrozen(report));
  assert.equal(report.canAuthorizeConnection, false);
  assert.equal(report.canAuthorizeTransaction, false);
  assert.equal(report.securityAudit, false);
  assert.equal(report.historicalObservation, true);
  assert.equal(report.canRestoreDirectly, true);
  assert.equal(report.recoveryId, f.recovery.state().recoveryId);
  assert.equal(report.currentRevision, f.history.state().revision);
  f.panel.dispose();
});

test("stale report offers archive inspection without a replacement plan", () => {
  const f = fixture();
  f.remove();
  f.history.add(observation("3"));
  const current = f.history.exportText();
  const report = f.recovery.report();
  assert.equal(report.canRestoreDirectly, false);
  assert.match(report.text, /操作後に履歴が変わっています/);
  assert.match(report.text, /新しい履歴を置き換える指示ではありません/);
  assert.doesNotMatch(report.text, /方式: 既存履歴を置き換え/);
  assert.equal(f.history.exportText(), current);
  f.panel.dispose();
});

test("report keeps uint256 values as exact decimal text", () => {
  const f = fixture([observation(MAX, {
    nativeBalanceBaseUnits: MAX,
    holdings: [{ address: OTHER, hasCode: true, balanceBaseUnits: MAX, notice: null }],
  })]);
  f.remove();
  const text = f.recovery.report().text;
  assert.ok(text.includes("block " + MAX));
  assert.ok(text.includes("ネイティブ残高（最小単位）: " + MAX));
  assert.ok(text.includes("契約 " + OTHER + ": " + MAX));
  assert.doesNotMatch(text, /e\+\d+/);
  f.panel.dispose();
});

test("unknown token balance is described as unknown rather than zero", () => {
  const f = fixture([observation("1", {
    holdings: [{ address: OTHER, hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }],
  })]);
  f.remove();
  const text = f.recovery.report().text;
  assert.ok(text.includes("契約 " + OTHER + ": 未確認（契約コードなし）"));
  assert.ok(!text.includes("契約 " + OTHER + ": 0"));
  assert.match(text, /現在残高・所有権・利益・独立監査を証明しません/);
  f.panel.dispose();
});

test("reports retain account, chain, origin, hash and insertion order", () => {
  const f = fixture([
    observation("9", { account: OTHER, chainId: 8453, siteOrigin: "https://example.com" }),
    observation("1"),
  ]);
  f.recovery.clear(1);
  const text = f.recovery.report().text;
  assert.ok(text.includes("1. DAT / " + OTHER));
  assert.ok(text.includes("chain 8453 / https://example.com"));
  assert.ok(text.indexOf("block 9 / hash") < text.indexOf("block 1 / hash"));
  assert.ok(text.includes("0x" + "ab".repeat(32)));
  assert.match(text, /対象操作: 全記録の消去/);
  f.panel.dispose();
});

test("replacement report exposes the reversed same-height balance change", () => {
  const f = fixture([observation("1")]);
  f.recovery.replace(archive([observation("1", { nativeBalanceBaseUnits: "99" })]), 1);
  const text = f.recovery.report().text;
  assert.match(text, /対象操作: JSONによる置き換え/);
  assert.match(text, /ネイティブ残高（最小単位）: 99 → 16/);
  assert.match(text, /同じ位置の変更 1件/);
  f.panel.dispose();
});

test("UI report action shows details without enabling restore", () => {
  const f = fixture();
  f.remove();
  f.field("report").click();
  assert.match(f.field("details").textContent, /操作前の履歴・復元確認レポート/);
  assert.match(f.field("status").textContent, /まだ履歴を変更していません/);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.history.state().size, 1);
  f.panel.dispose();
});

test("opening the report cancels a previously armed UI restore", () => {
  const f = fixture();
  f.remove();
  f.field("preview").click();
  const id = f.recovery.state().previewId;
  assert.equal(f.field("apply").disabled, false);
  f.field("report").click();
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.recovery.state().previewPending, false);
  assert.throws(() => f.recovery.apply(id));
  assert.equal(f.history.state().size, 1);
  f.panel.dispose();
});

test("stale history still permits detailed archive inspection in the UI", () => {
  const f = fixture();
  f.remove();
  f.history.add(observation("3"));
  f.panel.refresh();
  assert.equal(f.field("preview").disabled, true);
  assert.equal(f.field("report").disabled, false);
  f.field("report").click();
  assert.match(f.field("details").textContent, /直接復元せず/);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.history.state().size, 2);
  f.panel.dispose();
});

test("a stale rendered recovery identity cannot inspect the replacement slot", () => {
  const f = fixture();
  f.remove();
  f.recovery.clear(f.history.state().revision);
  f.field("report").click();
  assert.equal(f.field("details").textContent, "");
  assert.match(f.field("status").textContent, /行えませんでした/);
  assert.equal(f.history.state().size, 0);
  f.panel.dispose();
});

test("discard and disposal remove report access along with the archive", () => {
  const f = fixture();
  f.remove();
  f.recovery.discard(f.recovery.state().recoveryId);
  assert.throws(() => f.recovery.report());
  f.panel.refresh();
  assert.equal(f.field("report").disabled, true);
  f.recovery.clear(f.history.state().revision);
  assert.ok(f.recovery.report().text);
  f.recovery.dispose();
  assert.throws(() => f.recovery.report(), { code: "RECOVERY_DISPOSED" });
  f.panel.dispose();
});
