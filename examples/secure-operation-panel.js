import { secureBackupRunner } from "../src/secure-backup-runner.js";
import { describeSecureOperation, describeSecureOperationCounts } from "../src/secure-backup-status.js";

/** Text only, no file payloads, password fields, downloads or network capability. */
export function mountSecureOperationPanel({ document, parent, runner = secureBackupRunner } = {}) {
  const section = document.createElement("section");
  section.className = "secure-operation-panel";
  section.setAttribute("aria-label", "暗号処理の保護状態");
  const heading = document.createElement("h4");
  heading.textContent = "暗号処理の保護状態";
  const status = document.createElement("p");
  status.className = "secure-operation-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const counts = document.createElement("p");
  counts.className = "secure-operation-counts";
  const note = document.createElement("p");
  note.textContent = "取り消しは結果の使用を止めます。ブラウザーが実行中の暗号計算を直ちに終了させるものではありません。件数はこのページ内だけの記録です。";
  section.append(heading, status, counts, note);
  parent.append(section);
  let disposed = false;
  let unsubscribe;
  function render(value) {
    if (disposed) return;
    status.textContent = describeSecureOperation(value);
    counts.textContent = describeSecureOperationCounts(value);
  }
  try {
    render(runner.state());
    unsubscribe = runner.subscribe(render);
  } catch { render(null); }
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      try { unsubscribe?.(); } catch {}
      section.remove();
    },
  });
}
