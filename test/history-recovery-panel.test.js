import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { createHistoryRecovery } from "../src/history-recovery.js";
import { mountHistoryRecovery } from "../examples/history-recovery-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { observation, archive } from "./helpers/history-fixtures.js";

function fixture(options = {}) {
  const parent = new Element("section");
  const history = createPortfolioHistory();
  history.merge([observation("1"), observation("2")]);
  const recovery = createHistoryRecovery(history);
  const downloads = [], copies = [];
  let restored = 0;
  const panel = mountHistoryRecovery({
    document: { createElement: tag => new Element(tag) }, parent, agent: "DAT", recovery,
    onRestore: () => { restored++; }, onCopyArchive: text => copies.push(text),
    download: ({ prepared }) => downloads.push(prepared),
    ...options,
  });
  const field = suffix => parent.find("history-recovery-" + suffix);
  return { parent, history, recovery, panel, field, downloads, copies,
    restored: () => restored, click: suffix => field(suffix).click(),
    remove() { recovery.remove(0, history.state().revision); panel.refresh(); },
    clear() { recovery.clear(history.state().revision); panel.refresh(); } };
}

test("initial panel disables recovery actions without starting a download", () => {
  const f = fixture();
  for (const name of ["preview", "apply", "save", "copy", "discard"]) {
    assert.equal(f.field(name).disabled, true, name);
  }
  assert.equal(f.downloads.length, 0);
  assert.equal(f.copies.length, 0);
  assert.match(f.field("status").textContent, /まだありません/);
  f.panel.dispose();
});

test("deletion enables a preview but not an immediate restoration", () => {
  const f = fixture();
  f.remove();
  assert.equal(f.field("preview").disabled, false);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("save").disabled, false);
  assert.match(f.field("status").textContent, /操作前の履歴 2件/);
  assert.equal(f.history.state().size, 1);
  f.panel.dispose();
});

test("preview visibly describes the expected restoration count", () => {
  const f = fixture();
  f.remove();
  f.click("preview");
  assert.equal(f.field("apply").disabled, false);
  assert.match(f.field("details").textContent, /現在 1件 → 復元後 2件/);
  assert.match(f.field("details").textContent, /まだ復元していません/);
  assert.equal(f.history.state().size, 1);
  f.panel.dispose();
});

test("explicit apply restores and clears the one-step recovery slot", () => {
  const f = fixture();
  f.remove();
  f.click("preview");
  f.click("apply");
  assert.equal(f.history.state().size, 2);
  assert.equal(f.restored(), 1);
  assert.equal(f.recovery.state().hasBackup, false);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("preview").disabled, true);
  f.panel.dispose();
});

test("clear-all recovery shows 0 to previous count", () => {
  const f = fixture();
  f.clear();
  f.click("preview");
  assert.match(f.field("details").textContent, /現在 0件 → 復元後 2件/);
  assert.equal(f.history.state().size, 0);
  f.click("apply");
  assert.equal(f.history.state().size, 2);
  f.panel.dispose();
});

test("new record disables direct restoration but permits saving a backup", () => {
  const f = fixture();
  f.remove();
  f.history.add(observation("99"));
  f.panel.refresh();
  assert.equal(f.field("preview").disabled, true);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("save").disabled, false);
  assert.equal(f.field("copy").disabled, false);
  assert.match(f.field("status").textContent, /履歴が変わっています/);
  f.panel.dispose();
});

test("new record after preview prevents final restoration", () => {
  const f = fixture();
  f.remove();
  f.click("preview");
  f.history.add(observation("99"));
  f.click("apply");
  assert.equal(f.history.state().size, 2);
  assert.equal(f.history.state().snapshots[1].blockNumber, "99");
  assert.equal(f.restored(), 0);
  assert.equal(f.field("apply").disabled, true);
  assert.match(f.field("status").textContent, /上書きしていません/);
  f.panel.dispose();
});

test("invalidating UI cancels the outstanding model preview", () => {
  const f = fixture();
  f.remove();
  f.click("preview");
  assert.equal(f.recovery.state().previewPending, true);
  f.panel.invalidate();
  assert.equal(f.recovery.state().previewPending, false);
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("apply").disabled, true);
  f.panel.dispose();
});

test("file save exports the pre-deletion archive with a distinct name", () => {
  const f = fixture();
  f.remove();
  f.click("save");
  assert.equal(f.downloads.length, 1);
  assert.match(f.downloads[0].filename, /-before-change\.json$/);
  assert.equal(JSON.parse(f.downloads[0].text).reports.length, 2);
  assert.equal(f.history.state().size, 1);
  assert.match(f.field("status").textContent, /ダウンロードを開始/);
  f.panel.dispose();
});

