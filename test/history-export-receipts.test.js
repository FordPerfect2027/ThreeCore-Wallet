import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mountHistoryFiles } from "../examples/history-files.js";
import { mountHistoryRecovery } from "../examples/history-recovery-panel.js";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { createHistoryRecovery } from "../src/history-recovery.js";
import { Element } from "./helpers/panel-dom.js";
import { observation } from "./helpers/history-fixtures.js";

const ACTIONS = ["full", "subset", "recovery"];
const tick = () => new Promise(resolve => setImmediate(resolve));

/** Actual mounted controls, a previously delivered file, and newer unsaved records. */
function fixture(action, onRead = () => {}) {
  const document = { createElement: tag => new Element(tag) };
  const parent = new Element("section"), recoveryParent = new Element("section");
  const history = createPortfolioHistory();
  history.merge([observation("42"), observation("43")]);
  const files = [];
  let receive = prepared => { files.push(prepared); };
  const download = ({ prepared }) => receive(prepared);
  const filesPanel = mountHistoryFiles({ document, parent, agent: "DAT",
    getArchive: () => { onRead("archive"); return history.exportText(); },
    getRevision: () => { onRead("revision"); return history.state().revision; },
    onImportText: () => { throw Error("An export must not stage an import"); }, download });
  const field = name => parent.find("history-" + name);
  field("file-save").click();
  assert.equal(files.length, 1);
  assert.equal(JSON.parse(files[0].text).reports.length, 2);
  history.add(observation("44"));
  filesPanel.invalidate();
  assert.match(field("backup-state").textContent, /まだファイルとして/);

  let recovery = null, recoveryPanel = null;
  if (action === "recovery") {
    recovery = createHistoryRecovery(history);
    recovery.remove(0, history.state().revision);
    recoveryPanel = mountHistoryRecovery({ document, parent: recoveryParent, agent: "DAT", recovery,
      onRestore: () => { throw Error("An export must not restore history"); },
      onCopyArchive: () => { throw Error("An export must not replace an import draft"); }, download });
  }
  const status = action === "recovery" ? recoveryParent.find("history-recovery-status") : field("file-status");
  const expectedText = action === "recovery" ? recovery.exportText() :
    action === "subset" ? files[0].text : history.exportText();
  const source = () => JSON.stringify({ history: history.exportText(), recovery: recovery?.exportText() ?? null });
  const before = source();
  return {
    files, status, expectedText, before, source,
    marker: field("backup-state"),
    setReceive: callback => { receive = callback; },
    send() {
      if (action === "subset") {
        field("filter-maximum").value = "43";
        field("filter-maximum").dispatchEvent(new Event("input"));
        field("filter-run").click();
        field("file-save-subset").click();
      } else if (action === "full") field("file-save").click();
      else recoveryParent.find("history-recovery-save").click();
    },
    stop(kind) { (recoveryPanel ?? filesPanel)[kind](); },
    dispose() { recoveryPanel?.dispose(); filesPanel.dispose(); recovery?.dispose(); },
  };
}

function assertSuccess(f, action) {
  assert.equal(f.files.length, 2, "only the old backup and explicit successful retry were delivered");
  assert.equal(f.files[1].text, f.expectedText);
  assert.equal(f.source(), f.before, "all current and pre-change records remain unchanged");
  assert.match(f.status.textContent, /ダウンロード.*開始しました/);
  if (action === "full") assert.match(f.marker.textContent, /現在の履歴のダウンロードを開始済み/);
  else assert.match(f.marker.textContent, /まだファイルとして/);
}

async function refuse(action, kind) {
  const f = fixture(action);
  let calls = 0, getterReads = 0, settlements = 0;
  try {
    f.setReceive(() => {
      calls++;
      if (kind === "false") return false;
      if (kind === "promise") return Promise.resolve(true);
      if (kind === "rejection") return Promise.reject(Error("synthetic private delivery detail"));
      return { get then() {
        getterReads++;
        if (kind === "unreadable") throw Error("synthetic private receipt detail");
        if (getterReads > 1) return undefined;
        if (kind === "async-then") return async () => { settlements++; throw Error("synthetic private then detail"); };
        return resolve => { settlements++; resolve(true); };
      } };
    });
    f.send();
    // Native rejections must be contained even before the user makes another attempt.
    await tick();
    assert.equal(calls, 1);
    assert.equal(f.files.length, 1, "the previous file is the only delivered backup");
    assert.equal(f.source(), f.before);
    assert.match(f.status.textContent, /操作できませんでした|復元操作は行えませんでした/);
    assert(!f.status.textContent.includes("private"));
    assert.match(f.marker.textContent, /まだファイルとして/);
    if (["changing", "unreadable", "async-then"].includes(kind)) assert.equal(getterReads, 1);
    if (["changing", "async-then"].includes(kind)) assert.equal(settlements, 1);
    f.setReceive(prepared => { f.files.push(prepared); return true; });
    f.send();
    await tick();
    assertSuccess(f, action);
  } finally { f.dispose(); }
}

