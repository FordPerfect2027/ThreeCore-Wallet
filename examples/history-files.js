import { offerWalletDownload } from "./export-download.js";
import { readSecurityFileBytes } from "../src/security-file.js";
import { createHistoryFileReader } from "../src/history-file-reader.js";
import { prepareHistoryDownload, createHistoryBackupTracker } from "../src/history-file.js";
import { exportFilteredHistory, queryPortfolioHistory } from "../src/history-query.js";
import { consumeCallback, observeCallbackResult } from "../src/security-callback.js";

/** Browser file actions are explicit and scoped to one agent card. */
export function mountHistoryFiles({ document, parent, agent, getArchive, getRevision, onImportText, onReadStart = () => {},
  readBytes = readSecurityFileBytes,
  download = offerHistoryDownload }) {
  const cleanup = [];
  let disposed = false;
  let view = null;
  let generation = 0, updatingBackup = false;
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
    file.disabled = state.phase === "reading";
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
  listen(file, "change", () => {
    if (disposed) return;
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
  function query() {
    const chainText = chain.value.trim();
    if (chainText && !/^[1-9][0-9]*$/.test(chainText)) throw Error("Invalid chain");
    return {
      account: account.value.trim(),
      chainId: chainText === "" ? "" : Number(chainText),
      minimumBlock: minimum.value.trim(),
      maximumBlock: maximum.value.trim(),
      order: order.value,
    };
  }
  function invalidateView() {
    view = null;
    results.textContent = "";
    saveSubset.disabled = true;
  }
  const search = button("history-filter-run", "条件に合う履歴を表示", id => {
    invalidateView();
    const criteria = query();
    const captured = capture(id);
    const result = queryPortfolioHistory(captured.archive, criteria);
    if (!matches(captured, id)) throw Error("History changed");
    view = { ...captured, criteria };
    results.textContent = result.matchCount + " / " + result.totalCount + "件\n" + result.rows.map(({ snapshot }) =>
      snapshot.agent + " / " + snapshot.account + " / chain " + snapshot.chainId + " / block " + snapshot.blockNumber).join("\n");
    saveSubset.disabled = result.matchCount === 0;
  });
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
  const resetFilters = button("history-filter-reset", "絞り込み条件を消去", () => {
    for (const input of [account, chain, minimum, maximum]) input.value = "";
    order.value = "oldest";
    invalidateView();
  });
  const changedFilter = () => { generation++; invalidateView(); };
  for (const input of [account, chain, minimum, maximum]) listen(input, "input", changedFilter);
  listen(order, "change", changedFilter);
  section.append(heading, explanation, save, backupState,
    labelled("保存した履歴JSONファイルを選択", file), cancel, status,
    filterHeading, labelled("公開アドレス（空欄ならすべて）", account),
    labelled("チェーンID（空欄ならすべて）", chain),
    labelled("最小ブロック（空欄なら制限なし）", minimum),
    labelled("最大ブロック（空欄なら制限なし）", maximum),
    labelled("表示順", order), search, resetFilters, results, saveSubset);
  parent.append(section);
  updateBackup();
  return Object.freeze({
    invalidate() {
      if (disposed) return;
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
      reader.dispose();
      for (const stop of cleanup) stop();
      section.remove();
    },
  });
}

/** Browser-owned download only: no filesystem path, network request or upload. */
export function offerHistoryDownload({ document, prepared }) {
  return offerWalletDownload({ document, prepared: prepared });
}

