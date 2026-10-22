import test from "node:test";
import assert from "node:assert/strict";
import { mountWalletSetupPanel } from "../examples/wallet-setup-panel.js";
import { encodeWalletSetup } from "../src/wallet-setup.js";
import { Element } from "./helpers/panel-dom.js";
import { A, B, C, setup, raw, deferred, fileFor } from "./helpers/setup-fixtures.js";

const text = encodeWalletSetup(setup());
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const parent = new Element("main");
  const document = { createElement: tag => new Element(tag) };
  let fields = raw();
  const applied = [], downloads = [];
  const panel = mountWalletSetupPanel({ document, parent, readFields: () => fields,
    applyPlan(plan, changes) { applied.push({ plan, changes }); fields = plan.entries.map(row => ({ ...row, account: row.account ?? "" })); },
    download: entry => downloads.push(entry.prepared), ...options });
  const find = name => parent.find("wallet-setup-" + name);
  const click = name => find(name).click();
  function input(value = text) {
    find("json").value = value;
    find("json").dispatchEvent(new Event("input"));
  }
  function confirm() {
    find("confirm").checked = true;
    find("confirm").dispatchEvent(new Event("change"));
  }
  function choose(file) {
    find("file").files = [file];
    find("file").dispatchEvent(new Event("change"));
  }
  return { parent, panel, find, click, input, confirm, choose, applied, downloads,
    fields: () => fields, set: value => { fields = value; },
    preview: () => { input(); click("preview"); } };
}

test("panel starts with missing settings and disabled apply", () => {
  const f = fixture();
  assert.match(f.find("readiness").textContent, /0 \/ 3/);
  assert.match(f.find("readiness").textContent, /DAT: 未設定/);
  assert.equal(f.find("apply").disabled, true);
  assert.equal(f.find("confirm").disabled, true);
  assert.equal(f.applied.length, 0);
});

test("preview alone neither applies nor authorizes apply", () => {
  const f = fixture();
  f.preview();
  assert.match(f.find("details").textContent, /変更対象: DAT・EMA・CAWELON/);
  assert.equal(f.find("apply").disabled, true);
  assert.equal(f.find("confirm").disabled, false);
  assert.equal(f.applied.length, 0);
});

test("explicit confirmation enables one application", () => {
  const f = fixture();
  f.preview();
  f.confirm();
  assert.equal(f.find("apply").disabled, false);
  f.click("apply");
  assert.equal(f.applied.length, 1);
  assert.deepEqual(f.fields().map(row => row.account), [A, B, C]);
  assert.equal(f.find("apply").disabled, true);
  assert.equal(f.find("confirm").checked, false);
  assert.match(f.find("status").textContent, /設定を反映しました/);
});

test("repeated apply cannot apply twice", () => {
  const f = fixture();
  f.preview();
  f.confirm();
  f.click("apply");
  f.click("apply");
  assert.equal(f.applied.length, 1);
});

test("unchecking confirmation disables apply again", () => {
  const f = fixture();
  f.preview();
  f.confirm();
  f.find("confirm").checked = false;
  f.find("confirm").dispatchEvent(new Event("change"));
  assert.equal(f.find("apply").disabled, true);
  f.click("apply");
  assert.equal(f.applied.length, 0);
});

test("changing JSON cancels preview and confirmation", () => {
  const f = fixture();
  f.preview();
  f.confirm();
  f.input(text + "\n");
  assert.equal(f.find("apply").disabled, true);
  assert.equal(f.find("confirm").checked, false);
  assert.equal(f.find("details").textContent, "");
});

test("editing destination settings invalidates the preview", () => {
  const f = fixture();
  f.preview();
  f.confirm();
  f.set(raw([C, "", ""]));
  f.panel.invalidate();
  assert.equal(f.find("apply").disabled, true);
  assert.match(f.find("readiness").textContent, /1 \/ 3/);
  assert.equal(f.applied.length, 0);
});

test("silent destination changes are rejected at apply time", () => {
  const f = fixture();
  f.preview();
  f.confirm();
  f.set(raw([C, "", ""]));
  f.click("apply");
  assert.equal(f.applied.length, 0);
  assert.equal(f.fields()[0].account, C);
  assert.match(f.find("status").textContent, /設定が変わりました/);
});

test("cancel keeps card values and draft JSON", () => {
  const f = fixture();
  f.preview();
  f.confirm();
  f.click("cancel");
  assert.equal(f.find("json").value, text);
  assert.equal(f.fields()[0].account, "");
  assert.equal(f.find("apply").disabled, true);
});

test("duplicate file plan explains the issue and keeps existing settings", () => {
  const f = fixture();
  f.set(raw([A, B, C]));
  f.input(JSON.stringify(setup([A, A, C])));
  f.click("preview");
  assert.match(f.find("status").textContent, /同じ公開アドレス/);
  assert.equal(f.applied.length, 0);
  assert.deepEqual(f.fields().map(row => row.account), [A, B, C]);
});

test("export reflects current cards, not unreviewed imported JSON", () => {
  const f = fixture();
  f.set(raw([A, "", ""]));
  f.input(text);
  f.click("export");
  assert.deepEqual(JSON.parse(f.find("json").value), setup([A, null, null]));
  assert.equal(f.downloads.length, 0);
  assert.match(f.find("status").textContent, /まだファイル保存はしていません/);
});

