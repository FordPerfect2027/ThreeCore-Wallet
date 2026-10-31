import { offerWalletDownload } from "./export-download.js";
import { readSecurityFileBytes, readFormatFileName } from "../src/security-file.js";
import { prepareWalletSavedBundle, reviewWalletSavedBundle, walletSavedBundleSourceFile, walletSavedBundleReviewText, WALLET_SAVED_BUNDLE_LIMIT, WALLET_SAVED_BUNDLE_SOURCE_LIMIT, inspectWalletSavedText, walletSavedComparisonText, reviewWalletSavedComparison, walletSavedComparisonReviewText, WALLET_SAVED_COMPARISON_REVIEW_LIMIT, walletSavedInspectionText, walletSavedInspectionErrorText, WALLET_SAVED_INSPECTION_LIMIT } from "../src/file-read-status.js";
import { walletFileReadService } from "../src/file-read-service.js";
import { describeFileReadStatus, describeFileReadError } from "../src/file-read-status.js";
import { compareWalletSavedTextInspections } from "../src/file-read-status.js";
import { inspectWalletSavedTextDifferences, encodeWalletSavedTextDifferences, walletSavedTextDifferencesText, WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT } from "../src/file-read-status.js";
import { consumeCleanup } from "../src/file-read-policy.js";
import { observeCallbackResult } from "../src/security-callback.js";
import { boundedUtf8Length } from "../src/security-json.js";
import { sha256Hex } from "../src/security-data.js";
import { validateWalletSavedBatchSelection, encodeWalletSavedTextBatch,
  walletSavedTextBatchManifest, WALLET_SAVED_BROWSER_BATCH_LIMITS, matchWalletSavedBatchManifest,
  WALLET_SAVED_BATCH_MANIFEST_LIMIT, encodeWalletSavedTextBatchCsv, compareWalletSavedTextBatches,
  encodeWalletSavedBatchComparison, walletSavedBatchComparisonText, reviewWalletSavedBatchComparison,
  encodeWalletSavedBatchComparisonReview, WALLET_SAVED_BATCH_COMPARISON_REVIEW_LIMIT, inspectWalletSavedFileBatch,
  resumeWalletSavedFileBatch, canResumeWalletSavedFileBatch } from "../src/file-read-status.js";

/** Aggregate file-read protection and a separate, read-only saved-file guide. */
export function mountFileReadPanel({ document, parent, service = walletFileReadService, savedFileDestinations = {} }) {
  const section = document.createElement("section");
  section.className = "file-read-panel";
  function node(tag, name, text) {
    const element = document.createElement(tag);
    element.className = "file-read-" + name;
    if (text) element.textContent = text;
    section.append(element);
    return element;
  }
  node("h3", "title", "ファイル読み込みの保護");
  const headline = node("p", "headline");
  headline.setAttribute("role", "status");
  headline.setAttribute("aria-live", "polite");
  const detail = node("p", "detail");
  const counts = node("pre", "counts");
  const stop = node("button", "stop", "進行中のファイル読み込みを止める");
  stop.type = "button";
  node("p", "scope", "このページ内の集計です。ファイル名・内容・パスは表示や記録に含めません。入力サイズはブラウザー全体のメモリ使用量ではありません。");
  const action = node("p", "action");
  action.setAttribute("role", "status");
  parent.append(section);
  const savedGuide = mountSavedFileInspectionPanel({ document, parent: section, destinations: savedFileDestinations });
  const savedBatch = mountSavedFileBatchPanel({ document, parent: section,
    inspectOriginal: (file, digest) => savedGuide.inspectFile(file, digest),
    compareOriginal: (file, digest) => savedGuide.compareFile(file, digest) });
  let disposed = false;
  let observing = true, renderGeneration = 0, actionGeneration = 0;
  let unsubscribe = () => {};
  function render(value) {
    if (disposed) return;
    const id = ++renderGeneration;
    const view = describeFileReadStatus(value);
    if (disposed || id !== renderGeneration) return;
    section.setAttribute("data-level", view.level);
    headline.textContent = view.heading;
    detail.textContent = view.detail;
    counts.textContent = view.counts;
  }
  function cancel() {
    if (disposed) return;
    const id = ++actionGeneration;
    try {
      const count = service.cancelAll();
      const kind = observeCallbackResult(count);
      if (disposed || id !== actionGeneration) return;
      action.textContent = kind === "synchronous" && Number.isSafeInteger(count) && count >= 0 && count <= 4 ?
        `読み込み ${count}件の待機を停止しました。保存済みの内容は変更していません。` :
        "停止した件数を確認できませんでした。";
    } catch { if (!disposed && id === actionGeneration) action.textContent = "読み込みの停止を確認できませんでした。"; }
  }
  stop.addEventListener("click", cancel);
  try {
    const initial = service.state();
    const initialKind = observeCallbackResult(initial);
    render(initialKind === "synchronous" ? initial : null);
    const receipt = service.subscribe(value => { if (observing) render(value); });
    const kind = observeCallbackResult(receipt, late => { if (typeof late === "function") consumeCleanup(late); });
    if (kind !== "synchronous" || typeof receipt !== "function") { observing = false; render(null); }
    else if (disposed) consumeCleanup(receipt);
    else unsubscribe = receipt;
  } catch { observing = false; render(null); }
  return Object.freeze({ dispose() {
    if (disposed) return;
    disposed = true;
    observing = false; renderGeneration++; actionGeneration++;
    consumeCleanup(() => unsubscribe());
    stop.removeEventListener("click", cancel);
    savedGuide.dispose();
    savedBatch.dispose();
    section.remove();
  } });
}

/** Picker dismissal is a notice, not cancellation of an already running read. */
export function createFileSelectionNotice(input, note) {
  let disposed = false;
  function noSelection() {
    if (!disposed) note.textContent = "新しいファイルは選ばれていません。進行中の読み込みや現在の確認内容は変更していません。";
  }
  function clear() { if (!disposed) note.textContent = ""; }
  input.addEventListener("cancel", noSelection);
  return Object.freeze({
    noSelection, clear,
    dispose() {
      if (disposed) return;
      clear(); disposed = true;
      input.removeEventListener("cancel", noSelection);
    },
  });
}

