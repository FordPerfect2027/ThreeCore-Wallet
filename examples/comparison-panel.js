import { decodePortfolioReport, validatePortfolioSnapshot, encodePortfolioReport } from "../src/portfolio-report.js";
import { describePortfolioComparison, encodePortfolioComparisonReport, decodePortfolioComparisonReport, PORTFOLIO_COMPARISON_REPORT_LIMIT } from "../src/portfolio-comparison.js";
import { readOwnErrorCode } from "../src/provider-error.js";
import { readSecurityFileText } from "../src/security-file.js";
import { offerWalletDownload } from "./export-download.js";
import { observeCallbackResult } from "../src/security-callback.js";

const ERRORS = Object.freeze({
  IDENTITY_MISMATCH: "同じエージェント・公開アドレス・チェーン・サイトの記録を選んでください。",
  REVERSED_BLOCKS: "比較元には、表示中の結果より古いブロックの記録を選んでください。",
  BLOCK_CONFLICT: "同じ高さのブロックハッシュが異なるため比較できません。",
  OBSERVATION_CONFLICT: "同じブロックの記録が一致しないため比較できません。",
});

/** Entirely local, text-only historical comparison. No provider is accepted. */
export function mountComparisonPanel({ document, parent, download = offerWalletDownload }) {
  const section = document.createElement("section");
  section.className = "comparison-panel";
  const heading = document.createElement("h4");
  heading.textContent = "前に保存した記録と比較";
  const label = document.createElement("label");
  label.textContent = "比較元の確認記録JSON（同じアカウント・チェーン）";
  const baseline = document.createElement("textarea");
  baseline.className = "comparison-baseline";
  baseline.rows = 4;
  baseline.maxLength = 65536;
  baseline.spellcheck = false;
  baseline.setAttribute("aria-label", "比較元の確認記録JSON");
  label.append(baseline);
  const fileLabel = document.createElement("label"); fileLabel.textContent = "比較元の確認記録ファイル（JSON・64 KiBまで）";
  const file = document.createElement("input"); file.type = "file"; file.accept = ".json,application/json"; file.className = "comparison-file"; fileLabel.append(file);
  const stop = document.createElement("button"); stop.type = "button"; stop.className = "comparison-file-stop secondary"; stop.textContent = "ファイル読み込みを中止";
  const save = document.createElement("button"); save.type = "button"; save.className = "comparison-save secondary"; save.textContent = "比較結果と前後の残高記録を保存";
  const reviewLabel = document.createElement("label"); reviewLabel.textContent = "保存した比較資料を再確認（JSON・128 KiBまで）";
  const reviewFile = document.createElement("input"); reviewFile.type = "file"; reviewFile.accept = ".json,application/json"; reviewFile.className = "comparison-review-file"; reviewLabel.append(reviewFile);
  const compare = document.createElement("button");
  compare.type = "button";
  compare.className = "comparison-run secondary";
  compare.textContent = "保存記録と比較する";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "comparison-clear secondary";
  clear.textContent = "比較を消去";
  const status = document.createElement("p");
  status.className = "comparison-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const details = document.createElement("pre");
  details.className = "comparison-details";
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.textContent = "比較はPC内だけで行います。増減は送金履歴や利益を意味しません。比較資料の保存には前後の公開アドレスと残高も含みます。元ファイルの書式や出所を証明する資料ではありません。";
  section.append(heading, fileLabel, stop, label, compare, clear, status, details, save, reviewLabel, notice);
  parent.append(section);
  let target = null;
  let disposed = false;
  let generation = 0;
  let reading = null;
  let completed = null;
  const owns = id => !disposed && id === generation;
  function retireRead() { const previous = reading; reading = null; previous?.abort(); }
  function controls() { compare.disabled = !target || Boolean(reading); file.disabled = reviewFile.disabled = Boolean(reading); stop.disabled = !reading; save.disabled = !completed || Boolean(reading); section.setAttribute("aria-busy", String(Boolean(reading))); }

  function reset(message = "比較する結果を先に表示してください。") {
    completed = null;
    details.textContent = "";
    status.textContent = message;
    baseline.setAttribute("aria-invalid", "false");
    controls();
  }
  function changed() {
    if (disposed) return;
    generation++; retireRead();
    reset(target ? "比較元の入力が変わりました。もう一度比較してください。" : undefined);
  }
  function run() {
    if (disposed || !target || reading) return;
    reset();
    // Browser maxlength does not cover programmatic values or every paste
    // path. Check the exact text locally before parsing a saved observation.
    if (!baseline.value.trim() || baseline.value.length > 65536) {
      baseline.setAttribute("aria-invalid", "true");
      status.textContent = !baseline.value.trim()
        ? "比較元の確認記録JSONを入力してください。"
        : "比較元の記録が長すぎます。65,536文字以内のJSONを選んでください。";
      return;
    }
    try {
      const report = decodePortfolioReport(baseline.value);
      details.textContent = describePortfolioComparison(report.snapshot, target);
      completed = Object.freeze({ earlier: report.snapshot, later: target, inputText: baseline.value }); controls();
      status.textContent = "保存記録の比較が完了しました。外部通信は行っていません。";
    } catch (error) {
      baseline.setAttribute("aria-invalid", "true");
      let message;
      try {
        const code = readOwnErrorCode(error);
        if (typeof code === "string" && Object.hasOwn(ERRORS, code)) message = ERRORS[code];
      } catch { /* Do not trust error accessors. */ }
      status.textContent = message ?? "比較元の記録を読み取れませんでした。JSONの内容を確認してください。";
    }
  }
  function clearInput() {
    if (disposed) return;
    generation++; retireRead();
    baseline.value = "";
    reset(target ? "比較を消去しました。" : undefined);
  }
  async function loadFile(event) {
    const isReview = event?.currentTarget === reviewFile, input = isReview ? reviewFile : file;
    if (disposed) return; const chosen = input.files?.[0]; input.value = ""; if (!chosen || reading) return;
    const id = ++generation, local = new AbortController(); reading = local;
    reset(isReview ? "保存した比較資料を前後の記録から再計算しています。" : "比較元のファイルを読み込んでいます。表示中の残高記録は変更しません。");
    try { const source = await readSecurityFileText(chosen, { maxBytes: isReview ? PORTFOLIO_COMPARISON_REPORT_LIMIT : 65536, signal: local.signal });
      if (!owns(id) || local.signal.aborted) return;
      const checked = isReview ? decodePortfolioComparisonReport(source) : decodePortfolioReport(source);
      if (!owns(id) || local.signal.aborted) return; reading = null;
      if (isReview) { reset("保存した比較と前後の記録からの再計算が一致しました。現在の比較先・比較元の入力・履歴は置き換えていません。出所や現在の残高は未確認です。");
        details.textContent = describePortfolioComparison(checked.earlier, checked.later); completed = Object.freeze({ earlier: checked.earlier, later: checked.later }); controls(); }
      else { baseline.value = source; reset(target ? "比較元の記録を読み込みました。「保存記録と比較する」で比較してください。" : "比較元の記録を読み込みました。比較先の結果を先に表示してください。"); }
    } catch { if (owns(id) && !local.signal.aborted) { reading = null; reset(isReview ? "比較資料を確認できませんでした。形式・128 KiBの上限・保存された値と再計算の一致を確認してください。比較先と比較元の入力は保持しています。" : "比較元を読み込めませんでした。64 KiB以内のUTF-8 JSONを確認してください。元の入力は保持しています。"); } }
    finally { if (reading === local) reading = null; local.abort(); }
  }
  function stopFile() { if (disposed || !reading) return; generation++; retireRead(); reset("ファイル読み込みを中止しました。比較元の入力は保持しています。"); }
  function saveComparison() {
    if (disposed || reading || !completed) return; const id = generation, pair = completed;
    if (pair.inputText !== undefined && baseline.value !== pair.inputText) { reset("比較元の入力が変わりました。保存する前にもう一度比較してください。"); return; }
    try { const prepared = { text: encodePortfolioComparisonReport(pair.earlier, pair.later), filename: `ThreeCore-${pair.later.agent}-portfolio-comparison-${pair.earlier.blockNumber}-${pair.later.blockNumber}.json`, mimeType: "application/json;charset=utf-8", containsOriginalEvidence: true, restorable: false };
      const result = download({ document, prepared }), kind = observeCallbackResult(result); if (!owns(id) || completed !== pair) return;
      if (kind !== "synchronous" || result === false) throw Error(); status.textContent = "比較資料の保存を開始しました。ダウンロード先をご確認ください。";
    } catch { if (owns(id) && completed === pair) status.textContent = "比較資料を保存できませんでした。比較結果は保持しています。"; }
  }
  reviewFile.addEventListener("change", loadFile); save.addEventListener("click", saveComparison);
  file.addEventListener("change", loadFile); stop.addEventListener("click", stopFile);
  baseline.addEventListener("input", changed);
  compare.addEventListener("click", run);
  clear.addEventListener("click", clearInput);
  reset();
  return Object.freeze({
    stageBaseline(snapshot) {
      if (disposed) return false;
      const id = ++generation; retireRead(); reset();
      try {
        const captured = validatePortfolioSnapshot(snapshot), text = encodePortfolioReport(captured);
        if (!owns(id)) return false;
        if (target) describePortfolioComparison(captured, target);
        if (!owns(id) || new TextEncoder().encode(text).byteLength > 65536) return false;
        baseline.value = text;
        reset(target ? "選んだ履歴を比較元へ準備しました。「保存記録と比較する」で確認してください。" : "選んだ履歴を比較元へ準備しました。比較先の結果を先に表示してください。");
        try { baseline.focus?.(); } catch {}
        return owns(id) && baseline.value === text;
      } catch (error) {
        if (!owns(id)) return false; const code = readOwnErrorCode(error);
        if (owns(id)) reset(typeof code === "string" && Object.hasOwn(ERRORS, code) ? ERRORS[code] : "履歴を比較元にできませんでした。記録を確認してください。元の入力は保持しています。");
        return false;
      }
    },
    setTarget(snapshot) {
      if (disposed) return;
      const id = ++generation;
      retireRead();
      // Clear first so malformed replacements cannot preserve an old target.
      target = null;
      reset();
      const captured = snapshot === null ? null : validatePortfolioSnapshot(snapshot);
      if (disposed || generation !== id) return;
      target = captured;
      reset(target ? "比較元の保存記録を入力して比較してください。" : undefined);
    },
    clearTarget() {
      if (disposed) return;
      generation++;
      retireRead();
      target = null;
      baseline.value = "";
      reset();
    },
    dispose() {
      if (disposed) return;
      generation++;
      target = null;
      clearInput();
      disposed = true;
      baseline.removeEventListener("input", changed);
      file.removeEventListener("change", loadFile); stop.removeEventListener("click", stopFile);
      reviewFile.removeEventListener("change", loadFile); save.removeEventListener("click", saveComparison);
      compare.removeEventListener("click", run);
      clear.removeEventListener("click", clearInput);
      section.remove();
    },
  });
}