test("download saves current settings without applying a pending file", () => {
  const f = fixture();
  f.set(raw([A, "", ""]));
  f.preview();
  f.click("save");
  assert.equal(f.downloads.length, 1);
  assert.deepEqual(JSON.parse(f.downloads[0].text), setup([A, null, null]));
  assert.equal(f.applied.length, 0);
  assert.match(f.find("status").textContent, /保存完了を確認/);
});

test("invalid current settings cannot be exported or downloaded", () => {
  const f = fixture();
  f.set(raw([A, A, C]));
  f.click("save");
  f.click("export");
  assert.equal(f.downloads.length, 0);
  assert.match(f.find("status").textContent, /同じ公開アドレス/);
});

test("file selection loads only a draft until preview and confirmation", async () => {
  const f = fixture();
  f.choose(fileFor(text));
  await tick();
  assert.equal(f.find("json").value, text);
  assert.equal(f.find("apply").disabled, true);
  assert.equal(f.applied.length, 0);
  assert.match(f.find("status").textContent, /プレビューしてから/);
  f.click("preview");
  f.confirm();
  f.click("apply");
  assert.equal(f.applied.length, 1);
});

test("file loading locks review actions but permits cancellation", async () => {
  const gate = deferred();
  const f = fixture({ readBytes: () => gate.promise });
  f.preview();
  f.confirm();
  f.choose(fileFor(text));
  assert.equal(f.find("preview").disabled, true);
  assert.equal(f.find("apply").disabled, true);
  assert.equal(f.find("file").disabled, true);
  f.click("cancel");
  gate.resolve(new TextEncoder().encode(text));
  await tick();
  assert.equal(f.find("file").disabled, false);
  assert.equal(f.find("apply").disabled, true);
  assert.equal(f.applied.length, 0);
});

test("typing while a file is loading keeps the newer text", async () => {
  const gate = deferred();
  const f = fixture({ readBytes: () => gate.promise });
  f.choose(fileFor(text));
  f.input("newer typed content");
  gate.resolve(new TextEncoder().encode(text));
  await tick();
  assert.equal(f.find("json").value, "newer typed content");
});

test("field invalidation while reading prevents a late draft replacement", async () => {
  const gate = deferred();
  const f = fixture({ readBytes: () => gate.promise });
  f.input("keep this");
  f.choose(fileFor(text));
  f.panel.invalidate();
  gate.resolve(new TextEncoder().encode(text));
  await tick();
  assert.equal(f.find("json").value, "keep this");
});

test("malformed file leaves draft and cards intact", async () => {
  const f = fixture();
  f.input(text);
  f.choose(fileFor("broken json"));
  await tick();
  assert.equal(f.find("json").value, text);
  assert.equal(f.fields()[0].account, "");
  assert.equal(f.applied.length, 0);
  assert.match(f.find("status").textContent, /読み込めません/);
});

test("multiple selected files never partially import", async () => {
  const f = fixture();
  f.find("file").files = [fileFor(text), fileFor(text)];
  f.find("file").dispatchEvent(new Event("change"));
  await tick();
  assert.match(f.find("status").textContent, /1つずつ/);
  assert.equal(f.find("json").value, "");
});

test("cancelled chooser does not clear a pending review", () => {
  const f = fixture();
  f.preview();
  f.confirm();
  f.find("file").files = [];
  f.find("file").dispatchEvent(new Event("change"));
  assert.equal(f.find("apply").disabled, false);
});

test("refresh gives configuration status without changing settings", () => {
  const f = fixture();
  f.set(raw([A, B, C]));
  f.click("refresh");
  assert.match(f.find("readiness").textContent, /3 \/ 3/);
  assert.match(f.find("readiness").textContent, /接続未確認/);
  assert.equal(f.applied.length, 0);
});

test("an unchanged plan explains that existing connections are retained", () => {
  const f = fixture();
  f.set(raw([A, B, C]));
  f.preview();
  f.confirm();
  f.click("apply");
  assert.match(f.find("status").textContent, /設定の変更はありません/);
});

test("rendered diagnostic errors do not expose callback error payloads", () => {
  const f = fixture({ applyPlan() { throw Error("sensitive callback payload"); } });
  f.preview();
  f.confirm();
  f.click("apply");
  assert(!f.find("status").textContent.includes("sensitive"));
  assert.equal(f.find("apply").disabled, true);
  assert.equal(f.find("confirm").checked, false);
});

test("dispose removes panel and blocks retained event handlers", async () => {
  const f = fixture();
  f.preview();
  f.confirm();
  const apply = f.find("apply");
  const save = f.find("save");
  f.panel.dispose();
  apply.click();
  save.click();
  f.panel.invalidate();
  assert.equal(f.parent.children.length, 0);
  assert.equal(f.applied.length, 0);
  assert.equal(f.downloads.length, 0);
});

test("disposed panel ignores a late file completion", async () => {
  const gate = deferred();
  const f = fixture({ readBytes: () => gate.promise });
  f.choose(fileFor(text));
  const draft = f.find("json");
  f.panel.dispose();
  gate.resolve(new TextEncoder().encode(text));
  await tick();
  assert.equal(draft.value, "");
  assert.equal(f.parent.children.length, 0);
});

test("HTML-looking JSON is rejected and not rendered as markup", () => {
  const f = fixture();
  f.input('{"schema":"<img src=x onerror=alert(1)>"}');
  f.click("preview");
  assert.equal(f.find("details").textContent, "");
  assert.equal(f.applied.length, 0);
  assert(!f.find("status").textContent.includes("onerror"));
});
