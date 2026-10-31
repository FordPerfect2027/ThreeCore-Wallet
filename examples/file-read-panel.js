import { offerWalletDownload } from "./export-download.js";
import { readSecurityFileBytes, readFormatFileName } from "../src/security-file.js";
import { inspectWalletSavedText, compareWalletSavedInspections, walletSavedComparisonText, walletSavedInspectionText, walletSavedInspectionErrorText, WALLET_SAVED_INSPECTION_LIMIT } from "../src/file-read-status.js";
import { walletFileReadService } from "../src/file-read-service.js";
import { describeFileReadStatus } from "../src/file-read-status.js";
import { consumeCleanup } from "../src/file-read-policy.js";
import { observeCallbackResult } from "../src/security-callback.js";

/** Aggregate file-read protection and a separate, read-only saved-file guide. */
export function mountFileReadPanel({ document, parent, service = walletFileReadService }) {
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
  const savedGuide = mountSavedFileInspectionPanel({ document, parent: section });
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
  download = prepared => offerWalletDownload({ document, prepared }) } = {}) {
  const host = document.createElement("details"); host.className = "saved-file-guide";
  parent.append(host); const nodes = {}, cleanup = [];
  let disposed = false, generation = 0, aborter = null, busy = false, result = null, comparison = null, workKind = "source";
  const make = (tag, name, text, target = host) => {
    const node = document.createElement(tag); node.className = "saved-file-guide-" + name;
    if (text !== undefined) node.textContent = text;
    target.append(node); nodes[name] = node; return node;
  };
  make("summary", "heading", "保存したJSONの種類と開く場所を調べる");
  make("p", "intro", "ThreeCoreの期間・保存一覧・報告・報告履歴・確認セットのJSONを1つ選んでください。元記録の形式とチェックサムを調べ、開く欄を案内します。ここでは履歴への追加や画面への復元は行いません。");
  const label = make("label", "file-label", "調べる元のJSON（最大96 MiB）");
  const file = make("input", "file", undefined, label); file.type = "file"; file.accept = ".json,application/json";
  const stop = make("button", "stop", "このファイルの確認を中止"); stop.type = "button";
  const status = make("p", "status", "ファイルを選ぶまで読み込みません。"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const notice = make("p", "notice"), output = make("pre", "output");
  const ackLabel = make("label", "ack-label", "形式の案内と照合用の値を、暗号化せずPCに保存します");
  const ack = make("input", "ack", undefined, ackLabel); ack.type = "checkbox";
  const save = make("button", "save", "この案内をJSON保存"); save.type = "button";
  make("p", "limits", "この案内JSONに元の記録は含まれず、復元には使えません。元のファイルを別に保全してください。出所や現在のチェーンを保証する確認ではありません。");
  const compareBox = make("details", "comparison");
  make("summary", "comparison-heading", "このファイルと別の保存ファイルを比較する", compareBox);
  make("p", "comparison-intro", "上で調べたファイルを比較元にします。次のファイルを選ぶと、同じ元記録・書式だけの違い・内容の変更を区別します。元ファイルを置き換えません。", compareBox);
  const compareLabel = make("label", "compare-file-label", "比較先の元のJSON（最大96 MiB）", compareBox);
  const compareFile = make("input", "compare-file", undefined, compareLabel); compareFile.type = "file"; compareFile.accept = ".json,application/json";
  const comparisonOutput = make("pre", "comparison-output", "", compareBox);
  const compareAckLabel = make("label", "comparison-ack-label", "この比較結果と照合用の値を、暗号化せずPCに保存します", compareBox);
  const compareAck = make("input", "comparison-ack", undefined, compareAckLabel); compareAck.type = "checkbox";
  const compareSave = make("button", "comparison-save", "2つの保存ファイルの比較をJSON保存", compareBox); compareSave.type = "button";
  const selectionNotice = createFileSelectionNotice(file, notice);
  const comparisonNotice = createFileSelectionNotice(compareFile, notice);
  function render() {
    if (disposed) return;
    host.setAttribute("aria-busy", String(busy)); file.disabled = busy; stop.disabled = !busy;
    ack.disabled = busy || !result; save.disabled = busy || !result || !ack.checked;
    output.textContent = walletSavedInspectionText(result);
    compareFile.disabled = busy || !result; compareAck.disabled = busy || !comparison;
    compareSave.disabled = busy || !comparison || !compareAck.checked;
    comparisonOutput.textContent = walletSavedComparisonText(comparison);
  }
  function cancel() {
    if (disposed) return;
    const own = ++generation, previous = aborter; aborter = null; busy = false; if (workKind === "source") result = null; comparison = null; ack.checked = false; compareAck.checked = false;
    previous?.abort(); if (disposed || generation !== own) return;
    status.textContent = "確認を中止しました。保存済みの元のファイルや履歴は変更していません。"; render();
  }
  async function selected() {
    if (disposed) return;
    const chosen = file.files?.[0]; file.value = "";
    if (!chosen) { selectionNotice.noSelection(); return; }
    const own = ++generation, previous = aborter; aborter = null; previous?.abort();
    if (disposed || own !== generation) return;
    const local = new AbortController(); aborter = local; busy = true; workKind = "source"; result = null; comparison = null; compareAck.checked = false; ack.checked = false; selectionNotice.clear();
    status.textContent = "選んだJSONの形式と内容を確認しています。"; render();
    try {
      readFormatFileName(chosen, { maxLength: 180, code: "FILE_INSPECTION_NAME", fail: code => { const error = new Error(code); error.code = code; throw error; } });
      if (disposed || generation !== own) return;
      const text = await readText(chosen, { maxBytes: WALLET_SAVED_INSPECTION_LIMIT, signal: local.signal });
      if (disposed || generation !== own) return;
      const value = await inspect(text, { signal: local.signal });
      if (disposed || generation !== own) return;
      result = value; status.textContent = value.validation === "validated-original" ? "元記録の形式とチェックサムを確認しました。開く欄は下の案内をご覧ください。" :
        "形式の指定だけを判別しました。補助資料の中身は検証していません。";
    } catch (error) {
      if (disposed || generation !== own) return;
      status.textContent = walletSavedInspectionErrorText(error);
    } finally { if (!disposed && generation === own) { aborter = null; busy = false; render(); } }
  }
  async function compareSelected() {
    if (disposed || busy || !result) return;
    const chosen = compareFile.files?.[0]; compareFile.value = "";
    if (!chosen) { comparisonNotice.noSelection(); return; }
    const own = ++generation, base = result, previous = aborter; aborter = null; previous?.abort();
    if (disposed || generation !== own) return;
    const local = new AbortController(); aborter = local; busy = true; workKind = "comparison";
    comparison = null; compareAck.checked = false; ack.checked = false; comparisonNotice.clear();
    status.textContent = "比較先のファイルを確認しています。比較元は保持しています。"; render();
    try {
      readFormatFileName(chosen, { maxLength: 180, code: "FILE_INSPECTION_NAME", fail: code => { const error = new Error(code); error.code = code; throw error; } });
      if (disposed || generation !== own) return;
      const text = await readText(chosen, { maxBytes: WALLET_SAVED_INSPECTION_LIMIT, signal: local.signal });
      if (disposed || generation !== own) return;
      const incoming = await inspect(text, { signal: local.signal });
      if (disposed || generation !== own) return;
      comparison = compareWalletSavedInspections(base, incoming);
      status.textContent = "保存ファイル同士の比較を表示しました。元記録を置き換えたり復元したりしていません。";
    } catch (error) { if (!disposed && generation === own) status.textContent = walletSavedInspectionErrorText(error); }
    finally { if (!disposed && generation === own) { aborter = null; busy = false; render(); } }
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
  listen(ack, "change", render); listen(save, "click", saveResult);
  listen(compareFile, "change", () => { void compareSelected(); }); listen(compareAck, "change", render); listen(compareSave, "click", saveComparison); render();
  return Object.freeze({ getState: () => Object.freeze({ busy, result, comparison, disposed }), dispose() {
    if (disposed) return;
    disposed = true; generation++; const previous = aborter; aborter = null; busy = false; result = null; comparison = null;
    previous?.abort(); selectionNotice.dispose(); comparisonNotice.dispose(); cleanup.forEach(remove => remove()); host.remove();
  } });
}

async function readSavedGuideText(file, options) {
  const bytes = await readSecurityFileBytes(file, options);
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { const error = new Error("FILE_ENCODING"); error.code = "FILE_ENCODING"; throw error; }
}
