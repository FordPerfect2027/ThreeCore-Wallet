import { createFileReadService } from "/src/file-read-service.js";
import { mountFileReadPanel } from "/examples/file-read-panel.js";

// This synthetic UI has no user file picker, storage or wallet dependencies.
const service = createFileReadService();
const panel = mountFileReadPanel({ document, parent: document.querySelector("#monitor"), service });
const output = document.querySelector("#outcome");
const events = [];
const pending = new Set();
const listeners = [];
const payload = JSON.stringify({ synthetic: true, agents: ["DAT", "EMA", "CAWELON"] });
const data = new TextEncoder().encode(payload);
let disposed = false;
let sequence = 0;
const messages = Object.freeze({
  accepted: "正常なJSONの内容が一致しました。", rejectedEncoding: "不正なUTF-8を拒否しました。",
  cancelled: "停止した読み込みの結果は取り込みません。", timeout: "時間切れの読み込みを停止しました。",
  busy: "上限により追加の読み込みを拒否しました。", late: "保留した模擬処理に完了を返しました。",
  held: "模擬読み込みを保留しました。", failure: "確認処理を完了できませんでした。",
});
function report(kind) {
  if (disposed) return;
  const safe = Object.hasOwn(messages, kind) ? kind : "failure";
  output.textContent = messages[safe];
  events.push({ number: ++sequence, result: safe });
  if (events.length > 12) events.shift();
  document.querySelector("#events").textContent = events.map(row => `#${row.number} ${row.result}`).join("\n");
  document.body.dataset.lastResult = safe;
}
function classify(error) {
  if (error?.code === "FILE_CANCELLED") return "cancelled";
  if (error?.code === "FILE_TIMEOUT") return "timeout";
  if (error?.code === "FILE_BUSY") return "busy";
  return "failure";
}
function listen(id, action) {
  const button = document.querySelector(id);
  const handler = () => {
    if (disposed) return;
    Promise.resolve().then(action).catch(error => report(classify(error)));
  };
  button.addEventListener("click", handler);
  listeners.push(() => button.removeEventListener("click", handler));
}
function hold(timeoutMs = 30_000) {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const item = { finish, invoked: false };
  pending.add(item);
  const operation = service.readText({ size: data.length, arrayBuffer() {
    item.invoked = true;
    return gate;
  } }, { timeoutMs });
  operation.then(value => {
    if (value === payload) report("accepted");
    else report("failure");
  }, error => {
    if (!item.invoked) pending.delete(item);
    report(classify(error));
  });
  return operation;
}
function finishAll() {
  for (const item of pending) item.finish(data.slice().buffer);
  pending.clear();
  report("late");
}
listen("#valid", async () => {
  const text = await service.readText(new File([payload], "synthetic.json"));
  report(text === payload ? "accepted" : "failure");
});
listen("#utf8", async () => {
  try {
    await service.readText(new File([Uint8Array.of(0xff)], "synthetic.json"));
    report("failure");
  } catch (error) { report(error.code === "FILE_ENCODING" ? "rejectedEncoding" : classify(error)); }
});
listen("#pending", () => { hold(); report("held"); });
listen("#settle", finishAll);
listen("#capacity", async () => {
  if (service.state().active) { report("failure"); return; }
  for (let i = 0; i < 4; i++) hold();
  try { await service.readText(new File([payload], "synthetic.json")); report("failure"); }
  catch (error) { report(classify(error)); }
});
listen("#timeout", () => { hold(50); report("held"); });
const unsubscribe = service.subscribe(state => {
  if (disposed) return;
  for (const key of ["active", "waiting", "retained", "completed", "cancelled", "timedOut", "rejected"]) {
    document.body.dataset[key] = String(state[key]);
  }
});
window.addEventListener("pagehide", () => {
  disposed = true;
  listeners.forEach(remove => remove());
  unsubscribe(); panel.dispose(); service.dispose();
  for (const item of pending) item.finish(new ArrayBuffer(0));
  pending.clear();
}, { once: true });
