import { offerWalletDownload } from "./export-download.js";
import { createPeriodController } from "../src/period-controller.js";
import { periodPlanKey, periodWindows, periodFail } from "../src/period-plan.js";
import { periodDraftProgress } from "../src/period-draft.js";
import { periodPlanText, periodSummary, periodMessage } from "../src/period-view.js";
import { periodRecovery } from "../src/period-recovery.js";
import { periodProgressText } from "../src/period-progress.js";

/** UI consumes connected-card read methods; mounting this panel performs no RPC. */
export function mountPeriodPanel({ document, parent, getContext, read, stageWorkspace,
  download = file => downloadPeriodFile(file, document), controllerOptions = {} }) {
  let disposed = false;
  let reviewShown = null;
  let displayedPlan = null;
  let displayedDraft = null;
  let cachedSummary = null;
  const cleanup = [];
  const nodes = {};
  function node(tag, name, text, host = root) {
    const value = document.createElement(tag);
    value.className = "period-" + name;
    if (text !== undefined) value.textContent = text;
    if (host) host.append(value);
    nodes[name] = value;
    return value;
  }
  const root = node("section", "panel", undefined, null);
  root.setAttribute("aria-label", "期間を指定した残高と履歴の取得");
  parent.append(root);
  node("p", "eyebrow", "THREECORE / PERIOD COLLECTION");
  node("h2", "heading", "期間を選んで、残高の変化を確かめる");
  node("p", "intro", "開始時と終了時の残高、その間の送受信履歴を順に取得します。途中で停止しても、取得済みの控えを保存して再開できます。");
  node("p", "notice", "読み取り専用です。まず各トークンのカードで接続してください。過去の状態に対応しない接続先では取得できない場合があります。");
  const form = node("div", "form");
  function input(name, text, tag = "input", host = form) {
    const label = node("label", name + "-label", text, host);
    return node(tag, name, undefined, label);
  }
  const agent = input("agent", "対象トークン", "select");
  for (const value of ["DAT", "EMA", "CAWELON"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    agent.append(option);
  }
  agent.value = "DAT";
  for (const [name, text] of [["earlier", "開始ブロック（この終了時点の残高）"], ["later", "終了ブロック"]]) {
    const value = input(name, text);
    value.type = "text";
    value.inputMode = "numeric";
    value.autocomplete = "off";
    value.placeholder = "例: " + (name === "earlier" ? "30" : "42");
    value.maxLength = 78;
  }
  const windowSize = input("window-size", "1区間のブロック数");
  windowSize.type = "number";
  windowSize.min = "1";
  windowSize.max = "2000";
  windowSize.step = "1";
  windowSize.value = "1000";
  function button(name, text, host = root) {
    const value = node("button", name, text, host);
    value.type = "button";
    return value;
  }
  const actions = node("div", "actions");
  button("prepare", "期間の計画を確認", actions);
  button("start", "取得を開始・再開", actions);
  button("cancel", "処理を停止", actions);
  const status = node("p", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const recovery = node("section", "recovery");
  node("h3", "recovery-heading", "", recovery);
  node("p", "recovery-text", "", recovery);
  button("repair", "提案する期間の計画を確認", recovery);
  const review = node("section", "review");
  node("h3", "review-heading", "反映する前の確認", review);
  node("pre", "review-text", "", review);
  const ack = input("ack", "現在の控えを置き換えることを確認しました", "input", review);
  ack.type = "checkbox";
  button("apply", "この内容を控えに反映", review);
  const summary = node("section", "summary");
  const summaryHeader = node("div", "summary-header", undefined, summary);
  node("h3", "summary-heading", "まだ計画がありません", summaryHeader);
  node("span", "badge", "未開始", summaryHeader);
  const bar = node("progress", "progress", undefined, summary);
  bar.setAttribute("aria-label", "取得済みの段階数");
  bar.max = 1;
  bar.value = 0;
  node("p", "progress-text", "", summary);
  node("p", "provenance", "", summary);
  const amounts = node("div", "amounts", undefined, summary);
  for (const [name, text] of [["before", "開始時の残高"], ["after", "終了時の残高"]]) {
    const item = node("div", name + "-card", undefined, amounts);
    node("span", name + "-label", text, item);
    node("strong", name + "-amount", "未取得", item);
  }
  const table = node("table", "table", undefined, summary);
  const caption = document.createElement("caption");
  caption.textContent = "取得する区間と完了状況";
  table.append(caption);
  const head = document.createElement("thead");
  const row = document.createElement("tr");
  for (const text of ["区間", "ブロック", "状態", "履歴件数"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = text;
    row.append(cell);
  }
  head.append(row);
  table.append(head);
  node("tbody", "rows", undefined, table);
  const details = node("details", "details", undefined, summary);
  node("summary", "details-heading", "接続先・期間の詳細", details);
  node("pre", "plan-details", "", details);
  button("send", "照合画面へ確認候補を送る", summary);
  node("p", "send-note", "取得が揃ったら照合画面で内容を確認し、適用してください。計算一致は履歴の完全性や安全性を保証しません。", summary);
  const files = node("section", "files");
  node("h3", "files-heading", "控えの保存と復元", files);
  node("p", "files-note", "ページを閉じる前にJSONを保存してください。公開アドレスと過去の残高・履歴を含み、暗号化されていません。読み込みだけではウォレットへ接続しません。", files);
  const file = input("file", "期間取得のJSONを読み込む", "input", files);
  file.type = "file";
  file.accept = ".json,application/json";
  const exports = node("div", "export-actions", undefined, files);
  button("save", "途中の控えをJSON保存", exports);
  button("save-reconciliation", "照合用JSONを保存", exports);
  button("save-text", "取得内容をテキスト保存", exports);
  node("p", "saved", "", files);

  function listen(element, name, handler) {
    element.addEventListener(name, handler);
    cleanup.push(() => element.removeEventListener(name, handler));
  }
  function render(state) {
    if (disposed) return;
    root.setAttribute("aria-busy", String(state.busy));
    agent.value = state.agent;
    status.textContent = state.error ? periodMessage(state.error) : state.message;
    status.setAttribute("data-error", String(state.error !== null));
    recovery.hidden = (!state.error && !state.requiresNewPlan) || !state.draft;
    if (!recovery.hidden) {
      const suggestion = periodRecovery(state.draft, state.error ?? "PERIOD_NEW_PLAN_REQUIRED");
      nodes["recovery-heading"].textContent = suggestion.title;
      nodes["recovery-text"].textContent = suggestion.explanation;
      nodes.repair.hidden = suggestion.proposedPlan === null;
      nodes.repair.disabled = state.busy;
    }
    for (const name of ["prepare", "agent", "earlier", "later", "window-size", "file"]) nodes[name].disabled = state.busy;
    nodes.start.disabled = state.busy || state.review !== null || state.requiresNewPlan ||
      state.draft === null || state.agent !== state.draft.plan.context.agent;
    nodes.cancel.disabled = !state.busy && !state.review;
    review.hidden = state.review === null;
    if (reviewShown !== state.review) {
      reviewShown = state.review;
      ack.checked = false;
    }
    if (state.review) {
      const p = periodDraftProgress(state.review.candidate);
      nodes["review-text"].textContent = periodPlanText(state.review.candidate.plan) +
        `\n取得済み: ${p.completed} / ${p.total}` +
        (state.review.source === "library" ? "\n保存一覧に保管した過去の記録です。現在の接続先で再確認していません。" :
          state.review.source === "file" ? "\nファイル内の過去の記録です。作成者と内容の真正性は未確認です。" : "");
    }
    nodes["ack-label"].hidden = !state.review?.requiresReplacement;
    nodes.apply.disabled = state.busy || !state.review || (state.review.requiresReplacement && !ack.checked);
    const draftChanged = displayedDraft !== state.draft;
    if (draftChanged) {
      displayedDraft = state.draft;
      cachedSummary = state.draft ? periodSummary(state.draft) : null;
    }
    const value = cachedSummary;
    summary.hidden = !value;
    nodes.save.disabled = state.busy || !value;
    nodes["save-text"].disabled = state.busy || !value;
    nodes["save-reconciliation"].disabled = state.busy || state.requiresNewPlan || !value?.progress.complete;
    nodes.send.disabled = state.busy || state.requiresNewPlan || !value?.progress.complete;
    nodes.saved.textContent = state.savedCurrent ? "現在の控えのダウンロードを開始済み。保存先で確認してください。" :
      value ? "現在の控えは、この画面からまだJSON保存していません。" : "";
    if (!value) return;
    const key = periodPlanKey(value.plan);
    if (displayedPlan !== key) {
      displayedPlan = key;
      nodes.earlier.value = value.plan.earlierBlock;
      nodes.later.value = value.plan.laterBlock;
      windowSize.value = String(value.plan.windowSize);
    }
    const p = value.progress;
    nodes["summary-heading"].textContent = value.plan.context.agent + " / block " + value.plan.earlierBlock + " → " + value.plan.laterBlock;
    nodes.badge.textContent = state.requiresNewPlan ? "新しい計画で再取得が必要" :
      state.busy ? "処理中" : p.complete ? "取得記録が揃いました" : "途中の控え";
    bar.max = p.total;
    bar.value = p.completed;
    nodes["progress-text"].textContent = `${p.completed} / ${p.total}段階 · ${p.events}件の履歴` +
      (state.progress ? " · " + periodProgressText(state.progress, value.plan) : "");
    nodes.provenance.textContent = state.checkedThisSession
      ? "今回の接続中にブロック情報を再確認しました。提供元の履歴が完全かどうかは独立検証していません。"
      : "保存した過去の記録です。この接続での最終再確認はまだ完了していません。";
    nodes["before-amount"].textContent = value.earlierAmount + " " + value.plan.context.agent;
    nodes["after-amount"].textContent = value.laterAmount + " " + value.plan.context.agent;
    nodes["plan-details"].textContent = periodPlanText(value.plan);
    if (draftChanged) {
      nodes.rows.replaceChildren();
      for (const window of periodWindows(value.plan)) {
      const row = document.createElement("tr");
      const record = state.draft.records[window.index];
      for (const text of [String(window.index + 1), window.fromBlock + " ～ " + window.toBlock,
        record ? "取得済み" : "未取得", record ? String(record.events.length) : "—"]) {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);
      }
        nodes.rows.append(row);
      }
    }
  }
  const controller = createPeriodController({ ...controllerOptions, getContext, read, stageWorkspace, onChange: render });
  listen(agent, "change", () => controller.selectAgent(agent.value));
  for (const name of ["earlier", "later", "window-size"]) listen(nodes[name], "input", () => controller.invalidate());
  listen(nodes.prepare, "click", () => controller.prepare({
    earlierBlock: nodes.earlier.value.trim(), laterBlock: nodes.later.value.trim(),
    windowSize: /^\d+$/.test(windowSize.value) ? Number(windowSize.value) : NaN,
  }));
  listen(nodes.apply, "click", () => controller.apply(ack.checked));
  listen(nodes.repair, "click", () => controller.prepareRepair());
  listen(ack, "change", () => render(controller.state));
  listen(nodes.start, "click", () => { void controller.start(); });
  listen(nodes.cancel, "click", () => controller.cancel());
  listen(nodes.send, "click", () => controller.sendToReconciliation());
  listen(file, "change", () => {
    const selected = file.files?.[0];
    file.value = "";
    if (selected) void controller.importFile(selected);
  });
  for (const [name, kind] of [["save", "draft"], ["save-reconciliation", "reconciliation"], ["save-text", "text"]]) {
    listen(nodes[name], "click", () => { void controller.exportFile(kind, download); });
  }
  render(controller.state);
  return Object.freeze({ getDraft: () => controller.state.draft,
    getCheckpoint() {
      const state = controller.state;
      if (state.busy) periodFail("PERIOD_BUSY");
      return state.draft ? Object.freeze({ draft: state.draft, requiresNewPlan: state.requiresNewPlan }) : null;
    },
    stageSaved: (draft, options) => controller.stageSaved(draft, options), invalidate: () => controller.invalidate(),
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      cleanup.forEach(stop => stop());
      root.remove();
    },
  });
}

function downloadPeriodFile(file, document) {
  return offerWalletDownload({ document, prepared: file });
}
