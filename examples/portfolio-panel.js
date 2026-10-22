import { mountHistoryPanel } from "./history-panel.js";
import { mountComparisonPanel } from "./comparison-panel.js";
import { mountTokenPlanPanel } from "./token-plan-panel.js";
import { createPortfolioProgressTracker, portfolioFailureStatus } from "../src/portfolio-progress.js";
import { encodePortfolioReport, decodePortfolioReport } from "../src/portfolio-report.js";

const STATUS = Object.freeze({
  idle: "未確認",
  loading: "残高を確認しています…",
  ready: "確認が完了しました",
  cancelled: "確認をキャンセルしました",
  error: "確認できませんでした。接続と入力を確認してください。",
});

/** A card-scoped, text-only view. All wallet requests stay in the controller. */
export function mountPortfolioPanel({ document, card, read, onCancel, getContext = () => null }) {
  const section = document.createElement("section");
  section.className = "portfolio-panel";
  const listeners = [];
  let disposed = false;
  let revision = 0;
  let active = null;
  let current = null;
  let comparison;
  let tokenPlan;
  let historyPanel;


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
    target.addEventListener(event, fn);
    listeners.push(() => target.removeEventListener(event, fn));
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
    exportButton, reportLabel, importButton, note);
  card.append(section);

  function controls(loading = false) {
    progress.hidden = !loading;
    inspect.disabled = loading;
    cancel.disabled = !loading;
    exportButton.disabled = !current || loading;
    importButton.disabled = loading;
    section.setAttribute("aria-busy", String(loading));
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
  function invalidate(message = STATUS.idle) {
    revision++;
    active?.abort();
    active = null;
    current = null;
    progress.value = 0;
    progress.max = 1;

    details.textContent = "";
    report.value = "";
    status.textContent = message;
    comparison?.clearTarget();
    tokenPlan?.invalidate();
    historyPanel?.invalidate();
    controls();
  }
  async function refresh() {
    if (disposed) return;
    invalidate();
    const id = revision;
    const abort = new AbortController();
    active = abort;
    const tokens = input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    status.textContent = STATUS.loading;
    controls(true);
    try {
      let tracker;
      const snapshot = await read({ tokens, signal: abort.signal, onProgress(event) {
        if (disposed || id !== revision || abort.signal.aborted || active !== abort) return;
        try {
          tracker ??= createPortfolioProgressTracker(tokens);
          const update = tracker.accept(event);
          progress.max = update.totalTokens;
          progress.value = update.completedTokens;
          status.textContent = update.label;
        } catch { /* Malformed progress is never displayed or treated as a result. */ }
      } });
      if (disposed || id !== revision || abort.signal.aborted) return;
      // Validate the complete shape before any provider-controlled data renders.
      const checked = decodePortfolioReport(encodePortfolioReport(snapshot)).snapshot;
      current = checked;
      show(checked, false);
      status.textContent = STATUS.ready;
    } catch (error) {
      if (disposed || id !== revision) return;
      current = null;
      details.textContent = "";
      report.value = "";
      status.textContent = abort.signal.aborted ? STATUS.cancelled : portfolioFailureStatus(error).message;
    } finally {
      if (!disposed && id === revision) {
        active = null;
        controls();
      }
    }
  }
  listen(inspect, "click", refresh);
  listen(cancel, "click", () => {
    invalidate(STATUS.cancelled);
    onCancel?.();
  });
  listen(clear, "click", () => { invalidate(); onCancel?.(); });
  listen(input, "input", () => {
    invalidate("入力が変わりました。もう一度確認してください。");
    onCancel?.();
  });
  listen(exportButton, "click", () => {
    if (!current || active || disposed) return;
    report.value = encodePortfolioReport(current);
    status.textContent = "確認記録をJSONにしました。内容を確認して保存してください。";
  });
  listen(importButton, "click", () => {
    if (disposed || active) return;
    const text = report.value;
    invalidate();
    try {
      const imported = decodePortfolioReport(text);
      show(imported.snapshot, true);
      status.textContent = "過去の記録を表示しています。現在の接続や残高ではありません。";
    } catch {
      status.textContent = "記録の形式が正しくありません。";
    }
  });
  comparison = mountComparisonPanel({ document, parent: section });
  tokenPlan = mountTokenPlanPanel({ document, parent: section, getContext,
    readLines: () => input.value,
    applyLines: value => {
      input.value = value;
      invalidate("入力リストを変更しました。必要な場合は改めて残高を確認してください。");
      onCancel?.();
    },
  });
  historyPanel = mountHistoryPanel({ document, parent: section, agent: card.dataset?.agent ?? getContext()?.agent,
    getSnapshot: () => active ? null : current, getReport: () => report.value });
  controls();
  return Object.freeze({
    exportHistory: () => historyPanel.exportArchive(),
    replaceHistory: text => historyPanel.replaceArchive(text),
    invalidate,
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
      comparison.dispose();
      tokenPlan.dispose();
      historyPanel.dispose();
      for (const stop of listeners) stop();
      section.remove();
    },
  });
}




