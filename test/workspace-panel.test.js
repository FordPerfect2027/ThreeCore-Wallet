import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { mountWorkspacePanel } from "../examples/workspace-panel.js";
import { prepareWorkspaceFile } from "../src/workspace-file.js";
import { Element } from "./helpers/panel-dom.js";
import { draft, text, bundle, fileObject, clone, gate, tick, until, CONTRACTS } from "./helpers/workspace-fixtures.js";

function fixture(options = {}) {
  const parent = new Element("main");
  const document = { createElement: tag => new Element(tag) };
  let current = draft({ block: "10" });
  const writes = [];
  const downloads = [];
  const panel = mountWorkspacePanel({ document, parent,
    readDraft: () => current,
    writeDraft: value => { writes.push(clone(value)); current = clone(value); },
    download: ({ prepared }) => downloads.push(prepared), ...options });
  const field = name => parent.find("workspace-" + name);
  const click = name => field(name).click();
  const input = value => {
    field("json").value = value;
    field("json").dispatchEvent(new Event("input"));
  };
  const check = (name, checked = true) => {
    field(name).checked = checked;
    field(name).dispatchEvent(new Event("change"));
  };
  const choose = files => {
    field("file").files = files;
    field("file").dispatchEvent(new Event("change"));
  };
  const review = (value = text({ block: "20" })) => { input(value); click("preview"); };
  const apply = () => { check("confirmed"); click("apply"); };
  return { panel, parent, field, click, input, check, choose, review, apply, writes, downloads,
    current: () => current, edit: action => action(current) };
}

test("workspace panel starts with no read write download or automatic connection", () => {
  const f = fixture();
  assert.equal(f.writes.length, 0);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.field("overview").textContent, "");
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("undo-apply").disabled, true);
  assert.equal(f.field("undo-preview").disabled, true);
  assert.equal(f.field("settings").checked, true);
  assert.equal(f.field("histories").checked, true);
  assert.equal(f.field("replace").checked, false);
});

test("workspace panel overview reads local observations and labels them honestly", () => {
  const f = fixture();
  f.click("inspect");
  assert.match(f.field("overview").textContent, /保存履歴: 合計 3件/);
  assert.match(f.field("overview").textContent, /過去の観測値/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.downloads.length, 0);
});

test("workspace panel overview text download contains readable units and caveats", () => {
  const f = fixture();
  f.click("save-summary");
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].filename, "ThreeCore-workspace-overview.txt");
  assert.match(f.downloads[0].text, /0.000000000000000016/);
  assert.match(f.downloads[0].text, /現在の残高・接続・所有・安全性を証明しません/);
});

test("workspace panel preview alone does not change any history", () => {
  const f = fixture();
  f.review();
  assert.match(f.field("detail").textContent, /保存履歴: 1 → 2件/);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("confirmed").disabled, false);
  assert.equal(f.writes.length, 0);
});

test("workspace panel confirmed merge adds records to all three cards once", () => {
  const f = fixture();
  f.review();
  f.apply();
  assert.equal(f.writes.length, 1);
  assert.ok(f.current().every(row => JSON.parse(row.history).reports.length === 2));
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("confirmed").checked, false);
  f.click("apply");
  assert.equal(f.writes.length, 1);
});

test("workspace panel replacing existing records requires a separate deletion acknowledgement", () => {
  const f = fixture();
  f.check("replace");
  f.review(text({ populated: false }));
  f.check("confirmed");
  assert.equal(f.field("removal").disabled, false);
  assert.equal(f.field("apply").disabled, true);
  f.click("apply");
  assert.equal(f.writes.length, 0);
  f.check("removal");
  f.click("apply");
  assert.equal(f.writes.length, 1);
  assert.ok(f.current().every(row => JSON.parse(row.history).reports.length === 0));
});

test("workspace panel replacement without any record removal needs no deletion checkbox", () => {
  const f = fixture();
  f.check("replace");
  f.review(text({ block: "10" }));
  assert.equal(f.field("removal").disabled, true);
  f.apply();
  assert.match(f.field("status").textContent, /変更はありません/);
  assert.equal(f.writes.length, 0);
});

