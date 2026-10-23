import { createTransferArchiveController } from "../src/transfer-archive-controller.js";
import { transferArchiveText } from "../src/transfer-archive.js";
import { transferErrorText } from "../src/transfer-messages.js";

export function mountTransferArchivePanel({ document, parent, getContext, getSnapshot, onSelect, download, subtle }) {
  const cleanup = [];
  let disposed = false;
  let state;
  function element(tag, name, text = "") {
    const value = document.createElement(tag);
    value.className = "transfer-archive-" + name;
    value.textContent = text;
    return value;
  }
  function button(name, text) {
    const value = element("button", name, text);
    value.type = "button";
    return value;
  }
  function listen(target, event, action) {
    target.addEventListener(event, action);
    cleanup.push(() => target.removeEventListener(event, action));
  }
  const host = element("details", "panel");
  host.append(element("summary", "title", "期間ごとの記録をまとめる（最大12件）"));
  const help = element("p", "help", "記録を一時的にまとめ、問い合わせた期間と未確認の期間を整理します。画面を閉じる前にJSONを保存してください。既存の保存ファイルは変更しません。");
  const add = button("add", "今の履歴をまとめに追加");
  const save = button("save", "まとめたJSONを保存");
  const clear = button("clear", "この画面のまとめをクリア");
  const status = element("p", "status");
  status.setAttribute("role", "status");
  const overview = element("pre", "overview");
  const choiceLabel = element("label", "choice-label", "表示する期間の記録");
  const choice = element("select", "choice");
  choiceLabel.append(choice);
  const select = button("select", "選択した記録を確認");
  const remove = button("remove", "選択した記録をまとめから外す");
  const fileLabel = element("label", "file-label", "保存したまとめJSONを開く（最大6 MiB）");
  const file = element("input", "file");
  file.type = "file";
  file.accept = ".json,application/json";
  fileLabel.append(file);
  const preview = element("pre", "preview");
  const apply = button("apply", "確認したまとめに置き換える");
  const cancel = button("cancel", "読み込み・準備を中止");
  host.append(help, add, save, clear, status, overview, choiceLabel, select, remove, fileLabel, preview, apply, cancel);
  parent.append(host);
  function refresh() {
    if (!state || disposed) return;
    const busy = ["loading", "preparing"].includes(state.phase);
    host.setAttribute("aria-busy", String(busy));
    add.disabled = busy || !getSnapshot();
    save.disabled = busy || !state.archive;
    select.disabled = busy || !state.archive;
    remove.disabled = busy || !state.archive;
    file.disabled = busy;
    apply.disabled = !state.preview;
    cancel.disabled = !busy && !state.preview;
  }
  function render(next) {
    state = next;
    const previous = choice.value;
    choice.replaceChildren();
    for (const [index, record] of (next.archive?.records ?? []).entries()) {
      const option = element("option", "option", `${record.range.fromBlock} ～ ${record.range.toBlock} (${record.events.length}件)`);
      option.value = String(index);
      choice.append(option);
    }
    choice.value = next.archive && Number(previous) < next.archive.records.length ? previous || "0" : "0";
    overview.textContent = next.archive ? transferArchiveText(next.archive) : "";
    preview.textContent = next.preview ? transferArchiveText(next.preview.archive) + "\nファイルからの記録です。現在のチェーン状態は未確認です。" : "";
    status.textContent = next.error ? transferErrorText(next.error) :
      next.phase === "loading" ? "まとめファイルを確認しています。" :
      next.phase === "preparing" ? "保存ファイルを準備しています。" :
      next.phase === "preview" ? "内容を確認すると、画面内のまとめを置き換えられます。" :
      next.archive ? "画面内に記録があります。保存はJSONボタンから行えます。" : "まとめた記録はありません。";
    refresh();
  }
  const controller = createTransferArchiveController({ getContext, onChange: render, subtle });
  listen(add, "click", () => {
    const snapshot = getSnapshot();
    if (snapshot) controller.add(snapshot);
  });
  listen(clear, "click", () => controller.invalidate());
  listen(remove, "click", () => controller.remove(Number(choice.value)));
  listen(select, "click", async () => {
    const selected = controller.select(Number(choice.value));
    if (!selected) return;
    try { await onSelect(selected); }
    catch { if (!disposed) status.textContent = "選択した記録を表示できませんでした。"; }
  });
  listen(file, "change", () => {
    const selected = file.files?.[0];
    file.value = "";
    if (selected) controller.stage(selected);
  });
  listen(apply, "click", () => controller.apply(state.preview?.id));
  listen(cancel, "click", () => controller.cancel());
  listen(save, "click", async () => {
    const prepared = await controller.prepare();
    if (!prepared || disposed) return;
    try { await download(prepared, document); }
    catch { if (!disposed) status.textContent = "まとめファイルを保存できませんでした。"; }
  });
  render(controller.state);
  return Object.freeze({
    refresh,
    getArchive: () => controller.capture(),
    stageArchive(input) { host.open = true; return controller.reviewArchive(input); },
    invalidate() { controller.invalidate(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const stop of cleanup) stop();
      controller.dispose();
      host.remove();
    },
  });
}
