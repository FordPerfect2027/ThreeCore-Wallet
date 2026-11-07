import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { mountWorkspacePanel } from "../examples/workspace-panel.js";
import { decodeWorkspaceFile } from "../src/workspace-file.js";
import { Element } from "./helpers/panel-dom.js";
import { archive } from "./helpers/history-fixtures.js";
import { draft, snapshot, bundle, text, fileObject, clone, tick, until } from "./helpers/workspace-fixtures.js";

function fixture() {
  const parent = new Element("main");
  const document = { createElement: tag => new Element(tag) };
  let current = draft().map((row, index) => ({ ...row,
    history: archive(["10", "20", "30"].map(block => snapshot(index, block))) }));
  const writes = [], downloads = [];
  const panel = mountWorkspacePanel({ document, parent, subtle: webcrypto.subtle,
    readDraft: () => current,
    writeDraft(value) { writes.push(clone(value)); current = clone(value); },
    download({ prepared }) { downloads.push(prepared); return true; } });
  const field = name => parent.find("workspace-" + name);
  function input(value) {
    field("json").value = value;
    field("json").dispatchEvent(new Event("input"));
  }
  function check(name, checked = true) {
    field(name).checked = checked;
    field(name).dispatchEvent(new Event("change"));
  }
  return { panel, parent, field, input, check, writes, downloads,
    current: () => current, edit: action => action(current) };
}

function duplicateWorkspace() {
  const value = bundle({ block: "40" });
  for (const row of value.entries) row.account = value.entries[0].account;
  return value;
}

function legacyDuplicateFile(workspace) {
  // A valid checksum does not make duplicate configuration valid. Build the
  // legacy envelope without asking the current exporter to accept that setup.
  const digest = createHash("sha256").update(JSON.stringify(workspace, null, 2)).digest("hex");
  return JSON.stringify({ schema: "threecore-workspace-file-v1", algorithm: "SHA-256", digest, workspace }, null, 2);
}

function assertPreserved(f, before) {
  assert.equal(before.reduce((count, row) => count + JSON.parse(row.history).reports.length, 0), 9);
  assert.deepEqual(f.current(), before, "All settings and nine historical observations must survive");
  assert.equal(f.writes.length, 0);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("confirmed").checked, false);
  f.field("apply").click();
  assert.equal(f.writes.length, 0, "An old confirmation must not authorize the rejected backup");
}

function assertImportGuidance(f) {
  const status = f.field("status").textContent;
  assert.match(status, /読み込むバックアップ内/);
  assert.match(status, /履歴だけを選んでも一括復元できません/);
  assert.match(status, /画面の設定を変えても.*重複は解消しません/);
  assert.match(status, /元のファイルやJSONを保管/);
  assert.match(status, /現在の設定と保存履歴は変更していません/);
  assert.doesNotMatch(status, /別々のアドレスを設定してから保存/);
}

for (const settings of [true, false]) {
  const mode = settings ? "settings and histories" : "histories only";
  test(`duplicate backup file guidance preserves nine histories with ${mode}`, async () => {
    const f = fixture();
    try {
      const before = clone(f.current());
      f.check("settings", settings);
      f.input(text({ block: "40" }));
      f.field("preview").click();
      f.check("confirmed");
      assert.equal(f.field("apply").disabled, false);
      const oldJson = f.field("json").value;
      const fileText = legacyDuplicateFile(duplicateWorkspace());
      await assert.rejects(decodeWorkspaceFile(new TextEncoder().encode(fileText), { subtle: webcrypto.subtle }),
        { code: "WORKSPACE_DUPLICATE" });
      f.field("file").files = [fileObject(fileText)];
      f.field("file").dispatchEvent(new Event("change"));
      await until(() => !f.field("file").disabled);
      await tick();
      assertImportGuidance(f);
      assert.equal(f.field("json").value, oldJson, "Failed file reading must not replace the prior JSON draft");
      assertPreserved(f, before);
      assert.equal(f.parent.find("workspace-panel").getAttribute("aria-busy"), "false");
    } finally { f.panel.dispose(); }
  });

  test(`duplicate pasted backup guidance preserves nine histories with ${mode}`, () => {
    const f = fixture();
    try {
      const before = clone(f.current());
      f.check("settings", settings);
      f.input(JSON.stringify(duplicateWorkspace()));
      f.field("preview").click();
      assertImportGuidance(f);
      assertPreserved(f, before);
    } finally { f.panel.dispose(); }
  });
}

test("duplicate current settings give save guidance and retain nine histories for correction", async () => {
  const f = fixture();
  try {
    const originalAccount = f.current()[1].account;
    f.edit(rows => { rows[1].account = rows[0].account; });
    const before = clone(f.current());
    f.field("save").click();
    await until(() => !f.field("save").disabled);
    await tick();
    const status = f.field("status").textContent;
    assert.match(status, /現在のカード設定/);
    assert.match(status, /別々のアドレスを設定してから保存/);
    assert.match(status, /保存履歴は変更していません/);
    assert.doesNotMatch(status, /読み込むバックアップ内|履歴だけを選んでも/);
    assertPreserved(f, before);
    f.edit(rows => { rows[1].account = originalAccount; });
    const corrected = clone(f.current());
    f.field("save").click();
    await until(() => !f.field("save").disabled);
    assert.equal(f.downloads.length, 1, "Explicit save succeeds after correcting only the current settings");
    const saved = await decodeWorkspaceFile(new TextEncoder().encode(f.downloads[0].text), { subtle: webcrypto.subtle });
    assert.equal(saved.workspace.entries.reduce((count, row) => count + row.history.reports.length, 0), 9);
    assert.deepEqual(f.current(), corrected);
    assert.equal(f.writes.length, 0);
  } finally { f.panel.dispose(); }
});