/** A separate, explicitly selected file is inspected only; no import callbacks exist. */
export function mountSavedFileInspectionPanel({ document, parent,
  readText = readSavedGuideText, inspect = inspectWalletSavedText,
  destinations = {},
  download = prepared => offerWalletDownload({ document, prepared }) } = {}) {
  const host = document.createElement("details"); host.className = "saved-file-guide";
  parent.append(host); const nodes = {}, cleanup = [];
  let disposed = false, generation = 0, aborter = null, busy = false, result = null, comparison = null, comparisonReview = null, workKind = "source";
  let sourceFile = null, comparisonSourceFile = null, bundlePanel = null, differencePanel = null;
  const destinationCallbacks = Object.create(null);
  for (const target of ["period", "library", "report", "history", "set", "workspace", "setup", "transfer-vault", "reconciliation"]) {
    try { const descriptor = Object.getOwnPropertyDescriptor(destinations, target); if (descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "function") destinationCallbacks[target] = descriptor.value; } catch { /* Unknown destinations stay unavailable. */ }
  }
  const make = (tag, name, text, target = host) => {
    const node = document.createElement(tag); node.className = "saved-file-guide-" + name;
    if (text !== undefined) node.textContent = text;
    target.append(node); nodes[name] = node; return node;
  };
  const heading = make("summary", "heading", "保存したJSONの種類と開く場所を調べる"); heading.setAttribute("tabindex", "-1");
  make("p", "intro", "ThreeCoreの元の保存JSONを1つ選んでください。期間・報告・受信送信履歴・残高・利用許可の観測・設定と履歴のバックアップ・運用リハーサルの練習用記録などに対応しています。形式と内部チェックサムの有無を分けて確認し、開く欄を案内します。ここでは履歴への追加や画面への復元は行いません。");
  const label = make("label", "file-label", "調べる元のJSON（最大96 MiB）");
  const file = make("input", "file", undefined, label); file.type = "file"; file.accept = ".json,application/json";
  const stop = make("button", "stop", "このファイルの確認を中止"); stop.type = "button";
  const status = make("p", "status", "ファイルを選ぶまで読み込みません。"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const notice = make("p", "notice"), output = make("pre", "output");
  const destination = make("button", "destination", "このページの読み込み欄へ移動"); destination.type = "button";
  const destinationStatus = make("p", "destination-status", ""); destinationStatus.setAttribute("role", "status");
  const ackLabel = make("label", "ack-label", "形式の案内と照合用の値を、暗号化せずPCに保存します");
  const ack = make("input", "ack", undefined, ackLabel); ack.type = "checkbox";
  const save = make("button", "save", "この案内をJSON保存"); save.type = "button";
  make("p", "limits", "この案内JSONに元の記録は含まれず、復元には使えません。元のファイルを別に保全してください。出所や現在のチェーンを保証する確認ではありません。");
  const compareBox = make("details", "comparison");
  make("summary", "comparison-heading", "このファイルと別の保存ファイルを比較する", compareBox);
  make("p", "comparison-intro", "上で調べたファイルを比較元にします。内部チェックサム付きの記録は、同じ元記録・書式だけの違い・内容の変更を区別します。設定や練習用記録など内部チェックサムのない形式は、今回の元JSONの文字列を照合します。元ファイルを置き換えません。", compareBox);
  const compareLabel = make("label", "compare-file-label", "比較先の元のJSON（最大96 MiB）", compareBox);
  const compareFile = make("input", "compare-file", undefined, compareLabel); compareFile.type = "file"; compareFile.accept = ".json,application/json";
  const comparisonOutput = make("pre", "comparison-output", "", compareBox);
  const compareAckLabel = make("label", "comparison-ack-label", "この比較結果と照合用の値を、暗号化せずPCに保存します", compareBox);
  const compareAck = make("input", "comparison-ack", undefined, compareAckLabel); compareAck.type = "checkbox";
  const compareSave = make("button", "comparison-save", "2つの保存ファイルの比較をJSON保存", compareBox); compareSave.type = "button";
  const reviewBox = make("details", "comparison-review", undefined, compareBox);
  make("summary", "comparison-review-heading", "保存した比較結果を、この2つの記録と照合する", reviewBox);
  const reviewLabel = make("label", "review-file-label", "保存した比較JSON（最大256 KiB）", reviewBox);
  const reviewFile = make("input", "review-file", undefined, reviewLabel); reviewFile.type = "file"; reviewFile.accept = ".json,application/json";
  const reviewOutput = make("pre", "review-output", "", reviewBox);
  const reviewAckLabel = make("label", "review-ack-label", "照合結果と照合用の値を、暗号化せずPCに保存します", reviewBox);
  const reviewAck = make("input", "review-ack", undefined, reviewAckLabel); reviewAck.type = "checkbox";
  const reviewSave = make("button", "review-save", "比較JSONの照合結果を保存", reviewBox); reviewSave.type = "button";
  const selectionNotice = createFileSelectionNotice(file, notice);
  const comparisonNotice = createFileSelectionNotice(compareFile, notice);
  const reviewNotice = createFileSelectionNotice(reviewFile, notice);
  function render() {
    if (disposed) return;
    host.setAttribute("aria-busy", String(busy)); file.disabled = busy; stop.disabled = !busy;
    ack.disabled = busy || !result; save.disabled = busy || !result || !ack.checked;
    output.textContent = walletSavedInspectionText(result);
    destination.disabled = disposed || busy || !result || !["validated-original", "validated-structure"].includes(result.validation) || !destinationCallbacks[result.target];
    if (!result) destinationStatus.textContent = "";
    compareFile.disabled = busy || !result; compareAck.disabled = busy || !comparison;
    compareSave.disabled = busy || !comparison || !compareAck.checked;
    comparisonOutput.textContent = walletSavedComparisonText(comparison);
    reviewFile.disabled = busy || !comparison; reviewAck.disabled = busy || !comparisonReview;
    reviewSave.disabled = busy || !comparisonReview || !reviewAck.checked;
    reviewOutput.textContent = walletSavedComparisonReviewText(comparisonReview);
    bundlePanel?.updatePair();
    differencePanel?.updatePair();
  }
  function cancel() {
    if (disposed) return;
    const own = ++generation, previous = aborter; aborter = null; busy = false; if (workKind === "source") result = null; if (workKind !== "comparison-review") comparison = null; comparisonReview = null; ack.checked = false; compareAck.checked = false; reviewAck.checked = false;
    if (!result) sourceFile = null; if (!comparison) comparisonSourceFile = null;
    previous?.abort(); if (disposed || generation !== own) return;
    status.textContent = "確認を中止しました。保存済みの元のファイルや履歴は変更していません。"; render();
  }
  async function selected() {
    if (disposed) return;
    const chosen = file.files?.[0]; file.value = "";
    if (!chosen) { selectionNotice.noSelection(); return; }
    return inspectFile(chosen);
  }
  async function inspectFile(chosen, expectedDigest) {
    if (disposed) return false;
    if (expectedDigest !== undefined && (typeof expectedDigest !== "string" || !/^[0-9a-f]{64}$/.test(expectedDigest))) return false;
    const own = ++generation, previous = aborter; aborter = null; previous?.abort();
    if (disposed || own !== generation) return false;
    const local = new AbortController(); aborter = local; busy = true; workKind = "source"; result = null; comparison = null; comparisonReview = null; reviewAck.checked = false; compareAck.checked = false; ack.checked = false; selectionNotice.clear();
    sourceFile = null; comparisonSourceFile = null;
    host.open = true; try { heading.focus?.(); } catch { /* Focus is advisory, not inspection authority. */ }
    if (disposed || own !== generation) return false;
    status.textContent = expectedDigest === undefined ? "選んだJSONの形式と内容を確認しています。" : "一括確認したファイルの内容が変わっていないか確認してから、詳細を開きます。"; render();
    try {
      readFormatFileName(chosen, { maxLength: 180, code: "FILE_INSPECTION_NAME", fail: code => { const error = new Error(code); error.code = code; throw error; } });
      if (disposed || generation !== own) return;
      const text = await readText(chosen, { maxBytes: WALLET_SAVED_INSPECTION_LIMIT, signal: local.signal });
      if (disposed || generation !== own) return;
      if (expectedDigest !== undefined) {
        boundedUtf8Length(text, WALLET_SAVED_INSPECTION_LIMIT);
        const actualDigest = await sha256Hex(new TextEncoder().encode(text), globalThis.crypto?.subtle, { signal: local.signal, timeoutMs: 30000 });
        if (disposed || generation !== own) return false;
        if (actualDigest !== expectedDigest) { const error = new Error("FILE_BATCH_SOURCE_CHANGED"); error.code = "FILE_BATCH_SOURCE_CHANGED"; throw error; }
      }
      const value = await inspect(text, { signal: local.signal });
      if (disposed || generation !== own) return;
      sourceFile = chosen; result = value; status.textContent = value.validation === "validated-original" ? "元記録の形式とチェックサムを確認しました。開く欄は下の案内をご覧ください。" :
        "形式の指定だけを判別しました。補助資料の中身は検証していません。";
      return true;
    } catch (error) {
      if (disposed || generation !== own) return;
      status.textContent = walletSavedInspectionErrorText(error);
      return false;
    } finally { if (!disposed && generation === own) { aborter = null; busy = false; render(); } }
  }
  async function compareSelected() {
    if (disposed || busy || !result) return;
    const chosen = compareFile.files?.[0]; compareFile.value = "";
    if (!chosen) { comparisonNotice.noSelection(); return; }
    return inspectComparisonFile(chosen);
  }
  async function inspectComparisonFile(chosen, expectedDigest) {
    if (disposed || busy || !result) return false;
    if (expectedDigest !== undefined && (typeof expectedDigest !== "string" || !/^[0-9a-f]{64}$/.test(expectedDigest))) return false;
    const own = ++generation, base = result, previous = aborter; aborter = null; previous?.abort();
    if (disposed || generation !== own) return;
    const local = new AbortController(); aborter = local; busy = true; workKind = "comparison";
    comparison = null; comparisonReview = null; reviewAck.checked = false; compareAck.checked = false; ack.checked = false; comparisonNotice.clear();
    comparisonSourceFile = null;
    host.open = true; compareBox.open = true; try { heading.focus?.(); } catch {}
    if (disposed || generation !== own) return false;
    status.textContent = "比較先のファイルを確認しています。比較元は保持しています。"; render();
    try {
      readFormatFileName(chosen, { maxLength: 180, code: "FILE_INSPECTION_NAME", fail: code => { const error = new Error(code); error.code = code; throw error; } });
      if (disposed || generation !== own) return;
      const text = await readText(chosen, { maxBytes: WALLET_SAVED_INSPECTION_LIMIT, signal: local.signal });
      if (disposed || generation !== own) return;
      if (expectedDigest !== undefined) {
        boundedUtf8Length(text, WALLET_SAVED_INSPECTION_LIMIT);
        const actualDigest = await sha256Hex(new TextEncoder().encode(text), globalThis.crypto?.subtle, { signal: local.signal, timeoutMs: 30000 });
        if (disposed || generation !== own) return false;
        if (actualDigest !== expectedDigest) { const error = new Error("FILE_BATCH_SOURCE_CHANGED"); error.code = "FILE_BATCH_SOURCE_CHANGED"; throw error; }
      }
      const incoming = await inspect(text, { signal: local.signal });
      if (disposed || generation !== own) return;
      comparison = compareWalletSavedTextInspections(base, incoming); comparisonSourceFile = chosen;
      status.textContent = "保存ファイル同士の比較を表示しました。元記録を置き換えたり復元したりしていません。";
      return true;
    } catch (error) { if (!disposed && generation === own) status.textContent = walletSavedInspectionErrorText(error); return false; }
    finally { if (!disposed && generation === own) { aborter = null; busy = false; render(); } }
  }
  async function reviewSelected() {
    if (disposed || busy || !comparison) return;
    const chosen = reviewFile.files?.[0]; reviewFile.value = "";
    if (!chosen) { reviewNotice.noSelection(); return; }
    const own = ++generation, captured = comparison, local = new AbortController(); aborter = local;
    busy = true; workKind = "comparison-review"; comparisonReview = null; reviewAck.checked = false; reviewNotice.clear();
    status.textContent = "保存した比較結果を、現在の比較元・比較先から照合しています。"; render();
    try {
      readFormatFileName(chosen, { maxLength: 180, code: "FILE_INSPECTION_NAME", fail: code => { const error = new Error(code); error.code = code; throw error; } });
      if (disposed || generation !== own) return;
      const text = await readText(chosen, { maxBytes: WALLET_SAVED_COMPARISON_REVIEW_LIMIT, signal: local.signal });
      if (disposed || generation !== own) return;
      const reviewed = await reviewWalletSavedComparison(captured.before, captured.after, text, { signal: local.signal });
      if (disposed || generation !== own) return;
      comparisonReview = reviewed;
      status.textContent = reviewed.matchesRecomputation ? "保存した比較結果と再計算が一致しました。元のファイル同士の一致とは別の判定です。" : "保存した比較結果に不一致が見つかりました。照合の詳細を確認してください。";
    } catch (error) { if (!disposed && generation === own) status.textContent = walletSavedInspectionErrorText(error); }
    finally { if (!disposed && generation === own) { aborter = null; busy = false; render(); } }
  }
  function saveReview() {
    if (disposed || busy || !comparisonReview || !reviewAck.checked) return;
    const own = ++generation, captured = comparisonReview; reviewAck.checked = false; render();
    try {
      const file = Object.freeze({ text: JSON.stringify(captured, null, 2) + "\n", filename: "ThreeCore-saved-file-comparison-review.json",
        mimeType: "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false, encrypted: false });
      const delivered = download(file), kind = observeCallbackResult(delivered);
      if (disposed || generation !== own) return;
      status.textContent = kind === "synchronous" && delivered !== false ? "照合結果の保存処理を開始しました。ダウンロード先をご確認ください。" : "照合結果の保存を確認できませんでした。";
    } catch { if (!disposed && generation === own) status.textContent = "照合結果の保存を確認できませんでした。"; }
  }
  function saveComparison() {
    if (disposed || busy || !comparison || !compareAck.checked) return;
    const own = ++generation, captured = comparison; compareAck.checked = false; render();
    try {
      const file = Object.freeze({ text: JSON.stringify(captured, null, 2) + "\n", filename: "ThreeCore-saved-file-comparison.json",
        mimeType: "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false, encrypted: false });
      const delivered = download(file), kind = observeCallbackResult(delivered);
      if (disposed || generation !== own) return;
      status.textContent = kind === "synchronous" && delivered !== false ? "比較結果の保存処理を開始しました。ダウンロード先をご確認ください。" : "比較結果の保存を確認できませんでした。";
    } catch { if (!disposed && generation === own) status.textContent = "比較結果の保存を確認できませんでした。"; }
  }
  function saveResult() {
    if (disposed || busy || !result || !ack.checked) return;
    const own = ++generation, captured = result; ack.checked = false; render();
    try {
      const prepared = Object.freeze({ text: JSON.stringify(captured, null, 2) + "\n",
        filename: "ThreeCore-saved-file-inspection.json", mimeType: "application/json;charset=utf-8",
        containsOriginalEvidence: false, restorable: false, encrypted: false });
      const delivery = download(prepared), kind = observeCallbackResult(delivery);
      if (disposed || generation !== own) return;
      status.textContent = kind === "synchronous" && delivery !== false ? "案内の保存処理を開始しました。ダウンロード先をご確認ください。" : "案内の保存を確認できませんでした。";
    } catch { if (!disposed && generation === own) status.textContent = "案内の保存を確認できませんでした。"; }
  }
  function listen(node, event, callback) { node.addEventListener(event, callback); cleanup.push(() => node.removeEventListener(event, callback)); }
  listen(file, "change", () => { void selected(); }); listen(stop, "click", cancel);
  listen(destination, "click", () => {
    if (disposed || busy || !result || destination.disabled) return;
    const own = generation, captured = result; let accepted = false;
    try { const value = destinationCallbacks[captured.target](); accepted = observeCallbackResult(value) === "synchronous" && value === true; } catch {}
    if (!disposed && generation === own && result === captured) destinationStatus.textContent = accepted ? "読み込み欄へ移動しました。元のJSONはまだ読み込んでいません。案内した欄で元のファイルを選んでください。" : "このページの読み込み欄へ移動できませんでした。上の案内にある欄を確認してください。";
  });
  listen(ack, "change", render); listen(save, "click", saveResult);
  listen(compareFile, "change", () => { void compareSelected(); }); listen(compareAck, "change", render); listen(compareSave, "click", saveComparison);
  bundlePanel = mountSavedComparisonBundlePanel({ document, parent: compareBox, readText, download,
    getPair: () => !disposed && !busy && comparison && sourceFile && comparisonSourceFile ? { comparison, beforeFile: sourceFile, afterFile: comparisonSourceFile } : null });
  differencePanel = mountSavedFileDifferencePanel({ document, parent: compareBox, readText, download,
    getPair: () => !disposed && !busy && comparison && sourceFile && comparisonSourceFile ? { comparison, beforeFile: sourceFile, afterFile: comparisonSourceFile } : null });
  listen(reviewFile, "change", () => { void reviewSelected(); }); listen(reviewAck, "change", render); listen(reviewSave, "click", saveReview); render();
  return Object.freeze({ inspectFile, compareFile: inspectComparisonFile, getState: () => Object.freeze({ busy, result, comparison, comparisonReview, disposed }), dispose() {
    if (disposed) return;
    disposed = true; generation++; const previous = aborter; aborter = null; busy = false; result = null; comparison = null; comparisonReview = null;
    sourceFile = null; comparisonSourceFile = null; bundlePanel.dispose(); differencePanel.dispose();
    previous?.abort(); selectionNotice.dispose(); comparisonNotice.dispose(); reviewNotice.dispose(); cleanup.forEach(remove => remove()); host.remove();
  } });
}

async function readSavedGuideText(file, options) {
  const bytes = await readSecurityFileBytes(file, options);
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { const error = new Error("FILE_ENCODING"); error.code = "FILE_ENCODING"; throw error; }
}

/** Explicit, bounded re-read of plain sources. Only locations and hashes are exported. */
export function mountSavedFileDifferencePanel({ document, parent, getPair = () => null,
  readText = readSavedGuideText, download = prepared => offerWalletDownload({ document, prepared }) } = {}) {
  const host = document.createElement("details"); host.className = "saved-differences"; parent.append(host);
  let disposed = false, busy = false, generation = 0, aborter = null, result = null, lastPair = null;
  const cleanup = [];
  function node(tag, name, text, target = host) { const value = document.createElement(tag); value.className = "saved-differences-" + name; if (text !== undefined) value.textContent = text; target.append(value); return value; }
  node("summary", "heading", "設定や練習用JSONの、変わった箇所を調べる");
  node("p", "intro", "上で比較した同じ形式の設定・残高記録・練習用記録を読み直します。各2 MiBまで。値は表示せず、相違箇所の合計と先頭40件の場所を表示します。");
  const start = node("button", "start", "相違箇所を調べる"), stop = node("button", "stop", "相違箇所の確認を中止"); start.type = stop.type = "button";
  const status = node("p", "status", "対応する2つの元ファイルを比較してから確認できます。"), output = node("pre", "output", ""); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const label = node("label", "ack-label", "相違箇所と元ファイルの照合値を、暗号化せずPCに保存します"), ack = node("input", "ack", undefined, label); ack.type = "checkbox";
  const save = node("button", "save", "相違箇所をJSON保存"); save.type = "button";
  const current = () => { try { return getPair(); } catch { return null; } };
  const usable = pair => Boolean(pair?.comparison?.before?.validation === "validated-structure" && pair?.comparison?.after?.validation === "validated-structure" && pair.comparison.before.sourceSchema === pair.comparison.after.sourceSchema && pair.beforeFile && pair.afterFile);
  const same = own => !disposed && generation === own;
  function render() { if (disposed) return; host.setAttribute("aria-busy", String(busy)); start.disabled = busy || !usable(current()); stop.disabled = !busy; ack.disabled = busy || !result; save.disabled = busy || !result || !ack.checked; output.textContent = result ? walletSavedTextDifferencesText(result) : ""; }
  function cancel() { if (disposed) return; const own = ++generation, previous = aborter; aborter = null; busy = false; result = null; ack.checked = false; previous?.abort(); if (same(own)) { status.textContent = "相違箇所の確認を中止しました。元ファイルは変更していません。"; render(); } }
  function updatePair() { if (disposed) return; const next = current()?.comparison ?? null; if (lastPair !== next) { lastPair = next; cancel(); status.textContent = "比較するファイルが変わりました。必要に応じて相違箇所を調べてください。"; } render(); }
  async function inspectPair() {
    if (disposed || busy) return false;
    const captured = current(); if (!usable(captured)) return false;
    const own = ++generation, local = new AbortController(); aborter = local; busy = true; result = null; ack.checked = false;
    status.textContent = "両方の元ファイルを読み直して相違箇所を確認しています。"; render();
    const unchanged = () => same(own) && current()?.comparison === captured.comparison;
    try {
      const options = { maxBytes: WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT, signal: local.signal };
      const beforeText = await readText(captured.beforeFile, options); if (!unchanged()) return false;
      const afterText = await readText(captured.afterFile, options); if (!unchanged()) return false;
      const checked = await inspectWalletSavedTextDifferences(beforeText, afterText, { signal: local.signal,
        expectedBeforeSha256: captured.comparison.before.textDigest, expectedAfterSha256: captured.comparison.after.textDigest });
      if (!unchanged()) return false;
      result = checked; status.textContent = "相違箇所を確認しました。元ファイルの値や行を変更していません。"; return true;
    } catch (error) { if (unchanged()) status.textContent = describeFileReadError(error, "各2 MiB") ?? walletSavedInspectionErrorText(error); return false; }
    finally { if (same(own)) { aborter = null; busy = false; render(); } }
  }
  function saveResult() {
    if (disposed || busy || !result || !ack.checked) return;
    const own = generation, captured = result; ack.checked = false; render();
    try { const prepared = Object.freeze({ text: encodeWalletSavedTextDifferences(captured), filename: "ThreeCore-saved-file-differences.json", mimeType: "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false, encrypted: false });
      const delivery = download(prepared), kind = observeCallbackResult(delivery); if (!same(own)) return;
      status.textContent = kind === "synchronous" && delivery !== false ? "相違箇所の保存処理を開始しました。ダウンロード先をご確認ください。" : "相違箇所の保存を確認できませんでした。";
    } catch { if (same(own)) status.textContent = "相違箇所の保存を確認できませんでした。"; }
  }
  function listen(element, event, action) { element.addEventListener(event, action); cleanup.push(() => element.removeEventListener(event, action)); }
  listen(start, "click", () => { void inspectPair(); }); listen(stop, "click", cancel); listen(ack, "change", render); listen(save, "click", saveResult); updatePair();
  return Object.freeze({ inspectPair, updatePair, getState: () => Object.freeze({ busy, result, disposed }), dispose() { if (disposed) return; disposed = true; generation++; const previous = aborter; aborter = null; result = null; busy = false; previous?.abort(); cleanup.forEach(remove => remove()); host.remove(); } });
}

/** Separate file-only inventory. No restore, account or storage callbacks exist. */
export function mountSavedFileBatchPanel({ document, parent, readText = readSavedGuideText,
  inspectFiles = inspectWalletSavedFileBatch, resumeFiles = resumeWalletSavedFileBatch, subtle = globalThis.crypto?.subtle,
  inspectOriginal = null, compareOriginal = null,
  download = prepared => offerWalletDownload({ document, prepared }) } = {}) {
  const host = document.createElement("details"); host.className = "saved-file-batch"; parent.append(host);
  let disposed = false, generation = 0, selection = null, active = null, result = null;
  let referenceText;
  let comparisonPanel;
  const cleanup = [], nodes = {};
  function make(tag, name, text, target = host) { const element = document.createElement(tag); element.className = "saved-file-batch-" + name; if (text !== undefined) element.textContent = text; target.append(element); nodes[name] = element; return element; }
  function button(name, text) { const element = make("button", name, text); element.type = "button"; return element; }
  function listen(node, event, callback) { node.addEventListener(event, callback); cleanup.push(() => node.removeEventListener(event, callback)); }
  const current = id => !disposed && id === generation;
  const errorText = error => describeFileReadError(error, "1件16 MiB、合計64 MiB") ?? walletSavedInspectionErrorText(error);
  make("summary", "heading", "複数の保存ファイルをまとめて確認する");
  make("p", "intro", "期間・報告・受信送信履歴・残高観測など、元の保存JSONを1〜20個選び、確認を開始します。1件ずつ読み込みと確認を行い、読めないファイルがあっても、ほかの結果を残します。1件16 MiB、合計64 MiB、開始後120秒までです。履歴への追加や復元は行いません。");
  make("p", "resume-intro", "中止・時間切れの後は、この画面に残った未確認分だけを続けられます。確認済みの結果は前回のものを保持し、再確認しません。ファイルや照合値一覧を選び直した場合は、最初からの確認になります。");
  const label = make("label", "file-label", "まとめて確認する元のJSON"), file = make("input", "file", undefined, label); file.type = "file"; file.accept = ".json,application/json"; file.multiple = true;
  const referenceBox = make("details", "reference"); make("summary", "reference-heading", "以前の照合値一覧と比較する（任意）", referenceBox);
  make("p", "reference-intro", "以前保存したSHA256SUMS一覧を選ぶか、その全文を貼り付けてください。16 KiB・20行までです。一覧にある全ファイルを、同じ名前で選んで確認します。比較しない場合は『以前の一覧を外す』を押してください。", referenceBox);
  const referenceLabel = make("label", "reference-file-label", "以前保存した照合値一覧", referenceBox), referenceFile = make("input", "reference-file", undefined, referenceLabel); referenceFile.type = "file"; referenceFile.accept = ".txt,text/plain";
  const pasteLabel = make("label", "reference-text-label", "照合値一覧の全文を貼り付け", referenceBox), referenceInput = make("textarea", "reference-text", undefined, pasteLabel); referenceInput.maxLength = WALLET_SAVED_BATCH_MANIFEST_LIMIT;
  const referenceClear = make("button", "reference-clear", "以前の一覧を外す", referenceBox); referenceClear.type = "button";
  const referenceStatus = make("p", "reference-status", "以前の一覧は指定されていません。", referenceBox); referenceStatus.setAttribute("role", "status");
  const start = button("start", "選んだファイルをまとめて確認"), resume = button("resume", "未確認の続きを確認"), stop = button("stop", "一括確認を中止"), clear = button("clear", "選択と確認結果をクリア");
  const status = make("p", "status", "ファイルを選び、開始するまで読み込みません。"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const notice = make("p", "notice"), selectionNotice = createFileSelectionNotice(file, notice), summary = make("p", "summary");
  const table = make("table", "table"); make("caption", "caption", "選択した保存ファイルの確認結果", table);
  const header = make("thead", "thead", undefined, table), heading = make("tr", "head-row", undefined, header);
  for (const text of ["ファイル名", "確認結果", "開く場所・確認範囲", "内容のSHA-256", "以前の照合値との比較", "詳細確認"]) { const cell = document.createElement("th"); cell.textContent = text; cell.setAttribute("scope", "col"); heading.append(cell); }
  const rows = make("tbody", "rows", undefined, table);
  const ackLabel = make("label", "ack-label", "ファイル名・確認結果・照合値を、暗号化せずPCに保存します"), ack = make("input", "ack", undefined, ackLabel); ack.type = "checkbox";
  const save = button("save", "一括確認の控えをJSON保存"), csv = button("csv", "全ファイルの確認結果をCSV保存"), manifest = button("manifest", "今回の内容の照合値一覧を保存");
  make("p", "limits", "以前の一覧を指定した場合だけ、その値と比較します。一覧の出所は保証しません。今回の照合値一覧を保存しても、以前の値が正しいことの証明にはなりません。補助資料は形式の案内だけです。この控えに元記録は含まれず、復元には使えません。元ファイルと同じ名前のまま一緒に保管してください。同じ記録が複数の報告に含まれる場合があります。");
  const exportStatus = make("p", "export-status"); exportStatus.setAttribute("role", "status"); exportStatus.setAttribute("aria-live", "polite");
  function buttons() {
    comparisonPanel?.updateCurrent(!disposed && !active ? result : null);
    host.setAttribute("aria-busy", active ? "true" : "false"); start.disabled = disposed || Boolean(active) || !selection;
    if (referenceText !== undefined && selection) {
      try { matchWalletSavedBatchManifest(selection.map(({ name, byteLength }) => ({ name, byteLength })), referenceText); referenceStatus.textContent = "以前の一覧と、選択した全ファイルの名前が対応しています。開始すると内容を比較します。"; }
      catch (error) { start.disabled = true; referenceStatus.textContent = walletSavedInspectionErrorText(error); }
    } else referenceStatus.textContent = referenceText === undefined ? "以前の一覧は指定されていません。" : "以前の一覧を指定しました。対応する元のJSONをすべて選んでください。";
    stop.disabled = disposed || !active || active.signal.aborted;
    resume.disabled = disposed || Boolean(active) || !selection || !canResumeWalletSavedFileBatch(result);
    ack.disabled = disposed || Boolean(active) || !result;
    save.disabled = ack.disabled || !ack.checked;
    csv.disabled = save.disabled;
    manifest.disabled = save.disabled || !result?.complete || result.files.some(row => row.sha256 === null);
  }
  function reset(keepSelection = false) {
    const id = ++generation, old = active; active = null; if (!keepSelection) selection = null; result = null; ack.checked = false;
    old?.abort(); if (!current(id)) return id;
    rows.replaceChildren(); summary.textContent = ""; exportStatus.textContent = ""; selectionNotice.clear(); buttons(); return id;
  }
  listen(referenceInput, "input", () => {
    if (disposed) return; const text = referenceInput.value, id = reset(true); if (!current(id)) return;
    referenceText = text; referenceFile.value = ""; status.textContent = "以前の一覧を変更しました。選択した元ファイルは保持しています。"; buttons();
  });
  listen(referenceClear, "click", () => {
    if (disposed) return; const id = reset(true); if (!current(id)) return;
    referenceText = undefined; referenceInput.value = ""; referenceFile.value = ""; status.textContent = "以前の一覧を外しました。次の確認では外部の照合値を比較しません。"; buttons();
  });
  listen(referenceFile, "change", async () => {
    if (disposed) return; const chosen = referenceFile.files?.[0]; referenceFile.value = ""; if (!chosen) return;
    const id = reset(true); if (!current(id)) return; referenceText = ""; referenceInput.value = "";
    const local = new AbortController(); active = local; status.textContent = "以前の照合値一覧を読み込んでいます。"; buttons();
    try { const text = await readText(chosen, { signal: local.signal, maxBytes: WALLET_SAVED_BATCH_MANIFEST_LIMIT });
      if (!current(id) || local.signal.aborted) return;
      boundedUtf8Length(text, WALLET_SAVED_BATCH_MANIFEST_LIMIT); referenceText = text; referenceInput.value = text; status.textContent = "以前の一覧を読み込みました。元ファイルの確認は開始していません。";
    } catch { if (current(id)) status.textContent = "以前の一覧を読み込めませんでした。16 KiB以内の元の一覧を選ぶか、全文を貼り付けてください。比較なしに切り替えてはいません。"; }
    finally { local.abort(); if (current(id)) { active = null; if (status.textContent.startsWith("中止しています")) status.textContent = "以前の一覧の読み込みを中止しました。比較なしには切り替えていません。"; buttons(); } }
  });
  listen(file, "change", () => {
    if (disposed) return;
    const offered = file.files, count = offered?.length;
    if (count === 0) { selectionNotice.noSelection(); return; }
    const id = reset(); if (!current(id)) return;
    try {
      if (!Number.isInteger(count) || count < 1 || count > WALLET_SAVED_BROWSER_BATCH_LIMITS.files) throw Error();
      const captured = [];
      for (let i = 0; i < count; i++) { const chosen = offered[i], name = readFormatFileName(chosen, { maxLength: 180, code: "FILE_BATCH_SELECTION", fail: () => { throw Error(); } }), byteLength = chosen.size; observeCallbackResult(byteLength); captured.push({ file: chosen, name, byteLength }); }
      const checked = validateWalletSavedBatchSelection(captured.map(({ name, byteLength }) => ({ name, byteLength })));
      if (!current(id)) return; selection = Object.freeze(captured.map((row, i) => Object.freeze({ file: row.file, ...checked.files[i] })));
      status.textContent = `${selection.length}件を選びました。「選んだファイルをまとめて確認」を押すと読み込みます。`; buttons();
    } catch { if (current(id)) status.textContent = "名前が重複しないJSONを1〜20個選んでください。1件16 MiB、合計64 MiBまでです。ファイル名に特殊な記号がある場合は名前を変えて選び直してください。"; }
  });
  function render(receipt, id) {
    const labels = { "validated-original": "元記録の形式・内部チェックサムを確認", "validated-structure": "データ形式を確認・内部チェックサムなし", "declared-only": "補助資料の形式指定だけ", invalid: "元記録を確認できません", "hash-unavailable": "照合値を計算できません", "source-unavailable": "ファイルを読み込めません", "checksum-mismatch": "以前の照合値と不一致", pending: "未確認" };
    const sourceSelection = selection;
    const elements = receipt.files.map((row, index) => {
      const tr = document.createElement("tr"), scope = row.inspection?.scope;
      const detail = row.inspection ? row.inspection.destinationMessage + (scope ? scope.draftReferences !== null ? ` 元の控えの参照 ${scope.draftReferences}件／未完了 ${scope.incompleteDraftReferences}件。` : " 件数の内訳は元記録の詳細から確認できます。" : " 中身や結論は未検証です。") : row.code ? errorText({ code: row.code }) : "処理していません。";
      const referenceResult = !receipt.referenceProvided ? "指定なし" : (row.checksumMatches === null ? "未比較" : row.checksumMatches ? "一致" : "不一致") + "：" + row.expectedSha256;
      for (const value of [row.name, labels[row.status], detail, row.sha256 ?? "未計算", referenceResult]) { const cell = document.createElement("td"); cell.textContent = value; tr.append(cell); }
      const action = document.createElement("td");
      for (const [name, label, callback] of [["open", "この元記録の詳細を開く", inspectOriginal], ["compare", "開いている元記録と比較", compareOriginal]]) {
        const open = document.createElement("button"); open.className = "saved-file-batch-" + name; open.type = "button"; open.textContent = label;
        open.disabled = !["validated-original", "validated-structure"].includes(row.status) || !row.sha256 || typeof callback !== "function";
        open.addEventListener("click", async () => {
          if (disposed || active || !current(id) || result !== receipt || open.disabled) return;
          open.disabled = true;
          try { const accepted = await callback(sourceSelection[index].file, row.sha256);
            if (current(id) && result === receipt) exportStatus.textContent = accepted === true ? "元記録の詳細確認を上の案内欄に開きました。一括確認の結果は保持しています。" : "詳細確認を完了できませんでした。比較する場合は、先に比較元の詳細を開いてください。上の案内欄をご確認ください。一括確認の結果は保持しています。";
          } catch { if (current(id) && result === receipt) exportStatus.textContent = "詳細確認を開けませんでした。一括確認の結果は保持しています。"; }
          finally { if (current(id) && result === receipt) open.disabled = false; }
        }); action.append(open);
      } tr.append(action);
      return tr;
    });
    if (!current(id)) return; result = receipt; rows.replaceChildren(...elements);
    const s = receipt.summary; summary.textContent = `${s.selected}件中、確認済み ${s.checked}件／未確認 ${s.pending}件。元記録 ${s.validatedOriginals}件、補助資料 ${s.declaredOnly}件、形式・照合値の問題 ${s.invalid + s.hashUnavailable + (s.checksumMismatches ?? 0)}件。`;
    if (s.simulationFiles) summary.textContent += ` 練習用 ${s.simulationFiles}件（実際の入出金の証拠ではありません）。`;
    if (receipt.continuation) summary.textContent += ` 続きの確認 ${receipt.continuation.sequence}回目：前回の結果を保持 ${receipt.continuation.retainedChecks}件（再確認していません）。`;
    if (s.structureValidated) summary.textContent += ` データ形式を確認・内部チェックサムなし ${s.structureValidated}件。内部チェックサム付きの元記録とは分けています。`;
    if (s.sourceUnavailable) summary.textContent += ` ファイルを読み込めなかったもの ${s.sourceUnavailable}件。ほかのファイルの確認結果は残しています。`;
    if (receipt.referenceProvided) summary.textContent += ` 以前の照合値との一致 ${s.checksumsMatching}件／不一致 ${s.checksumMismatches}件／未比較 ${s.selected - s.checksumsCompared}件。`;
    status.textContent = receipt.complete ? s.sourceUnavailable ? "読み込めないファイルがありました。ほかのファイルの確認結果は残しています。各行をご確認ください。" : "一括確認を終えました。各ファイルの結果をご確認ください。" : receipt.phase === "timed-out" ? "待ち時間の上限で止めました。確認できた分と未確認の行を含む控えを保存できます。" : "一括確認を止めました。確認できた分の控えを保存できます。未確認の行も含みます。";
  }
  async function run(previous = null) {
    if (disposed || active || !selection || (previous ? resume.disabled : start.disabled)) return;
    const id = ++generation, chosen = selection, manifestText = referenceText, local = new AbortController(); active = local; result = previous; ack.checked = false;
    if (!previous) { rows.replaceChildren(); summary.textContent = ""; } exportStatus.textContent = ""; buttons();
    try {
      if (manifestText !== undefined) matchWalletSavedBatchManifest(chosen.map(({ name, byteLength }) => ({ name, byteLength })), manifestText);
      const read = (index, options) => {
        if (current(id)) status.textContent = `ファイルを読み込んでいます（${index + 1} / ${chosen.length}）：${chosen[index].name}`;
        return readText(chosen[index].file, options);
      };
      const options = { signal: local.signal, subtle, onProgress: p => { if (current(id)) status.textContent = `元記録を確認しています（${p.checked} / ${p.selected}件）。`; } };
      const receipt = previous ? await resumeFiles(previous, read, options) : await inspectFiles(chosen.map(({ name, byteLength }) => ({ name, byteLength })), read, { ...options, manifestText });
      if (current(id)) render(receipt, id);
    } catch (error) { if (current(id)) { if (previous) render(previous, id); status.textContent = (previous ? "続きの確認を完了できませんでした。前回の結果は保持しています。" : local.signal.aborted ? "ファイルの読み込みを中止しました。確認結果はまだありません。" : "まとめて読み込めませんでした。") + errorText(error); } }
    finally { local.abort(); if (current(id)) { active = null; if (!result && local.signal.aborted && status.textContent.startsWith("中止しています")) status.textContent = "ファイルの読み込みを中止しました。確認結果はまだありません。"; buttons(); } }
  }
  listen(start, "click", () => { void run(); }); listen(resume, "click", () => { void run(result); });
  listen(stop, "click", () => { if (disposed || !active) return; const own = generation, controller = active; controller.abort(); if (!current(own) || active !== controller) return; status.textContent = "中止しています。確認できた分を残します。"; buttons(); });
  listen(clear, "click", () => { if (disposed) return; const own = reset(); if (!current(own)) return; referenceText = undefined; referenceInput.value = ""; referenceFile.value = ""; file.value = ""; status.textContent = "選択と確認結果をクリアしました。"; buttons(); });
  listen(ack, "change", () => { if (!disposed) buttons(); });
  for (const [button, encode, filename, mimeType] of [[save, encodeWalletSavedTextBatch, "ThreeCore-wallet-saved-batch.json", "application/json;charset=utf-8"], [csv, encodeWalletSavedTextBatchCsv, "ThreeCore-wallet-saved-batch.csv", "text/csv;charset=utf-8"], [manifest, walletSavedTextBatchManifest, "SHA256SUMS.txt", "text/plain;charset=utf-8"]]) listen(button, "click", () => {
    if (disposed || active || !result || button.disabled || !ack.checked) return;
    const own = generation, receipt = result; ack.checked = false; buttons();
    try {
      const prepared = Object.freeze({ text: encode(receipt), filename: button === manifest && receipt.referenceProvided ? "ThreeCore-selected-content-SHA256SUMS.txt" : filename, mimeType, restorable: false, containsOriginalEvidence: false, encrypted: false });
      const delivered = download(prepared), kind = observeCallbackResult(delivered);
      if (current(own) && result === receipt) exportStatus.textContent = kind === "synchronous" && delivered !== false ? "確認用の控えの保存処理を開始しました。ダウンロード先をご確認ください。" : "保存を確認できませんでした。結果は保持しています。";
    } catch { if (current(own) && result === receipt) exportStatus.textContent = "保存を確認できませんでした。結果は保持しています。"; }
  });
  comparisonPanel = mountSavedBatchComparisonPanel({ document, parent: host, download, readText });
  buttons();
  return Object.freeze({ getState: () => Object.freeze({ busy: Boolean(active), result, selected: selection?.length ?? 0, disposed }), dispose() {
    if (disposed) return; disposed = true; ++generation; const old = active; active = null; selection = null; result = null; referenceText = undefined; referenceInput.value = ""; ack.checked = false;
    old?.abort(); comparisonPanel.dispose(); selectionNotice.dispose(); cleanup.forEach(remove => remove()); buttons(); host.remove();
  } });
}

/** Holds two owned observations without keeping original file bodies or importing them. */
export function mountSavedBatchComparisonPanel({ document, parent,
  readText = readSavedGuideText, review = reviewWalletSavedBatchComparison,
  download = prepared => offerWalletDownload({ document, prepared }) } = {}) {
  const host = document.createElement("details"); host.className = "saved-batch-comparison"; parent.append(host);
  let disposed = false, revision = 0, baseline = null, current = null, comparison = null;
  let reviewed = null, reviewActive = null;
  const cleanup = [];
  function make(tag, name, text, target = host) { const element = document.createElement(tag); element.className = "saved-batch-comparison-" + name; if (text !== undefined) element.textContent = text; target.append(element); return element; }
  function button(name, text) { const element = make("button", name, text); element.type = "button"; return element; }
  function listen(node, event, callback) { node.addEventListener(event, callback); cleanup.push(() => node.removeEventListener(event, callback)); }
  make("summary", "heading", "二組の保存ファイルの変化を比較する");
  make("p", "intro", "上の確認結果を比較元として保持し、別の組のファイルを選んで確認してください。同じファイル名同士を比較します。比較元はこのページ内で保持されます。取り除く場合は『比較元をクリア』を押してください。");
  const hold = button("hold", "現在の一括確認を比較元として保持"), clear = button("clear", "比較元をクリア");
  const baselineText = make("p", "baseline"), summary = make("p", "summary"); summary.setAttribute("role", "status"); summary.setAttribute("aria-live", "polite");
  const table = make("table", "table"); make("caption", "caption", "二組の選択ファイルの比較", table);
  const head = make("thead", "head", undefined, table), headings = make("tr", "headings", undefined, head);
  for (const text of ["ファイル名", "比較結果", "比較元 → 今回の状態", "比較元のSHA-256", "今回のSHA-256", "元記録の変化"]) { const cell = document.createElement("th"); cell.textContent = text; cell.setAttribute("scope", "col"); headings.append(cell); }
  const rows = make("tbody", "rows", undefined, table);
  const ackLabel = make("label", "ack-label", "二組の確認結果とファイル名・照合値を、暗号化せずPCに保存します"), ack = make("input", "ack", undefined, ackLabel); ack.type = "checkbox";
  const json = button("json", "二組の比較をJSON保存"), csv = button("csv", "二組の比較をCSV保存"), saveStatus = make("p", "save-status"); saveStatus.setAttribute("role", "status");
  make("p", "limits", "ファイルが選択されていないことと、PCから削除されたことは別です。同じ内容でも出所や現在のチェーンは保証しません。この比較には元記録の本文は含まれず、復元には使えません。両方の元ファイルを別に保全してください。");
  const reviewBox = make("details", "review"); make("summary", "review-heading", "保存した一括比較JSONを照合する", reviewBox);
  make("p", "review-intro", "現在の比較元と今回の確認結果を使い、以前保存した比較JSONの結論を再計算します。照合の一致と、元のファイル同士の一致は別の判定です。", reviewBox);
  const reviewLabel = make("label", "review-file-label", "照合する一括比較JSON（最大1 MiB）", reviewBox), reviewFile = make("input", "review-file", undefined, reviewLabel); reviewFile.type = "file"; reviewFile.accept = ".json,application/json";
  const reviewStop = make("button", "review-stop", "比較JSONの照合を中止", reviewBox); reviewStop.type = "button";
  const reviewStatus = make("p", "review-status", "比較する二組を確認してから、保存した比較JSONを選んでください。", reviewBox); reviewStatus.setAttribute("role", "status"); reviewStatus.setAttribute("aria-live", "polite");
  const reviewAckLabel = make("label", "review-ack-label", "比較JSONの照合結果と照合値を、暗号化せずPCに保存します", reviewBox), reviewAck = make("input", "review-ack", undefined, reviewAckLabel); reviewAck.type = "checkbox";
  const reviewSave = make("button", "review-save", "比較JSONの照合結果を保存", reviewBox); reviewSave.type = "button";
  const reviewSaveStatus = make("p", "review-save-status", "", reviewBox); reviewSaveStatus.setAttribute("role", "status");
  const labels = { identical: "同じ元記録・同じ書式", "format-only": "書式だけの違い", "changed-original": "元記録が変化", "different-format": "異なる形式", unverified: "元記録を比較できません", "only-before": "比較元だけに選択", "only-after": "今回だけに選択" };
  const statusLabels = { "validated-original": "元記録を確認", "validated-structure": "データ形式を確認・内部チェックサムなし", "declared-only": "補助資料の形式だけ", invalid: "形式・内部照合の問題", "hash-unavailable": "照合値を計算できません", "source-unavailable": "ファイルを読み込めません", "checksum-mismatch": "以前の照合値と不一致", pending: "未確認" };
  function controls() {
    hold.disabled = disposed || !current || Boolean(reviewActive); clear.disabled = disposed || !baseline; ack.disabled = disposed || !comparison; json.disabled = csv.disabled = ack.disabled || !ack.checked;
    reviewBox.setAttribute("aria-busy", reviewActive ? "true" : "false"); reviewFile.disabled = disposed || !comparison || Boolean(reviewActive); reviewStop.disabled = disposed || !reviewActive;
    reviewAck.disabled = disposed || Boolean(reviewActive) || !reviewed; reviewSave.disabled = reviewAck.disabled || !reviewAck.checked;
  }
  function render() {
    baselineText.textContent = baseline ? `比較元を保持しています：${baseline.summary.selected}件、確認済み ${baseline.summary.checked}件、未確認 ${baseline.summary.pending}件。` : "比較元はまだ保持していません。";
    summary.textContent = comparison ? walletSavedBatchComparisonText(comparison) : baseline ? "比較元を保持しています。別の組のファイルを上で確認すると比較します。" : "上で元のファイルを確認してから、比較元として保持してください。";
    rows.replaceChildren(...(comparison?.files ?? []).map(row => {
      const tr = document.createElement("tr");
      const states = (statusLabels[row.before?.status] ?? "選択なし") + " → " + (statusLabels[row.after?.status] ?? "選択なし");
      const details = row.comparison ? walletSavedComparisonText(row.comparison) : "元記録の内容の一致や変化は判断していません。";
      for (const value of [row.name, labels[row.kind], states, row.before?.sha256 ?? "未計算・選択なし", row.after?.sha256 ?? "未計算・選択なし", details]) { const cell = document.createElement("td"); cell.textContent = value; tr.append(cell); }
      return tr;
    })); controls();
  }
  function changed() {
    const own = ++revision, old = reviewActive; reviewActive = null; reviewed = null; reviewAck.checked = false; ack.checked = false; saveStatus.textContent = ""; reviewSaveStatus.textContent = "";
    old?.abort(); if (disposed || own !== revision) return;
    comparison = baseline && current ? compareWalletSavedTextBatches(baseline, current) : null;
    reviewStatus.textContent = "比較する二組を確認してから、保存した比較JSONを選んでください。"; render();
  }
  listen(hold, "click", () => { if (disposed || !current) return; baseline = current; changed(); });
  listen(clear, "click", () => { if (disposed) return; baseline = null; changed(); });
  listen(ack, "change", controls);
  listen(reviewAck, "change", controls);
  listen(reviewFile, "change", async () => {
    if (disposed || !comparison || reviewActive) return;
    const chosen = reviewFile.files?.[0]; reviewFile.value = ""; if (!chosen) return;
    const own = ++revision, pair = comparison, local = new AbortController(); reviewActive = local; reviewed = null; reviewAck.checked = false; reviewSaveStatus.textContent = "";
    reviewStatus.textContent = "保存した一括比較JSONを再計算と照合しています。"; controls();
    try {
      const text = await readText(chosen, { maxBytes: WALLET_SAVED_BATCH_COMPARISON_REVIEW_LIMIT, signal: local.signal });
      if (disposed || own !== revision) return;
      const value = await review(pair.before, pair.after, text, { signal: local.signal });
      if (disposed || own !== revision) return; reviewed = value;
      reviewStatus.textContent = value.matchesRecomputation ? "保存した比較JSONは、この二組から再計算した結果と一致しました。" : `保存した比較JSONに不一致があります。異なる項目 ${value.differences.length}件、余分な項目 ${value.unexpectedFields}件。`;
      reviewStatus.textContent += value.allSelectedOriginalsIdentical ? " 元のファイル同士も、選択した全件が同じ元記録・同じ書式です。" : " 元のファイル同士が全件一致したという意味ではありません。上の比較結果をご確認ください。";
    } catch { if (!disposed && own === revision) reviewStatus.textContent = "比較JSONを照合できませんでした。1 MiB以内の元の一括比較JSONを選び直してください。二組の確認結果は保持しています。"; }
    finally { local.abort(); if (!disposed && own === revision) { reviewActive = null; controls(); } }
  });
  listen(reviewStop, "click", () => {
    if (disposed || !reviewActive) return; const own = ++revision, old = reviewActive; reviewActive = null; reviewed = null; reviewAck.checked = false; old.abort();
    if (disposed || own !== revision) return; reviewStatus.textContent = "比較JSONの照合を中止しました。二組の確認結果は保持しています。"; controls();
  });
  listen(reviewSave, "click", () => {
    if (disposed || reviewActive || !reviewed || !reviewAck.checked || reviewSave.disabled) return;
    const own = revision, value = reviewed; reviewAck.checked = false; controls();
    try { const prepared = Object.freeze({ text: encodeWalletSavedBatchComparisonReview(value), filename: "ThreeCore-wallet-saved-batch-comparison-review.json", mimeType: "application/json;charset=utf-8", restorable: false, containsOriginalEvidence: false, encrypted: false }), delivered = download(prepared), kind = observeCallbackResult(delivered);
      if (!disposed && own === revision && reviewed === value) reviewSaveStatus.textContent = kind === "synchronous" && delivered !== false ? "照合結果の保存処理を開始しました。ダウンロード先をご確認ください。" : "照合結果の保存を確認できませんでした。結果は保持しています。";
    } catch { if (!disposed && own === revision && reviewed === value) reviewSaveStatus.textContent = "照合結果の保存を確認できませんでした。結果は保持しています。"; }
  });
  for (const [button, format] of [[json, "json"], [csv, "csv"]]) listen(button, "click", () => {
    if (disposed || button.disabled || !comparison || !ack.checked) return;
    const own = revision, value = comparison; ack.checked = false; controls();
    try { const prepared = Object.freeze({ text: encodeWalletSavedBatchComparison(value, format), filename: "ThreeCore-wallet-saved-batch-comparison." + format, mimeType: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8", restorable: false, containsOriginalEvidence: false, encrypted: false });
      const delivered = download(prepared), kind = observeCallbackResult(delivered);
      if (!disposed && own === revision && comparison === value) saveStatus.textContent = kind === "synchronous" && delivered !== false ? "比較の保存処理を開始しました。ダウンロード先をご確認ください。" : "比較の保存を確認できませんでした。結果は保持しています。";
    } catch { if (!disposed && own === revision && comparison === value) saveStatus.textContent = "比較の保存を確認できませんでした。結果は保持しています。"; }
  });
  render();
  return Object.freeze({ updateCurrent(value) {
    if (disposed || current === value) return;
    if (value !== null) compareWalletSavedTextBatches(value, value); // Validate ownership before changing the retained pair.
    current = value; changed();
  }, getState: () => Object.freeze({ baseline, current, comparison, reviewed, reviewing: Boolean(reviewActive), disposed }), dispose() {
    if (disposed) return; disposed = true; ++revision; baseline = null; current = null; comparison = null; reviewed = null; const old = reviewActive; reviewActive = null; old?.abort(); ack.checked = false; reviewAck.checked = false; cleanup.forEach(remove => remove()); controls(); host.remove();
  } });
}

/** Owns a portable bundle review; has no wallet, import, or storage capability. */
export function mountSavedComparisonBundlePanel({ document, parent, getPair = () => null,
  readText = readSavedGuideText, download = prepared => offerWalletDownload({ document, prepared }) } = {}) {
  const host = document.createElement("details"); host.className = "saved-bundle"; parent.append(host);
  const nodes = {}, cleanup = []; let disposed = false, busy = false, generation = 0, aborter = null, receipt = null, workKind = null, lastPair = null;
  function node(tag, name, text, target = host) { const value = document.createElement(tag); value.className = "saved-bundle-" + name; if (text !== undefined) value.textContent = text; target.append(value); nodes[name] = value; return value; }
  function checkbox(name, text) { const label = node("label", name + "-label", text), field = node("input", name, undefined, label); field.type = "checkbox"; return field; }
  function button(name, text) { const value = node("button", name, text); value.type = "button"; return value; }
  node("summary", "heading", "比較と両方の元資料を、一つのJSONで保全する");
  node("p", "intro", "上で比較した両方の元のJSONを、そのままの文字列でまとめます。元資料の合計は24 MiBまでです。大きい場合は2つの元ファイルを別々に保全してください。補助資料だけの比較はまとめられません。");
  const exportAck = checkbox("export-ack", "両方の元資料のアドレス・残高・履歴・メモを、暗号化せず一つのJSONに保存します");
  const exportButton = button("export", "比較と両方の元資料をまとめてJSON保存");
  node("h4", "open-heading", "まとめた資料を読み取り専用で確認する");
  const fileLabel = node("label", "file-label", "まとめた比較資料のJSON（最大48 MiB）"), file = node("input", "file", undefined, fileLabel); file.type = "file"; file.accept = ".json,application/json";
  const stop = button("stop", "まとめた資料の処理を中止"), status = node("p", "status", "元資料の取込みや接続は行いません。"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const notice = node("p", "notice"), output = node("pre", "output", ""), selectionNotice = createFileSelectionNotice(file, notice);
  const sourceAck = checkbox("source-ack", "確認済み資料から、元のアドレス・残高・履歴・メモを含むファイルを暗号化せず取り出します");
  const before = button("before", "比較元の元ファイルを取り出す"), after = button("after", "比較先の元ファイルを取り出す");
  node("p", "limits", "再計算と一致する資料だけから取り出せます。元ファイルの形式・制限を保ち、ウォレットへの接続や復元は自動で行いません。");
  const current = () => { try { return getPair(); } catch { return null; } };
  const usable = pair => Boolean(pair?.comparison?.before?.validation === "validated-original" && pair?.comparison?.after?.validation === "validated-original" && pair.beforeFile && pair.afterFile);
  function render() {
    if (disposed) return;
    const pair = current(); host.setAttribute("aria-busy", String(busy));
    exportAck.disabled = busy || !usable(pair); exportButton.disabled = busy || !usable(pair) || !exportAck.checked;
    file.disabled = busy; stop.disabled = !busy; sourceAck.disabled = busy || !receipt?.originalsAvailable;
    before.disabled = after.disabled = busy || !receipt?.originalsAvailable || !sourceAck.checked;
    output.textContent = walletSavedBundleReviewText(receipt);
  }
  function cancel() {
    if (disposed) return;
    const own = ++generation, previous = aborter; aborter = null; busy = false; workKind = null; exportAck.checked = false; sourceAck.checked = false;
    previous?.abort(); if (disposed || generation !== own) return;
    status.textContent = "処理を中止しました。元のファイルは変更していません。"; render();
  }
  function updatePair() {
    if (disposed) return;
    const next = current()?.comparison ?? null;
    if (next !== lastPair) { lastPair = next; exportAck.checked = false; if (busy && workKind === "export") { cancel(); return; } }
    render();
  }
  const same = own => !disposed && generation === own;
  function failCode(code) { const error = new Error(code); error.code = code; throw error; }
  function named(chosen) { readFormatFileName(chosen, { maxLength: 180, code: "FILE_INSPECTION_NAME", fail: failCode }); }
  async function exportPair() {
    if (disposed || busy || !exportAck.checked) return;
    const captured = current(); if (!usable(captured)) return;
    const own = ++generation, local = new AbortController(); aborter = local; busy = true; workKind = "export"; exportAck.checked = false;
    status.textContent = "両方の元ファイルを読み直し、比較時の内容と一致することを確認しています。"; render();
    const unchanged = () => { if (!same(own)) return false; const value = current(); if (!same(own)) return false; if (value?.comparison !== captured.comparison) failCode("FILE_BUNDLE_SOURCE_CHANGED"); return true; };
    try {
      if (!unchanged()) return; named(captured.beforeFile); if (!unchanged()) return; named(captured.afterFile);
      const sizes = [captured.beforeFile.size, captured.afterFile.size];
      if (!unchanged()) return;
      if (sizes.some(size => !Number.isSafeInteger(size) || size < 1) || sizes[0] + sizes[1] > WALLET_SAVED_BUNDLE_SOURCE_LIMIT) failCode("FILE_BUNDLE_SIZE");
      const beforeText = await readText(captured.beforeFile, { maxBytes: WALLET_SAVED_BUNDLE_SOURCE_LIMIT, signal: local.signal }); if (!unchanged()) return;
      const afterText = await readText(captured.afterFile, { maxBytes: WALLET_SAVED_BUNDLE_SOURCE_LIMIT, signal: local.signal }); if (!unchanged()) return;
      const prepared = await prepareWalletSavedBundle(beforeText, afterText, { signal: local.signal }); if (!unchanged()) return;
      if (prepared.comparison.before.textDigest !== captured.comparison.before.textDigest || prepared.comparison.after.textDigest !== captured.comparison.after.textDigest) failCode("FILE_BUNDLE_SOURCE_CHANGED");
      const delivery = download(prepared), kind = observeCallbackResult(delivery); if (!unchanged()) return;
      status.textContent = kind === "synchronous" && delivery !== false ? "両方の元資料を含むJSONの保存処理を開始しました。ダウンロード先をご確認ください。" : "まとめた資料の保存を確認できませんでした。";
    } catch (error) { if (same(own)) status.textContent = walletSavedInspectionErrorText(error); }
    finally { if (same(own)) { aborter = null; busy = false; workKind = null; render(); } }
  }
  async function openBundle() {
    if (disposed || busy) return;
    const chosen = file.files?.[0]; file.value = ""; if (!chosen) { selectionNotice.noSelection(); return; }
    const own = ++generation, local = new AbortController(); aborter = local; busy = true; workKind = "review"; receipt = null; sourceAck.checked = false; selectionNotice.clear();
    status.textContent = "まとめた資料の両方の元記録と比較結果を確認しています。"; render();
    try {
      named(chosen); if (!same(own)) return;
      const text = await readText(chosen, { maxBytes: WALLET_SAVED_BUNDLE_LIMIT, signal: local.signal }); if (!same(own)) return;
      const checked = await reviewWalletSavedBundle(text, { signal: local.signal }); if (!same(own)) return;
      receipt = checked;
      status.textContent = checked.originalsAvailable ? "両方の元記録と比較結果を確認しました。内容を確認してから元ファイルを取り出せます。" : "元記録は検証できましたが、比較結果に不一致があります。取り出しは行っていません。";
    } catch (error) { if (same(own)) status.textContent = walletSavedInspectionErrorText(error); }
    finally { if (same(own)) { aborter = null; busy = false; workKind = null; render(); } }
  }
  function extract(role) {
    if (disposed || busy || !receipt?.originalsAvailable || !sourceAck.checked) return;
    const own = ++generation, captured = receipt; sourceAck.checked = false; render();
    try {
      const prepared = walletSavedBundleSourceFile(captured, role), delivery = download(prepared), kind = observeCallbackResult(delivery);
      if (!same(own)) return;
      status.textContent = kind === "synchronous" && delivery !== false ? "元のJSONの保存処理を開始しました。各形式の読込み欄で確認してください。" : "元ファイルの取り出しを確認できませんでした。";
    } catch (error) { if (same(own)) status.textContent = walletSavedInspectionErrorText(error); }
  }
  function listen(element, event, action) { element.addEventListener(event, action); cleanup.push(() => element.removeEventListener(event, action)); }
  listen(exportAck, "change", render); listen(exportButton, "click", () => { void exportPair(); });
  listen(file, "change", () => { void openBundle(); }); listen(stop, "click", cancel); listen(sourceAck, "change", render);
  listen(before, "click", () => extract("before")); listen(after, "click", () => extract("after")); updatePair();
  return Object.freeze({ updatePair, getState: () => Object.freeze({ busy, receipt, disposed }), dispose() {
    if (disposed) return; disposed = true; generation++; const previous = aborter; aborter = null; busy = false; receipt = null;
    previous?.abort(); selectionNotice.dispose(); cleanup.forEach(remove => remove()); host.remove();
  } });

}
