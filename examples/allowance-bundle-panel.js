import { offerWalletDownload } from "./export-download.js";
import { captureAllowanceBundle, allowanceBundleKey, prepareAllowanceBundle,
  readAllowanceBundle, describeAllowanceBundle } from "../src/allowance-bundle.js";
import { allowanceErrorMessage } from "../src/allowance-view.js";
import { readOwnErrorCode } from "../src/provider-error.js";
import { observeCallbackResult } from "../src/security-callback.js";

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
  let active = null;
  const current = id => !disposed && generation === id;
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
    if (disposed) return;
    section.setAttribute("aria-busy", String(pending));
    review.disabled = pending;
    save.disabled = pending || !preview;
    file.disabled = pending;
    cancel.disabled = !pending;
  }
  function retire() {
    const id = ++generation;
    const previous = active;
    active = null;
    pending = false;
    preview = null;
    previous?.abort();
    if (current(id)) render();
    return id;
  }
  function errorMessage(code) {
    if (["ALLOWANCE_BUNDLE_RECORDS", "ALLOWANCE_SHAPE"].includes(code)) {
      return "DAT・EMA・CAWELONの3件の確認記録が必要です。各カードを確認してください。";
    }
    if (code === "ALLOWANCE_BUNDLE_STALE") return "カードの記録が変わりました。保存内容をもう一度確認してください。";
    return allowanceErrorMessage(code);
  }
  const stale = () => Object.assign(Error("Stale bundle"), { code: "ALLOWANCE_BUNDLE_STALE" });
  function browserDownload(prepared) {
    return offerWalletDownload({ document, prepared: prepared });
  }
  listen(review, "click", () => {
    if (disposed) return;
    const id = retire();
    if (!current(id)) return;
    try {
      const bundle = captureAllowanceBundle(readRecords());
      if (!current(id)) return;
      preview = { bundle, key: allowanceBundleKey(bundle) };
      details.textContent = describeAllowanceBundle(bundle);
      status.textContent = "3件のWallet・ネットワーク・ブロックを確認してから保存してください。";
    } catch (error) {
      const code = readOwnErrorCode(error);
      if (!current(id)) return;
      details.textContent = "";
      status.textContent = errorMessage(code);
    }
    render();
  });
  listen(save, "click", async () => {
    if (disposed || !preview || pending) return;
    const id = ++generation;
    const own = new AbortController();
    active = own;
    const reviewed = preview;
    pending = true;
    render();
    try {
      const initialKey = allowanceBundleKey(captureAllowanceBundle(readRecords()));
      if (!current(id)) return;
      if (initialKey !== reviewed.key) throw stale();
      const prepared = await prepareAllowanceBundle(reviewed.bundle, { subtle, signal: own.signal });
      if (!current(id)) return;
      const latestKey = allowanceBundleKey(captureAllowanceBundle(readRecords()));
      if (!current(id)) return;
      if (latestKey !== reviewed.key) throw stale();
      const receipt = (downloadFile ?? browserDownload)(prepared);
      if (observeCallbackResult(receipt) !== "synchronous" || receipt === false) {
        throw Object.assign(Error("Download refused"), { code: "ALLOWANCE_EXPORT_REFUSED" });
      }
      if (!current(id)) return;
      status.textContent = "一括ファイルを用意しました。ブラウザーでダウンロード完了を確認してください。";
    } catch (error) {
      if (!current(id)) return;
      const code = readOwnErrorCode(error);
      if (!current(id)) return;
      preview = null;
      status.textContent = errorMessage(code);
    } finally {
      if (active === own) active = null;
      if (!disposed && id === generation) { pending = false; render(); }
    }
  });
  listen(file, "change", async () => {
    if (disposed) return;
    const selected = file.files?.[0];
    file.value = "";
    if (!selected) return;
    const id = retire();
    if (!current(id)) return;
    const own = new AbortController();
    active = own;
    pending = true;
    details.textContent = "";
    status.textContent = "一括ファイルの形式と破損を確認しています…";
    render();
    try {
      const result = await readAllowanceBundle(selected, { subtle, signal: own.signal });
      if (disposed || id !== generation) return;
      details.textContent = describeAllowanceBundle(result.bundle);
      status.textContent = "過去の一括記録を表示しています。カードの設定・記録は変更していません。";
    } catch (error) {
      if (!current(id)) return;
      const code = readOwnErrorCode(error);
      if (current(id)) status.textContent = errorMessage(code);
    } finally {
      if (active === own) active = null;
      if (!disposed && id === generation) { pending = false; render(); }
    }
  });
  listen(cancel, "click", () => {
    if (disposed) return;
    const id = retire();
    if (!current(id)) return;
    details.textContent = "";
    status.textContent = "処理を中止しました。";
  });
  listen(clear, "click", () => {
    if (disposed) return;
    const id = retire();
    if (!current(id)) return;
    details.textContent = "";
    status.textContent = "一括記録の表示を消しました。";
  });
  render();
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      retire();
      for (const stop of listeners) stop();
      section.remove();
    },
  });
}
