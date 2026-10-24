import { createSecurityLock } from "../src/security-lock.js";
import { createSecurityJournal } from "../src/security-journal.js";
import { mountSecurityJournalPanel } from "./security-journal-panel.js";
import { mountTabGuardPanel } from "./tab-guard-panel.js";

const reasons = Object.freeze({ manual: "操作により", idle: "一定時間操作がなかったため",
  hidden: "画面を離れたため", "page-exit": "ページを離れたため",
  clock: "待機時間を確認できなかったため", disposed: "画面を終了したため",
  "broadcast-stop": "まとめて停止する操作により", "peer-stop": "他の画面からの停止通知により",
  "channel-error": "停止通知を確認できなかったため", "page-freeze": "ページが一時停止したため",
  "page-restored": "保存されたページを再表示したため" });

export function mountSecurityPanel({ document, parent, eventTarget, onLock = () => {},
  onChange = () => {}, canResume = () => true, lockOptions = {}, tabGuardOptions = {} }) {
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
  const cleanupWarning = node("p", "cleanup-warning");
  cleanupWarning.setAttribute("role", "alert");
  const cleanupRetry = node("button", "cleanup-retry", "表示の消去を再試行");
  cleanupRetry.type = "button";
  cleanupWarning.hidden = cleanupRetry.hidden = true;
  node("p", "scope", "再開した後は各トークンで接続し直してください。保存した履歴は残ります。Wallet拡張機能自体のロックや接続許可の取り消しは、Wallet側で行ってください。");
  node("p", "policy", "この画面から送金・署名・トークン承認は行いません。通常の保存ファイルは暗号化されていないため、共有先を確認してください。一括バックアップは合言葉付き保存を選べます。");
  parent.append(section);
  const listeners = [];
  let disposed = false;
  const journal = createSecurityJournal();
  journal.record("ready");
  let journalPanel = null;
  let previousLocked = false;
  let lastReportedReason = null;
  let protectionCompleted = true;
  function protect(state) {
    protectionCompleted = false;
    try {
      const result = onLock(state);
      if (result && typeof result.then === "function") {
        Promise.resolve(result).catch(() => {});
      } else protectionCompleted = result !== false;
    } catch { /* A closed access gate does not imply every view was cleaned. */ }
  }
  const lock = createSecurityLock({ ...lockOptions, onLock: protect,
    onChange(state) {
      if (state.locked !== previousLocked) {
        journal.record(state.locked ? state.reason : "resumed");
        lastReportedReason = state.locked ? state.reason : null;
        previousLocked = state.locked;
      }
      render(state);
      journalPanel?.render();
      onChange(state);
    },
  });
  function mayResume() {
    try {
      const value = canResume();
      if (value && typeof value.then === "function") Promise.resolve(value).catch(() => {});
      return value === true;
    } catch { return false; }
  }
  function render(state) {
    status.textContent = state.locked
      ? (reasons[state.reason] ?? "保護のため") + "、接続を停止しました。"
      : "接続操作を受け付けています。読み取りには各トークンの接続が必要です。";
    stop.disabled = state.locked || state.disposed;
    resume.disabled = !state.locked || state.disposed || !protectionCompleted || !mayResume();
    cleanupWarning.hidden = cleanupRetry.hidden = protectionCompleted;
    cleanupRetry.disabled = state.disposed;
    cleanupWarning.textContent = protectionCompleted ? "" :
      "読み取りは停止していますが、一部の表示の消去を確認できません。表示の消去を再試行してください。解決しない場合はこの画面を閉じてください。";
    idle.value = String(state.idleMs);
    section.setAttribute("data-locked", String(state.locked));
  }
  function listen(target, type, callback, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  }
  function protectAgain(reason = "manual") {
    if (disposed) return false;
    if (!lock.state().locked) return lock.lock(reason);
    protect(lock.state());
    // Repeat cleanup, but do not inflate history for repeated identical stops.
    if (reason !== lastReportedReason) {
      journal.record(reason);
      lastReportedReason = reason;
    }
    journalPanel.render();
    render(lock.state());
    return protectionCompleted;
  }
  listen(stop, "click", () => protectAgain());
  listen(cleanupRetry, "click", () => {
    if (!protectionCompleted && lock.state().locked) protectAgain();
  });
  let tabGuardPanel;
  listen(resume, "click", () => {
    if (protectionCompleted && mayResume() && tabGuardPanel.noteResume()) lock.unlock();
  });
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
    if (hide.checked && document.visibilityState === "hidden") protectAgain("hidden");
    else lock.check();
  });
  listen(eventTarget, "pagehide", () => protectAgain("page-exit"));
  listen(document, "freeze", () => protectAgain("page-freeze"));
  listen(eventTarget, "pageshow", event => {
    if (event.persisted === true) protectAgain("page-restored");
    else lock.check();
  });
  render(lock.state());
  journalPanel = mountSecurityJournalPanel({ document, parent: section, journal });
  tabGuardPanel = mountTabGuardPanel({ document, parent: section, options: tabGuardOptions,
    onStop(reason) {
      if (disposed) return false;
      // Even an already stopped screen may contain newly entered backup credentials.
      protectAgain(reason);
      return !disposed && !lock.state().canRead && protectionCompleted;
    } });
  return Object.freeze({
    check: lock.check,
    state: lock.state,
    lock: protectAgain,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const remove of listeners) remove();
      tabGuardPanel.dispose();
      lock.dispose();
      journalPanel.dispose();
      journal.dispose();
      section.remove();
    },
  });
}
