import { createExportGuard } from "/src/export-guard.js";
import { mountExportGuardPanel } from "/examples/export-guard-panel.js";

const host = document.querySelector("#export-status"), result = document.querySelector("#result");
const input = { text: "Synthetic export demonstration", filename: "ThreeCore-synthetic.txt",
  mimeType: "text/plain;charset=utf-8" };
let guard, panel, time = 0, timerId = 0, broken = false;
const timers = new Map();
function initialize() {
  broken = false;
  guard?.dispose(); guard?.retryCleanup(); panel?.dispose();
  time = 0; timers.clear();
  guard = createExportGuard({ now: () => time,
    schedule(callback, delay) { timers.set(++timerId, { callback, due: time + delay }); return timerId; },
    unschedule(id) { timers.delete(id); },
    createResource() {
      // No Blob, URL or anchor is allocated in this interactive demonstration.
      return { activate() {}, release() { return !broken; } };
    },
  });
  panel = mountExportGuardPanel({ document, parent: host, guard });
  result.textContent = "確認待ちです。";
}
function offer(count) {
  let accepted = 0;
  for (let i = 0; i < count; i++) {
    try { guard.offer(input); accepted++; }
    catch (error) {
      result.textContent = `${accepted}件を受け付けました。追加分は ${error.code} で停止しました。`;
      return;
    }
  }
  result.textContent = `${accepted}件の合成データを受け付けました。実際のダウンロードはしていません。`;
}
document.querySelector("#offer").addEventListener("click", () => offer(1));
document.querySelector("#four").addEventListener("click", () => offer(4));
document.querySelector("#expire").addEventListener("click", () => {
  time += 1000;
  for (const [id, item] of [...timers]) if (item.due <= time) {
    timers.delete(id); item.callback();
  }
  result.textContent = "確認用の時間を1秒進めました。";
});
document.querySelector("#fail").addEventListener("click", () => {
  broken = true;
  guard.clear();
  result.textContent = "合成データの解放失敗を再現しました。実ファイルは変更していません。";
});
document.querySelector("#recover").addEventListener("click", () => {
  broken = false;
  result.textContent = "解放機能を正常に戻しました。下の再試行ボタンで確認できます。";
});
document.querySelector("#invalid").addEventListener("click", () => {
  try { guard.offer({ ...input, filename: "../synthetic.txt" }); }
  catch (error) { result.textContent = "入力を " + error.code + " で拒否しました。"; }
});
document.querySelector("#reset").addEventListener("click", initialize);
window.addEventListener("pagehide", () => { broken = false; guard.dispose(); guard.retryCleanup(); panel.dispose(); });
initialize();
