import test from "node:test";
import assert from "node:assert/strict";
import { mountWorkspacePanel } from "../examples/workspace-panel.js";
import { mountHistoryPanel } from "../examples/history-panel.js";
import { createWorkspaceController } from "../src/workspace-controller.js";
import { workspaceDraftKey, workspaceFromDraft, encodeWorkspace } from "../src/workspace-format.js";
import { prepareWorkspaceFile, decodeWorkspaceFile } from "../src/workspace-file.js";
import { summarizeWorkspace } from "../src/workspace-overview.js";
import { Element } from "./helpers/panel-dom.js";
import { draft, clone, snapshot, OPTIONS, AGENTS, CONTRACTS, until, fileObject } from "./helpers/workspace-fixtures.js";
import { archive } from "./helpers/history-fixtures.js";

// Independent history panels represent the three live local stores. This tests
// the transaction adapter across modules, not just a single in-memory object.
function session(initial = draft({ populated: false, accounts: false })) {
  const document = { createElement: tag => new Element(tag) };
  const parent = new Element("main");
  const configs = clone(initial);
  const historyPanels = AGENTS.map((agent, index) => {
    const panel = mountHistoryPanel({ document, parent, agent, getSnapshot: () => null });
    panel.replaceArchive(initial[index].history);
    return panel;
  });
  let failIndex = -1;
  let writes = 0;
  const downloads = [];
  const readDraft = () => configs.map((row, index) => ({ ...row, history: historyPanels[index].exportArchive() }));
  const writeDraft = next => {
    writes++;
    for (let index = 0; index < next.length; index++) {
      configs[index] = { ...next[index] };
      historyPanels[index].replaceArchive(next[index].history);
      if (index === failIndex) {
        failIndex = -1;
        throw Error("Synthetic interrupted card write");
      }
    }
  };
  const workspace = mountWorkspacePanel({ document, parent, readDraft, writeDraft,
    download: ({ prepared }) => downloads.push(prepared) });
  const field = name => parent.find("workspace-" + name);
  const check = (name, value = true) => {
    field(name).checked = value;
    field(name).dispatchEvent(new Event("change"));
  };
  const input = value => {
    field("json").value = value;
    field("json").dispatchEvent(new Event("input"));
  };
  const click = name => field(name).click();
  return {
    readDraft, writeDraft, historyPanels, field, check, input, click, downloads,
    failOnce: index => { failIndex = index; },
    writes: () => writes,
    restore: value => {
      input(value);
      click("preview");
      check("confirmed");
      click("apply");
    },
    edit: action => { action(configs); workspace.invalidate(); },
    choose: value => {
      field("file").files = [fileObject(value)];
      field("file").dispatchEvent(new Event("change"));
    },
    dispose: () => { workspace.dispose(); historyPanels.forEach(panel => panel.dispose()); },
  };
}

test("full workspace download reload file-select preview restore round trip", async () => {
  const source = session(draft());
  const expected = workspaceDraftKey(source.readDraft());
  source.click("save");
  await until(() => source.downloads.length === 1);
  const saved = source.downloads[0];
  assert.equal(saved.filename, "ThreeCore-workspace-backup.json");
  source.dispose();

  const target = session();
  assert.equal(summarizeWorkspace(target.readDraft()).totalObservations, 0);
  target.choose(saved.text);
  await until(() => target.field("status").textContent.includes("破損確認が一致"));
  assert.equal(target.writes(), 0, "reading is not restoring");
  target.click("preview");
  assert.equal(target.writes(), 0, "preview is not restoring");
  target.check("confirmed");
  target.click("apply");
  assert.equal(target.writes(), 1);
  assert.equal(workspaceDraftKey(target.readDraft()), expected);
  assert.equal(summarizeWorkspace(target.readDraft()).configured, 3);
  assert.equal(summarizeWorkspace(target.readDraft()).totalObservations, 3);
  target.dispose();
});

test("all cards keep independent archives after one workspace restore", () => {
  const target = session();
  target.restore(encodeWorkspace(workspaceFromDraft(draft())));
  for (let index = 0; index < 3; index++) {
    const summary = summarizeWorkspace(target.readDraft()).cards[index];
    assert.equal(summary.agent, AGENTS[index]);
    assert.equal(summary.historyCount, 1);
    target.historyPanels[index].replaceArchive(archive([]));
    for (let other = index + 1; other < 3; other++) {
      assert.equal(summarizeWorkspace(target.readDraft()).cards[other].historyCount, 1);
    }
  }
  target.dispose();
});

for (const failedCard of [0, 1, 2]) {
  test("partial write after card " + AGENTS[failedCard] + " rolls all local stores back", () => {
    const target = session(draft({ block: "10" }));
    const before = workspaceDraftKey(target.readDraft());
    target.failOnce(failedCard);
    target.restore(encodeWorkspace(workspaceFromDraft(draft({ block: "20" }))));
    assert.equal(target.writes(), 2, "one attempt and one rollback");
    assert.equal(workspaceDraftKey(target.readDraft()), before);
    assert.match(target.field("status").textContent, /操作前へ戻しました/);
    assert.equal(target.field("undo-preview").disabled, true);
    target.dispose();
  });
}

