import { offerWalletDownload } from "./export-download.js";
import { readSecurityFileBytes, readFormatFileName } from "../src/security-file.js";
import { prepareWalletSavedSourceBundle, reviewWalletSavedBundle, walletSavedBundleSourceFile, walletSavedBundleReviewText, WALLET_SAVED_BUNDLE_LIMIT, WALLET_SAVED_BUNDLE_SOURCE_LIMIT, inspectWalletSavedText, walletSavedComparisonText, reviewWalletSavedComparison, walletSavedComparisonReviewText, WALLET_SAVED_COMPARISON_REVIEW_LIMIT, walletSavedInspectionText, walletSavedInspectionErrorText, WALLET_SAVED_INSPECTION_LIMIT } from "../src/file-read-status.js";
import { walletFileReadService } from "../src/file-read-service.js";
import { describeFileReadStatus, describeFileReadError } from "../src/file-read-status.js";
import { compareWalletSavedTextInspections } from "../src/file-read-status.js";
import { inspectWalletSavedTextDifferences, encodeWalletSavedTextDifferences, WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT } from "../src/file-read-status.js";
import { reviewWalletSavedTextDifferences, encodeWalletSavedTextDifferenceReview, walletSavedTextDifferenceReviewText, WALLET_SAVED_DIFFERENCE_REVIEW_LIMIT } from "../src/file-read-status.js";
import { queryWalletSavedTextDifferences, walletSavedTextDifferencePageText, encodeWalletSavedTextDifferencePage } from "../src/file-read-status.js";
import { encodeWalletSavedBundleReview } from "../src/file-read-status.js";
import { canPrepareWalletSavedBatchEvidence, prepareWalletSavedBatchEvidence, reviewWalletSavedBatchEvidence,
  encodeWalletSavedBatchEvidenceReview, openReviewedWalletSavedBatchEvidence, extractWalletSavedBatchEvidenceSource, WALLET_SAVED_BATCH_EVIDENCE_LIMIT } from "../src/file-read-status.js";
import { reviewWalletSavedBundleReceipt, encodeWalletSavedBundleReceiptCheck, walletSavedBundleReceiptCheckText, WALLET_SAVED_BUNDLE_RECEIPT_LIMIT } from "../src/file-read-status.js";
import { reviewWalletSavedBatchEvidenceReceipt, encodeWalletSavedBatchEvidenceReceiptCheck } from "../src/file-read-status.js";
import { queryWalletSavedBatchFiles, encodeWalletSavedBatchSelection } from "../src/file-read-status.js";
import { reviewWalletSavedBatchSelection, encodeWalletSavedBatchSelectionReview, extractWalletSavedBatchSelectionQuery } from "../src/file-read-status.js";
import { prepareWalletBatchComparisonEvidence, reviewWalletBatchComparisonEvidence, encodeWalletBatchComparisonEvidenceReview,
  openReviewedWalletBatchComparisonEvidence, extractWalletBatchComparisonEvidenceSource, WALLET_BATCH_COMPARISON_EVIDENCE_LIMIT } from "../src/file-read-status.js";