for (const option of ["settings", "histories", "replace"]) {
  test("workspace panel changing " + option + " cancels old confirmation", () => {
    const f = fixture();
    f.review();
    f.check("confirmed");
    f.check(option, !f.field(option).checked);
    assert.equal(f.field("apply").disabled, true);
    assert.equal(f.field("confirmed").checked, false);
    assert.equal(f.field("detail").textContent, "");
    assert.equal(f.writes.length, 0);
  });
}

test("workspace panel deselecting both sections cannot authorize an import", () => {
  const f = fixture();
  f.check("settings", false);
  f.check("histories", false);
  f.review();
  assert.equal(f.field("apply").disabled, true);
  assert.match(f.field("status").textContent, /どちらか/);
});

test("workspace panel editing JSON removes both restore and delete acknowledgements", () => {
  const f = fixture();
  f.check("replace");
  f.review();
  f.check("confirmed");
  f.check("removal");
  f.input(text({ block: "30" }));
  assert.equal(f.field("confirmed").checked, false);
  assert.equal(f.field("removal").checked, false);
  assert.equal(f.field("apply").disabled, true);
});

test("workspace panel stale source data cannot be overwritten even without an input event", () => {
  const f = fixture();
  f.review();
  f.edit(value => { value[1].tokens = CONTRACTS.join("\n"); });
  f.apply();
  assert.equal(f.writes.length, 0);
  assert.match(f.field("status").textContent, /プレビュー後/);
});

test("workspace panel invalidation cancels review and clears old overview", () => {
  const f = fixture();
  f.click("inspect");
  f.review();
  f.panel.invalidate();
  assert.equal(f.field("overview").textContent, "");
  assert.equal(f.field("detail").textContent, "");
  assert.equal(f.field("apply").disabled, true);
});

test("workspace panel invalid JSON keeps current data and presents a safe error", () => {
  const f = fixture();
  f.review('{"privateKey":"pretend-secret"');
  assert.equal(f.writes.length, 0);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("status").textContent.includes("pretend-secret"), false);
});

test("workspace panel full restore can be explicitly undone", () => {
  const f = fixture();
  const before = clone(f.current());
  f.review();
  f.apply();
  assert.equal(f.field("undo-preview").disabled, false);
  f.click("undo-preview");
  assert.match(f.field("undo-detail").textContent, /履歴: 2 → 1件/);
  assert.equal(f.field("undo-apply").disabled, true);
  f.check("undo-confirmed");
  f.click("undo-apply");
  assert.deepEqual(f.current(), before);
  assert.equal(f.field("undo-preview").disabled, true);
});

test("workspace panel undo preview can be cancelled without altering current data", () => {
  const f = fixture();
  f.review();
  f.apply();
  f.click("undo-preview");
  f.check("undo-confirmed");
  f.click("cancel");
  assert.equal(f.field("undo-apply").disabled, true);
  assert.equal(f.current()[0].history.includes('"blockNumber": "20"'), true);
});

test("workspace panel history-only restore preserves configuration", () => {
  const f = fixture();
  f.check("settings", false);
  f.review(text({ block: "20", accounts: false }));
  f.apply();
  assert.ok(f.current().every(row => row.account !== ""));
  assert.ok(f.current().every(row => JSON.parse(row.history).reports.length === 2));
});

test("workspace panel offers old data as recovery even after further edits", () => {
  const f = fixture();
  const before = clone(f.current());
  f.review();
  f.apply();
  f.edit(value => { value[0].tokens = CONTRACTS.join("\n"); });
  f.panel.invalidate();
  assert.equal(f.field("undo-preview").disabled, true);
  assert.equal(f.field("recovery").disabled, false);
  f.click("recovery");
  assert.deepEqual(JSON.parse(f.downloads[0].text).entries, before);
  assert.match(f.field("status").textContent, /異なる形式/);
});

test("workspace panel save performs checksum generation before offering a download", async () => {
  const f = fixture();
  f.click("save");
  assert.equal(f.field("save").disabled, true);
  await until(() => !f.field("save").disabled);
  assert.equal(f.downloads.length, 1);
  assert.match(JSON.parse(f.downloads[0].text).digest, /^[0-9a-f]{64}$/);
  assert.match(f.field("backup-status").textContent, /PCへの保存完了を確認/);
});

test("workspace panel cannot claim a completed save if browser download throws", async () => {
  const f = fixture({ download: () => { throw Error("Download blocked"); } });
  f.click("save");
  await until(() => !f.field("save").disabled);
  assert.match(f.field("backup-status").textContent, /まだ開始していません/);
  assert.match(f.field("status").textContent, /完了していません/);
});

