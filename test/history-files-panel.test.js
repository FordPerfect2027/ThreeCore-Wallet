import test from "node:test";
import assert from "node:assert/strict";
import { mountHistoryFiles, offerHistoryDownload } from "../examples/history-files.js";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { Element } from "./helpers/panel-dom.js";
import { archive, observation, file, bytes, deferred, OTHER } from "./helpers/history-fixtures.js";

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const parent = new Element("section");
  const history = createPortfolioHistory();
  history.add(observation());
  const downloads = [], imports = [];
  const panel = mountHistoryFiles({
    document: { createElement: tag => new Element(tag) }, parent, agent: "DAT",
    getArchive: () => history.exportText(), getRevision: () => history.state().revision,
    onImportText: text => imports.push(text),
    readBytes: async () => bytes(),
    download: value => downloads.push(value.prepared),
    ...options,
  });
  const field = suffix => parent.find("history-" + suffix);
  const select = files => {
    const input = field("file-input");
    input.files = files;
    input.dispatchEvent(new Event("change"));
  };
  const input = (suffix, value) => {
    field(suffix).value = value;
    field(suffix).dispatchEvent(new Event("input"));
  };
  return { parent, history, downloads, imports, panel, field, select, input,
    click: suffix => field(suffix).click() };
}

test("file panel starts without IO, downloads or imported records", () => {
  const f = fixture();
  assert.equal(f.downloads.length, 0);
  assert.equal(f.imports.length, 0);
  assert.equal(f.field("file-cancel").disabled, true);
  assert.equal(f.field("file-save-subset").disabled, true);
  assert.equal(f.field("file-input").accept, ".json,application/json");
  assert.equal(f.field("file-input").type, "file");
  f.panel.dispose();
});

test("download is explicit and includes all records", () => {
  const f = fixture();
  f.click("file-save");
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].observationCount, 1);
  assert.equal(f.downloads[0].filename, "ThreeCore-DAT-history-r1.json");
  assert.match(f.field("backup-state").textContent, /ダウンロードを開始済み/);
  assert.match(f.field("backup-state").textContent, /保存完了はブラウザーで確認/);
  f.panel.dispose();
});

test("download exception never marks the archive as saved", () => {
  const f = fixture({ download() { throw Error("browser refused"); } });
  f.click("file-save");
  assert.match(f.field("file-status").textContent, /操作できません/);
  assert.match(f.field("backup-state").textContent, /まだファイルとして/);
  assert.equal(f.history.state().size, 1);
  f.panel.dispose();
});

test("new history invalidates the previous offered download revision", () => {
  const f = fixture();
  f.click("file-save");
  f.history.add(observation("43"));
  f.panel.invalidate();
  assert.match(f.field("backup-state").textContent, /まだファイルとして/);
  f.panel.dispose();
});

test("valid file populates import text without modifying the history", async () => {
  const f = fixture();
  const before = f.history.exportText();
  f.select([file()]);
  await settle();
  assert.equal(f.imports.length, 1);
  assert.equal(f.history.exportText(), before);
  assert.match(f.field("file-status").textContent, /まだ履歴は変更していません/);
  assert.equal(f.field("file-cancel").disabled, true);
  f.panel.dispose();
});

test("empty file selection leaves existing import text alone", async () => {
  const f = fixture();
  f.select([]);
  await settle();
  assert.equal(f.imports.length, 0);
  assert.equal(f.history.state().size, 1);
  f.panel.dispose();
});

test("multiple files are rejected before starting IO", async () => {
  let reads = 0;
  const f = fixture({ readBytes: async () => { reads++; return bytes(); } });
  f.select([file(), file()]);
  await settle();
  assert.equal(reads, 0);
  assert.match(f.field("file-status").textContent, /一度に1つ/);
  f.panel.dispose();
});

test("invalid file content reports a safe error without copying arbitrary text", async () => {
  const f = fixture({ readBytes: async () => bytes("<script>bad</script>") });
  f.select([file("<script>bad</script>")]);
  await settle();
  assert.equal(f.imports.length, 0);
  assert.match(f.field("file-status").textContent, /形式が正しくありません/);
  assert.ok(!f.field("file-status").textContent.includes("<script>"));
  f.panel.dispose();
});

test("another agent file is explained and never imported", async () => {
  const text = archive([observation("1", { agent: "EMA" })]);
  const f = fixture({ readBytes: async () => bytes(text) });
  f.select([file(text)]);
  await settle();
  assert.equal(f.imports.length, 0);
  assert.match(f.field("file-status").textContent, /別のトークン/);
  f.panel.dispose();
});

test("cancel is available while reading and late data cannot populate JSON", async () => {
  const pending = deferred();
  const f = fixture({ readBytes: () => pending.promise });
  f.select([file()]);
  assert.equal(f.field("file-cancel").disabled, false);
  assert.equal(f.field("file-input").disabled, true);
  f.click("file-cancel");
  pending.resolve(bytes());
  await settle();
  assert.equal(f.imports.length, 0);
  assert.match(f.field("file-status").textContent, /キャンセル/);
  assert.equal(f.field("file-input").disabled, false);
  f.panel.dispose();
});

