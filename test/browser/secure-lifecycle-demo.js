import { fixture } from "/test/browser/secure-lifecycle-fixture.js";
const f = fixture();
const prepare = document.querySelector("#prepare");
const expire = document.querySelector("#expire");
const clear = document.querySelector("#clear");
const status = document.querySelector("#demo-status");
const proof = document.querySelector("#proof");
let generation = 0;
function report(text) {
  status.textContent = text;
  proof.textContent = `復元による書き込み: ${f.writes.length}件 ／ 外部ウォレット操作: 0件`;
}
prepare.addEventListener("click", async () => {
  const id = ++generation;
  prepare.disabled = true;
  expire.disabled = true;
  report("テストデータをPC内で暗号化・復号し、復元待ちサンプルを準備しています。");
  try {
    await f.unlock();
    if (id !== generation) return;
    f.q("stage").click();
    f.w("preview").click();
    f.check(f.w("confirmed"));
    if (f.w("apply").disabled) throw Error("Preview unavailable");
    expire.disabled = false;
    report("3トークンの復元内容を確認できる状態です。まだ書き込みは行っていません。");
  } catch {
    if (id === generation) report("準備を完了できませんでした。取り消してから再度準備してください。");
  } finally { if (id === generation) prepare.disabled = false; }
});
expire.addEventListener("click", () => {
  f.time.advance(100);
  f.w("apply").click();
  expire.disabled = true;
  const closed = f.w("json").value === "" && f.w("apply").disabled && f.writes.length === 0;
  report(closed ? "確認成功：期限切れの復元を停止し、復元待ちデータを消去しました。書き込みは0件です。" :
    "確認結果に不一致があります。開発担当者による確認が必要です。");
});
clear.addEventListener("click", () => {
  generation++;
  f.panel.protect();
  prepare.disabled = false;
  expire.disabled = true;
  report("取り消しました。合言葉と復元待ちデータを消去しました。");
});
window.addEventListener("pagehide", () => { generation++; f.dispose(); }, { once: true });