test("stale recovery identity cannot export a different newer archive", () => {
  const f = fixture();
  f.remove();
  f.recovery.clear(f.history.state().revision);
  f.click("save");
  assert.equal(f.downloads.length, 0);
  assert.match(f.field("status").textContent, /復元操作は行えません/);
  f.panel.dispose();
});

test("copy shows old archive for separate review without applying it", () => {
  const f = fixture();
  f.remove();
  f.click("copy");
  assert.equal(f.copies.length, 1);
  assert.equal(JSON.parse(f.copies[0]).reports.length, 2);
  assert.equal(f.history.state().size, 1);
  assert.equal(f.restored(), 0);
  assert.match(f.field("status").textContent, /別途確認してから適用/);
  f.panel.dispose();
});

test("copy also cancels an earlier restoration preview", () => {
  const f = fixture();
  f.remove();
  f.click("preview");
  f.click("copy");
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.recovery.state().previewPending, false);
  f.panel.dispose();
});

test("unconfirmed discard retains backup and current observations", () => {
  const f = fixture();
  f.remove();
  f.click("discard");
  assert.equal(f.recovery.state().hasBackup, true);
  assert.equal(f.history.state().size, 1);
  f.panel.dispose();
});

test("confirmed discard removes only the recovery slot", () => {
  const f = fixture();
  f.remove();
  const current = f.history.exportText();
  f.field("discard-confirm").checked = true;
  f.click("discard");
  assert.equal(f.recovery.state().hasBackup, false);
  assert.equal(f.history.exportText(), current);
  assert.equal(f.field("save").disabled, true);
  assert.match(f.field("status").textContent, /現在の履歴は保持/);
  f.panel.dispose();
});

test("new destructive action clears a previous discard acknowledgement", () => {
  const f = fixture();
  f.remove();
  f.field("discard-confirm").checked = true;
  f.recovery.clear(f.history.state().revision);
  f.panel.refresh();
  assert.equal(f.field("discard-confirm").checked, false);
  f.click("discard");
  assert.equal(f.recovery.state().hasBackup, true);
  f.panel.dispose();
});

test("old acknowledgement cannot discard a newer unrendered recovery slot", () => {
  const f = fixture();
  f.remove();
  f.field("discard-confirm").checked = true;
  f.recovery.clear(f.history.state().revision);
  f.click("discard");
  assert.equal(f.recovery.state().hasBackup, true);
  f.panel.dispose();
});

test("download failures expose a finite safe explanation", () => {
  const f = fixture({ download() { throw Error("PRIVATE_PATH"); } });
  f.remove();
  f.click("save");
  assert.match(f.field("status").textContent, /復元操作は行えません/);
  assert.ok(!f.field("status").textContent.includes("PRIVATE_PATH"));
  assert.equal(f.recovery.state().hasBackup, true);
  f.panel.dispose();
});

test("new preview failure clears an earlier valid apply control", () => {
  const f = fixture();
  f.remove();
  f.click("preview");
  f.history.add(observation("99"));
  f.click("preview");
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("details").textContent, "");
  f.panel.dispose();
});

test("panel disposal removes callbacks but does not destroy the owning history", () => {
  const f = fixture();
  f.remove();
  const preview = f.field("preview");
  f.panel.dispose();
  f.panel.dispose();
  f.panel.refresh();
  f.panel.invalidate();
  preview.click();
  assert.equal(f.parent.children.length, 0);
  assert.equal(f.history.state().size, 1);
  assert.equal(f.restored(), 0);
});

test("accessible status identifies recovery updates", () => {
  const f = fixture();
  assert.equal(f.field("status").getAttribute("role"), "status");
  assert.equal(f.field("status").getAttribute("aria-live"), "polite");
  f.panel.dispose();
});

test("backup remains downloadable after collection changes made undo stale", () => {
  const f = fixture();
  f.remove();
  f.history.add(observation("99"));
  f.panel.refresh();
  f.click("save");
  assert.equal(f.downloads.length, 1);
  assert.equal(JSON.parse(f.downloads[0].text).reports.length, 2);
  assert.equal(f.history.state().snapshots[1].blockNumber, "99");
  f.panel.dispose();
});

test("recovery download is revalidated for the selected agent", () => {
  const f = fixture({ agent: "EMA" });
  f.remove();
  f.click("save");
  assert.equal(f.downloads.length, 0);
  assert.equal(f.recovery.state().hasBackup, true);
  f.panel.dispose();
});

test("replacement recovery describes the stored full prior collection", () => {
  const f = fixture();
  f.recovery.replace(archive([observation("99")]), 1);
  f.panel.refresh();
  f.click("preview");
  assert.match(f.field("details").textContent, /現在 1件 → 復元後 2件/);
  f.click("apply");
  assert.deepEqual(f.history.state().snapshots.map(row => row.blockNumber), ["1", "2"]);
  f.panel.dispose();
});
