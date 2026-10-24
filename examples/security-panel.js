import { createSecurityLock } from "../src/security-lock.js";
import { createSecurityJournal } from "../src/security-journal.js";
import { mountSecurityJournalPanel } from "./security-journal-panel.js";

const reasons = Object.freeze({ manual: "操作により", idle: "一定時間操作がなかったため",
  hidden: "画面を離れたため", "page-exit": "ページを離れたため",
  clock: "待機時間を確認できなかったため", disposed: "画面を終了したため" });

export function mountSecurityPanel({ document, parent, eventTarget, onLock = () => {},
  onChange = () => {}, lockOptions = {} }) {
  const section = document.createElement("section");
  section.className = "security-panel";
  section.setAttribute("aria-label", "ウォレット接続の保護");
  function node(tag, name, text, host = section) {
    const element = document.createElement(tag);
    element.className = "security-" + name;
    if (text) element.textContent = text;
    host.append(element);
    return element;
  }
  node("h2", "heading", "ウォレット接続を保護する");
  node("p", "explanation", "読み取りを止めたいときは、3トークンの接続をまとめて停止できます。");
  const status = node("p", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const label = node("label", "idle-label", "操作がない場合に接続を停止するまでの時間");
  const idle = node("select", "idle", null, label);
  for (const [text, value] of [["1分", 60_000], ["5分", 300_000], ["15分", 900_000]]) {
    const option = node("option", "idle-option", text, idle);
    option.value = String(value);
  }
  const hideLabel = node("label", "hidden-label");
  const hide = node("input", "hidden", null, hideLabel);
  hide.type = "checkbox";
  hide.checked = true;
  node("span", "hidden-text", "別のタブや画面へ移ったときも接続を停止する", hideLabel);
  const stop = node("button", "stop", "3トークンの接続を停止");
  const resume = node("button", "resume", "接続操作を再開する");
  stop.type = resume.type = "button";
  node("p", "scope", "再開した後は各トークンで接続し直してください。保存した履歴は残ります。Wallet拡張機能自体のロックや接続許可の取り消しは、Wallet側で行ってください。");
  node("p", "policy", "この画面から送金・署名・トークン承認は行いません。通常の保存ファイルは暗号化されていないため、共有先を確認してください。一括バックアップは合言葉付き保存を選べます。");
  parent.append(section);
  const listeners = [];
  let disposed = false;
  const journal = createSecurityJournal();
  journal.record("ready");
  let journalPanel = null;
  let previousLocked = false;
  const lock = createSecurityLock({ ...lockOptions, onLock,
    onChange(state) {
      if (state.locked !== previousLocked) {
        journal.record(state.locked ? state.reason : "resumed");
        previousLocked = state.locked;
      }
      render(state);
      journalPanel?.render();
      onChange(state);
    },
  });
  function render(state) {
    status.textContent = state.locked
      ? (reasons[state.reason] ?? "保護のため") + "、接続を停止しました。"
      : "接続操作を受け付けています。読み取りには各トークンの接続が必要です。";
    stop.disabled = state.locked || state.disposed;
    resume.disabled = !state.locked || state.disposed;
    idle.value = String(state.idleMs);
    section.setAttribute("data-locked", String(state.locked));
  }
  function listen(target, type, callback, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  }
  listen(stop, "click", () => lock.lock());
  listen(resume, "click", () => lock.unlock());
  listen(idle, "change", () => {
    const next = Number(idle.value), previous = lock.state().idleMs;
    if (lock.configure(next) && next !== previous) journal.record("idle-policy", { idleMs: next });
    journalPanel.render();
  });
  listen(hide, "change", () => {
    journal.record("hidden-policy", { enabled: hide.checked });
    journalPanel.render();
  });
  for (const name of ["pointerdown", "keydown"]) listen(eventTarget, name, event => {
    // A script-generated event cannot keep an unattended session alive.
    if (event.isTrusted) lock.activity();
  }, { capture: true });
  listen(document, "visibilitychange", () => {
    if (hide.checked && document.visibilityState === "hidden") lock.lock("hidden");
    else lock.check();
  });
  listen(eventTarget, "pagehide", () => lock.lock("page-exit"));
  listen(eventTarget, "pageshow", () => lock.check());
  render(lock.state());
  journalPanel = mountSecurityJournalPanel({ document, parent: section, journal });
  return Object.freeze({
    check: lock.check,
    state: lock.state,
    lock: lock.lock,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const remove of listeners) remove();
      lock.dispose();
      journalPanel.dispose();
      journal.dispose();
      section.remove();
    },
  });
}
