import test from "node:test";
import assert from "node:assert/strict";
import { mountWorkspacePanel } from "../examples/workspace-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { draft, text, clone } from "./helpers/workspace-fixtures.js";

function fixture() {
  const parent = new Element("main"), downloads = [];
  let current = draft({ block: "10" }), writes = 0, prepare = () => {}, writer = value => { current = clone(value); };
  const panel = mountWorkspacePanel({ document: { createElement: tag => new Element(tag) }, parent,
    readDraft: () => current, prepareWrite: () => prepare(),
    writeDraft(value) { writes++; return writer(value); }, download: ({ prepared }) => downloads.push(prepared) });
  const q = name => parent.find("workspace-" + name);
  const click = name => q(name).click();
  const check = name => { q(name).checked = true; q(name).dispatchEvent(new Event("change")); };
  const review = () => { panel.stageText(text({ block: "20" })); click("preview"); check("confirmed"); };
  return { panel, q, click, check, review, downloads, snapshot: () => clone(current), writes: () => writes,
    prepare: callback => { prepare = callback; }, writer: callback => { writer = callback; },
    set: value => { current = clone(value); } };
}

for (const mode of ["restore", "undo"]) test(`workspace mutation: cancelled ${mode} requests a fresh review and preserves data`, () => {
  const f = fixture();
  try {
    f.review();
    if (mode === "undo") { f.click("apply"); f.click("undo-preview"); f.check("undo-confirmed"); }
    const before = f.snapshot(), writes = f.writes();
    f.prepare(() => f.click("cancel"));
    f.click(mode === "undo" ? "undo-apply" : "apply");
    assert.deepEqual(f.snapshot(), before); assert.equal(f.writes(), writes);
    assert.match(f.q("status").textContent, /現在の内容をプレビュー/);
    assert.equal(f.q("apply").disabled, true); assert.equal(f.q("undo-apply").disabled, true);
    if (mode === "undo") assert.equal(f.q("undo-preview").disabled, false);
  } finally { f.panel.dispose(); }
});

test("workspace mutation: cancellation during writing reports the completed rollback", () => {
  const f = fixture();
  try {
    const before = f.snapshot(); let intermediate;
    f.writer(value => { f.set(value); if (f.writes() === 1) { f.click("cancel"); intermediate = f.q("status").textContent; } });
    f.review(); f.click("apply");
    assert.deepEqual(f.snapshot(), before); assert.equal(f.writes(), 2);
    assert.doesNotMatch(intermediate, /変更していません/);
    assert.match(f.q("status").textContent, /操作前へ戻しました/);
    assert.equal(f.q("preview").disabled, false);
  } finally { f.panel.dispose(); }
});

for (const replacement of [false, true]) test(`workspace mutation: failed rollback exposes recovery even after replacement=${replacement}`, () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    f.writer(value => {
      if (f.writes() > 1) throw Error("Synthetic unavailable destination");
      f.set(value); f.click("cancel");
      if (replacement) f.panel.stageText(text({ block: "30" }));
    });
    f.review(); f.click("apply");
    assert.match(f.q("status").textContent, /操作前の控え/);
    assert.equal(f.q("preview").disabled, true); assert.equal(f.q("apply").disabled, true);
    assert.equal(f.q("recovery").disabled, false);
    f.click("recovery");
    assert.equal(f.downloads.length, 1); assert.deepEqual(JSON.parse(f.downloads[0].text).entries, before);
    assert.equal(f.writes(), 2);
  } finally { f.panel.dispose(); }
});

for (const next of ["stage", "input", "dispose"]) test(`workspace mutation: cancellation does not overwrite subsequent ${next}`, () => {
  const f = fixture(); let status, expected;
  try {
    f.review();
    f.prepare(() => {
      f.click("cancel"); status = f.q("status");
      if (next === "stage") f.panel.stageText(text({ block: "30" }));
      else if (next === "input") { f.q("json").value = "new unfinished input"; f.q("json").dispatchEvent(new Event("input")); status.textContent = "new input"; }
      else f.panel.dispose();
      expected = status.textContent;
    });
    f.click("apply");
    assert.equal(status.textContent, expected); assert.equal(f.writes(), 0);
    if (next === "stage") assert.equal(f.q("json").value, text({ block: "30" }));
  } finally { f.panel.dispose(); }
});
