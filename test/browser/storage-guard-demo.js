import { createNativeFixture, formats, virtualDeadline, save, same, assert, outcome, waitFor } from "/test/browser/storage-guard-fixture.js";
import { mountStorageGuardPanel } from "/examples/storage-guard-panel.js";

const fixture = createNativeFixture();
const time = virtualDeadline();
const options = { deadlineOptions: time.options, transactionTimeoutMs: 100 };
const original = fixture.storage(formats[0], options);
let storage = original.value;
let baseline;
let busy = false;
const checks = new Map();
const byId = id => document.getElementById(id);
const controls = ["prepare", "cancel-write", "expire-write", "reload"];
mountStorageGuardPanel({ document, parent: byId("guard"), guard: fixture.guard });

function buttons() {
  for (const id of controls) byId(id).disabled = busy || (id === "prepare" ? !!baseline : !baseline);
}
function renderReadback(value) {
  byId("saved").textContent = `${value.entries.length}件`;
  byId("revision").textContent = String(value.revision);
  byId("preserved").textContent = baseline && JSON.stringify(value) === JSON.stringify(baseline) ? "保持を確認" : "未確認";
  byId("readback").textContent = value.entries[0]?.label ?? "保存済みの項目はありません";
}
function record(key, text) {
  checks.set(key, text);
  byId("checks").replaceChildren();
  for (const value of checks.values()) {
    const li = document.createElement("li");
    li.textContent = value;
    byId("checks").append(li);
  }
}
async function run(action) {
  if (busy) return;
  busy = true;
  buttons();
  try { await action(); }
  catch { byId("demo-status").textContent = "検証を完了できませんでした。テスト領域のデータは自動で上書きしません。"; }
  finally { busy = false; buttons(); }
}
byId("prepare").addEventListener("click", () => run(async () => {
  baseline = await storage.change(0, save(1, "DAT / EMA / CAWELON — 保全するテストデータ"));
  renderReadback(await storage.read());
  record("save", "保存後の読み直しで、元データと版番号1の一致を確認しました。");
  byId("demo-status").textContent = "元データを保存しました。取り消し・期限切れの確認に進めます。";
}));
byId("cancel-write").addEventListener("click", () => run(async () => {
  const aborter = new AbortController();
  const result = await outcome(storage.change(baseline.revision, save(2, "保存してはいけない追加データ"), {
    signal: aborter.signal, canCommit() { aborter.abort(); return true; },
  }));
  assert(result.code === "CHECKPOINT_CANCELLED");
  await waitFor(() => fixture.guard.state().active === 0);
  const readback = await storage.read();
  same(readback, baseline);
  renderReadback(readback);
  record("cancel", "取り消した追加データは保存されず、元データ1件が残っています。");
  byId("demo-status").textContent = "取り消し後の再読み込みで、元データの保持を確認しました。";
}));
byId("expire-write").addEventListener("click", () => run(async () => {
  const result = await outcome(storage.change(baseline.revision, save(3, "期限切れの追加データ"), {
    canCommit() { time.advance(100); return true; },
  }));
  assert(result.code === "CHECKPOINT_TIMEOUT");
  await waitFor(() => fixture.guard.state().active === 0);
  const readback = await storage.read();
  same(readback, baseline);
  renderReadback(readback);
  record("expire", "期限切れの追加データは保存されず、版番号1のままです。");
  byId("demo-status").textContent = "期限切れ後も元データが残ることを確認しました。";
}));
byId("reload").addEventListener("click", () => run(async () => {
  storage.close();
  storage = fixture.storage(formats[0], { ...options, name: original.name }).value;
  const value = await storage.read();
  same(value, baseline);
  renderReadback(value);
  record("reopen", "保存先を開き直した後も、元データの一致を確認しました。");
  byId("demo-status").textContent = "保存先を開き直して再確認しました。元データは保持されています。";
}));
// Each page instance owns a random test-only name. No production data is opened.
// The visible proof remains available until the page closes; its fixture can then
// be removed by a later explicit test cleanup without touching other databases.
window.addEventListener("pagehide", () => { fixture.dispose().catch(() => {}); }, { once: true });
buttons();
