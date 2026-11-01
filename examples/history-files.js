import { offerWalletDownload } from "./export-download.js";
import { readSecurityFileBytes, readFormatFileName } from "../src/security-file.js";
import { createHistoryFileReader } from "../src/history-file-reader.js";
import { prepareHistoryDownload, createHistoryBackupTracker, preparePortfolioReportsHistory, prepareHistoryArchives, HISTORY_REPORT_FILE_LIMIT, HISTORY_REPORT_BATCH_LIMIT, HISTORY_ARCHIVE_FILE_LIMIT, HISTORY_ARCHIVE_BATCH_LIMIT } from "../src/history-file.js";
import { readOwnErrorCode } from "../src/provider-error.js";
import { validatePortfolioSnapshot } from "../src/portfolio-report.js";
import { exportFilteredHistory, queryPortfolioHistory, prepareHistoryPrune, prepareHistoryRetention, portfolioHistoryCSV, encodeHistoryQueryFile, decodeHistoryQueryFile, HISTORY_QUERY_FILE_LIMIT } from "../src/history-query.js";
import { consumeCallback, observeCallbackResult } from "../src/security-callback.js";

/** Browser file actions are explicit and scoped to one agent card. */
export function mountHistoryFiles({ document, parent, agent, getArchive, getRevision, onImportText, onReadStart = () => {},
  onSelectRecord = null, onPrune = null,
  readBytes = readSecurityFileBytes,
  download = offerHistoryDownload }) {
  const cleanup = [];
  let disposed = false;
  let view = null, pruneProposal = null;
  let generation = 0, updatingBackup = false;
  let reportBatch = null, queryRead = null;
  const current = id => !disposed && generation === id;
  function source(read, id) {
    if (!current(id)) throw Error("File action retired");
    const value = read(), kind = observeCallbackResult(value);
    if (!current(id) || kind !== "synchronous") throw Error("Synchronous source required");
    return value;
  }
  function capture(id) {
    const revision = source(getRevision, id), archive = source(getArchive, id);
    if (revision !== source(getRevision, id)) throw Error("History changed");
    return { revision, archive };
  }
  function matches(value, id) {
    return value.revision === source(getRevision, id) && value.archive === source(getArchive, id) &&
      value.revision === source(getRevision, id) && current(id);
  }
  function deliver(prepared, id) {
    const receipt = source(() => download({ document, prepared }), id);
    if (receipt === false) throw Error("Download refused");
    return current(id);
  }
  const backup = createHistoryBackupTracker();
  const section = document.createElement("section");
  section.className = "history-files";
  function node(tag, name, text) {
    const value = document.createElement(tag);
    value.className = name;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  function listen(target, event, action) {
    const handler = (...args) => { if (!disposed) return action(...args); };
    target.addEventListener(event, handler);
    cleanup.push(() => target.removeEventListener(event, handler));
  }
  function button(name, text, action) {
    const value = node("button", name + " secondary", text);
    value.type = "button";
    listen(value, "click", () => {
      if (disposed) return;
      stopReportBatch();
      stopQueryRead();
      if (name !== "history-prune-preview" && name !== "history-prune-apply") invalidatePrune();
      const id = ++generation;
      try { return action(id); }
      catch { if (current(id)) status.textContent = "操作できませんでした。入力とブラウザーの保存設定を確認してください。履歴は変更していません。"; }
    });
    return value;
  }
  function labelled(text, value) {
    const label = node("label", "", text);
    label.append(value);
    return label;
  }
  const heading = node("h4", "", "ファイルへ保存・ファイルから読み込み");
  const explanation = node("p", "notice", "URLのコピーでは履歴は保存されません。「履歴ファイルをダウンロード」でJSONファイルを保存できます。公開アドレスと残高を含みます。保存先や完了はブラウザーで確認してください。");
  const status = node("p", "history-file-status", "ファイル操作はまだ行っていません。");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const backupState = node("p", "history-backup-state");
  const file = node("input", "history-file-input");
  file.type = "file";
  file.accept = ".json,application/json";
  file.setAttribute("aria-label", "読み込む履歴JSONファイル");
  const reportFiles = node("input", "history-report-files"); reportFiles.type = "file"; reportFiles.accept = ".json,application/json"; reportFiles.multiple = true;
  reportFiles.setAttribute("aria-label", "履歴候補にまとめる確認記録JSONファイル（最大64件）");
  const archiveFiles = node("input", "history-archive-files"); archiveFiles.type = "file"; archiveFiles.accept = ".json,application/json"; archiveFiles.multiple = true;
  archiveFiles.setAttribute("aria-label", "まとめる履歴JSONファイル（最大16件）");
  function reportControls() {
    const busy = Boolean(reportBatch); reportFiles.disabled = busy || reader.state().phase === "reading";
    archiveFiles.disabled = reportFiles.disabled;
    reportCancel.disabled = !busy; file.disabled = busy || reader.state().phase === "reading";
    reportFiles.setAttribute("aria-busy", String(busy));
    archiveFiles.setAttribute("aria-busy", String(busy));
  }
  function stopReportBatch() {
    const previous = reportBatch; if (!previous) return;
    reportBatch = null; const id = ++generation; previous.abort(); reportControls();
    if (current(id) && !reportBatch) status.textContent = "ファイルのまとめ読みを中止しました。履歴は変更していません。";
  }
  const FILE_ERRORS = Object.freeze({
    FILE_SIZE: "空のファイル、または大きすぎるファイルです。",
    FILE_NAME: "拡張子が.jsonのファイルを選んでください。",
    FILE_ENCODING: "UTF-8形式のJSONファイルを選んでください。",
    AGENT_MISMATCH: "別のトークンの履歴です。このカードには読み込めません。",
    INVALID_FILE: "履歴ファイルの形式が正しくありません。",
    INVALID_AGENT: "カードの種類を確認してください。",
  });
  const reader = createHistoryFileReader({ agent, readBytes, onChange(state) {
    if (disposed) return;
    const id = generation;
    const owns = () => current(id) && reader.state() === state;
    file.disabled = state.phase === "reading" || Boolean(reportBatch);
    reportFiles.disabled = state.phase === "reading" || Boolean(reportBatch);
    archiveFiles.disabled = reportFiles.disabled;
    cancel.disabled = state.phase !== "reading";
    if (state.phase === "reading") consumeCallback(onReadStart);
    if (!owns()) return;
    if (state.phase === "reading") status.textContent = "履歴ファイルを確認しています。まだ履歴は変更していません。";
    if (state.phase === "ready") {
      try {
        const receipt = onImportText(state.result.text);
        const kind = observeCallbackResult(receipt);
        if (!owns()) return;
        if (kind !== "synchronous" || receipt === false) throw Error("Import handoff refused");
      } catch {
        if (owns()) status.textContent = "ファイルは確認できましたが、入力欄への読み込みは完了しませんでした。履歴は変更していません。";
        return;
      }
      status.textContent = state.result.observationCount + "件の履歴JSONを入力欄へ読み込みました。下のプレビューで確認してから適用してください。まだ履歴は変更していません。";
    }
    if (state.phase === "error") status.textContent = (FILE_ERRORS[state.errorCode] ?? FILE_ERRORS.INVALID_FILE) + " 既存履歴は保持しています。";
    if (state.phase === "cancelled") status.textContent = "ファイルの読み込みをキャンセルしました。履歴は変更していません。";
  } });
  const cancel = button("history-file-cancel", "ファイル読み込みをキャンセル", id => {
    reader.cancel();
    if (current(id)) file.value = "";
  });
  cancel.disabled = true;
  const reportCancel = button("history-report-cancel", "ファイルのまとめ読みを中止", () => {
    status.textContent = "ファイルのまとめ読みを中止しました。入力欄と履歴は保持しています。";
  }); reportCancel.disabled = true;
  function batchPicker(input, { countLimit, fileLimit, totalLimit, prepare, kind, limits }) { listen(input, "change", () => {
    const files = input.files, count = files?.length; observeCallbackResult(count); if (!files || count === 0) return;
    stopReportBatch(); stopQueryRead(); const id = ++generation; reader.reset(); if (!current(id)) return;
    invalidatePrune();
    let selected = [];
    try {
      if (!Number.isSafeInteger(count) || count < 1 || count > countLimit) throw Error("Batch size");
      let total = 0;
      for (let index = 0; index < count; index++) {
        const chosen = files[index]; readFormatFileName(chosen, { maxLength: 255, fail: () => { throw Error("File name"); }, code: "FILE_NAME" });
        if (!current(id)) return; const size = chosen.size; observeCallbackResult(size); if (!current(id)) return;
        if (!Number.isSafeInteger(size) || size < 1 || size > fileLimit || (total += size) > totalLimit) throw Error("Batch size");
        selected.push({ file: chosen, size });
      }
    } catch { if (current(id)) status.textContent = kind + "JSONを" + limits + "以内で選んでください。履歴は変更していません。"; input.value = ""; return; }
    if (!current(id)) return; input.value = "";
    const local = new AbortController(); reportBatch = local; reportControls();
    const owns = () => current(id) && reportBatch === local && !local.signal.aborted;
    let completed = 0, handedOff = false; const started = performance.now();
    void (async () => { try {
      const captured = capture(id); consumeCallback(onReadStart); if (!owns()) return;
      const texts = [];
      for (const selectedFile of selected) {
        const remaining = Math.floor(30000 - (performance.now() - started)); if (remaining < 1) throw Error("Batch timeout");
        status.textContent = `${kind}の読み込み: ${completed}／${selected.length}件。履歴は変更していません。`;
        const bytes = await readBytes(selectedFile.file, { maxBytes: fileLimit, timeoutMs: remaining, signal: local.signal });
        if (!owns()) return;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== selectedFile.size) throw Error("Changed file");
        texts.push(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); completed++;
      }
      if (!owns() || performance.now() - started >= 30000) throw Error("Batch timeout");
      const prepared = prepare(texts, agent);
      if (!owns()) return;
      if (performance.now() - started >= 30000 || !matches(captured, id)) throw Error("Batch expired or history changed");
      handedOff = true; const receipt = onImportText(prepared.text), callbackKind = observeCallbackResult(receipt);
      if (!owns() || !matches(captured, id)) return;
      if (callbackKind !== "synchronous" || receipt === false) throw Error("Unconfirmed handoff");
      status.textContent = `${prepared.sourceCount}ファイルから${prepared.observationCount}件の履歴候補を入力欄へ準備しました（重複${prepared.duplicateCount}件）。プレビュー後に適用してください。履歴はまだ変更していません。`;
    } catch (error) {
      if (!owns()) return; const code = readOwnErrorCode(error); if (!owns()) return;
      const reason = code === "AGENT_MISMATCH" ? "別のカードの記録が含まれています。" : code === "OBSERVATION_CONFLICT" ? "同じ対象・ブロックの記録が矛盾しています。" : "形式・サイズ・読み込みを確認してください。";
      status.textContent = `${kind}をまとめられませんでした（読み込み${completed}／${selected.length}件）。${reason}` + (handedOff ? "入力欄の内容を確認してください。履歴は自動変更していません。" : "入力欄と履歴は保持しています。");
    } finally { if (reportBatch === local) { reportBatch = null; local.abort(); reportControls(); } } })();
  }); }
  batchPicker(reportFiles, { countLimit: 64, fileLimit: HISTORY_REPORT_FILE_LIMIT, totalLimit: HISTORY_REPORT_BATCH_LIMIT, prepare: preparePortfolioReportsHistory, kind: "確認記録", limits: "1〜64件、各64 KiB・合計1 MiB" });
  batchPicker(archiveFiles, { countLimit: 16, fileLimit: HISTORY_ARCHIVE_FILE_LIMIT, totalLimit: HISTORY_ARCHIVE_BATCH_LIMIT, prepare: prepareHistoryArchives, kind: "履歴ファイル", limits: "1〜16件、各1 MiB・合計4 MiB" });
  listen(file, "change", () => {
    if (disposed) return;
    stopReportBatch();
    stopQueryRead();
    const id = ++generation;
    const files = file.files;
    if (!current(id)) return;
    if (!files || files.length === 0) return;
    if (files.length !== 1) {
      reader.reset();
      if (current(id)) status.textContent = "一度に1つの履歴JSONファイルを選んでください。";
      return;
    }
    const selected = files[0];
    file.value = "";
    return reader.load(selected);
  });
  function updateBackup(id = generation) {
    if (!current(id)) return false;
    backupState.textContent = "履歴の保存状態を確認できていません。";
    if (updatingBackup) return false;
    updatingBackup = true;
    try {
      const state = backup.state(source(getRevision, id));
      if (!current(id)) return false;
      backupState.textContent = state.currentDownloadOffered
        ? "現在の履歴のダウンロードを開始済みです。PCへの保存完了はブラウザーで確認してください。"
        : "現在の履歴は、この画面からまだファイルとしてダウンロードしていません。";
      return true;
    } catch { return false; }
    finally { updatingBackup = false; }
  }
  const save = button("history-file-save", "履歴ファイルをダウンロード", id => {
    const captured = capture(id), { revision } = captured;
    const prepared = prepareHistoryDownload(captured.archive, agent, revision);
    if (!matches(captured, id)) throw Error("History changed");
    if (!deliver(prepared, id)) return;
    backup.offered(revision);
    updateBackup(id);
    if (!current(id)) return;
    status.textContent = prepared.filename + " のダウンロードを開始しました。保存先を確認してください。";
  });
  const filterHeading = node("h4", "", "履歴の絞り込み・一部だけ保存");
  const tokenAddress = node("input", "history-filter-token"); tokenAddress.type = "text"; tokenAddress.maxLength = 42; tokenAddress.spellcheck = false;
  tokenAddress.setAttribute("aria-label", "履歴を絞るトークン契約アドレス");
  const tokenStatus = node("select", "history-filter-token-status");
  for (const [value, text] of [["any", "この契約を確認した記録すべて"], ["known", "残高を読み取れた記録（0を含む）"], ["unknown", "契約コードがなく残高不明の記録"], ["not-observed", "この契約を確認していない記録"]]) { const option = node("option", "", text); option.value = value; tokenStatus.append(option); }
  tokenStatus.value = "any";
  const account = node("input", "history-filter-account");
  account.type = "text";
  account.maxLength = 42;
  account.spellcheck = false;
  account.setAttribute("aria-label", "履歴を絞る公開アドレス");
  const chain = node("input", "history-filter-chain");
  chain.type = "text";
  chain.inputMode = "numeric";
  chain.maxLength = 16;
  chain.setAttribute("aria-label", "履歴を絞るチェーンID");
  const origin = node("input", "history-filter-origin"); origin.type = "text"; origin.maxLength = 65536; origin.spellcheck = false;
  origin.setAttribute("aria-label", "履歴を絞るサイトのオリジン（URLの先頭部分）");
  const minimum = node("input", "history-filter-minimum");
  minimum.type = "text";
  minimum.inputMode = "numeric";
  minimum.maxLength = 78;
  minimum.setAttribute("aria-label", "履歴の最小ブロック");
  const maximum = node("input", "history-filter-maximum");
  maximum.type = "text";
  maximum.inputMode = "numeric";
  maximum.maxLength = 78;
  maximum.setAttribute("aria-label", "履歴の最大ブロック");
  const order = node("select", "history-filter-order");
  for (const [value, text] of [["oldest", "古いブロックから"], ["newest", "新しいブロックから"]]) {
    const option = node("option", "", text);
    option.value = value;
    order.append(option);
  }
  order.value = "oldest";
  const results = node("pre", "history-filter-results");
  results.setAttribute("tabindex", "-1"); results.setAttribute("aria-label", "絞り込んだ保存履歴");
  const rowActions = node("ol", "history-filter-actions"); rowActions.hidden = typeof onSelectRecord !== "function";
  let rowCleanup = [];
  function clearRows() { for (const stop of rowCleanup) stop(); rowCleanup = []; rowActions.replaceChildren(); }
  function renderRows(selected, rows) {
    clearRows(); if (typeof onSelectRecord !== "function") return;
    for (const { snapshot, index } of rows) {
      const item = node("li", "history-filter-action-row", snapshot.agent + " / " + snapshot.account + " / chain " + snapshot.chainId + " / " + snapshot.siteOrigin + " / block " + snapshot.blockNumber);
      for (const [side, caption] of [["before", "前の記録に選ぶ"], ["after", "後の記録・削除対象に選ぶ"]]) {
        const control = node("button", "history-filter-select-" + side + " secondary", caption); control.type = "button";
        const action = () => {
          if (disposed || view !== selected) return; const id = ++generation;
          try { if (!matches(selected, id) || JSON.stringify(selected.criteria) !== JSON.stringify(query())) throw Error("Search changed");
            const receipt = onSelectRecord(Object.freeze({ index, side, revision: selected.revision, archive: selected.archive })), kind = observeCallbackResult(receipt);
            if (!current(id) || view !== selected) return;
            if (kind !== "synchronous" || receipt !== true || !matches(selected, id)) throw Error("Selection unconfirmed");
            status.textContent = caption.replace("選ぶ", "選びました") + "。比較・削除は実行していません。";
          } catch { if (current(id) && view === selected) status.textContent = "記録の選択を確認できませんでした。条件と履歴をもう一度確認してください。"; }
        };
        control.addEventListener("click", action); rowCleanup.push(() => control.removeEventListener("click", action)); item.append(control);
      }
      rowActions.append(item);
    }
  }
  function query() {
    const chainText = chain.value.trim();
    if (chainText && !/^[1-9][0-9]*$/.test(chainText)) throw Error("Invalid chain");
    return {
      account: account.value.trim(),
      chainId: chainText === "" ? "" : Number(chainText),
      minimumBlock: minimum.value.trim(),
      maximumBlock: maximum.value.trim(),
      order: order.value,
      tokenAddress: tokenAddress.value.trim(), tokenStatus: tokenStatus.value,
      siteOrigin: origin.value.trim(),
    };
  }
  function invalidateView() {
    stopQueryRead();
    invalidatePrune();
    clearRows();
    view = null;
    results.textContent = "";
    saveSubset.disabled = true;
    saveBalances.disabled = true;
  }
  function searchHistory(id) {
    invalidateView();
    const criteria = query();
    const captured = capture(id);
    const result = queryPortfolioHistory(captured.archive, criteria);
    if (!matches(captured, id)) throw Error("History changed");
    view = { ...captured, criteria };
    renderRows(view, result.rows);
    results.textContent = result.matchCount + " / " + result.totalCount + "件\n" + result.rows.map(({ snapshot }) =>
      snapshot.agent + " / " + snapshot.account + " / chain " + snapshot.chainId + " / " + snapshot.siteOrigin + " / block " + snapshot.blockNumber).join("\n");
    saveSubset.disabled = result.matchCount === 0;
    saveBalances.disabled = result.matchCount === 0;
  }
  const search = button("history-filter-run", "条件に合う履歴を表示", searchHistory);
  const saveSubset = button("history-file-save-subset", "表示した履歴だけダウンロード", id => {
    const selected = view;
    if (!selected || !matches(selected, id) || JSON.stringify(selected.criteria) !== JSON.stringify(query())) throw Error("Review changed history");
    const subset = exportFilteredHistory(selected.archive, selected.criteria);
    const prepared = prepareHistoryDownload(subset.text, agent, selected.revision);
    if (!deliver(Object.freeze({ ...prepared, filename: prepared.filename.replace(".json", "-filtered.json") }), id)) return;
    // A partial export does not mark the full collection as backed up.
    status.textContent = subset.exportedCount + "件だけのファイルをダウンロード開始しました。全履歴の保存ではありません。";
  });
  saveSubset.disabled = true;
  const saveBalances = button("history-file-save-balances", "表示した記録の残高をCSVで保存", id => {
    const selected = view;
    if (!selected || !matches(selected, id) || JSON.stringify(selected.criteria) !== JSON.stringify(query())) throw Error("Search changed");
    const prepared = portfolioHistoryCSV(selected.archive, selected.criteria);
    if (!matches(selected, id) || !deliver(prepared, id)) return;
    status.textContent = `${prepared.observationCount}記録・${prepared.balanceRows}残高行のCSV保存を開始しました。条件に合う記録内の全契約を含みます。復元用にはJSONも保存してください。`;
  }); saveBalances.disabled = true;
  const pruneDetails = node("pre", "history-prune-details"); pruneDetails.setAttribute("tabindex", "-1");
  const pruneConfirm = node("input", "history-prune-confirm"); pruneConfirm.type = "checkbox";
  const keepCount = node("input", "history-retain-count"); keepCount.type = "text"; keepCount.inputMode = "numeric"; keepCount.maxLength = 2; keepCount.value = "1";
  function invalidatePrune() { pruneProposal = null; pruneDetails.textContent = ""; pruneConfirm.checked = false; pruneApply.disabled = true; }
  function reviewPrune(id, mode) {
    invalidatePrune(); reader.reset(); const selected = view;
    if (typeof onPrune !== "function" || !selected || !matches(selected, id) || JSON.stringify(selected.criteria) !== JSON.stringify(query())) throw Error("Search required");
    const keepText = keepCount.value;
    if (mode === "retention" && !/^[1-9][0-9]?$/.test(keepText)) throw Error("Invalid retention count");
    const prepared = mode === "retention" ? prepareHistoryRetention(selected.archive, selected.criteria, Number(keepText)) : prepareHistoryPrune(selected.archive, selected.criteria);
    if (!matches(selected, id)) throw Error("History changed");
    pruneProposal = { ...selected, prepared, mode, keepText };
    const removed = new Set(prepared.removedIndices);
    pruneDetails.textContent = (mode === "retention" ? `表示した記録内で、同じエージェント・アカウント・チェーン・サイトごとに新しい${keepText}件を残します。\n` : "") + `削除予定${prepared.removedCount}件 / 残す記録${prepared.remainingCount}件。まだ変更していません。\n` +
      queryPortfolioHistory(selected.archive, selected.criteria).rows.filter(row => removed.has(row.index)).map(({ snapshot, index }) => `元の位置${index}: ${snapshot.account} / chain ${snapshot.chainId} / ${snapshot.siteOrigin} / block ${snapshot.blockNumber}`).join("\n") +
      "\n必要な履歴は先にファイルへ保存してください。適用後は直前の履歴を復元できます。ページを閉じると復元用データも消えます。";
    status.textContent = "削除予定を表示しました。内容を確認し、確認欄を選んでから適用してください。";
    if (current(id)) { try { pruneDetails.focus?.(); } catch {} }
  }
  const prunePreview = button("history-prune-preview", "表示した記録の削除予定を確認", id => reviewPrune(id, "matches"));
  const retainPreview = button("history-retain-preview", "対象ごとに新しい記録を残す整理案を確認", id => reviewPrune(id, "retention"));
  const pruneApply = button("history-prune-apply", "確認した記録だけ削除", id => {
    const proposal = pruneProposal;
    if (!pruneConfirm.checked || !proposal || !matches(proposal, id) || JSON.stringify(proposal.criteria) !== JSON.stringify(query())) { invalidatePrune(); throw Error("New review required"); }
    if (proposal.mode === "retention" && proposal.keepText !== keepCount.value) { invalidatePrune(); throw Error("Retention count changed"); }
    const prepared = proposal.mode === "retention" ? prepareHistoryRetention(proposal.archive, proposal.criteria, Number(proposal.keepText)) : prepareHistoryPrune(proposal.archive, proposal.criteria);
    if (prepared.text !== proposal.prepared.text || !matches(proposal, id) || proposal !== pruneProposal) { invalidatePrune(); throw Error("Stale deletion"); }
    invalidatePrune();
    try {
      const receipt = onPrune(Object.freeze({ archive: proposal.archive, revision: proposal.revision, criteria: Object.freeze({ ...proposal.criteria }), text: prepared.text, mode: proposal.mode, keepCount: prepared.keepCount ?? null })), kind = observeCallbackResult(receipt);
      if (!current(id)) return;
      if (kind !== "synchronous" || receipt !== true) throw Error("Unconfirmed deletion");
    } catch { if (current(id)) status.textContent = "削除結果を確認できませんでした。現在の履歴と復元欄を確認してください。"; return; }
    invalidateView(); status.textContent = prepared.removedCount + "件の削除を確認しました。直前の履歴は復元欄で確認できます。";
  }); pruneApply.disabled = true;
  listen(pruneConfirm, "change", () => { pruneApply.disabled = !pruneConfirm.checked || !pruneProposal; });
  listen(keepCount, "input", invalidatePrune);
  const pruneSection = node("section", "history-prune"); pruneSection.hidden = typeof onPrune !== "function";
  pruneSection.append(node("p", "notice", "容量整理: 条件で絞った一部の記録だけを削除します。全件の消去は上の専用確認欄で行ってください。"), prunePreview,
    labelled("対象ごとに残す新しい保存記録の数（1〜64件）", keepCount), retainPreview,
    node("p", "notice", "整理案は表示した記録だけが対象です。条件に合わない記録は残します。「新しい」は保存記録のブロック番号順で、現在の残高を保証しません。"), pruneDetails,
    labelled("表示した記録をこの履歴から削除することを確認", pruneConfirm), pruneApply);
  const resetFilters = button("history-filter-reset", "絞り込み条件を消去", () => {
    for (const input of [account, chain, minimum, maximum, tokenAddress, origin]) input.value = "";
    order.value = "oldest";
    tokenStatus.value = "any";
    invalidateView();
  });
  const queryDraft = node("textarea", "history-query-json"); queryDraft.rows = 3; queryDraft.maxLength = HISTORY_QUERY_FILE_LIMIT; queryDraft.spellcheck = false;
  queryDraft.setAttribute("aria-label", "保存した検索条件JSON（履歴データではありません）");
  const queryFile = node("input", "history-query-file"); queryFile.type = "file"; queryFile.accept = ".json,application/json";
  const queryStop = button("history-query-stop", "検索条件の読み込みを中止", () => { status.textContent = "検索条件の読み込みを中止しました。条件と履歴は保持しています。"; }); queryStop.disabled = true;
  function stopQueryRead() { const old = queryRead; if (!old) return; queryRead = null; old.abort(); queryFile.disabled = false; queryStop.disabled = true; }
  const querySave = button("history-query-save", "現在の検索条件をファイル保存", id => {
    const criteria = query(), text = encodeHistoryQueryFile(criteria); queryDraft.value = text;
    if (JSON.stringify(criteria) !== JSON.stringify(query()) || !deliver({ text, filename: "ThreeCore-history-query.json", mimeType: "application/json;charset=utf-8" }, id)) return;
    status.textContent = "検索条件の保存を開始しました。公開アドレスを含む場合があります。履歴や残高のバックアップではありません。";
  });
  const queryUse = button("history-query-use", "確認した検索条件を使って検索", id => {
    const criteria = decodeHistoryQueryFile(queryDraft.value);
    if (!current(id)) return;
    account.value = criteria.account; chain.value = criteria.chainId === "" ? "" : String(criteria.chainId); origin.value = criteria.siteOrigin;
    minimum.value = criteria.minimumBlock ?? ""; maximum.value = criteria.maximumBlock ?? ""; order.value = criteria.order;
    tokenAddress.value = criteria.tokenAddress; tokenStatus.value = criteria.tokenStatus;
    searchHistory(id); if (!current(id)) return;
    status.textContent = "保存した条件で現在の履歴を検索しました。元ファイル作成時と同じ結果であることは保証しません。履歴は変更していません。";
    try { results.focus?.(); } catch {}
  });
  listen(queryDraft, "input", () => { stopQueryRead(); generation++; });
  listen(queryFile, "change", () => {
    const files = queryFile.files; if (!files || files.length === 0) return;
    stopQueryRead(); stopReportBatch(); const id = ++generation; reader.reset(); if (!current(id)) return; invalidatePrune();
    if (files.length !== 1) { status.textContent = "検索条件JSONは一度に1ファイル選んでください。"; return; }
    const chosen = files[0]; queryFile.value = "";
    const local = new AbortController(); queryRead = local; queryFile.disabled = true; queryStop.disabled = false;
    status.textContent = "検索条件ファイルを確認しています。現在の条件と履歴は変更しません。";
    void (async () => { try {
      readFormatFileName(chosen, { maxLength: 255, fail: () => { throw Error("Name"); }, code: "FILE_NAME" });
      if (!current(id) || queryRead !== local || local.signal.aborted) return;
      const bytes = await readBytes(chosen, { maxBytes: HISTORY_QUERY_FILE_LIMIT, signal: local.signal, timeoutMs: 30000 });
      if (!current(id) || queryRead !== local || local.signal.aborted) return;
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), criteria = decodeHistoryQueryFile(text);
      if (!current(id) || queryRead !== local) return;
      queryDraft.value = encodeHistoryQueryFile(criteria);
      status.textContent = "検索条件を確認欄へ読み込みました。「確認した検索条件を使って検索」で反映してください。履歴は変更していません。";
    } catch { if (current(id) && queryRead === local) status.textContent = "検索条件を読み込めませんでした。64 KiB以内の検索条件JSONを確認してください。元の入力と履歴は保持しています。"; }
    finally { if (queryRead === local) stopQueryRead(); } })();
  });
  const changedFilter = () => { stopReportBatch(); generation++; invalidateView(); };
  for (const input of [account, chain, minimum, maximum, tokenAddress, origin]) listen(input, "input", changedFilter);
  listen(order, "change", changedFilter);
  listen(tokenStatus, "change", changedFilter);
  section.append(heading, explanation, save, backupState,
    labelled("保存した履歴JSONファイルを選択", file), cancel, status,
    labelled("個別の確認記録をまとめて履歴候補にする（最大64件・各64 KiB・合計1 MiB）", reportFiles),
    labelled("複数の履歴ファイルをまとめて候補にする（最大16件・各1 MiB・合計4 MiB）", archiveFiles), reportCancel,
    filterHeading, labelled("公開アドレス（空欄ならすべて）", account),
    labelled("チェーンID（空欄ならすべて）", chain),
    labelled("サイト（例 https://example.com または http://localhost:4231・空欄ならすべて）", origin),
    labelled("トークン契約アドレス（空欄なら絞り込まない）", tokenAddress), labelled("その契約の確認状態（契約アドレスが必要）", tokenStatus),
    node("p", "notice", "条件に合う記録全体を選びます。保存ファイルには、その記録内の他の契約も含まれます。未確認や残高不明は残高0とは異なります。"),
    labelled("最小ブロック（空欄なら制限なし）", minimum),
    labelled("最大ブロック（空欄なら制限なし）", maximum),
    labelled("表示順", order), search, resetFilters, results, rowActions, saveSubset, saveBalances,
    node("p", "notice", "残高CSVは最小単位の文字列です。桁を保つため数値の先頭に ' を付けています。不明な残高は空欄とcode-missingで示し、0に置き換えません。復元にはJSONを使ってください。"),
    querySave, labelled("保存した検索条件ファイル（JSON・64 KiB）", queryFile), queryStop,
    labelled("読み込んだ検索条件の確認・貼り付け", queryDraft), queryUse, pruneSection);
  parent.append(section);
  updateBackup();
  return Object.freeze({
    filterIdentity(input) {
      if (disposed) return false; stopReportBatch(); const id = ++generation; reader.reset();
      try {
        if (!current(id)) return false; invalidateView(); const snapshot = validatePortfolioSnapshot(input); if (!current(id)) return false;
        if (snapshot.agent !== agent) throw Error("Different card");
        account.value = snapshot.account; chain.value = String(snapshot.chainId); origin.value = snapshot.siteOrigin;
        minimum.value = maximum.value = tokenAddress.value = ""; tokenStatus.value = "any"; order.value = "oldest";
        searchHistory(id); if (!current(id)) return false;
        status.textContent = "選択した記録と同じアカウント・チェーン・サイトで絞り込みました。履歴は変更していません。";
        try { results.focus?.(); } catch {}
        return current(id) && view !== null;
      } catch { if (current(id)) { invalidateView(); status.textContent = "同じ対象の検索を確認できませんでした。履歴を確認してください。"; } return false; }
    },
    invalidate() {
      if (disposed) return;
      stopReportBatch();
      const id = ++generation;
      reader.reset();
      if (!current(id)) return;
      invalidateView();
      updateBackup(id);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      stopQueryRead();
      stopReportBatch();
      reader.dispose();
      invalidatePrune();
      clearRows();
      for (const stop of cleanup) stop();
      section.remove();
    },
  });
}

/** Browser-owned download only: no filesystem path, network request or upload. */
export function offerHistoryDownload({ document, prepared }) {
  return offerWalletDownload({ document, prepared: prepared });
}

