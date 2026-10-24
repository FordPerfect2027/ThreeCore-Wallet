import { securityJournalRows, exportSecurityJournal } from "../src/security-journal.js";

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
  function render() {
    if (disposed) return;
    const state = journal.state();
    list.replaceChildren();
    for (const row of securityJournalRows(state)) node("li", "event", "#" + row.sequence + " " + row.text, list);
    summary.textContent = "この画面で " + state.total + " 件。直近 " + Math.min(state.events.length, 8) +
      " 件を表示しています。" + (state.dropped ? "古い " + state.dropped + " 件の詳細は保持していません。" : "");
    if (shown && revision !== state.total) {
      output.value = "";
      shown = false;
      notice.textContent = "新しい記録があります。もう一度表示してください。";
    }
    label.hidden = close.hidden = !shown;
    prepare.disabled = state.disposed;
  }
  function show() {
    if (disposed) return;
    const state = journal.state();
    output.value = exportSecurityJournal(state);
    revision = state.total;
    shown = true;
    notice.textContent = "表示時点の記録です。必要な場合に内容を確認してコピーしてください。";
    render();
  }
  function hide() {
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
    prepare.removeEventListener("click", show);
    close.removeEventListener("click", hide);
    output.value = "";
    section.remove();
  } });
}
