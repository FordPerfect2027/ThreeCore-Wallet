import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { mountWorkspacePanel } from "../examples/workspace-panel.js";
import { prepareWorkspaceFile } from "../src/workspace-file.js";
import { Element } from "./helpers/panel-dom.js";
import { draft, bundle, text, fileObject, gate, tick, until } from "./helpers/workspace-fixtures.js";
import { lifecyclePanel } from "./helpers/secure-lifecycle-panel.js";

function fixture() {
  const parent = new Element("main");
  const document = { createElement: tag => new Element(tag) };
  let current = draft({ block: "10" }), onRead, onDownload;
  const downloads = [], waits = [], writes = [];
  const panel = mountWorkspacePanel({ document, parent,
    readDraft() { const callback = onRead; onRead = null; callback?.(); return current; },
    writeDraft(value) { writes.push(value); current = value; },
    subtle: { digest(...args) {
      const pending = gate(); waits.push(pending);
      pending.complete = pending.promise.then(() => webcrypto.subtle.digest(...args));
      return pending.complete;
    } },
    download({ prepared }) {
      downloads.push(prepared);
      const callback = onDownload; onDownload = null; callback?.();
    },
  });
  const root = parent.children[0];
  const field = name => root.find("workspace-" + name);
  const click = name => field(name).click();
  const arm = action => { onRead = action; };
  const stop = mode => mode === "cancel" ? click("cancel") : panel[mode]();
  const review = () => {
    field("json").value = text({ block: "20" });
    field("json").dispatchEvent(new Event("input"));
    click("preview");
    field("confirmed").checked = true;
    field("confirmed").dispatchEvent(new Event("change"));
    click("apply");
  };
  async function finish(index = 0) {
    waits[index].resolve();
    // Drain both native WebCrypto and the panel's final render, not just one tick.
    await waits[index].complete;
    await tick();
    await tick();
  }
  return { panel, parent, field, click, arm, stop, review, downloads, waits, writes, finish,
    onDownload(action) { onDownload = action; },
    replace(value) { current = value; },
  };
}

for (const mode of ["cancel", "invalidate", "dispose"]) {
  test(`workspace save: ${mode} during initial snapshot prevents hashing and download`, async () => {
    const f = fixture();
    f.arm(() => f.stop(mode));
    f.click("save");
    await tick();
    // Settle even the faulty implementation so baseline reproduction leaks no jobs.
    if (f.waits.length) await f.finish();
    assert.equal(f.waits.length, 0, "A stopped export must not start checksum work");
    assert.equal(f.downloads.length, 0);
    assert.equal(f.writes.length, 0);
  });

  test(`workspace save: ${mode} during final identical snapshot prevents download`, async () => {
    const f = fixture();
    f.click("save");
    assert.equal(f.waits.length, 1);
    f.arm(() => f.stop(mode));
    await f.finish();
    assert.equal(f.downloads.length, 0, "Equal data does not renew cancelled authority");
    assert.equal(f.writes.length, 0);
    if (mode === "cancel") assert.match(f.field("status").textContent, /取り消しました/);
    if (mode === "dispose") assert.equal(f.parent.children.length, 0);
  });

  test(`workspace save: ${mode} inside download callback cannot report stale success`, async () => {
    const f = fixture();
    let stoppedStatus;
    f.onDownload(() => { f.stop(mode); stoppedStatus = f.field("status").textContent; });
    f.click("save");
    await f.finish();
    assert.equal(f.downloads.length, 1, "An already invoked download is not retroactively cancelled");
    assert.equal(f.field("status").textContent, stoppedStatus);
    assert.doesNotMatch(f.field("backup-status").textContent, /現在の内容でダウンロードを開始済み/);
    assert.equal(f.writes.length, 0);
  });

  test(`workspace summary: ${mode} during snapshot blocks plaintext export`, () => {
    const f = fixture();
    f.arm(() => f.stop(mode));
    f.click("save-summary");
    assert.equal(f.downloads.length, 0);
    assert.equal(f.writes.length, 0);
  });

  test(`workspace staging: ${mode} during undo-state read cannot insert late plaintext`, () => {
    const f = fixture();
    f.review();
    assert.equal(f.writes.length, 1);
    const before = f.field("json").value;
    f.arm(() => f.stop(mode));
    const result = f.panel.stageText(text({ block: "30" }));
    assert.equal(result, false);
    assert.equal(f.field("json").value, before);
    assert.equal(f.field("confirmed").checked, false);
    assert.equal(f.field("apply").disabled, true);
    assert.equal(f.writes.length, 1);
  });
}