test("workspace panel save refuses incomplete public address input", async () => {
  const f = fixture();
  f.edit(value => { value[1].account = "unfinished"; });
  f.click("save");
  await tick();
  assert.equal(f.downloads.length, 0);
  assert.match(f.field("status").textContent, /アドレスの形式/);
});

test("workspace panel edits during hashing prevent downloading stale data", async () => {
  const pending = gate();
  const f = fixture({ subtle: { digest: (...args) => pending.promise.then(() => webcrypto.subtle.digest(...args)) } });
  f.click("save");
  f.edit(value => { value[0].tokens = CONTRACTS.join("\n"); });
  pending.resolve();
  await until(() => !f.field("save").disabled);
  assert.equal(f.downloads.length, 0);
  assert.match(f.field("status").textContent, /保存準備中に内容が変わりました/);
});

test("workspace panel cancel suppresses a pending checksum download", async () => {
  const pending = gate();
  const f = fixture({ subtle: { digest: (...args) => pending.promise.then(() => webcrypto.subtle.digest(...args)) } });
  f.click("save");
  f.click("cancel");
  pending.resolve();
  await tick();
  assert.equal(f.downloads.length, 0);
  assert.match(f.field("status").textContent, /取り消しました/);
});

test("workspace panel reads a file into JSON without applying it", async () => {
  const file = await prepareWorkspaceFile(bundle({ block: "20" }));
  const f = fixture();
  f.choose([fileObject(file.text)]);
  await until(() => f.field("json").value.length > 0);
  assert.match(f.field("status").textContent, /破損確認が一致/);
  assert.match(f.field("status").textContent, /本人・所有・安全性の確認ではありません/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.field("apply").disabled, true);
});

test("workspace panel selected file replaces old preview authorization", async () => {
  const file = await prepareWorkspaceFile(bundle());
  const f = fixture();
  f.review();
  f.check("confirmed");
  f.choose([fileObject(file.text)]);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("confirmed").checked, false);
  await until(() => !f.field("file").disabled);
  assert.equal(f.writes.length, 0);
});

test("workspace panel malformed checksum never replaces current settings or histories", async () => {
  const saved = await prepareWorkspaceFile(bundle());
  const bad = JSON.parse(saved.text);
  bad.digest = "0".repeat(64);
  const f = fixture();
  f.choose([fileObject(JSON.stringify(bad))]);
  await until(() => !f.field("file").disabled);
  assert.match(f.field("status").textContent, /破損確認が一致しません/);
  assert.equal(f.writes.length, 0);
});

test("workspace panel cancellation prevents a selected file from overwriting new JSON", async () => {
  const file = await prepareWorkspaceFile(bundle());
  const pending = gate();
  const f = fixture({ readBytes: () => pending.promise });
  f.choose([fileObject(file.text)]);
  f.input("new local draft");
  pending.resolve(new TextEncoder().encode(file.text));
  await tick();
  assert.equal(f.field("json").value, "new local draft");
  assert.equal(f.writes.length, 0);
});

test("workspace panel permits only one file and resets selection for repeat imports", async () => {
  const file = await prepareWorkspaceFile(bundle());
  const f = fixture();
  f.choose([fileObject(file.text), fileObject(file.text)]);
  assert.match(f.field("status").textContent, /1ファイルずつ/);
  assert.equal(f.field("file").value, "");
  assert.equal(f.field("json").value, "");
});

test("workspace panel backup status becomes stale after a history edit", async () => {
  const f = fixture();
  f.click("save");
  await until(() => !f.field("save").disabled);
  f.edit(value => { value[0].history = draft({ block: "99" })[0].history; });
  f.panel.invalidate();
  assert.match(f.field("backup-status").textContent, /内容が変わった/);
});

test("workspace panel disposal stops late downloads and retained event handlers", async () => {
  const pending = gate();
  const f = fixture({ subtle: { digest: (...args) => pending.promise.then(() => webcrypto.subtle.digest(...args)) } });
  const save = f.field("save");
  const inspect = f.field("inspect");
  f.click("save");
  f.panel.dispose();
  pending.resolve();
  await tick();
  save.click();
  inspect.click();
  assert.equal(f.downloads.length, 0);
  assert.equal(f.parent.children.length, 0);
});
