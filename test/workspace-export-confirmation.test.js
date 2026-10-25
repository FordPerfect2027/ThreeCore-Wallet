import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { mountWorkspacePanel } from "../examples/workspace-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { draft, text, clone, tick, until } from "./helpers/workspace-fixtures.js";

function fixture() {
  const parent = new Element("main"), document = { createElement: tag => new Element(tag) };
  let current = draft({ block: "10" }), receive = () => {}, read = () => current, writes = 0;
  const delivered = [];
  const panel = mountWorkspacePanel({ document, parent, readDraft: () => read(),
    writeDraft(value) { writes++; current = clone(value); }, subtle: webcrypto.subtle,
    download(value) { delivered.push(value.prepared); return receive(value); } });
  const node = name => parent.find("workspace-" + name);
  function restore() {
    node("json").value = text({ block: "20" }); node("preview").click();
    node("confirmed").checked = true; node("confirmed").dispatchEvent(new Event("change")); node("apply").click();
    assert.match(node("status").textContent, /一括復元しました/);
  }
  async function click(action) {
    node(action).click();
    if (action === "save") await until(() => parent.find("workspace-panel").getAttribute("aria-busy") === "false");
    await tick();
  }
  return { panel, parent, node, restore, click, delivered, value: () => clone(current), writes: () => writes,
    read: fn => { read = fn; }, receive: fn => { receive = fn; } };
}

for (const action of ["save", "save-summary", "recovery"]) {
  for (const fault of ["false", "promise", "changing-then", "async-then"]) {
    test(`workspace ${action}: ${fault} delivery preserves originals and permits explicit retry`, async () => {
      const f = fixture(), original = f.value();
      try {
        if (action === "recovery") f.restore();
        const before = f.value(), writes = f.writes(); let reads = 0, calls = 0;
        f.receive(() => {
          if (fault === "false") return false;
          if (fault === "promise") return Promise.reject(Error("synthetic private download"));
          return { get then() {
            reads++;
            if (fault === "async-then") return async () => { calls++; throw Error("synthetic private then"); };
            return resolve => { calls++; resolve(true); };
          } };
        });
        await f.click(action);
        assert.match(f.node("status").textContent, /開始できません/);
        assert(!f.node("backup-status").textContent.includes("開始済み"));
        assert.deepEqual(f.value(), before); assert.equal(f.writes(), writes);
        if (fault.includes("then")) { assert.equal(reads, 1); assert.equal(calls, 1); }
        const failedText = f.delivered[0].text;
        if (action === "recovery") assert.deepEqual(JSON.parse(failedText).entries, original);
        f.receive(() => true); await f.click(action);
        assert.equal(f.delivered.length, 2); assert.equal(f.delivered[1].text, failedText);
        assert(!f.node("status").textContent.includes("開始できません"));
        assert.deepEqual(f.value(), before); assert.equal(f.writes(), writes);
      } finally { f.panel.dispose(); }
    });
  }
  for (const stop of ["cancel", "invalidate", "dispose"]) {
    test(`workspace ${action}: ${stop} during delivery retains its stopped state`, async () => {
      const f = fixture();
      try {
        if (action === "recovery") f.restore();
        const status = f.node("status"); let delivered = false;
        f.receive(() => {
          delivered = true;
          if (stop === "cancel") f.node("cancel").click(); else f.panel[stop]();
          return Promise.reject(Error("synthetic stopped receipt"));
        });
        f.node(action).click(); await until(() => delivered); await tick();
        assert(!status.textContent.includes("ダウンロードを開始しました"));
        assert(!status.textContent.includes("操作前の控えを保存します"));
        if (stop === "dispose") assert.equal(f.parent.children.length, 0);
      } finally { f.panel.dispose(); }
    });
  }
}
for (const action of ["inspect", "save-summary", "save"]) {
  test(`workspace ${action}: rejected async source is consumed without offering a file`, async () => {
    const f = fixture();
    try {
      f.read(() => Promise.reject(Error("synthetic private source")));
      await f.click(action);
      assert.equal(f.delivered.length, 0); assert.equal(f.writes(), 0);
      assert(!f.node("status").textContent.includes("private"));
    } finally { f.panel.dispose(); }
  });
}
