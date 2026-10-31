import { mountHistoryPanel } from "./history-panel.js";
import { mountComparisonPanel } from "./comparison-panel.js";
import { mountTokenPlanPanel } from "./token-plan-panel.js";
import { createPortfolioProgressTracker, portfolioFailureStatus } from "../src/portfolio-progress.js";
import { encodePortfolioReport, decodePortfolioReport } from "../src/portfolio-report.js";
import { consumeCallback, observeCallbackResult } from "../src/security-callback.js";
import { readOwnErrorCode } from "../src/provider-error.js";
import { readSecurityFileText } from "../src/security-file.js";
import { offerWalletDownload } from "./export-download.js";

const STATUS = Object.freeze({
  idle: "未確認",
  loading: "残高を確認しています…",
  ready: "確認が完了しました",
  cancelled: "確認をキャンセルしました",
  error: "確認できませんでした。接続と入力を確認してください。",
});

/** A card-scoped, text-only view. All wallet requests stay in the controller. */
export function mountPortfolioPanel({ document, card, read, onCancel, getContext = () => null, download = offerWalletDownload }) {
  const section = document.createElement("section");
  section.className = "portfolio-panel";
  const listeners = [];
  let disposed = false;
  let revision = 0;
  let active = null;
  let fileRead = null;
  let current = null;
  let comparison;
  let tokenPlan;
  let historyPanel;
  const alive = id => !disposed && id === revision;


  function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }
  function button(className, text) {
    const item = element("button", className + " secondary", text);
    item.type = "button";
    return item;
  }
  function listen(target, event, fn) {
    const listener = (...args) => { if (!disposed) return fn(...args); };
    target.addEventListener(event, listener);
    listeners.push(() => target.removeEventListener(event, listener));
  }
  const heading = element("h3", "", "複数トークンの残高確認");
  const label = element("label", "", "契約アドレスを1行に1つ入力（最大32件）");
  const input = element("textarea", "portfolio-tokens");
  input.rows = 3;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "確認するトークンの契約アドレス");
  label.append(input);
  const inspect = button("portfolio-read", "まとめて確認");
  const cancel = button("portfolio-cancel", "確認をキャンセル");
  const clear = button("portfolio-clear", "結果を消去");
  const exportButton = button("portfolio-export", "確認記録をJSONにする");
  const downloadButton = button("portfolio-download", "今回の確認記録をファイル保存");
  const fileLabel = element("label", "", "保存した確認記録を読み込む（JSON・64 KiBまで）");
  const file = element("input", "portfolio-file"); file.type = "file"; file.accept = ".json,application/json"; fileLabel.append(file);
  const fileStop = button("portfolio-file-stop", "ファイル読み込みを中止");
  const importButton = button("portfolio-import", "過去の記録を表示");
  const status = element("p", "portfolio-status", STATUS.idle);
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const details = element("pre", "portfolio-details");
  const progress = element("progress", "portfolio-progress");
  progress.max = 1;
  progress.value = 0;
  progress.hidden = true;
  progress.setAttribute("aria-label", "トークンの確認件数");
  const reportLabel = element("label", "", "確認記録（公開アドレスと残高が含まれます）");
  const report = element("textarea", "portfolio-json");
  report.rows = 4;
  report.maxLength = 65536;
  report.spellcheck = false;
  report.setAttribute("aria-label", "確認記録JSON");
  reportLabel.append(report);
  const note = element("p", "notice", "読み取り専用。署名・送金は行いません。過去の記録は現在の残高や接続を証明しません。");
  section.append(heading, label, inspect, cancel, clear, status, progress, details,
    exportButton, downloadButton, fileLabel, fileStop, reportLabel, importButton, note);
  card.append(section);

  function controls(loading = Boolean(active)) {
    const busy = loading || Boolean(fileRead);
    progress.hidden = !loading;
    inspect.disabled = busy;
    cancel.disabled = !loading;
    exportButton.disabled = downloadButton.disabled = !current || busy;
    importButton.disabled = busy; file.disabled = busy; fileStop.disabled = !fileRead;
    section.setAttribute("aria-busy", String(busy));
  }
  function show(snapshot, historical) {
    comparison.setTarget(snapshot);
    const lines = [
      historical ? "過去の保存記録（現在の状態ではありません）" : "今回の確認結果",
      snapshot.agent + " / " + snapshot.account,
      "チェーン: " + snapshot.chainId,
      "参照ブロック: " + snapshot.blockNumber,
      "ブロックハッシュ: " + snapshot.blockHash,
      "ETH残高（wei）: " + snapshot.nativeBalanceBaseUnits,
    ];
    for (const row of snapshot.holdings) {
      lines.push(row.address);
      lines.push(row.hasCode ? "残高（最小単位）: " + row.balanceBaseUnits : "契約コードなし：残高は確認できません");
    }
    details.textContent = lines.join("\n");
  }
  function invalidate(message = STATUS.idle, preserveTokenPlan = false) {
    if (disposed) return null;
    const id = ++revision;
    const previous = active;
    const oldFile = fileRead; fileRead = null;
    active = null;
    current = null;
    oldFile?.abort();
    previous?.abort();
    if (!alive(id)) return id;
    progress.value = 0;
    progress.max = 1;

    details.textContent = "";
    report.value = "";
    status.textContent = message;
    comparison?.clearTarget();
    if (!alive(id)) return id;
    if (!preserveTokenPlan) tokenPlan?.invalidate();
    if (!alive(id)) return id;
    historyPanel?.invalidate();
    if (alive(id)) controls();
    return id;
  }
  async function refresh() {
    if (disposed || active || fileRead) return;
    const id = invalidate();
    if (!alive(id)) return;
    const abort = new AbortController();
    active = abort;
    const tokens = input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const plannedTokens = tokens.slice();
    status.textContent = STATUS.loading;
    controls(true);
    try {
      let tracker;
      const snapshot = await read({ tokens, signal: abort.signal, onProgress(event) {
        if (disposed || id !== revision || abort.signal.aborted || active !== abort) return;
        try {
          tracker ??= createPortfolioProgressTracker(plannedTokens);
          const update = tracker.accept(event);
          if (!alive(id) || abort.signal.aborted || active !== abort) return;
          progress.max = update.totalTokens;
          progress.value = update.completedTokens;
          status.textContent = update.label;
        } catch { /* Malformed progress is never displayed or treated as a result. */ }
      } });
      if (disposed || id !== revision || abort.signal.aborted) return;
      // Validate the complete shape before any provider-controlled data renders.
      const checked = decodePortfolioReport(encodePortfolioReport(snapshot)).snapshot;
      if (!alive(id) || abort.signal.aborted || active !== abort) return;
      current = checked;
      show(checked, false);
      status.textContent = STATUS.ready;
    } catch (error) {
      if (!alive(id) || active !== abort) return;
      const message = abort.signal.aborted ? STATUS.cancelled : portfolioFailureStatus({ code: readOwnErrorCode(error) }).message;
      if (!alive(id) || active !== abort) return;
      current = null;
      details.textContent = "";
      report.value = "";
      status.textContent = message;
    } finally {
      if (alive(id) && active === abort) {
        active = null;
        controls();
      }
    }
  }
  function cancelRead(message, preserveTokenPlan = false) {
    const id = invalidate(message, preserveTokenPlan);
    if (alive(id)) consumeCallback(() => onCancel?.());
  }
  listen(inspect, "click", refresh);
  listen(cancel, "click", () => cancelRead(STATUS.cancelled));
  listen(clear, "click", () => cancelRead());
  listen(input, "input", () => cancelRead("入力が変わりました。もう一度確認してください。"));
  listen(exportButton, "click", () => {
    if (!current || active || fileRead || disposed) return;
    report.value = encodePortfolioReport(current);
    status.textContent = "確認記録をJSONにしました。内容を確認して保存してください。";
  });
  listen(downloadButton, "click", () => {
    if (!current || active || fileRead || disposed) return; const id = revision, value = current;
    try { const prepared = { text: encodePortfolioReport(value), filename: `ThreeCore-${value.agent}-portfolio-${value.blockNumber}.json`, mimeType: "application/json;charset=utf-8", containsOriginalEvidence: true, restorable: false };
      const result = download({ document, prepared }), kind = observeCallbackResult(result); if (!alive(id)) return;
      if (kind !== "synchronous" || result === false) throw Error();
      status.textContent = "確認記録の保存を開始しました。ダウンロード先をご確認ください。";
    } catch { if (alive(id)) status.textContent = "確認記録を保存できませんでした。今回の確認結果は保持しています。"; }
  });
  listen(file, "change", () => {
    const chosen = file.files?.[0]; file.value = ""; if (!chosen || active || fileRead) return;
    const id = ++revision, local = new AbortController(); fileRead = local; controls();
    status.textContent = "保存した確認記録を読み込んでいます。今回の確認結果と履歴は保持しています。";
    void (async () => { try {
      const source = await readSecurityFileText(chosen, { maxBytes: 65536, signal: local.signal });
      if (!alive(id) || local.signal.aborted) return; decodePortfolioReport(source);
      if (!alive(id) || local.signal.aborted) return; report.value = source;
      status.textContent = "確認記録JSONを読み込みました。「過去の記録を表示」で内容を確認できます。履歴への追加は別の操作です。";
    } catch { if (alive(id) && !local.signal.aborted) status.textContent = "確認記録を読み込めませんでした。64 KiB以内のUTF-8 JSONを確認してください。今回の結果と履歴は保持しています。"; }
    finally { if (alive(id) && fileRead === local) { fileRead = null; local.abort(); controls(); } } })();
  });
  function cancelFileRead(message) { if (!fileRead) return; const id = ++revision, previous = fileRead; fileRead = null; previous.abort(); if (alive(id)) { controls(); status.textContent = message; } }
  listen(fileStop, "click", () => cancelFileRead("ファイル読み込みを中止しました。今回の結果と履歴は保持しています。"));
  listen(report, "input", () => cancelFileRead("JSONが編集されたためファイル読み込みを中止しました。編集した内容は保持しています。"));
  listen(importButton, "click", () => {
    if (disposed || active || fileRead) return;
    const text = report.value;
    const id = invalidate();
    if (!alive(id)) return;
    try {
      const imported = decodePortfolioReport(text);
      show(imported.snapshot, true);
      status.textContent = "過去の記録を表示しています。現在の接続や残高ではありません。";
    } catch {
      status.textContent = "記録の形式が正しくありません。";
    }
  });
  comparison = mountComparisonPanel({ document, parent: section });
  tokenPlan = mountTokenPlanPanel({ document, parent: section, getContext, download,
    readLines: () => input.value,
    applyLines: value => {
      if (disposed) return false;
      input.value = value;
      cancelRead("入力リストを変更しました。必要な場合は改めて残高を確認してください。", true);
    },
  });
  historyPanel = mountHistoryPanel({ document, parent: section, agent: card.dataset?.agent ?? getContext()?.agent,
    getSnapshot: () => active ? null : current, getReport: () => report.value });
  controls();
  return Object.freeze({
    exportHistory: () => historyPanel.exportArchive(),
    replaceHistory: text => historyPanel.replaceArchive(text),
    invalidate: message => invalidate(message),
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      const previous = active;
      active = null;
      const oldFile = fileRead; fileRead = null; oldFile?.abort();
      current = null;
      previous?.abort();
      comparison.dispose();
      tokenPlan.dispose();
      historyPanel.dispose();
      for (const stop of listeners) stop();
      section.remove();
    },
  });
}