test("undo across history panels returns every archive and input to the original draft", () => {
  const target = session(draft({ block: "10" }));
  const before = workspaceDraftKey(target.readDraft());
  target.restore(encodeWorkspace(workspaceFromDraft(draft({ block: "20" }))));
  target.click("undo-preview");
  assert.match(target.field("undo-detail").textContent, /取り除く過去記録: 1件/);
  target.check("undo-confirmed");
  target.click("undo-apply");
  assert.equal(workspaceDraftKey(target.readDraft()), before);
  assert.equal(target.field("undo-preview").disabled, true);
  target.dispose();
});

test("editing any card after restore preserves that edit and disables direct undo", () => {
  const target = session();
  target.restore(encodeWorkspace(workspaceFromDraft(draft())));
  target.edit(cards => { cards[2].tokens = CONTRACTS[0]; });
  assert.equal(target.field("undo-preview").disabled, true);
  assert.equal(target.readDraft()[2].tokens, CONTRACTS[0]);
  target.click("recovery");
  assert.equal(target.downloads.length, 1);
  assert.equal(JSON.parse(target.downloads[0].text).schema, "threecore-local-recovery-draft-v1");
  target.dispose();
});

test("separately added observation invalidates a previously previewed workspace", () => {
  const target = session();
  target.input(encodeWorkspace(workspaceFromDraft(draft())));
  target.click("preview");
  target.historyPanels[1].replaceArchive(archive([snapshot(1, "99")]));
  const changed = workspaceDraftKey(target.readDraft());
  target.check("confirmed");
  target.click("apply");
  assert.equal(target.writes(), 0);
  assert.equal(workspaceDraftKey(target.readDraft()), changed);
  assert.match(target.field("status").textContent, /もう一度プレビュー/);
  target.dispose();
});

test("a corrupted file cannot replace an earlier successfully restored archive", async () => {
  const target = session(draft());
  const before = workspaceDraftKey(target.readDraft());
  const saved = await prepareWorkspaceFile(workspaceFromDraft(draft({ block: "99" })));
  const corrupt = JSON.parse(saved.text);
  corrupt.digest = "0".repeat(64);
  target.choose(JSON.stringify(corrupt));
  await until(() => target.field("status").textContent.includes("破損確認が一致しません"));
  assert.equal(workspaceDraftKey(target.readDraft()), before);
  assert.equal(target.writes(), 0);
  assert.equal(target.field("apply").disabled, true);
  target.dispose();
});

test("restoring histories only leaves intentionally unfinished input untouched", () => {
  const initial = draft({ populated: false });
  initial[0].account = "unfinished";
  initial[1].tokenAddress = "next token";
  initial[2].tokens = "draft list";
  const target = session(initial);
  target.check("settings", false);
  target.restore(encodeWorkspace(workspaceFromDraft(draft())));
  const result = target.readDraft();
  assert.equal(result[0].account, "unfinished");
  assert.equal(result[1].tokenAddress, "next token");
  assert.equal(result[2].tokens, "draft list");
  assert.equal(summarizeWorkspace(result).totalObservations, 3);
  target.dispose();
});

test("repeated save restore cycles do not multiply duplicate observations", async () => {
  let current = draft();
  for (let cycle = 0; cycle < 3; cycle++) {
    const saved = await prepareWorkspaceFile(workspaceFromDraft(current));
    const read = await decodeWorkspaceFile(new TextEncoder().encode(saved.text));
    const controller = createWorkspaceController({ readDraft: () => current,
      writeDraft: value => { current = clone(value); } });
    const review = controller.preview(read.text, OPTIONS);
    assert.equal(review.changed, false);
    controller.apply(review.id, read.text, OPTIONS);
    assert.equal(summarizeWorkspace(current).totalObservations, 3);
    controller.dispose();
  }
});

test("replacement requires the removal acknowledgement at the integrated panel", () => {
  const target = session(draft());
  const before = workspaceDraftKey(target.readDraft());
  target.check("replace");
  target.restore(encodeWorkspace(workspaceFromDraft(draft({ populated: false }))));
  assert.equal(target.writes(), 0);
  assert.equal(workspaceDraftKey(target.readDraft()), before);
  assert.equal(target.field("apply").disabled, true);
  target.check("removal");
  target.click("apply");
  assert.equal(summarizeWorkspace(target.readDraft()).totalObservations, 0);
  target.dispose();
});

test("workspace files carry public observations but exclude session approval material", async () => {
  const source = session(draft());
  source.click("save");
  await until(() => source.downloads.length === 1);
  const file = JSON.parse(source.downloads[0].text);
  for (const entry of file.workspace.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ["account", "agent", "chainId", "history", "tokenAddress", "tokens"].sort());
  }
  for (const field of ["privateKey", "mnemonic", "spender", "allowance", "provider", "connected"]) {
    assert.ok(!source.downloads[0].text.includes('"' + field + '"'));
  }
  source.dispose();
});

test("closed workspace cannot accept a late file read or trigger a download", async () => {
  const source = session(draft());
  const saved = await prepareWorkspaceFile(workspaceFromDraft(draft()));
  source.choose(saved.text);
  source.dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(source.writes(), 0);
  assert.equal(source.downloads.length, 0);
});
