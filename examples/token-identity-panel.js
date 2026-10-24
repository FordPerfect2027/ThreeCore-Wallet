import { offerWalletDownload } from "./export-download.js";
import { createTokenIdentityController } from "../src/token-identity-controller.js";
import { createCatalogSelection } from "../src/token-catalog.js";
import { describeCatalog, describeTokenObservation, describeTokenComparison,
  tokenIdentityErrorMessage, tokenIdentityProgressMessage } from "../src/token-identity-view.js";

/** Text-only UI with explicit reads and explicit file downloads. */
export function mountTokenIdentityPanel({ document, parent, getContext, read,
  applyAddress, downloadFile, subtle, onStateChange = () => {} } = {}) {
  const listeners = [];
  const selection = createCatalogSelection();
  let disposed = false;
  let preview = null;
  let controller;
  const section = document.createElement("section");
  section.className = "identity-panel";
  const create = (tag, name, text) => {
    const element = document.createElement(tag);
    element.className = "identity-" + name;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (name, text) => {
    const element = create("button", name, text);
    element.type = "button";
    return element;
  };
  const listen = (element, event, handler) => {
    element.addEventListener(event, handler);
    listeners.push(() => element.removeEventListener(event, handler));
  };
  const heading = create("h3", "heading", "公式トークンの照合");
  const intro = create("p", "intro", "DAT・EMA・CAWELONの契約情報と残高を、同じブロックで確認します。");
  const showCatalog = button("catalog", "公式アドレスを表示");
  const apply = button("apply", "この公式アドレスを入力");
  apply.disabled = true;
  const catalog = create("pre", "catalog-details");
  const inspect = button("inspect", "接続中のWalletで照合");
  const cancel = button("cancel", "照合・読込みを中止");
  const clear = button("clear", "照合記録を画面から消す");
  const status = create("p", "status", "未照合");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const details = create("pre", "details");
  const progress = create("p", "progress");
  progress.setAttribute("aria-live", "polite");
  progress.hidden = true;
  const save = button("save", "照合記録をファイル保存");
  const fileLabel = create("label", "file-label", "保存済みの照合記録を読み込む");
  const file = create("input", "file");
  file.type = "file";
  file.accept = ".json,application/json";
  file.setAttribute("aria-label", "照合記録JSONファイル");
  fileLabel.append(file);
  const setBaseline = button("baseline", "この記録を比較の基準にする");
  const compare = button("compare", "基準記録と比較");
  const baselineStatus = create("p", "baseline-status", "比較の基準は未設定です。");
  const comparison = create("pre", "comparison");
  const note = create("p", "note",
    "ファイルには公開アドレスと残高が含まれます。保存記録は過去の観測値です。署名・送金・承認は行いません。");
  section.append(heading, intro, showCatalog, apply, catalog, inspect, cancel, clear,
    status, progress, details, save, fileLabel, setBaseline, compare, baselineStatus, comparison, note);
  parent.append(section);

  function render(state) {
    if (disposed) return;
    try { onStateChange(state); } catch { /* Summary is an independent display. */ }
    const busy = ["reading", "loading", "preparing"].includes(state.phase);
    section.setAttribute("aria-busy", String(busy));
    inspect.disabled = busy;
    save.disabled = busy || !state.observation;
    setBaseline.disabled = busy || !state.observation;
    compare.disabled = busy || !state.baseline || !state.observation;
    cancel.disabled = !busy;
    file.disabled = busy;
    showCatalog.disabled = busy;
    apply.disabled = busy || !preview;
    const labels = {
      idle: "未照合",
      reading: "同じブロックで契約情報と残高を読み取っています…",
      loading: "保存記録の形式と破損を確認しています…",
      preparing: "照合記録の保存ファイルを準備しています…",
      ready: state.provenance === "imported" ? "過去の保存記録を表示しています。" : "照合結果を表示しています。",
      cancelled: "照合・読込みを中止しました。",
      error: "照合できませんでした。",
    };
    status.textContent = state.errorCode ? tokenIdentityErrorMessage(state.errorCode) : labels[state.phase] ?? "";
    progress.textContent = state.phase === "reading" ? tokenIdentityProgressMessage(state.progress) : "";
    progress.hidden = !progress.textContent;
    details.textContent = state.observation ? describeTokenObservation(state.observation, state.provenance) : "";
    baselineStatus.textContent = state.baseline
      ? "比較の基準: " + state.baseline.agent + " / chain " + state.baseline.chainId +
        " / block " + state.baseline.blockNumber + " / " + state.baseline.account
      : "比較の基準は未設定です。";
    comparison.textContent = state.comparison && state.baseline && state.observation
      ? describeTokenComparison(state.baseline, state.observation) : "";
  }
  controller = createTokenIdentityController({ getContext, read, onChange: render, subtle });
  function invalidate() {
    preview = null;
    selection.cancel();
    catalog.textContent = "";
    file.value = "";
    controller.invalidate();
  }
  function reportError(error) {
    status.textContent = tokenIdentityErrorMessage(error?.code);
  }
  listen(showCatalog, "click", () => {
    if (disposed) return;
    try {
      const value = getContext();
      const context = { agent: value.agent, chainId: value.chainId };
      preview = selection.preview(context, value.tokenAddress ?? "");
      catalog.textContent = describeCatalog(context, value.tokenAddress ?? "");
      apply.disabled = false;
    } catch (error) {
      preview = null;
      selection.cancel();
      apply.disabled = true;
      reportError(error);
    }
  });
  listen(apply, "click", () => {
    if (disposed) return;
    try {
      const value = getContext();
      const selected = selection.apply(preview?.id,
        { agent: value.agent, chainId: value.chainId }, value.tokenAddress ?? "");
      preview = null;
      applyAddress(selected);
      controller.invalidate();
      apply.disabled = true;
      status.textContent = "公式アドレスを入力しました。接続後に照合してください。";
    } catch (error) {
      preview = null;
      apply.disabled = true;
      reportError(error);
    }
  });
  listen(inspect, "click", () => { if (!disposed) void controller.inspect(); });
  listen(cancel, "click", () => { if (!disposed) controller.cancel(); });
  listen(clear, "click", () => { if (!disposed) invalidate(); });
  listen(file, "change", () => {
    if (disposed) return;
    const selected = file.files?.[0];
    file.value = "";
    if (selected) void controller.load(selected);
  });
  listen(setBaseline, "click", () => { if (!disposed) controller.useAsBaseline(); });
  listen(compare, "click", () => { if (!disposed) controller.compare(); });

  function browserDownload(prepared) {
    return offerWalletDownload({ document, prepared: prepared });
  }
  listen(save, "click", async () => {
    if (disposed) return;
    if (!await controller.prepareFile() || disposed) return;
    const prepared = controller.state().file;
    if (!prepared) return;
    try {
      (downloadFile ?? browserDownload)(prepared);
      status.textContent = "保存ファイルを用意しました。ブラウザーのダウンロード完了を確認してください。";
    } catch { status.textContent = tokenIdentityErrorMessage("IDENTITY_DOWNLOAD"); }
  });
  render(controller.state());
  return Object.freeze({
    invalidate,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      selection.cancel();
      for (const stop of listeners) stop();
      section.remove();
    },
  });
}