import { queryWalletBatchComparisonDifferences, encodeWalletBatchComparisonDifferences } from "../src/file-read-status.js";
import { consumeCleanup } from "../src/file-read-policy.js";
import { observeCallbackResult } from "../src/security-callback.js";
import { boundedUtf8Length } from "../src/security-json.js";
import { sha256Hex } from "../src/security-data.js";
import { validateWalletSavedBatchSelection, encodeWalletSavedTextBatch,
  walletSavedTextBatchManifest, WALLET_SAVED_BROWSER_BATCH_LIMITS, matchWalletSavedBatchManifest,
  WALLET_SAVED_BATCH_MANIFEST_LIMIT, encodeWalletSavedTextBatchCsv, compareWalletSavedTextBatches,
  encodeWalletSavedBatchComparison, walletSavedBatchComparisonText, reviewWalletSavedBatchComparison,
  encodeWalletSavedBatchComparisonReview, WALLET_SAVED_BATCH_COMPARISON_REVIEW_LIMIT, inspectWalletSavedFileBatch,
  resumeWalletSavedFileBatch, canResumeWalletSavedFileBatch, retryWalletSavedFileBatch, canRetryWalletSavedFileBatch } from "../src/file-read-status.js";

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
  const savedGuide = mountSavedFileInspectionPanel({ document, parent: section, destinations: savedFileDestinations,
    reviewBatchEvidence: file => savedBatch.inspectEvidenceFile(file), reviewComparisonEvidence: file => savedBatch.inspectComparisonEvidenceFile(file) });
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
  destinations = {}, reviewBatchEvidence = null, reviewComparisonEvidence = null,
  download = prepared => offerWalletDownload({ document, prepared }) } = {}) {
  const host = document.createElement("details"); host.className = "saved-file-guide";
  parent.append(host); const nodes = {}, cleanup = [];
  let disposed = false, generation = 0, aborter = null, busy = false, result = null, comparison = null, comparisonReview = null, workKind = "source";
  let sourceFile = null, comparisonSourceFile = null, bundlePanel = null, differencePanel = null;
  let handoffGeneration = null;
  const destinationCallbacks = Object.create(null);
  for (const target of ["period", "library", "report", "history", "set", "workspace", "setup", "transfer-vault", "reconciliation", "token-plan", "portfolio", "portfolio-history"]) {
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
  const batchEvidence = make("button", "batch-evidence", "このファイルを一括資料として再確認"); batchEvidence.type = "button";
  const batchEvidenceStatus = make("p", "batch-evidence-status", ""); batchEvidenceStatus.setAttribute("role", "status"); batchEvidenceStatus.setAttribute("aria-live", "polite");
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
    const comparisonEvidence = result?.sourceSchema === "threecore.wallet-batch-comparison-evidence.v1";
    batchEvidence.textContent = comparisonEvidence ? "このファイルを二組の比較資料として再確認" : "このファイルを一括資料として再確認";
    batchEvidence.disabled = disposed || busy || handoffGeneration === generation || !sourceFile ||
      (comparisonEvidence ? typeof reviewComparisonEvidence !== "function" : result?.sourceSchema !== "threecore.wallet-saved-batch-evidence.v1" || typeof reviewBatchEvidence !== "function");
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
    handoffGeneration = null; batchEvidenceStatus.textContent = "";
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
  listen(batchEvidence, "click", async () => {
    if (disposed || busy || batchEvidence.disabled || !sourceFile) return;
    const own = generation, captured = result, file = sourceFile, comparisonEvidence = captured.sourceSchema === "threecore.wallet-batch-comparison-evidence.v1", target = comparisonEvidence ? "二組の比較資料" : "一括資料";
    handoffGeneration = own; batchEvidenceStatus.textContent = "同じファイルを" + target + "の再確認へ渡しています。形式の案内だけでは、内容の一致を判断しません。"; render();
    try {
      const accepted = await (comparisonEvidence ? reviewComparisonEvidence : reviewBatchEvidence)(file);
      if (!disposed && generation === own && result === captured) batchEvidenceStatus.textContent = accepted === true ?
        "同じファイルの再確認を終えました。" + target + "の欄で結果をご確認ください。履歴や設定の復元は行っていません。" :
        "再確認の完了を確認できませんでした。" + target + "の欄の結果をご確認ください。この案内は保持しています。";
    } catch { if (!disposed && generation === own && result === captured) batchEvidenceStatus.textContent = target + "の再確認へ渡せませんでした。この案内は保持しています。"; }
    finally {
      if (!disposed && handoffGeneration === own) {
        handoffGeneration = null;
        if (generation !== own || result !== captured) batchEvidenceStatus.textContent = "";
        render();
      }
    }
  });
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
    sourceFile = null; comparisonSourceFile = null; handoffGeneration = null; bundlePanel.dispose(); differencePanel.dispose();
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
  let disposed = false, busy = false, generation = 0, aborter = null, result = null, page = null, queryDirty = false, lastPair = null, reviewPanel = null;
  const cleanup = [];
  function node(tag, name, text, target = host) { const value = document.createElement(tag); value.className = "saved-differences-" + name; if (text !== undefined) value.textContent = text; target.append(value); return value; }
  node("summary", "heading", "設定や練習用JSONの、変わった箇所を調べる");
  node("p", "intro", "上で比較した同じ形式の設定・残高記録・練習用記録を読み直します。各2 MiBまで。値は表示せず、相違箇所の合計と先頭40件の場所を表示します。");
  const start = node("button", "start", "相違箇所を調べる"), stop = node("button", "stop", "相違箇所の確認を中止"); start.type = stop.type = "button";
  const status = node("p", "status", "対応する2つの元ファイルを比較してから確認できます。"), output = node("pre", "output", ""); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  output.setAttribute("tabindex", "0"); output.setAttribute("role", "region"); output.setAttribute("aria-label", "保存ファイルの相違箇所");
  const pathLabel = node("label", "path-label", "項目の場所に含まれる文字で絞り込む"), path = node("input", "path", undefined, pathLabel); path.type = "text"; path.maxLength = 128; path.placeholder = "例: /policy や /events";
  const apply = node("button", "apply", "この条件で絞り込む"), clear = node("button", "clear-query", "絞り込みを解除"), previous = node("button", "previous", "前の40件"), next = node("button", "next", "次の40件"); for (const button of [apply, clear, previous, next]) button.type = "button";
  node("p", "page-scope", "今回読み取った元JSONから、表示範囲を選びます。ファイルを読み直すには、上の「相違箇所を調べる」を押してください。場所の絞り込みは値の検索ではありません。");
  const label = node("label", "ack-label", "相違箇所と元ファイルの照合値を、暗号化せずPCに保存します"), ack = node("input", "ack", undefined, label); ack.type = "checkbox";
  const save = node("button", "save", "照合用の相違箇所JSONを保存（先頭40件）"), pageSave = node("button", "page-save", "表示範囲をJSON保存"), csv = node("button", "csv", "表示範囲をCSV保存"); save.type = pageSave.type = csv.type = "button";
  const current = () => { try { return getPair(); } catch { return null; } };
  const usable = pair => Boolean(pair?.comparison?.before?.validation === "validated-structure" && pair?.comparison?.after?.validation === "validated-structure" && pair.comparison.before.sourceSchema === pair.comparison.after.sourceSchema && pair.beforeFile && pair.afterFile);
  const same = own => !disposed && generation === own;
  function render() { if (disposed) return; host.setAttribute("aria-busy", String(busy)); start.disabled = busy || !usable(current()); stop.disabled = !busy;
    path.disabled = apply.disabled = clear.disabled = busy || !result; previous.disabled = busy || queryDirty || !page?.hasPrevious; next.disabled = busy || queryDirty || !page?.hasNext;
    ack.disabled = busy || !result || queryDirty; save.disabled = busy || !result || queryDirty || !ack.checked; pageSave.disabled = csv.disabled = save.disabled || !page;
    output.textContent = page ? walletSavedTextDifferencePageText(page) : ""; reviewPanel?.updateResult(); }
  function cancel() { if (disposed) return; const own = ++generation, previous = aborter; aborter = null; busy = false; result = null; page = null; path.value = ""; queryDirty = false; ack.checked = false; previous?.abort(); if (same(own)) { status.textContent = "相違箇所の確認を中止しました。元ファイルは変更していません。"; render(); } }
  function updatePair() { if (disposed) return; const next = current()?.comparison ?? null; if (lastPair !== next) { lastPair = next; cancel(); status.textContent = "比較するファイルが変わりました。必要に応じて相違箇所を調べてください。"; } render(); }
  async function inspectPair() {
    if (disposed || busy) return false;
    const captured = current(); if (!usable(captured)) return false;
    const own = ++generation, local = new AbortController(); aborter = local; busy = true; result = null; page = null; path.value = ""; queryDirty = false; ack.checked = false;
    status.textContent = "両方の元ファイルを読み直して相違箇所を確認しています。"; render();
    const unchanged = () => same(own) && current()?.comparison === captured.comparison;
    try {
      const options = { maxBytes: WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT, signal: local.signal };
      const beforeText = await readText(captured.beforeFile, options); if (!unchanged()) return false;
      const afterText = await readText(captured.afterFile, options); if (!unchanged()) return false;
      const checked = await inspectWalletSavedTextDifferences(beforeText, afterText, { signal: local.signal,
        expectedBeforeSha256: captured.comparison.before.textDigest, expectedAfterSha256: captured.comparison.after.textDigest });
      if (!unchanged()) return false;
      const firstPage = queryWalletSavedTextDifferences(checked); result = checked; page = firstPage; status.textContent = "相違箇所を確認しました。元ファイルの値や行を変更していません。"; return true;
    } catch (error) { if (unchanged()) status.textContent = describeFileReadError(error, "各2 MiB") ?? walletSavedInspectionErrorText(error); return false; }
    finally { if (same(own)) { aborter = null; busy = false; render(); } }
  }
  function showPage(offset, pathIncludes) {
    if (disposed || busy || !result) return;
    ack.checked = false;
    try { page = queryWalletSavedTextDifferences(result, { offset, pathIncludes }); queryDirty = false; status.textContent = "指定した表示範囲に切り替えました。元の相違箇所の確認結果は保持しています。"; }
    catch { queryDirty = true; status.textContent = "絞り込み条件を確認してください。128文字以内で、改行や制御文字を含まない文字を入力してください。"; }
    render();
  }
  function saveResult(format = "base") {
    if (disposed || busy || !result || !ack.checked || queryDirty || (format !== "base" && !page)) return;
    const own = generation, captured = result, capturedPage = page; ack.checked = false; render();
    try { const prepared = Object.freeze({ text: format === "base" ? encodeWalletSavedTextDifferences(captured) : encodeWalletSavedTextDifferencePage(capturedPage, format),
      filename: format === "base" ? "ThreeCore-saved-file-differences.json" : `ThreeCore-saved-file-difference-page-${capturedPage.offset}.${format}`,
      mimeType: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false, encrypted: false });
      const delivery = download(prepared), kind = observeCallbackResult(delivery); if (!same(own) || page !== capturedPage || queryDirty) return;
      status.textContent = kind === "synchronous" && delivery !== false ? "相違箇所の保存処理を開始しました。ダウンロード先をご確認ください。" : "相違箇所の保存を確認できませんでした。";
    } catch { if (same(own)) status.textContent = "相違箇所の保存を確認できませんでした。"; }
  }
  function listen(element, event, action) { element.addEventListener(event, action); cleanup.push(() => element.removeEventListener(event, action)); }
  listen(start, "click", () => { void inspectPair(); }); listen(stop, "click", cancel); listen(ack, "change", render); listen(save, "click", () => saveResult());
  listen(pageSave, "click", () => saveResult("json")); listen(csv, "click", () => saveResult("csv"));
  listen(path, "input", () => { if (disposed || busy || !result) return; queryDirty = true; ack.checked = false; status.textContent = "入力した絞り込み条件は未適用です。「この条件で絞り込む」を押してください。"; render(); });
  listen(apply, "click", () => showPage(0, path.value)); listen(clear, "click", () => { path.value = ""; showPage(0, ""); });
  listen(previous, "click", () => { if (!previous.disabled) showPage(page.offset - page.limit, page.query.pathIncludes); });
  listen(next, "click", () => { if (!next.disabled) showPage(page.offset + page.limit, page.query.pathIncludes); });
  reviewPanel = mountSavedFileDifferenceReviewPanel({ document, parent: host, readText, download, getResult: () => !disposed && !busy ? result : null }); updatePair();
  return Object.freeze({ inspectPair, updatePair, getState: () => Object.freeze({ busy, result, page, disposed }), dispose() { if (disposed) return; disposed = true; generation++; const previous = aborter; aborter = null; result = null; page = null; busy = false; previous?.abort(); reviewPanel.dispose(); cleanup.forEach(remove => remove()); host.remove(); } });
}

/** A saved receipt is checked against the current owned calculation, never restored. */
export function mountSavedFileDifferenceReviewPanel({ document, parent, getResult = () => null,
  readText = readSavedGuideText, download = prepared => offerWalletDownload({ document, prepared }) } = {}) {
  const host = document.createElement("details"); host.className = "saved-difference-review"; parent.append(host);
  let disposed = false, busy = false, generation = 0, aborter = null, result = null, lastResult = null;
  const cleanup = [], current = () => { try { return getResult(); } catch { return null; } }, same = own => !disposed && generation === own;
  function node(tag, name, text, target = host) { const value = document.createElement(tag); value.className = "saved-difference-review-" + name; if (text !== undefined) value.textContent = text; target.append(value); return value; }
  node("summary", "heading", "保存した相違箇所JSONを再計算結果と照合する");
  node("p", "intro", "上の「相違箇所を調べる」で得た結果と、以前に保存した相違箇所JSONを照合します。両方の元JSONの照合値、場所・件数・判定を確認します。");
  const label = node("label", "file-label", "保存した相違箇所JSON（最大256 KiB）"), file = node("input", "file", undefined, label); file.type = "file"; file.accept = ".json,application/json";
  const stop = node("button", "stop", "保存結果の照合を中止"); stop.type = "button";
  const status = node("p", "status", "両方の元ファイルから相違箇所を調べてから照合してください。"), notice = node("p", "notice"), output = node("pre", "output", ""); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const selectionNotice = createFileSelectionNotice(file, notice), ackLabel = node("label", "ack-label", "照合結果と照合値を、暗号化せずPCに保存します"), ack = node("input", "ack", undefined, ackLabel); ack.type = "checkbox";
  const save = node("button", "save", "相違箇所の照合結果をJSON保存"); save.type = "button";
  function render() { if (disposed) return; host.setAttribute("aria-busy", String(busy)); file.disabled = busy || !current(); stop.disabled = !busy; ack.disabled = busy || !result; save.disabled = busy || !result || !ack.checked; output.textContent = walletSavedTextDifferenceReviewText(result); }
  function cancel() { if (disposed) return; const own = ++generation, previous = aborter; aborter = null; busy = false; result = null; ack.checked = false; previous?.abort(); if (same(own)) { status.textContent = "保存結果の照合を中止しました。元の確認結果は変更していません。"; render(); } }
  function updateResult() { if (disposed) return; const next = current(); if (lastResult !== next) { lastResult = next; cancel(); status.textContent = next ? "この再計算結果と照合する、保存済みの相違箇所JSONを選んでください。" : "両方の元ファイルから相違箇所を調べてから照合してください。"; } render(); }
  async function inspectFile(chosen) {
    if (disposed || busy) return false;
    const expected = current(); if (!expected) return false;
    const own = ++generation, local = new AbortController(); aborter = local; busy = true; result = null; ack.checked = false; selectionNotice.clear(); status.textContent = "保存した相違箇所JSONを再計算結果と照合しています。"; render();
    const unchanged = () => same(own) && current() === expected;
    try {
      const text = await readText(chosen, { maxBytes: WALLET_SAVED_DIFFERENCE_REVIEW_LIMIT, signal: local.signal }); if (!unchanged()) return false;
      const checked = await reviewWalletSavedTextDifferences(expected, text, { signal: local.signal }); if (!unchanged()) return false;
      result = checked; status.textContent = checked.matchesRecomputation ? "再計算結果との一致を確認しました。元ファイル同士の一致とは別の判定です。" : "再計算結果と一致しない項目が見つかりました。"; return true;
    } catch (error) { if (unchanged()) status.textContent = describeFileReadError(error, "256 KiB") ?? walletSavedInspectionErrorText(error); return false; }
    finally { if (same(own)) { aborter = null; busy = false; render(); } }
  }
  async function selected() { if (disposed || busy) return; const chosen = file.files?.[0]; file.value = ""; if (!chosen) { selectionNotice.noSelection(); return; } return inspectFile(chosen); }
  function saveResult() {
    if (disposed || busy || !result || !ack.checked) return;
    const own = generation, captured = result; ack.checked = false; render();
    try { const prepared = Object.freeze({ text: encodeWalletSavedTextDifferenceReview(captured), filename: "ThreeCore-saved-file-differences-review.json", mimeType: "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false, encrypted: false }), delivery = download(prepared), kind = observeCallbackResult(delivery);
      if (same(own)) status.textContent = kind === "synchronous" && delivery !== false ? "照合結果の保存処理を開始しました。ダウンロード先をご確認ください。" : "照合結果の保存を確認できませんでした。";
    } catch { if (same(own)) status.textContent = "照合結果の保存を確認できませんでした。"; }
  }
  function listen(element, event, action) { element.addEventListener(event, action); cleanup.push(() => element.removeEventListener(event, action)); }
  listen(file, "change", () => { void selected(); }); listen(stop, "click", cancel); listen(ack, "change", render); listen(save, "click", saveResult); updateResult();
  return Object.freeze({ inspectFile, updateResult, getState: () => Object.freeze({ busy, result, disposed }), dispose() { if (disposed) return; disposed = true; generation++; const previous = aborter; aborter = null; busy = false; result = null; previous?.abort(); selectionNotice.dispose(); cleanup.forEach(remove => remove()); host.remove(); } });
}

/** Separate file-only inventory. No restore, account or storage callbacks exist. */
/** Download one selected source from a previously verified batch, without re-reading or importing it. */
export function mountBatchSourceExportPanel({ document, parent, list, extract, download, classPrefix = "batch-source-export" }) {
  const host = document.createElement("details"); host.className = classPrefix; parent.append(host);
  const cleanups = []; let disposed = false, review = null, names = [], generation = 0;
  function make(tag, name, text, target = host) { const node = document.createElement(tag); node.className = classPrefix + "-" + name; if (text !== undefined) node.textContent = text; target.append(node); return node; }
  function listen(node, event, fn) { node.addEventListener(event, fn); cleanups.push(() => node.removeEventListener(event, fn)); }
  make("summary", "heading", "確認済みのまとめ資料から元ファイルを取り出す");
  make("p", "intro", "まとめた資料の再確認が一致した後、取り出すファイルを選びます。内容を変更せず、暗号化せずに保存します。元資料が不正・不一致でも、確認用に取り出せます。その判定は変わりません。");
  const label = make("label", "label", "取り出す元ファイル"), choice = make("select", "choice", undefined, label);
  const status = make("p", "status", "まとめた資料を再確認すると選べます。"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const ackLabel = make("label", "ack-label", "選んだ元ファイルの内容を暗号化せず保存する"), ack = make("input", "ack", undefined, ackLabel); ack.type = "checkbox";
  const save = make("button", "save", "選んだ元ファイルを保存"); save.type = "button";
  function selected() { return review && names.includes(choice.value); }
  const sourceLabels = { invalid: "内容を確認できない", unsupported: "対象外の形式", matched: "再計算と一致", different: "再計算と相違あり", "validated-original": "元記録・内部チェックサム確認済み", "validated-structure": "形式確認済み・内部チェックサムなし", "declared-only": "形式指定だけ", "checksum-mismatch": "以前の照合値と不一致" };
  function buttons() { choice.disabled = disposed || !review; ack.disabled = disposed || !selected(); save.disabled = ack.disabled || !ack.checked; }
  listen(choice, "change", () => {
    if (disposed) return; ack.checked = false;
    try { const prepared = selected() ? extract(review, choice.value) : null; status.textContent = prepared ?
      "選択: " + prepared.filename + " ／ 元資料の確認結果: " + (sourceLabels[prepared.sourceStatus] ?? "元の一覧を確認してください") + " ／ SHA-256: " + prepared.sourceTextDigest + "。取り出しても判定や現在の履歴は変わりません。" : "取り出す元ファイルを選んでください。";
    } catch { status.textContent = "元ファイルを確認できませんでした。まとめた資料を再確認してください。"; choice.value = ""; }
    buttons();
  });
  listen(ack, "change", buttons);
  listen(save, "click", () => {
    if (disposed || save.disabled || !ack.checked || !selected()) return;
    const owner = generation, current = review, name = choice.value; ack.checked = false; buttons();
    try { const prepared = extract(current, name), delivered = download(prepared); if (observeCallbackResult(delivered) !== "synchronous" || delivered === false) throw Error();
      if (!disposed && generation === owner && review === current && choice.value === name) status.textContent = name + " の保存を開始しました。ダウンロード先をご確認ください。元資料の判定と現在の履歴は変わりません。";
    } catch { if (!disposed && generation === owner && review === current && choice.value === name) status.textContent = "保存を確認できませんでした。元資料は保持しています。もう一度選択内容を確認して保存できます。"; }
  });
  function updateCurrent(next) {
    if (disposed || next === review) return; ++generation; review = null; names = []; choice.replaceChildren(); choice.value = ""; ack.checked = false;
    const option = document.createElement("option"); option.value = ""; option.textContent = "元ファイルを選んでください"; choice.append(option);
    if (next) try { const rows = list(next); names = rows.map(row => row.name); for (const name of names) { const option = document.createElement("option"); option.value = name; option.textContent = name; choice.append(option); } review = next; } catch { names = []; }
    status.textContent = review ? names.length + "件の元ファイルから、保存するものを選んでください。" : "まとめた資料を再確認すると選べます。"; buttons();
  }
  buttons();
  return Object.freeze({ updateCurrent, dispose() { if (disposed) return; disposed = true; ++generation; review = null; names = []; cleanups.forEach(remove => remove()); buttons(); host.remove(); } });
}

export function mountSavedFileBatchPanel({ document, parent, readText = readSavedGuideText,
  inspectFiles = inspectWalletSavedFileBatch, resumeFiles = resumeWalletSavedFileBatch, retryFiles = retryWalletSavedFileBatch, subtle = globalThis.crypto?.subtle,
  inspectOriginal = null, compareOriginal = null,
  download = prepared => offerWalletDownload({ document, prepared }) } = {}) {
  const host = document.createElement("details"); host.className = "saved-file-batch"; parent.append(host);
  let disposed = false, generation = 0, selection = null, active = null, result = null, viewRevision = 0;
  let referenceText;
  let comparisonPanel, evidenceReview = null, openedEvidence = null;
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
  const retry = button("retry", "読み込み・照合値の計算に失敗した分を再試行");
  make("p", "retry-intro", "全ファイルを一度確認した後、読み込みや照合値の計算に失敗したものだけを再試行できます。ほかの結果は以前のまま保持します。内容が不正なものや以前の照合値と異なるものは対象にしません。");
  const status = make("p", "status", "ファイルを選び、開始するまで読み込みません。"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const notice = make("p", "notice"), selectionNotice = createFileSelectionNotice(file, notice), summary = make("p", "summary");
  const filterBox = make("div", "filters"), filterNameLabel = make("label", "filter-name-label", "名前に含む文字（80文字まで）", filterBox), filterName = make("input", "filter-name", undefined, filterNameLabel); filterName.type = "text"; filterName.maxLength = 80;
  const filterStatusLabel = make("label", "filter-status-label", "表示する確認結果", filterBox), filterStatus = make("select", "filter-status", undefined, filterStatusLabel);
  const filterLabels = { all: "すべて", "validated-original": "元記録・内部チェックサム確認済み", "validated-structure": "形式確認済み・内部チェックサムなし", "declared-only": "補助資料の形式指定だけ", invalid: "内容を確認できない", "hash-unavailable": "照合値を計算できない", "source-unavailable": "読み込めない", "checksum-mismatch": "以前の照合値と不一致", pending: "未確認" };
  for (const [value, label] of Object.entries(filterLabels)) { const option = document.createElement("option"); option.value = value; option.textContent = label; filterStatus.append(option); } filterStatus.value = "all";
  const filterClear = make("button", "filter-clear", "一覧の絞り込みを解除", filterBox); filterClear.type = "button";
  const filterSummary = make("p", "filter-summary", "確認が終わると、表示する行を絞り込めます。"); filterSummary.setAttribute("role", "status"); filterSummary.setAttribute("aria-live", "polite");
  const tableWrap = make("div", "table-wrap"); tableWrap.className += " file-review-table-wrap"; tableWrap.setAttribute("tabindex", "0"); tableWrap.setAttribute("role", "region"); tableWrap.setAttribute("aria-label", "選択した保存ファイルの確認結果。横方向にスクロールできます");
  const table = make("table", "table", undefined, tableWrap); make("caption", "caption", "選択した保存ファイルの確認結果", table);
  const header = make("thead", "thead", undefined, table), heading = make("tr", "head-row", undefined, header);
  for (const text of ["ファイル名", "確認結果", "開く場所・確認範囲", "内容のSHA-256", "以前の照合値との比較", "詳細確認"]) { const cell = document.createElement("th"); cell.textContent = text; cell.setAttribute("scope", "col"); heading.append(cell); }
  const rows = make("tbody", "rows", undefined, table);
  function applyView() {
    ++viewRevision; exportStatus.textContent = ""; const name = filterName.value ?? "", state = filterStatus.value, valid = name.length <= 80 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name) && Object.hasOwn(filterLabels, state); let shown = 0;
    filterName.setAttribute("aria-invalid", String(!valid));
    for (const [index, row] of Array.from(rows.children).entries()) { const source = result?.files[index], visible = Boolean(valid && source && (state === "all" || source.status === state) && source.name.toLowerCase().includes(name.toLowerCase())); row.hidden = !visible; if (visible) shown++; }
    filterSummary.textContent = !result ? "確認が終わると、表示する行を絞り込めます。" : !valid ? "名前の条件は80文字以内で、改行や制御文字を含めないでください。確認結果と全件保存は保持しています。" : `表示 ${shown}件 / 選択した全 ${result.files.length}件。絞り込みは表示だけです。JSON・CSV・照合値一覧の保存は全件が対象です。`;
    buttons();
  }
  const ackLabel = make("label", "ack-label", "ファイル名・確認結果・照合値を、暗号化せずPCに保存します"), ack = make("input", "ack", undefined, ackLabel); ack.type = "checkbox";
  const save = button("save", "一括確認の控えをJSON保存"), csv = button("csv", "全ファイルの確認結果をCSV保存"), manifest = button("manifest", "今回の内容の照合値一覧を保存");
  const selectionSave = button("selection-save", "表示条件に一致した結果だけをJSON保存");
  make("p", "selection-scope", "条件付きの保存には、一致した行・条件・全体の件数を記録します。元ファイルの内容や全件の控えは含みません。再確認には元資料と全件の控えを保管してください。");
  make("p", "limits", "以前の一覧を指定した場合だけ、その値と比較します。一覧の出所は保証しません。今回の照合値一覧を保存しても、以前の値が正しいことの証明にはなりません。補助資料は形式の案内だけです。この控えに元記録は含まれず、復元には使えません。元ファイルと同じ名前のまま一緒に保管してください。同じ記録が複数の報告に含まれる場合があります。");
  const exportStatus = make("p", "export-status"); exportStatus.setAttribute("role", "status"); exportStatus.setAttribute("aria-live", "polite");
  const evidenceBox = make("details", "evidence"); make("summary", "evidence-heading", "元ファイルと確認結果を一つにまとめる", evidenceBox);
  make("p", "evidence-intro", "読み込みと照合値の計算が終わった全ファイルを、元の内容と新しい確認結果を含む一つのJSONにできます。元ファイルの合計24 MiB、保存後48 MiBまでです。公開アドレス・残高・注記も含み、暗号化しません。中断や再試行の経過を残す場合は、上の確認控えも保管してください。", evidenceBox);
  const evidenceAckLabel = make("label", "evidence-ack-label", "元ファイルの内容もまとめて保存する", evidenceBox), evidenceAck = make("input", "evidence-ack", undefined, evidenceAckLabel); evidenceAck.type = "checkbox";
  const evidenceSave = make("button", "evidence-save", "元ファイルと新しい確認結果をまとめて保存", evidenceBox); evidenceSave.type = "button";
  const evidenceFileLabel = make("label", "evidence-file-label", "まとめて保存した資料を再確認", evidenceBox), evidenceFile = make("input", "evidence-file", undefined, evidenceFileLabel); evidenceFile.type = "file"; evidenceFile.accept = ".json,application/json";
  const evidenceStatus = make("p", "evidence-status", "", evidenceBox); evidenceStatus.setAttribute("role", "status"); evidenceStatus.setAttribute("aria-live", "polite");
  const evidenceReviewSave = make("button", "evidence-review-save", "まとめた資料の照合結果を保存", evidenceBox); evidenceReviewSave.type = "button";
  const sourceExport = mountBatchSourceExportPanel({ document, parent: evidenceBox, download,
    list: review => openReviewedWalletSavedBatchEvidence(review).files,
    extract: extractWalletSavedBatchEvidenceSource });
  const receiptCheck = mountSavedBundleReceiptCheckPanel({ document, parent: evidenceBox, download, readText,
    getExpected: () => disposed || active ? null : evidenceReview, review: reviewWalletSavedBatchEvidenceReceipt,
    encode: encodeWalletSavedBatchEvidenceReceiptCheck, describe: batchEvidenceReceiptCheckText,
    filename: "ThreeCore-wallet-batch-evidence-receipt-check.json" });
  const selectionCheck = mountSavedBundleReceiptCheckPanel({ document, parent: evidenceBox, download, readText,
    getExpected: () => disposed || active ? null : result, review: reviewWalletSavedBatchSelection,
    encode: encodeWalletSavedBatchSelectionReview, describe: batchSelectionReviewText,
    filename: "ThreeCore-wallet-selection-review.json", recordLabel: "条件付きの保存結果",
    heading: "保存した絞り込み結果を現在の一覧と比較する", sourcePrompt: "先に、比較する元ファイルをこの画面で確認してください。",
    intro: "条件付きで保存したJSONを選びます。現在の確認結果から同じ条件を再計算し、保存された行・件数・全体の範囲と比較します。256 KiBまでです。保存時の処理経過や、除外された元ファイルの内容までは証明しません。",
    apply: checked => { if (disposed || active || !result) return false; const query = extractWalletSavedBatchSelectionQuery(checked); filterName.value = query.name; filterStatus.value = query.status; applyView(); return true; } });
  function buttons() {
    receiptCheck.updateExpected();
    selectionCheck.updateExpected();
    sourceExport.updateCurrent(disposed || active ? null : openedEvidence);
    evidenceAck.disabled = disposed || Boolean(active) || !canPrepareWalletSavedBatchEvidence(result);
    evidenceSave.disabled = evidenceAck.disabled || !evidenceAck.checked;
    evidenceFile.disabled = disposed || Boolean(active);
    evidenceReviewSave.disabled = disposed || Boolean(active) || !evidenceReview;
    comparisonPanel?.updateCurrent(!disposed && !active ? result : null);
    host.setAttribute("aria-busy", active ? "true" : "false"); start.disabled = disposed || Boolean(active) || !selection;
    if (referenceText !== undefined && selection) {
      try { matchWalletSavedBatchManifest(selection.map(({ name, byteLength }) => ({ name, byteLength })), referenceText); referenceStatus.textContent = "以前の一覧と、選択した全ファイルの名前が対応しています。開始すると内容を比較します。"; }
      catch (error) { start.disabled = true; referenceStatus.textContent = walletSavedInspectionErrorText(error); }
    } else referenceStatus.textContent = referenceText === undefined ? "以前の一覧は指定されていません。" : "以前の一覧を指定しました。対応する元のJSONをすべて選んでください。";
    stop.disabled = disposed || !active || active.signal.aborted;
    resume.disabled = disposed || Boolean(active) || !selection || !canResumeWalletSavedFileBatch(result);
    retry.disabled = disposed || Boolean(active) || !selection || !canRetryWalletSavedFileBatch(result);
    filterName.disabled = filterStatus.disabled = filterClear.disabled = disposed || Boolean(active) || !result;
    ack.disabled = disposed || Boolean(active) || !result;
    save.disabled = ack.disabled || !ack.checked;
    let validFilter = false; try { if (result) { queryWalletSavedBatchFiles(result, { name: filterName.value, status: filterStatus.value }); validFilter = true; } } catch { /* Invalid conditions cannot be exported. */ }
    selectionSave.disabled = save.disabled || !validFilter;
    csv.disabled = save.disabled;
    manifest.disabled = save.disabled || !result?.complete || result.files.some(row => row.sha256 === null);
  }
  function reset(keepSelection = false) {
    const id = ++generation, old = active; active = null; if (!keepSelection) selection = null; result = null; ack.checked = false;
    old?.abort(); if (!current(id)) return id;
    evidenceReview = null; openedEvidence = null; evidenceAck.checked = false; evidenceFile.value = ""; evidenceStatus.textContent = "";
    rows.replaceChildren(); summary.textContent = ""; exportStatus.textContent = ""; selectionNotice.clear(); filterName.value = ""; filterStatus.value = "all"; applyView(); buttons(); return id;
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
          if (disposed || active || !current(id) || result !== receipt || open.disabled || tr.hidden) return;
          const ownView = viewRevision;
          open.disabled = true;
          try { const accepted = await callback(sourceSelection[index].file, row.sha256);
            if (current(id) && result === receipt && ownView === viewRevision) exportStatus.textContent = accepted === true ? "元記録の詳細確認を上の案内欄に開きました。一括確認の結果は保持しています。" : "詳細確認を完了できませんでした。比較する場合は、先に比較元の詳細を開いてください。上の案内欄をご確認ください。一括確認の結果は保持しています。";
          } catch { if (current(id) && result === receipt && ownView === viewRevision) exportStatus.textContent = "詳細確認を開けませんでした。一括確認の結果は保持しています。"; }
          finally { if (current(id) && result === receipt) open.disabled = false; }
        }); action.append(open);
      } tr.append(action);
      return tr;
    });
    if (!current(id)) return; result = receipt; rows.replaceChildren(...elements); applyView(); evidenceAck.checked = false;
    const s = receipt.summary; summary.textContent = `${s.selected}件中、確認済み ${s.checked}件／未確認 ${s.pending}件。元記録 ${s.validatedOriginals}件、補助資料 ${s.declaredOnly}件、形式・照合値の問題 ${s.invalid + s.hashUnavailable + (s.checksumMismatches ?? 0)}件。`;
    if (s.simulationFiles) summary.textContent += ` 練習用 ${s.simulationFiles}件（実際の入出金の証拠ではありません）。`;
    if (receipt.continuation) summary.textContent += ` 続きの確認 ${receipt.continuation.sequence}回目：前回の結果を保持 ${receipt.continuation.retainedChecks}件（再確認していません）。`;
    if (receipt.retry) summary.textContent += ` 失敗分の再試行 ${receipt.retry.sequence}回目：対象 ${receipt.retry.targetIndexes.length}件中、再試行済み ${receipt.retry.completedIndexes.length}件／今回まだ再試行していないもの ${receipt.retry.remainingIndexes.length}件。前回の結果を保持 ${receipt.retry.retainedChecks}件。`;
    if (s.structureValidated) summary.textContent += ` データ形式を確認・内部チェックサムなし ${s.structureValidated}件。内部チェックサム付きの元記録とは分けています。`;
    if (s.sourceUnavailable) summary.textContent += ` ファイルを読み込めなかったもの ${s.sourceUnavailable}件。ほかのファイルの確認結果は残しています。`;
    if (receipt.referenceProvided) summary.textContent += ` 以前の照合値との一致 ${s.checksumsMatching}件／不一致 ${s.checksumMismatches}件／未比較 ${s.selected - s.checksumsCompared}件。`;
    status.textContent = receipt.complete ? s.sourceUnavailable ? "読み込めないファイルがありました。ほかのファイルの確認結果は残しています。各行をご確認ください。" : "一括確認を終えました。各ファイルの結果をご確認ください。" : receipt.phase === "timed-out" ? "待ち時間の上限で止めました。確認できた分と未確認の行を含む控えを保存できます。" : "一括確認を止めました。確認できた分の控えを保存できます。未確認の行も含みます。";
    if (receipt.retry) status.textContent = receipt.complete ? "失敗分の再試行を終えました。結果は各行をご確認ください。対象外の結果は前回のものです。" : "失敗分の再試行を中止・時間切れで止めました。まだ再試行していない行は、前回の失敗結果を保持しています。";
  }
  async function run(previous = null, retryFailed = false) {
    if (disposed || active || !selection || (retryFailed ? retry.disabled : previous ? resume.disabled : start.disabled)) return;
    const id = ++generation, chosen = selection, manifestText = referenceText, local = new AbortController(); active = local; result = previous; ack.checked = false;
    evidenceReview = null; openedEvidence = null; evidenceAck.checked = false; evidenceStatus.textContent = "";
    if (!previous) { rows.replaceChildren(); summary.textContent = ""; } exportStatus.textContent = ""; buttons();
    try {
      if (manifestText !== undefined) matchWalletSavedBatchManifest(chosen.map(({ name, byteLength }) => ({ name, byteLength })), manifestText);
      const read = (index, options) => {
        if (current(id)) status.textContent = `ファイルを読み込んでいます（${index + 1} / ${chosen.length}）：${chosen[index].name}`;
        return readText(chosen[index].file, options);
      };
      const options = { signal: local.signal, subtle, onProgress: p => { if (current(id)) status.textContent = p.retrySelected !== undefined ? `失敗分を再試行しています（${p.retryChecked} / ${p.retrySelected}件）。対象外の結果は保持しています。` : `元記録を確認しています（${p.checked} / ${p.selected}件）。`; } };
      const receipt = previous ? await (retryFailed ? retryFiles : resumeFiles)(previous, read, options) : await inspectFiles(chosen.map(({ name, byteLength }) => ({ name, byteLength })), read, { ...options, manifestText });
      if (current(id)) render(receipt, id);
    } catch (error) { if (current(id)) { if (previous) render(previous, id); status.textContent = (retryFailed ? "再試行を完了できませんでした。前回の結果は保持しています。" : previous ? "続きの確認を完了できませんでした。前回の結果は保持しています。" : local.signal.aborted ? "ファイルの読み込みを中止しました。確認結果はまだありません。" : "まとめて読み込めませんでした。") + errorText(error); } }
    finally { local.abort(); if (current(id)) { active = null; if (!result && local.signal.aborted && status.textContent.startsWith("中止しています")) status.textContent = "ファイルの読み込みを中止しました。確認結果はまだありません。"; buttons(); } }
  }
  async function evidenceJob(chosenFile = null) {
    if (disposed || active || (chosenFile ? evidenceFile.disabled : evidenceSave.disabled)) return;
    const id = ++generation, previous = result, local = new AbortController(); active = local;
    evidenceReview = null; evidenceAck.checked = false; ack.checked = false; buttons(); let message = "", accepted = false;
    try {
      evidenceStatus.textContent = chosenFile ? "まとめた資料を読み込み、元ファイルを再確認しています。" : "元ファイルから新しい確認結果を作っています。";
      const options = { subtle, signal: local.signal, onProgress: p => { if (current(id)) evidenceStatus.textContent = `元ファイルを確認しています（${p.checked} / ${p.selected}件）。`; } };
      if (chosenFile) {
        const text = await readText(chosenFile, { maxBytes: WALLET_SAVED_BATCH_EVIDENCE_LIMIT, signal: local.signal });
        const review = await reviewWalletSavedBatchEvidence(text, options);
        if (!current(id) || local.signal.aborted) return;
        evidenceReview = review;
        if (review.matchesRecomputation) {
          const opened = openReviewedWalletSavedBatchEvidence(review);
          selection = Object.freeze(opened.files.map(row => Object.freeze({ name: row.name,
            file: new File([row.text], row.name, { type: "application/json" }), byteLength: boundedUtf8Length(row.text, WALLET_SAVED_BROWSER_BATCH_LIMITS.fileBytes) })));
          referenceText = opened.result.referenceProvided ? opened.result.reference.text : undefined;
          referenceInput.value = referenceText ?? ""; referenceFile.value = ""; file.value = "";
          filterName.value = ""; filterStatus.value = "all"; render(opened.result, id);
          openedEvidence = review;
          accepted = true;
          message = "保存内容と再確認の結果が一致しました。元ファイルを確認一覧に開きました。ウォレットの履歴や設定への取り込みは行っていません。";
          if (!review.allOriginalsValidated) message += " 内部チェックサムのない資料・補助資料・確認できない資料は、各行で区別しています。";
        } else {
          if (previous) render(previous, id);
          message = "保存内容と再確認の結果に相違があります。現在の一覧は置き換えていません。照合結果の控えを保存できます。";
        }
      } else {
        const prepared = await prepareWalletSavedBatchEvidence(previous, options);
        if (!current(id) || result !== previous || local.signal.aborted) return;
        const delivered = download(prepared);
        if (observeCallbackResult(delivered) !== "synchronous" || delivered === false) throw Error();
        if (current(id) && result === previous) render(previous, id);
        message = "全選択ファイルの元の内容と確認結果を一つにまとめて保存し始めました。ダウンロード先をご確認ください。";
      }
    } catch {
      if (current(id) && previous) render(previous, id);
      message = local.signal.aborted ? "まとめた資料の処理を中止しました。現在の一覧は保持しています。" : "まとめた資料を処理できませんでした。元ファイル合計24 MiB、保存資料48 MiB以内の対応形式か確認してください。現在の一覧は保持しています。";
    } finally { local.abort(); if (current(id)) { active = null; evidenceStatus.textContent = message; buttons(); } }
    return accepted && current(id);
  }
  listen(evidenceAck, "change", () => { if (!disposed) buttons(); });
  listen(evidenceSave, "click", () => { void evidenceJob(); });
  listen(evidenceFile, "change", () => { if (!disposed && !active && evidenceFile.files?.length === 1) void evidenceJob(evidenceFile.files[0]); });
  listen(evidenceReviewSave, "click", () => {
    if (disposed || active || !evidenceReview) return;
    const id = generation, own = evidenceReview;
    try {
      const delivered = download({ text: encodeWalletSavedBatchEvidenceReview(own), filename: "ThreeCore-wallet-batch-evidence-review.json", mimeType: "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false });
      if (observeCallbackResult(delivered) !== "synchronous" || delivered === false) throw Error();
      if (current(id) && evidenceReview === own) evidenceStatus.textContent += " 照合結果の保存処理を開始しました。";
    } catch { if (current(id) && evidenceReview === own) evidenceStatus.textContent = "照合結果を保存できませんでした。確認結果は保持しています。"; }
  });
  listen(start, "click", () => { void run(); }); listen(resume, "click", () => { void run(result); });
  listen(retry, "click", () => { void run(result, true); });
  listen(filterName, "input", () => { if (!disposed && !active) applyView(); });
  listen(filterStatus, "change", () => { if (!disposed && !active) applyView(); });
  listen(filterClear, "click", () => { if (disposed || active) return; filterName.value = ""; filterStatus.value = "all"; applyView(); });
  listen(stop, "click", () => { if (disposed || !active) return; const own = generation, controller = active; controller.abort(); if (!current(own) || active !== controller) return; status.textContent = "中止しています。確認できた分を残します。"; buttons(); });
  listen(clear, "click", () => { if (disposed) return; const own = reset(); if (!current(own)) return; referenceText = undefined; referenceInput.value = ""; referenceFile.value = ""; file.value = ""; status.textContent = "選択と確認結果をクリアしました。"; buttons(); });
  listen(ack, "change", () => { if (!disposed) buttons(); });
  listen(selectionSave, "click", () => {
    if (disposed || active || !result || selectionSave.disabled || !ack.checked) return;
    const owner = generation, view = viewRevision, receipt = result; ack.checked = false; buttons();
    try { const prepared = Object.freeze({ text: encodeWalletSavedBatchSelection(receipt, { name: filterName.value, status: filterStatus.value }), filename: "ThreeCore-wallet-matching-file-results.json", mimeType: "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false }), delivered = download(prepared);
      if (observeCallbackResult(delivered) !== "synchronous" || delivered === false) throw Error();
      if (current(owner) && result === receipt && viewRevision === view) exportStatus.textContent = "条件に一致した行と、対象全体の件数・条件を保存し始めました。元資料と全件の控えも保管してください。";
    } catch { if (current(owner) && result === receipt && viewRevision === view) exportStatus.textContent = "条件に一致した結果を保存できませんでした。一覧と全件の結果は保持しています。"; }
  });
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
  return Object.freeze({ inspectEvidenceFile(chosen) {
    if (disposed || active || !chosen) return Promise.resolve(false);
    host.open = true; evidenceBox.open = true;
    try { evidenceFile.focus?.(); } catch { /* Focus is advisory. */ }
    return evidenceJob(chosen);
  }, inspectComparisonEvidenceFile(chosen) { if (disposed || active || !chosen) return Promise.resolve(false); host.open = true; return comparisonPanel.inspectEvidenceFile(chosen);
  }, getState: () => Object.freeze({ busy: Boolean(active), result, selected: selection?.length ?? 0, disposed }), dispose() {
    if (disposed) return; disposed = true; ++generation; const old = active; active = null; selection = null; result = null; evidenceReview = null; openedEvidence = null;
    referenceText = undefined; referenceInput.value = ""; ack.checked = false; evidenceAck.checked = false; evidenceFile.value = ""; evidenceStatus.textContent = "";
    old?.abort(); comparisonPanel.dispose(); sourceExport.dispose(); receiptCheck.dispose(); selectionCheck.dispose(); selectionNotice.dispose(); cleanup.forEach(remove => remove()); buttons(); host.remove();
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
  const tableWrap = make("div", "table-wrap"); tableWrap.className += " file-review-table-wrap"; tableWrap.setAttribute("tabindex", "0"); tableWrap.setAttribute("role", "region"); tableWrap.setAttribute("aria-label", "二組の保存ファイルの比較。横方向にスクロールできます");
  const table = make("table", "table", undefined, tableWrap); make("caption", "caption", "二組の選択ファイルの比較", table);
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
  const portable = mountWalletBatchComparisonEvidencePanel({ document, parent: host, getPair: () => comparison, download });
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
    portable.sourceChanged(); reviewStatus.textContent = "比較する二組を確認してから、保存した比較JSONを選んでください。"; render();
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
  }, inspectEvidenceFile(chosen) { if (disposed || reviewActive || !chosen) return Promise.resolve(false); host.open = true; return portable.inspectFile(chosen);
  }, getState: () => Object.freeze({ baseline, current, comparison, reviewed, reviewing: Boolean(reviewActive), disposed }), dispose() {
    if (disposed) return; disposed = true; ++revision; baseline = null; current = null; comparison = null; reviewed = null; const old = reviewActive; reviewActive = null; old?.abort(); portable.dispose(); ack.checked = false; reviewAck.checked = false; cleanup.forEach(remove => remove()); controls(); host.remove();
  } });
}

export function mountBatchComparisonDifferencePanel({ document, parent, open, query, encode, download }) {
  const host = document.createElement("details"); host.className = "batch-comparison-differences"; parent.append(host);
  let disposed = false, revision = 0, review = null, names = [], page = null, dirty = false; const cleanup = [];
  function make(tag, name, text, target = host) { const node = document.createElement(tag); node.className = "batch-comparison-differences-" + name; if (text !== undefined) node.textContent = text; target.append(node); return node; }
  function listen(node, event, fn) { node.addEventListener(event, fn); cleanup.push(() => node.removeEventListener(event, fn)); }
  make("summary", "heading", "同じ名前の元ファイルで変わった項目を調べる");
  make("p", "intro", "確認済みのまとめ資料から、両方に含まれる同名のJSONを比較します。各2 MiBまで、1ページ40件です。項目の場所だけを表示し、金額や注記などの値は表示しません。元資料の妥当性はこの比較では判定しません。");
  const nameLabel = make("label", "name-label", "比較する同名の元ファイル"), choice = make("select", "choice", undefined, nameLabel);
  const pathLabel = make("label", "path-label", "項目の場所に含まれる文字"), path = make("input", "path", undefined, pathLabel); path.type = "text"; path.maxLength = 128;
  const run = make("button", "run", "この条件で相違箇所を調べる"), clear = make("button", "clear", "絞り込みを解除"), previous = make("button", "previous", "前の40件"), next = make("button", "next", "次の40件"); for (const node of [run, clear, previous, next]) node.type = "button";
  const status = make("p", "status", "まとめ資料を再確認してから、元ファイルを選んでください。"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const output = make("pre", "output", "");
  output.setAttribute("tabindex", "0"); output.setAttribute("role", "region"); output.setAttribute("aria-label", "表示範囲の相違箇所");
  const label = make("label", "ack-label", "項目の場所・ファイル名・照合値を暗号化せず保存する"), ack = make("input", "ack", undefined, label); ack.type = "checkbox";
  const save = make("button", "save", "表示範囲の相違箇所をJSON保存"); save.type = "button";
  const ready = () => review && names.includes(choice.value);
  function buttons() { choice.disabled = disposed || !review; run.disabled = path.disabled = clear.disabled = disposed || !ready(); previous.disabled = disposed || dirty || !page?.hasPrevious; next.disabled = disposed || dirty || !page?.hasNext; ack.disabled = disposed || dirty || !page; save.disabled = ack.disabled || !ack.checked; }
  function show(offset = 0, filter = path.value) {
    if (disposed || !ready()) return; ++revision; ack.checked = false;
    try { page = query(review, choice.value, { offset, pathIncludes: filter }); dirty = false;
      status.textContent = `全体の相違${page.totalDifferences}件／この条件に一致${page.matchedDifferences}件／表示${page.shownDifferences}件。` + (page.shownDifferences ? ` ${page.offset + 1}〜${page.offset + page.shownDifferences}件目。` : " この条件の0件は、元ファイル全体の一致を意味しません。") + (page.totalDifferences === 0 && !page.sourceTextMatches ? " JSONの値は同じですが、元の文字や書式の照合値は異なります。" : "") + " 元資料の判定は上の一覧に残っています。";
      const kinds = { value: "値の相違", type: "種類の相違", missing: "比較元にだけある項目", unexpected: "比較先にだけある項目", "array-length": "配列の長さの相違" };
      output.textContent = page.differences.map(row => `${row.ordinal}. ${row.path} — ${kinds[row.kind]}`).join("\n");
    } catch { page = null; dirty = true; output.textContent = ""; status.textContent = "比較できませんでした。両方が各2 MiB以内のJSONで、場所の条件が128文字以内か確認してください。元資料と上の一覧は保持しています。"; }
    buttons();
  }
  listen(choice, "change", () => { if (disposed) return; ++revision; page = null; dirty = false; path.value = ""; ack.checked = false; output.textContent = ""; status.textContent = ready() ? "同名の二つの元ファイルを選びました。「この条件で相違箇所を調べる」を押してください。" : "両方にある元ファイルを選んでください。"; buttons(); });
  listen(path, "input", () => { if (disposed) return; ++revision; dirty = true; ack.checked = false; status.textContent = "入力した条件は未適用です。「この条件で相違箇所を調べる」を押してください。"; buttons(); });
  listen(run, "click", () => show()); listen(clear, "click", () => { path.value = ""; show(0, ""); });
  listen(previous, "click", () => { if (!previous.disabled) show(page.offset - page.limit, page.query.pathIncludes); }); listen(next, "click", () => { if (!next.disabled) show(page.offset + page.limit, page.query.pathIncludes); }); listen(ack, "change", buttons);
  listen(save, "click", () => { if (disposed || save.disabled || !ack.checked || !page || dirty) return; const own = revision, captured = page; ack.checked = false; buttons();
    try { const delivered = download({ text: encode(captured), filename: "ThreeCore-batch-comparison-differences-" + captured.offset + ".json", mimeType: "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false }); if (observeCallbackResult(delivered) !== "synchronous" || delivered === false) throw Error(); if (!disposed && revision === own && captured === page) status.textContent = "表示範囲の相違箇所の保存を開始しました。範囲外の相違と元資料の判定は変わりません。"; }
    catch { if (!disposed && revision === own && captured === page) status.textContent = "相違箇所を保存できませんでした。確認結果は保持しています。"; } });
  function updateReview(value) { if (disposed || value === review) return; const pair = value ? open(value) : null; ++revision; review = value; names = pair ? pair.before.files.map(row => row.name).filter(name => pair.after.files.some(row => row.name === name)) : []; page = null; dirty = false; path.value = ""; ack.checked = false; output.textContent = ""; choice.replaceChildren(); const first = document.createElement("option"); first.value = ""; first.textContent = "両方にある元ファイルを選択"; choice.append(first); for (const name of names) { const option = document.createElement("option"); option.value = name; option.textContent = name; choice.append(option); } choice.value = ""; status.textContent = review ? `両方に含まれる同名のファイルは${names.length}件です。元ファイルを選んでください。` : "まとめ資料を再確認してから、元ファイルを選んでください。"; buttons(); }
  buttons(); return Object.freeze({ updateReview, getState: () => Object.freeze({ review, page, dirty, disposed }), dispose() { if (disposed) return; disposed = true; ++revision; review = page = null; names = []; cleanup.forEach(remove => remove()); host.remove(); } });
}

/** A verified portable comparison is displayed separately from any current selection or retained baseline. */
export function mountReviewedBatchComparisonPanel({ document, parent, open, extract, encodeComparison, queryDifferences, encodeDifferences, download }) {
  const host = document.createElement("details"); host.className = "reviewed-batch-comparison"; parent.append(host);
  let disposed = false, revision = 0, review = null, pair = null; const cleanup = [];
  function make(tag, name, text, target = host) { const node = document.createElement(tag); node.className = "reviewed-batch-comparison-" + name; if (text !== undefined) node.textContent = text; target.append(node); return node; }
  function listen(node, event, fn) { node.addEventListener(event, fn); cleanup.push(() => node.removeEventListener(event, fn)); }
  make("summary", "heading", "保存資料から確認した二組を別に表示");
  const status = make("p", "status", "まとめ資料の照合が一致すると、二組の全行をここで確認できます。"); status.setAttribute("role", "status");
  make("p", "limits", "ここは保存資料の確認用の表示です。上で選んだ資料・比較元・現在の履歴は変更しません。不正・未確認の元資料は、その判定のまま表示します。");
  const wrap = make("div", "table-wrap"); wrap.className += " table-wrap file-review-table-wrap"; wrap.setAttribute("tabindex", "0"); wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", "保存資料に含まれる二組の全ファイル。横方向にスクロールできます");
  const table = make("table", "table", undefined, wrap); make("caption", "caption", "保存資料に含まれる二組の全ファイル", table);
  const head = make("thead", "head", undefined, table), tr = make("tr", "head-row", undefined, head);
  for (const label of ["ファイル名", "比較元の判定", "比較先の判定", "内容の照合値", "比較元のSHA-256", "比較先のSHA-256"]) { const th = document.createElement("th"); th.textContent = label; th.setAttribute("scope", "col"); tr.append(th); }
  const rows = make("tbody", "rows", undefined, table);
  const ackLabel = make("label", "ack-label", "全行の比較結果・ファイル名・照合値を暗号化せず保存する"), ack = make("input", "ack", undefined, ackLabel); ack.type = "checkbox";
  const save = make("button", "save", "確認した全行の比較をJSON保存"); save.type = "button";
  const roleLabel = make("label", "role-label", "元ファイルを取り出す側"), role = make("select", "role", undefined, roleLabel);
  for (const [value, label] of [["before", "比較元"], ["after", "比較先"]]) { const option = document.createElement("option"); option.value = value; option.textContent = label; role.append(option); } role.value = "before";
  const sources = mountBatchSourceExportPanel({ document, parent: host, classPrefix: "comparison-source-export", download,
    list: value => { const source = open(value)[role.value]; if (!source) throw Error(); return source.result.files; },
    extract: (value, name) => extract(value, role.value, name) });
  const differences = queryDifferences && encodeDifferences ? mountBatchComparisonDifferencePanel({ document, parent: host, open, query: queryDifferences, encode: encodeDifferences, download }) : null;
  const labels = { matched: "再計算と一致", different: "再計算と相違", invalid: "内容を確認できない", unsupported: "対象外の形式",
    "validated-original": "元記録・内部チェックサム確認済み", "validated-structure": "形式確認済み・内部チェックサムなし", "declared-only": "形式指定だけ", "checksum-mismatch": "以前の照合値と不一致" };
  function buttons() { ack.disabled = role.disabled = disposed || !pair; save.disabled = ack.disabled || !ack.checked; }
  listen(ack, "change", buttons);
  listen(role, "change", () => { if (disposed) return; ++revision; sources.updateCurrent(null); if (["before", "after"].includes(role.value)) sources.updateCurrent(review); });
  listen(save, "click", () => {
    if (disposed || save.disabled || !pair || !ack.checked) return; const own = revision, captured = pair; ack.checked = false; buttons();
    try { const delivered = download({ text: encodeComparison(captured.comparison), filename: "ThreeCore-verified-batch-comparison.json", mimeType: "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false });
      if (observeCallbackResult(delivered) !== "synchronous" || delivered === false) throw Error();
      if (!disposed && own === revision && pair === captured) status.textContent = "確認した全行の比較の保存を開始しました。元資料の判定は変わりません。";
    } catch { if (!disposed && own === revision && pair === captured) status.textContent = "比較を保存できませんでした。確認済みの資料は保持しています。"; }
  });
  function updateReview(value) {
    if (disposed || value === review) return; const next = value ? open(value) : null; ++revision; review = value; pair = next; ack.checked = false; role.value = "before";
    sources.updateCurrent(null); sources.updateCurrent(review); differences?.updateReview(review);
    rows.replaceChildren(...(pair?.comparison.files ?? []).map(row => { const tr = document.createElement("tr"); for (const text of [row.name, labels[row.before?.status] ?? "選択なし・未確認", labels[row.after?.status] ?? "選択なし・未確認", row.sameBytes === true ? "同じ内容の照合値" : row.sameBytes === false ? "内容の照合値が異なる" : "比較できない", row.before?.sha256 ?? "なし", row.after?.sha256 ?? "なし"]) { const td = document.createElement("td"); td.textContent = text; tr.append(td); } return tr; }));
    status.textContent = pair ? `保存資料の比較元${pair.before.result.files.length}件／比較先${pair.after.result.files.length}件／全${pair.comparison.files.length}行を表示しています。上の一覧と比較元は保持しています。` : "まとめ資料の照合が一致すると、二組の全行をここで確認できます。";
    buttons();
  }
  buttons(); return Object.freeze({ updateReview, getState: () => Object.freeze({ review, pair, disposed }), dispose() { if (disposed) return; disposed = true; ++revision; review = pair = null; sources.dispose(); differences?.dispose(); cleanup.forEach(remove => remove()); host.remove(); } });
}

export function comparisonEvidenceProgressText(stage) {
  if (stage.phase === "sources") return `${stage.side === "before" ? "比較元" : "比較先"}: ${stage.checked}／${stage.selected}件の確認を処理しました。判定は最終結果で確認できます。`;
  return ({ parsing: "比較資料の形式と大きさを確認しています。", comparing: "二組の結果と保存された比較を照合しています。",
    hashing: "比較資料全体の照合値を計算しています。", serializing: "二組の元ファイルと比較を保存資料にまとめています。",
    complete: "計算が終わりました。結果の表示・保存を準備しています。" })[stage.phase] ?? "比較資料を処理しています。";
}

export function mountWalletBatchComparisonEvidencePanel({ document, parent, getPair, download }) {
  const host = document.createElement("details"); host.className = "wallet-comparison-evidence"; parent.append(host);
  let disposed = false, revision = 0, active = null, reviewed = null; const cleanup = [];
  function make(tag, name, text, target = host) { const node = document.createElement(tag); node.className = "wallet-comparison-evidence-" + name; if (text !== undefined) node.textContent = text; target.append(node); return node; }
  function listen(node, event, fn) { node.addEventListener(event, fn); cleanup.push(() => node.removeEventListener(event, fn)); }
  make("summary", "heading", "二組の元ファイルと比較をまとめて保存・再確認");
  make("p", "intro", "元ファイル本文・注記・公開アドレスも暗号化せず含めます。最大96 MiB、各組の元ファイルは合計24 MiBです。新しく計算した比較を保存し、以前の中断・再試行の経過は別に保管します。");
  const label = make("label", "ack-label", "二組の元ファイル本文も含めて保存する"), ack = make("input", "ack", undefined, label); ack.type = "checkbox";
  const save = make("button", "save", "元ファイルと比較をまとめて保存"); save.type = "button";
  const fileLabel = make("label", "file-label", "保存した比較資料を再確認（最大96 MiB）"), file = make("input", "file", undefined, fileLabel); file.type = "file"; file.accept = ".json,application/json";
  const stop = make("button", "stop", "処理を中止"); stop.type = "button";
  const status = make("p", "status", ""); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); status.setAttribute("tabindex", "-1");
  const receipt = make("button", "receipt", "比較資料の照合結果を保存"); receipt.type = "button";
  const viewer = mountReviewedBatchComparisonPanel({ document, parent: host, open: openReviewedWalletBatchComparisonEvidence, extract: extractWalletBatchComparisonEvidenceSource, encodeComparison: encodeWalletSavedBatchComparison,
    queryDifferences: queryWalletBatchComparisonDifferences, encodeDifferences: encodeWalletBatchComparisonDifferences, download });
  function controls() { const pair = getPair(); ack.disabled = disposed || Boolean(active) || !canPrepareWalletSavedBatchEvidence(pair?.before) || !canPrepareWalletSavedBatchEvidence(pair?.after); save.disabled = ack.disabled || !ack.checked; file.disabled = disposed || Boolean(active); stop.disabled = disposed || !active; receipt.disabled = disposed || Boolean(active) || !reviewed; host.setAttribute("aria-busy", String(Boolean(active))); }
  function sourceChanged() { if (disposed) return; ++revision; const old = active; active = null; reviewed = null; viewer.updateReview(null); ack.checked = false; status.textContent = ""; old?.abort(); controls(); }
  async function run(chosen = null) {
    if (disposed || active || (chosen ? file.disabled : save.disabled)) return false;
    const own = ++revision, pair = getPair(), local = new AbortController(); active = local; reviewed = null; viewer.updateReview(null); ack.checked = false; status.textContent = "二組の元ファイルと比較を確認しています。"; controls();
    const owns = () => !disposed && own === revision && !local.signal.aborted;
    const onStage = stage => { if (owns()) status.textContent = comparisonEvidenceProgressText(stage); };
    try {
      if (chosen) { const text = await readSavedGuideText(chosen, { maxBytes: WALLET_BATCH_COMPARISON_EVIDENCE_LIMIT, signal: local.signal }); if (!owns()) return;
        const result = await reviewWalletBatchComparisonEvidence(text, { signal: local.signal, onStage }); if (!owns()) return false; reviewed = result;
        viewer.updateReview(result.matchesRecomputation ? result : null);
        status.textContent = (result.matchesRecomputation ? "保存内容と二組の再計算・比較が一致しました。" : "保存内容と再計算・比較に相違があります。") + (result.allOriginalsValidated ? "" : " 元記録を確認できない資料も含まれます。") + " 現在の一覧・比較元・履歴は変更していません。";
      } else { const prepared = await prepareWalletBatchComparisonEvidence(pair.before, pair.after, { signal: local.signal, onStage }); if (!owns()) return;
        const delivered = download(prepared); if (observeCallbackResult(delivered) !== "synchronous" || delivered === false) throw Error();
        if (owns()) status.textContent = "二組の元ファイルと比較の保存を開始しました。ダウンロード先をご確認ください。"; }
      return owns();
    } catch { if (owns()) status.textContent = "比較資料を処理できませんでした。対応する96 MiB以内の資料を選んでください。現在の二組は保持しています。"; return false; }
    finally { local.abort(); if (!disposed && own === revision) { active = null; controls(); } }
  }
  listen(ack, "change", controls); listen(save, "click", () => { void run(); });
  listen(file, "change", () => { const chosen = file.files?.[0]; file.value = ""; if (chosen) void run(chosen); });
  listen(stop, "click", () => { if (disposed || !active) return; ++revision; const old = active; active = null; reviewed = null; viewer.updateReview(null); old.abort(); status.textContent = "比較資料の処理を中止しました。現在の二組は保持しています。"; controls(); });
  listen(receipt, "click", () => { if (disposed || active || !reviewed) return; const own = revision, value = reviewed;
    try { const delivered = download({ text: encodeWalletBatchComparisonEvidenceReview(value), filename: "ThreeCore-wallet-batch-comparison-evidence-review.json", mimeType: "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false }); if (observeCallbackResult(delivered) !== "synchronous" || delivered === false) throw Error(); if (!disposed && own === revision) status.textContent = "照合結果の保存を開始しました。元資料の判定は変わりません。"; }
    catch { if (!disposed && own === revision) status.textContent = "照合結果の保存を確認できませんでした。確認結果は保持しています。"; } });
  controls(); return Object.freeze({ sourceChanged, async inspectFile(chosen) { if (disposed || active || !chosen) return false; host.open = true; const expected = revision + 1, completed = await run(chosen); if (!disposed && revision === expected) try { status.focus?.(); } catch {} return completed; }, getState: () => Object.freeze({ reviewed, busy: Boolean(active), disposed }), dispose() { if (disposed) return; sourceChanged(); disposed = true; viewer.dispose(); cleanup.forEach(remove => remove()); host.remove(); } });
}

/** Receipt validation has its own cancellation and acknowledgement; it cannot extract a source. */
export function batchEvidenceReceiptCheckText(result) {
  if (!result) return "";
  return [result.matchesRecomputation ? "保存した照合結果の全項目が再計算と一致しました。" : "保存した照合結果に再計算との不一致があります。",
    "まとめた資料との結び付け: " + (result.bundleTextBindingMatches ? "一致" : "不一致"),
    `相違の項目 ${result.differences.length}個／追加項目 ${result.unexpectedFields}個。`,
    result.expectedEvidenceMatches ? "まとめた資料の保存内容も再計算と一致しています。" : "まとめた資料の保存内容には相違があります。控えの一致で、その相違は解消しません。",
    "元資料ごとの判定は上の一覧で別に確認してください。控えの一致は出所や実際の残高を証明せず、履歴への取り込みも行いません。"].join("\n");
}
export function batchSelectionReviewText(result) {
  if (!result) return "";
  return [result.matchesRecomputation ? "条件付きの保存結果は、現在の確認結果からの再計算と全項目が一致しました。" : "条件付きの保存結果に、現在の再計算との相違があります。",
    `元の対象 ${result.selectedBatchFiles}件 ／ 条件に一致 ${result.matchedFiles}件。相違の項目 ${result.differences.length}個／追加項目 ${result.unexpectedFields}個。`,
    "元の確認控えのSHA-256: " + result.sourceBatchTextDigest,
    "保存時の読み込み・再試行の経過や、除外された元ファイルの内容まで証明する結果ではありません。元資料の判定と保存の完全性は全件の控えで別に確認してください。"].join("\n");
}
export function mountSavedBundleReceiptCheckPanel({ document, parent, getExpected = () => null, readText = readSavedGuideText,
  review = reviewWalletSavedBundleReceipt, encode = encodeWalletSavedBundleReceiptCheck, describe = walletSavedBundleReceiptCheckText,
  recordLabel = "照合結果", heading = "保存した照合結果を、この資料から再確認する", sourcePrompt = "先に、上でまとめた資料を読み込んでください。",
  intro = "上でまとめた資料を読み込んでから、その資料の照合結果JSONを選んでください。元の資料との結び付けと全項目を再計算と比較します。256 KiBまでです。", apply = null,
  filename = "ThreeCore-saved-bundle-receipt-check.json", download = prepared => offerWalletDownload({ document, prepared }) } = {}) {
  const host = document.createElement("details"); host.className = "saved-bundle-receipt-check"; parent.append(host);
  const cleanup = []; let disposed = false, revision = 0, expected = null, active = null, result = null;
  function node(tag, name, text, target = host) { const value = document.createElement(tag); value.className = "saved-bundle-receipt-check-" + name; if (text !== undefined) value.textContent = text; target.append(value); return value; }
  node("summary", "heading", heading);
  node("p", "intro", intro);
  const label = node("label", "file-label", "以前保存した" + recordLabel + "JSON"), file = node("input", "file", undefined, label); file.type = "file"; file.accept = ".json,application/json";
  const stop = node("button", "stop", recordLabel + "の再確認を中止"), status = node("p", "status", sourcePrompt), output = node("pre", "output", ""); stop.type = "button"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const ackLabel = node("label", "ack-label", "再確認の結果と照合値を、暗号化せずPCに保存します"), ack = node("input", "ack", undefined, ackLabel); ack.type = "checkbox";
  const save = node("button", "save", "再確認の結果をJSON保存"); save.type = "button";
  const applyButton = node("button", "apply", "確認済みの条件で現在の一覧を絞り込む"); applyButton.type = "button"; applyButton.hidden = typeof apply !== "function";
  if (typeof apply === "function") host.className += " batch-selection-check";
  function render() { file.disabled = disposed || !expected || Boolean(active); stop.disabled = disposed || !active; ack.disabled = disposed || Boolean(active) || !result; save.disabled = ack.disabled || !ack.checked; applyButton.disabled = disposed || Boolean(active) || typeof apply !== "function" || !result?.matchesRecomputation; host.setAttribute("aria-busy", String(Boolean(active))); output.textContent = describe(result); }
  function updateExpected() {
    if (disposed) return; const next = getExpected(); if (next !== expected) { ++revision; const old = active; active = null; expected = next; result = null; ack.checked = false; old?.abort(); status.textContent = next ? "以前保存した" + recordLabel + "JSONを選んでください。" : sourcePrompt; } render();
  }
  function listen(target, event, fn) { target.addEventListener(event, fn); cleanup.push(() => target.removeEventListener(event, fn)); }
  listen(file, "change", async () => {
    if (disposed || active || !expected) return; const chosen = file.files?.[0]; file.value = ""; if (!chosen) return;
    const own = ++revision, captured = expected, local = new AbortController(); active = local; result = null; ack.checked = false; status.textContent = "保存した" + recordLabel + "を再計算と比較しています。"; render();
    const current = () => !disposed && own === revision && captured === expected && getExpected() === captured;
    try { readFormatFileName(chosen, { maxLength: 180, code: "FILE_NAME", fail: code => { const error = new Error(code); error.code = code; throw error; } });
      const text = await readText(chosen, { maxBytes: WALLET_SAVED_BUNDLE_RECEIPT_LIMIT, signal: local.signal }); if (!current()) return;
      const checked = await review(captured, text, { signal: local.signal }); if (!current()) return; result = checked; status.textContent = recordLabel + "の再確認を終えました。下の判定をご確認ください。";
    } catch { if (current()) status.textContent = recordLabel + "を確認できませんでした。256 KiB以内の、この資料から保存した" + recordLabel + "JSONを選んでください。"; }
    finally { local.abort(); if (!disposed && own === revision) { active = null; updateExpected(); } }
  });
  listen(stop, "click", () => { if (disposed || !active) return; ++revision; const old = active; active = null; result = null; ack.checked = false; old.abort(); status.textContent = recordLabel + "の再確認を中止しました。元資料は変更していません。"; render(); });
  listen(ack, "change", render);
  listen(applyButton, "click", () => {
    if (disposed || active || applyButton.disabled || !result || getExpected() !== expected) return;
    const own = revision, checked = result, source = expected;
    try { const accepted = apply(checked); if (observeCallbackResult(accepted) !== "synchronous" || accepted === false) throw Error();
      if (!disposed && own === revision && getExpected() === source) status.textContent = "確認済みの条件を現在の一覧に設定しました。表示件数は現在の結果から計算し、元資料や履歴は変更していません。";
    } catch { if (!disposed && own === revision && getExpected() === source) status.textContent = "条件の設定を確認できませんでした。元資料と現在の結果は保持しています。"; }
  });
  listen(save, "click", () => {
    if (disposed || active || !result || !ack.checked || getExpected() !== expected) return; const own = revision, captured = result, source = expected; ack.checked = false; render();
    try { const prepared = Object.freeze({ text: encode(captured), filename, mimeType: "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false, encrypted: false }), delivered = download(prepared), kind = observeCallbackResult(delivered);
      if (!disposed && own === revision && getExpected() === source) status.textContent = kind === "synchronous" && delivered !== false ? "再確認の結果の保存処理を開始しました。ダウンロード先をご確認ください。" : "再確認の結果の保存を確認できませんでした。";
    } catch { if (!disposed && own === revision && getExpected() === source) status.textContent = "再確認の結果の保存を確認できませんでした。"; }
  });
  updateExpected(); return Object.freeze({ updateExpected, getState: () => Object.freeze({ busy: Boolean(active), result, disposed }), dispose() { if (disposed) return; disposed = true; ++revision; const old = active; active = null; expected = null; result = null; old?.abort(); cleanup.forEach(remove => remove()); host.remove(); } });
}

/** Owns a portable bundle review; has no wallet, import, or storage capability. */
export function mountSavedComparisonBundlePanel({ document, parent, getPair = () => null,
  readText = readSavedGuideText, download = prepared => offerWalletDownload({ document, prepared }) } = {}) {
  const host = document.createElement("details"); host.className = "saved-bundle"; parent.append(host);
  const nodes = {}, cleanup = []; let disposed = false, busy = false, generation = 0, aborter = null, receipt = null, workKind = null, lastPair = null, receiptCheckPanel = null;
  function node(tag, name, text, target = host) { const value = document.createElement(tag); value.className = "saved-bundle-" + name; if (text !== undefined) value.textContent = text; target.append(value); nodes[name] = value; return value; }
  function checkbox(name, text) { const label = node("label", name + "-label", text), field = node("input", name, undefined, label); field.type = "checkbox"; return field; }
  function button(name, text) { const value = node("button", name, text); value.type = "button"; return value; }
  node("summary", "heading", "比較と両方の元資料を、一つのJSONで保全する");
  node("p", "intro", "上で比較した両方の元のJSONを、そのままの文字列でまとめます。形式を確認した設定・残高記録・練習用記録にも対応します。内部チェックサムの有無は区別して記録します。元資料の合計は24 MiBまで。大きい場合は2つを別々に保全してください。補助資料だけの比較はまとめられません。");
  const exportAck = checkbox("export-ack", "両方の元資料のアドレス・残高・履歴・メモを、暗号化せず一つのJSONに保存します");
  const exportButton = button("export", "比較と両方の元資料をまとめてJSON保存");
  node("h4", "open-heading", "まとめた資料を読み取り専用で確認する");
  const fileLabel = node("label", "file-label", "まとめた比較資料のJSON（最大48 MiB）"), file = node("input", "file", undefined, fileLabel); file.type = "file"; file.accept = ".json,application/json";
  const stop = button("stop", "まとめた資料の処理を中止"), status = node("p", "status", "元資料の取込みや接続は行いません。"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const notice = node("p", "notice"), output = node("pre", "output", ""), selectionNotice = createFileSelectionNotice(file, notice);
  const reviewAck = checkbox("review-ack", "元ファイルの内容を含まない照合結果と照合値を、暗号化せずPCに保存します");
  const reviewSave = button("review-save", "照合結果だけをJSON保存");
  node("p", "review-scope", "この控えに元ファイルのアドレス・残高・メモ本文は含まれません。形式・件数・照合値・不一致の判定を記録します。再確認には、元のまとめた資料を別に保管してください。");
  const sourceAck = checkbox("source-ack", "確認済み資料から、元のアドレス・残高・履歴・メモを含むファイルを暗号化せず取り出します");
  const before = button("before", "比較元の元ファイルを取り出す"), after = button("after", "比較先の元ファイルを取り出す");
  node("p", "limits", "再計算と一致する資料だけから取り出せます。元ファイルの形式・制限を保ち、ウォレットへの接続や復元は自動で行いません。");
  receiptCheckPanel = mountSavedBundleReceiptCheckPanel({ document, parent: host, getExpected: () => busy ? null : receipt, readText, download });
  const current = () => { try { return getPair(); } catch { return null; } };
  const usable = pair => Boolean(["validated-original", "validated-structure"].includes(pair?.comparison?.before?.validation) && ["validated-original", "validated-structure"].includes(pair?.comparison?.after?.validation) && pair.beforeFile && pair.afterFile);
  const sourcesAvailable = value => Boolean(value?.sourceFilesAvailable ?? value?.originalsAvailable);
  function render() {
    if (disposed) return;
    const pair = current(); host.setAttribute("aria-busy", String(busy));
    exportAck.disabled = busy || !usable(pair); exportButton.disabled = busy || !usable(pair) || !exportAck.checked;
    file.disabled = busy; stop.disabled = !busy; sourceAck.disabled = busy || !sourcesAvailable(receipt);
    before.disabled = after.disabled = busy || !sourcesAvailable(receipt) || !sourceAck.checked;
    reviewAck.disabled = busy || !receipt; reviewSave.disabled = busy || !receipt || !reviewAck.checked;
    output.textContent = walletSavedBundleReviewText(receipt);
    receiptCheckPanel?.updateExpected();
  }
  function cancel() {
    if (disposed) return;
    const own = ++generation, previous = aborter; aborter = null; busy = false; workKind = null; exportAck.checked = false; sourceAck.checked = false; reviewAck.checked = false;
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
      const prepared = await prepareWalletSavedSourceBundle(beforeText, afterText, { signal: local.signal }); if (!unchanged()) return;
      if (prepared.comparison.before.textDigest !== captured.comparison.before.textDigest || prepared.comparison.after.textDigest !== captured.comparison.after.textDigest) failCode("FILE_BUNDLE_SOURCE_CHANGED");
      const delivery = download(prepared), kind = observeCallbackResult(delivery); if (!unchanged()) return;
      status.textContent = kind === "synchronous" && delivery !== false ? "両方の元資料を含むJSONの保存処理を開始しました。ダウンロード先をご確認ください。" : "まとめた資料の保存を確認できませんでした。";
    } catch (error) { if (same(own)) status.textContent = walletSavedInspectionErrorText(error); }
    finally { if (same(own)) { aborter = null; busy = false; workKind = null; render(); } }
  }
  async function openBundle() {
    if (disposed || busy) return;
    const chosen = file.files?.[0]; file.value = ""; if (!chosen) { selectionNotice.noSelection(); return; }
    const own = ++generation, local = new AbortController(); aborter = local; busy = true; workKind = "review"; receipt = null; sourceAck.checked = false; reviewAck.checked = false; selectionNotice.clear();
    status.textContent = "まとめた資料の両方の元記録と比較結果を確認しています。"; render();
    try {
      named(chosen); if (!same(own)) return;
      const text = await readText(chosen, { maxBytes: WALLET_SAVED_BUNDLE_LIMIT, signal: local.signal }); if (!same(own)) return;
      const checked = await reviewWalletSavedBundle(text, { signal: local.signal }); if (!same(own)) return;
      receipt = checked;
      status.textContent = sourcesAvailable(checked) ? "両方の元ファイルの形式と比較結果を確認しました。内部チェックサムの有無を下の表示で確認してから取り出せます。" : "元ファイルの形式は確認できましたが、比較結果に不一致があります。取り出しは行っていません。";
    } catch (error) { if (same(own)) status.textContent = walletSavedInspectionErrorText(error); }
    finally { if (same(own)) { aborter = null; busy = false; workKind = null; render(); } }
  }
  function extract(role) {
    if (disposed || busy || !sourcesAvailable(receipt) || !sourceAck.checked) return;
    const own = ++generation, captured = receipt; sourceAck.checked = false; render();
    try {
      const prepared = walletSavedBundleSourceFile(captured, role), delivery = download(prepared), kind = observeCallbackResult(delivery);
      if (!same(own)) return;
      status.textContent = kind === "synchronous" && delivery !== false ? "元のJSONの保存処理を開始しました。各形式の読込み欄で確認してください。" : "元ファイルの取り出しを確認できませんでした。";
    } catch (error) { if (same(own)) status.textContent = walletSavedInspectionErrorText(error); }
  }
  function saveReview() {
    if (disposed || busy || !receipt || !reviewAck.checked) return;
    const own = generation, captured = receipt; reviewAck.checked = false; render();
    try { const prepared = Object.freeze({ text: encodeWalletSavedBundleReview(captured), filename: "ThreeCore-saved-file-comparison-bundle-review.json",
      mimeType: "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false, authenticated: false, encrypted: false }), delivery = download(prepared), kind = observeCallbackResult(delivery);
      if (!same(own) || receipt !== captured) return;
      status.textContent = kind === "synchronous" && delivery !== false ? "元ファイルの内容を含まない照合結果の保存処理を開始しました。ダウンロード先をご確認ください。" : "照合結果の保存を確認できませんでした。";
    } catch { if (same(own) && receipt === captured) status.textContent = "照合結果の保存を確認できませんでした。"; }
  }
  function listen(element, event, action) { element.addEventListener(event, action); cleanup.push(() => element.removeEventListener(event, action)); }
  listen(exportAck, "change", render); listen(exportButton, "click", () => { void exportPair(); });
  listen(file, "change", () => { void openBundle(); }); listen(stop, "click", cancel); listen(sourceAck, "change", render);
  listen(reviewAck, "change", render); listen(reviewSave, "click", saveReview);
  listen(before, "click", () => extract("before")); listen(after, "click", () => extract("after")); updatePair();
  return Object.freeze({ updatePair, getState: () => Object.freeze({ busy, receipt, disposed }), dispose() {
    if (disposed) return; disposed = true; generation++; const previous = aborter; aborter = null; busy = false; receipt = null;
    previous?.abort(); receiptCheckPanel.dispose(); selectionNotice.dispose(); cleanup.forEach(remove => remove()); host.remove();
  } });

}
