import { createPortfolioHistory } from "./portfolio-history.js";
import { describeHistoryImport } from "./history-review.js";

const OPERATIONS = Object.freeze({
  remove: "選択した記録の削除",
  clear: "全記録の消去",
  replace: "JSONによる置き換え",
});

/** A local, bounded explanation of a recovery. It is never an authorization. */
export function prepareHistoryRecoveryReport(history, recovery) {
  const state = recovery.state();
  if (!state.hasBackup || !OPERATIONS[state.kind]) throw Error("No recovery report available");
  const currentText = history.exportText();
  const archiveText = recovery.exportText();
  const previous = createPortfolioHistory();
  previous.importText(archiveText);
  const current = createPortfolioHistory();
  current.importText(currentText);
  const lines = [
    "操作前の履歴・復元確認レポート",
    "対象操作: " + OPERATIONS[state.kind],
    "控えの記録数: " + previous.state().size,
    "現在の記録数: " + current.state().size,
    "復元用控え: " + state.recoveryId,
    "現在の履歴版: " + state.currentRevision,
    state.canPreview
      ? "直接復元の確認が可能です。このレポートを出しても適用しません。"
      : "操作後に履歴が変わっています。直接復元せず、JSONを別途保存・確認してください。",
    "控えはページ内のメモリーだけにあります。ページを閉じると失われます。",
    "",
  ];
  if (state.canPreview) {
    lines.push(describeHistoryImport(currentText, archiveText, { replace: true }));
  } else {
    lines.push("以下は控えにある記録の一覧です。新しい履歴を置き換える指示ではありません。");
  }
  lines.push("", "操作前の記録（挿入順）:");
  previous.state().snapshots.forEach((row, index) => {
    lines.push((index + 1) + ". " + row.agent + " / " + row.account);
    lines.push("chain " + row.chainId + " / " + row.siteOrigin);
    lines.push("block " + row.blockNumber + " / hash " + row.blockHash);
    lines.push("ネイティブ残高（最小単位）: " + row.nativeBalanceBaseUnits);
    for (const token of row.holdings) {
      lines.push("契約 " + token.address + ": " +
        (token.hasCode ? token.balanceBaseUnits : "未確認（契約コードなし）"));
    }
  });
  lines.push("", "履歴は過去の観測値です。現在残高・所有権・利益・独立監査を証明しません。",
    "この操作でWallet接続・署名・送金は行いません。適用には別の確認操作が必要です。");
  return Object.freeze({
    text: lines.join("\n"),
    recoveryId: state.recoveryId,
    currentRevision: state.currentRevision,
    canRestoreDirectly: state.canPreview,
    historicalObservation: true,
    canAuthorizeConnection: false,
    canAuthorizeTransaction: false,
    securityAudit: false,
  });
}
