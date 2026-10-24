import { offerWalletDownload } from "./export-download.js";
import { captureAllowanceBundle, allowanceBundleKey, prepareAllowanceBundle,
  readAllowanceBundle, describeAllowanceBundle } from "../src/allowance-bundle.js";
import { allowanceErrorMessage } from "../src/allowance-view.js";

/** A separate historical display: imports never overwrite any wallet card. */
export function mountAllowanceBundlePanel({
  document, parent, readRecords, downloadFile, subtle,
} = {}) {
  const section = document.createElement("section");
  section.className = "allowance-bundle-panel";
  const listeners = [];
  let generation = 0;
  let disposed = false;
  let preview = null;
  let pending = false;
  const make = (tag, name, text) => {
    const node = document.createElement(tag);
    node.className = "allowance-bundle-" + name;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (name, text) => {
    const node = make("button", name, text);
    node.type = "button";
    return node;
  };
  const heading = make("h3", "heading", "3トークンの記録を一括保存");
  const intro = make("p", "intro", "3カードの確認記録を一つのJSONにまとめます。すべてのカードに記録が必要です。");
  const review = button("review", "3件の保存内容を確認");
  const save = button("save", "確認した3件をファイル保存");
  const cancel = button("cancel", "準備・読込みを中止");
  const clear = button("clear", "一括記録の表示を消す");
  const status = make("p", "status", "保存内容は未確認です。");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const details = make("pre", "details");
  const label = make("label", "file-label", "一括保存したJSONを読み込む");
  const file = make("input", "file");
  file.type = "file";
  file.accept = ".json,application/json";
  file.setAttribute("aria-label", "3トークンの承認額一括JSONファイル");
  label.append(file);
  section.append(heading, intro, review, save, cancel, clear, status, details, label);
  parent.append(section);
  const listen = (node, event, handler) => {
    node.addEventListener(event, handler);
    listeners.push(() => node.removeEventListener(event, handler));
  };
  function render() {
    section.setAttribute("aria-busy", String(pending));
    review.disabled = pending;
    save.disabled = pending || !preview;
    file.disabled = pending;
    cancel.disabled = !pending;
  }
  function retire() {
    generation++;
    pending = false;
    preview = null;
    render();
  }
  function errorMessage(error) {
    if (["ALLOWANCE_BUNDLE_RECORDS", "ALLOWANCE_SHAPE"].includes(error?.code)) {
      return "DAT・EMA・CAWELONの3件の確認記録が必要です。各カードを確認してください。";
    }
    return allowanceErrorMessage(error?.code);
  }
  function browserDownload(prepared) {
    return offerWalletDownload({ document, prepared: prepared });
  }
  listen(review, "click", () => {
    if (disposed) return;
    retire();
    try {
      const bundle = captureAllowanceBundle(readRecords());
      preview = { bundle, key: allowanceBundleKey(bundle) };
      details.textContent = describeAllowanceBundle(bundle);
      status.textContent = "3件のWallet・ネットワーク・ブロックを確認してから保存してください。";
    } catch (error) {
      details.textContent = "";
      status.textContent = errorMessage(error);
    }
    render();
  });
  listen(save, "click", async () => {
    if (disposed || !preview || pending) return;
    const id = ++generation;
    const reviewed = preview;
    pending = true;
    render();
    try {
      if (allowanceBundleKey(captureAllowanceBundle(readRecords())) !== reviewed.key) throw Error("stale");
      const prepared = await prepareAllowanceBundle(reviewed.bundle, { subtle });
      if (disposed || id !== generation) return;
      if (allowanceBundleKey(captureAllowanceBundle(readRecords())) !== reviewed.key) throw Error("stale");
      await (downloadFile ?? browserDownload)(prepared);
      if (disposed || id !== generation) return;
      status.textContent = "一括ファイルを用意しました。ブラウザーでダウンロード完了を確認してください。";
    } catch (error) {
      if (disposed || id !== generation) return;
      preview = null;
      status.textContent = error?.message === "stale"
        ? "カードの記録が変わりました。保存内容をもう一度確認してください。"
        : errorMessage(error);
    } finally {
      if (!disposed && id === generation) { pending = false; render(); }
    }
  });
  listen(file, "change", async () => {
    if (disposed) return;
    const selected = file.files?.[0];
    file.value = "";
    if (!selected) return;
    retire();
    const id = generation;
    pending = true;
    details.textContent = "";
    status.textContent = "一括ファイルの形式と破損を確認しています…";
    render();
    try {
      const result = await readAllowanceBundle(selected, { subtle });
      if (disposed || id !== generation) return;
      details.textContent = describeAllowanceBundle(result.bundle);
      status.textContent = "過去の一括記録を表示しています。カードの設定・記録は変更していません。";
    } catch (error) {
      if (!disposed && id === generation) status.textContent = errorMessage(error);
    } finally {
      if (!disposed && id === generation) { pending = false; render(); }
    }
  });
  listen(cancel, "click", () => {
    if (disposed) return;
    retire();
    details.textContent = "";
    status.textContent = "処理を中止しました。";
  });
  listen(clear, "click", () => {
    if (disposed) return;
    retire();
    details.textContent = "";
    status.textContent = "一括記録の表示を消しました。";
  });
  render();
  return Object.freeze({
    dispose() {
      if (disposed) return;
      retire();
      disposed = true;
      for (const stop of listeners) stop();
      section.remove();
    },
  });
}