async function stopped(action, stop) {
  for (const boundary of ["callback", "receipt-getter", "throw-after-stop"]) {
    const f = fixture(action);
    const priorStatus = f.status.textContent, priorMarker = f.marker.textContent;
    let calls = 0, getterReads = 0;
    try {
      f.setReceive(() => {
        calls++;
        if (boundary === "receipt-getter") return { get then() { getterReads++; f.stop(stop); return undefined; } };
        f.stop(stop);
        if (boundary === "throw-after-stop") throw Error("synthetic private stopped delivery");
        return true;
      });
      f.send();
      await tick();
      assert.equal(calls, 1);
      assert.equal(f.files.length, 1);
      assert.equal(f.source(), f.before);
      assert.equal(f.status.textContent, priorStatus, "a stopped export cannot replace the previous status");
      assert.equal(f.marker.textContent, priorMarker, "a stopped export cannot mark newer records as offered");
      if (boundary === "receipt-getter") assert.equal(getterReads, 1);
      if (stop === "invalidate") {
        f.setReceive(prepared => { f.files.push(prepared); return undefined; });
        f.send();
        assertSuccess(f, action);
      }
    } finally { f.dispose(); }
  }
}

async function stoppedRead(boundary, stop) {
  let armed = false, delivered = false;
  const f = fixture("full", kind => {
    const matches = boundary === "prepare-revision" ? kind === "revision" && !delivered :
      boundary === "prepare-archive" ? kind === "archive" : kind === "revision" && delivered;
    if (!armed || !matches) return;
    armed = false;
    f.stop(stop);
    throw Error("synthetic private history read detail");
  });
  const priorStatus = f.status.textContent;
  try {
    f.setReceive(prepared => { delivered = true; f.files.push(prepared); return true; });
    armed = true;
    f.send();
    await tick();
    assert.equal(armed, false, "the intended adapter boundary was reached");
    assert.equal(f.files.length, boundary === "post-delivery-revision" ? 2 : 1);
    assert.equal(f.source(), f.before);
    assert.equal(f.status.textContent, priorStatus, "an old read failure cannot replace stopped status");
    if (stop === "invalidate") {
      const deliveredBeforeRetry = f.files.length;
      f.send();
      assert.equal(f.files.length, deliveredBeforeRetry + 1);
      assert.equal(f.files.at(-1).text, f.expectedText);
      assert.equal(f.source(), f.before);
      assert.match(f.status.textContent, /ダウンロード.*開始しました/);
      assert.match(f.marker.textContent, /現在の履歴のダウンロードを開始済み/);
    }
  } finally { f.dispose(); }
}

// Strict child processes turn an unobserved adapter rejection into a hard failure.
if (process.argv[2] === "--receipt-child") {
  const [action, kind] = process.argv.slice(3);
  await refuse(action, kind);
  console.log("contained");
} else {
  for (const boundary of ["prepare-revision", "prepare-archive", "post-delivery-revision"]) {
    for (const stop of ["invalidate", "dispose"]) {
      test(`history export full: ${boundary} ${stop} then throw cannot replace stopped status`,
        () => stoppedRead(boundary, stop));
    }
  }
  for (const action of ACTIONS) {
    for (const kind of ["false", "promise", "changing", "unreadable", "rejection", "async-then"]) {
      test(`history export ${action}: ${kind} cannot announce a backup and explicit retry preserves records`, () => {
        const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", fileURLToPath(import.meta.url),
          "--receipt-child", action, kind], { encoding: "utf8", timeout: 10000, windowsHide: true });
        assert.equal(child.error, undefined);
        assert.equal(child.status, 0, child.stderr);
        assert.equal(child.stderr, "");
        assert.equal(child.stdout.trim(), "contained");
      });
    }
    for (const stop of ["invalidate", "dispose"]) {
      test(`history export ${action}: ${stop} during delivery or receipt inspection cannot revive success`,
        () => stopped(action, stop));
    }
    test(`history export ${action}: synchronous success receipts retain compatibility`, () => {
      for (const receipt of [undefined, true, Object.freeze({ offered: true, downloadComplete: false })]) {
        const f = fixture(action);
        try {
          f.setReceive(prepared => { f.files.push(prepared); return receipt; });
          f.send();
          assertSuccess(f, action);
        } finally { f.dispose(); }
      }
    });
  }
}
