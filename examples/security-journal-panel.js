import { securityJournalRows, exportSecurityJournal, validateSecurityJournal } from "../src/security-journal.js";
import { observeCallbackResult } from "../src/security-callback.js";

/** A text-only view of page-local protection events; no persistence or upload. */
export function mountSecurityJournalPanel({ document, parent, journal }) {
  const section = document.createElement("section");
  section.className = "security-journal";
  section.setAttribute("aria-label", "この画面の保護履歴");
  function node(tag, name, text, host = section) {
    const element = document.createElement(tag);
    element.className = "security-journal-" + name;
    if (text) element.textContent = text;
    host.append(element);
    return element;
  }
  node("h3", "heading", "この画面の保護履歴");
  node("p", "scope", "停止理由と設定変更だけを記録します。アドレス・残高は含みません。再読み込みすると履歴は消えます。");
  const summary = node("p", "summary");
  const list = node("ol", "list");
  const prepare = node("button", "prepare", "保護の記録を表示");
  const close = node("button", "close", "記録の表示を閉じる");
  prepare.type = close.type = "button";
  const label = node("label", "export-label", "確認用の保護記録（自動送信されません）");
  const output = node("textarea", "output", null, label);
  output.readOnly = true;
  output.rows = 8;
  const notice = node("p", "notice");
  notice.setAttribute("role", "status");
  parent.append(section);
  let disposed = false;
  let shown = false;
  let revision = null;
  let generation = 0, reading = false;
  const current = id => !disposed && id === generation;
  function capture(id) {
    if (reading) { generation++; return null; }
    reading = true;
    try {
      const value = journal.state();
      if (observeCallbackResult(value) !== "synchronous") throw Error("Unavailable journal");
      const state = validateSecurityJournal(value);
      return current(id) ? state : null;
    } finally { reading = false; }
  }
  function unavailable(id) {
    if (!current(id)) return;
    output.value = ""; shown = false; revision = null;
    list.replaceChildren();
    summary.textContent = "保護履歴の件数を確認できません。";
    notice.textContent = "保護の記録を確認できませんでした。もう一度表示して確認してください。";
    label.hidden = close.hidden = true;
    prepare.disabled = false;
  }
  function present(state) {
    const rows = securityJournalRows(state), key = exportSecurityJournal(state);
    list.replaceChildren();
    for (const row of rows) node("li", "event", "#" + row.sequence + " " + row.text, list);
    summary.textContent = "この画面で " + state.total + " 件。直近 " + Math.min(state.events.length, 8) +
      " 件を表示しています。" + (state.dropped ? "古い " + state.dropped + " 件の詳細は保持していません。" : "");
    if (shown && revision !== key) {
      output.value = "";
      shown = false;
      notice.textContent = "新しい記録があります。もう一度表示してください。";
    }
    label.hidden = close.hidden = !shown;
    prepare.disabled = state.disposed;
  }
  function render() {
    if (disposed) return;
    const id = ++generation;
    try { const state = capture(id); if (state) present(state); }
    catch { unavailable(id); }
  }
  function show() {
    if (disposed) return;
    const id = ++generation;
    try {
      const state = capture(id);
      if (!state) return;
      const copy = exportSecurityJournal(state);
      output.value = copy;
      revision = copy;
      shown = true;
      notice.textContent = "表示時点の記録です。必要な場合に内容を確認してコピーしてください。";
      present(state);
    } catch { unavailable(id); }
  }
  function hide() {
    if (disposed) return;
    generation++;
    output.value = "";
    shown = false;
    notice.textContent = "記録の表示を閉じました。";
    render();
  }
  prepare.addEventListener("click", show);
  close.addEventListener("click", hide);
  render();
  return Object.freeze({ render, dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    prepare.removeEventListener("click", show);
    close.removeEventListener("click", hide);
    output.value = "";
    section.remove();
  } });
}