test("workspace save: cancelled changed snapshot preserves the cancellation notice", async () => {
  const f = fixture();
  f.click("save");
  f.arm(() => { f.stop("cancel"); f.replace(draft({ block: "99" })); });
  await f.finish();
  assert.equal(f.downloads.length, 0);
  assert.match(f.field("status").textContent, /取り消しました/);
  assert.doesNotMatch(f.field("status").textContent, /保存準備中/);
});

test("workspace save: late completion cannot release or mark a replacement export", async () => {
  const f = fixture();
  f.click("save");
  f.arm(() => { f.stop("cancel"); f.click("save"); });
  await f.finish(0);
  assert.equal(f.waits.length, 2);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.field("save").disabled, true, "New export still owns the busy state");
  await f.finish(1);
  await until(() => !f.field("save").disabled);
  assert.equal(f.downloads.length, 1);
  assert.match(f.field("backup-status").textContent, /現在の内容でダウンロードを開始済み/);
});

test("workspace save: stopped export permits a later explicit save", async () => {
  const f = fixture();
  f.click("save");
  f.arm(() => f.stop("cancel"));
  await f.finish(0);
  assert.equal(f.downloads.length, 0);
  f.click("save");
  await f.finish(1);
  await until(() => !f.field("save").disabled);
  assert.equal(f.downloads.length, 1);
  assert.equal(f.writes.length, 0);
});

test("workspace import: cancellation inside accepted-file render preserves edited JSON", async () => {
  const f = fixture();
  f.review(); // Existing undo state makes controls inspect the current draft.
  const prepared = await prepareWorkspaceFile(bundle({ block: "30" }));
  const input = f.field("file");
  input.files = [fileObject(prepared.text)];
  input.dispatchEvent(new Event("change"));
  await until(() => f.waits.length === 1);
  f.arm(() => {
    f.stop("cancel");
    f.field("json").value = "new unfinished local input";
  });
  await f.finish();
  assert.equal(f.field("json").value, "new unfinished local input");
  assert.match(f.field("status").textContent, /取り消しました/);
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.writes.length, 1);
});

for (const mode of ["protect", "pagehide"]) {
  test(`workspace encrypted handoff: ${mode} during staging cannot restore erased plaintext`, async () => {
    let f, armed = false, reads = 0, stopped = false;
    f = lifecyclePanel({ workspace: true, readDraft() {
      if (armed && ++reads === 2) {
        armed = false; stopped = true;
        if (mode === "protect") f.panel.protect();
        else f.eventTarget.dispatchEvent(new Event("pagehide"));
      }
      return f ? f.current : draft({ block: "10" });
    } });
    try {
      f.panel.stageText(text({ block: "20" }));
      f.w("preview").click(); f.check(f.w("confirmed")); f.w("apply").click();
      assert.equal(f.writes.length, 1);
      await f.unlock();
      assert.equal(f.q("stage").disabled, false);
      armed = true;
      f.q("stage").click();
      assert.equal(stopped, true);
      assert.equal(f.w("json").value, "", "Protected plaintext returned to the restore field");
      assert.equal(f.w("apply").disabled, true);
      assert.equal(f.q("stage").disabled, true);
      assert.equal(f.writes.length, 1);
    } finally { f.dispose(); }
  });
}