test("context invalidation cancels a late file candidate", async () => {
  const pending = deferred();
  const f = fixture({ readBytes: () => pending.promise });
  f.select([file()]);
  f.panel.invalidate();
  pending.resolve(bytes());
  await settle();
  assert.equal(f.imports.length, 0);
  f.panel.dispose();
});

test("disposed panel cannot finish an old read or start a download", async () => {
  const pending = deferred();
  const f = fixture({ readBytes: () => pending.promise });
  const save = f.field("file-save");
  f.select([file()]);
  f.panel.dispose();
  pending.resolve(bytes());
  await settle();
  save.click();
  f.panel.invalidate();
  assert.equal(f.downloads.length, 0);
  assert.equal(f.imports.length, 0);
});

test("unfiltered query lists observations and enables a subset export", () => {
  const f = fixture();
  f.click("filter-run");
  assert.match(f.field("filter-results").textContent, /1 \/ 1件/);
  assert.equal(f.field("file-save-subset").disabled, false);
  f.panel.dispose();
});

test("filter matches exact account and refuses unrelated account", () => {
  const f = fixture();
  f.input("filter-account", OTHER);
  f.click("filter-run");
  assert.match(f.field("filter-results").textContent, /0 \/ 1件/);
  assert.equal(f.field("file-save-subset").disabled, true);
  f.panel.dispose();
});

for (const [field, value] of [
  ["filter-account", "partial"],
  ["filter-chain", "0x2105"],
  ["filter-chain", "01"],
  ["filter-chain", "8453.0"],
  ["filter-chain", "-1"],
  ["filter-minimum", "01"],
  ["filter-maximum", "-1"],
]) {
  test("invalid filter disables an earlier export " + field + "=" + value, () => {
    const f = fixture();
    f.click("filter-run");
    f.input(field, value);
    f.click("filter-run");
    assert.equal(f.field("file-save-subset").disabled, true);
    assert.match(f.field("file-status").textContent, /操作できません/);
    assert.equal(f.downloads.length, 0);
    f.panel.dispose();
  });
}

test("filter edits invalidate previous results until explicit search", () => {
  const f = fixture();
  f.click("filter-run");
  f.input("filter-minimum", "40");
  assert.equal(f.field("filter-results").textContent, "");
  assert.equal(f.field("file-save-subset").disabled, true);
  f.panel.dispose();
});

test("partial download does not mark full history backed up", () => {
  const f = fixture();
  f.history.add(observation("43"));
  f.input("filter-maximum", "42");
  f.click("filter-run");
  f.click("file-save-subset");
  assert.equal(f.downloads[0].observationCount, 1);
  assert.match(f.downloads[0].filename, /-filtered\.json$/);
  assert.match(f.field("backup-state").textContent, /まだファイルとして/);
  assert.match(f.field("file-status").textContent, /全履歴の保存ではありません/);
  f.panel.dispose();
});

test("stale subset cannot be downloaded after record changes", () => {
  const f = fixture();
  f.click("filter-run");
  f.history.add(observation("43"));
  f.click("file-save-subset");
  assert.equal(f.downloads.length, 0);
  assert.match(f.field("file-status").textContent, /操作できません/);
  f.panel.dispose();
});

test("reset clears all filter fields and invalidates subset download", () => {
  const f = fixture();
  f.input("filter-minimum", "40");
  f.click("filter-run");
  f.click("filter-reset");
  for (const name of ["account", "chain", "minimum", "maximum"]) {
    assert.equal(f.field("filter-" + name).value, "");
  }
  assert.equal(f.field("filter-order").value, "oldest");
  assert.equal(f.field("file-save-subset").disabled, true);
  f.panel.dispose();
});

test("browser download cleanup revokes the blob URL after a delay", () => {
  const calls = [], timers = [];
  const anchor = new Element("a");
  anchor.click = () => calls.push("click");
  const document = {
    createElement: () => anchor,
    body: new Element("body"),
    defaultView: {
      Blob: class { constructor(parts, options) { calls.push({ parts, options }); } },
      URL: { createObjectURL() { return "blob:local-test"; }, revokeObjectURL(url) { calls.push(url); } },
      setTimeout(callback, delay) { timers.push({ callback, delay }); },
    },
  };
  offerHistoryDownload({ document, prepared: { text: "{}", filename: "history.json", mimeType: "application/json" } });
  assert.equal(anchor.href, "blob:local-test");
  assert.equal(anchor.download, "history.json");
  assert.equal(document.body.children.length, 0);
  assert.equal(timers[0].delay, 1000);
  assert.ok(calls.includes("click"));
  timers[0].callback();
  assert.ok(calls.includes("blob:local-test"));
});

test("failed download navigation still removes the anchor and revokes URL", () => {
  let cleaned = false;
  const timers = [];
  const anchor = new Element("a");
  anchor.click = () => { throw Error("navigation refused"); };
  const document = {
    createElement: () => anchor,
    body: new Element("body"),
    defaultView: {
      Blob: class {},
      URL: { createObjectURL: () => "blob:test", revokeObjectURL() { cleaned = true; } },
      setTimeout: callback => timers.push(callback),
    },
  };
  assert.throws(() => offerHistoryDownload({ document, prepared: { text: "{}" } }));
  assert.equal(document.body.children.length, 0);
  timers[0]();
  assert.equal(cleaned, true);
});
