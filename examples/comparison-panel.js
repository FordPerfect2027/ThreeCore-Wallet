import { decodePortfolioReport, validatePortfolioSnapshot } from "../src/portfolio-report.js";
import { describePortfolioComparison } from "../src/portfolio-comparison.js";
import { readOwnErrorCode } from "../src/provider-error.js";
import { readSecurityFileText } from "../src/security-file.js";

const ERRORS = Object.freeze({
  IDENTITY_MISMATCH: "同じエージェント・公開アドレス・チェーン・サイトの記録を選んでください。",
  REVERSED_BLOCKS: "比較元には、表示中の結果より古いブロックの記録を選んでください。",
  BLOCK_CONFLICT: "同じ高さのブロックハッシュが異なるため比較できません。",
  OBSERVATION_CONFLICT: "同じブロックの記録が一致しないため比較できません。",
});

/** Entirely local, text-only historical comparison. No provider is accepted. */
export function mountComparisonPanel({ document, parent }) {
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
  notice.textContent = "比較はPC内だけで行います。増減は送金履歴や利益を意味しません。";
  section.append(heading, fileLabel, stop, label, compare, clear, status, details, notice);
  parent.append(section);
  let target = null;
  let disposed = false;
  let generation = 0;
  let reading = null;
  const owns = id => !disposed && id === generation;
  function retireRead() { const previous = reading; reading = null; previous?.abort(); }

  function reset(message = "比較する結果を先に表示してください。") {
    details.textContent = "";
    status.textContent = message;
    baseline.setAttribute("aria-invalid", "false");
    compare.disabled = !target || Boolean(reading); file.disabled = Boolean(reading); stop.disabled = !reading; section.setAttribute("aria-busy", String(Boolean(reading)));
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
  async function loadFile() {
    if (disposed) return; const chosen = file.files?.[0]; file.value = ""; if (!chosen || reading) return;
    const id = ++generation, local = new AbortController(); reading = local;
    reset("比較元のファイルを読み込んでいます。表示中の残高記録は変更しません。");
    try { const source = await readSecurityFileText(chosen, { maxBytes: 65536, signal: local.signal });
      if (!owns(id) || local.signal.aborted) return; decodePortfolioReport(source);
      if (!owns(id) || local.signal.aborted) return; baseline.value = source;
      reading = null; reset(target ? "比較元の記録を読み込みました。「保存記録と比較する」で比較してください。" : "比較元の記録を読み込みました。比較先の結果を先に表示してください。");
    } catch { if (owns(id) && !local.signal.aborted) { reading = null; reset("比較元を読み込めませんでした。64 KiB以内のUTF-8 JSONを確認してください。元の入力は保持しています。"); } }
    finally { if (reading === local) reading = null; local.abort(); }
  }
  function stopFile() { if (disposed || !reading) return; generation++; retireRead(); reset("ファイル読み込みを中止しました。比較元の入力は保持しています。"); }
  file.addEventListener("change", loadFile); stop.addEventListener("click", stopFile);
  baseline.addEventListener("input", changed);
  compare.addEventListener("click", run);
  clear.addEventListener("click", clearInput);
  reset();
  return Object.freeze({
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
      compare.removeEventListener("click", run);
      clear.removeEventListener("click", clearInput);
      section.remove();
    },
  });
}
