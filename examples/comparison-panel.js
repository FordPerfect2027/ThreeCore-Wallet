import { decodePortfolioReport, validatePortfolioSnapshot } from "../src/portfolio-report.js";
import { describePortfolioComparison } from "../src/portfolio-comparison.js";

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
  section.append(heading, label, compare, clear, status, details, notice);
  parent.append(section);
  let target = null;
  let disposed = false;

  function reset(message = "比較する結果を先に表示してください。") {
    details.textContent = "";
    status.textContent = message;
    baseline.setAttribute("aria-invalid", "false");
    compare.disabled = !target;
  }
  function changed() {
    reset(target ? "比較元の入力が変わりました。もう一度比較してください。" : undefined);
  }
  function run() {
    if (disposed || !target) return;
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
        const code = error?.code;
        if (Object.hasOwn(ERRORS, code)) message = ERRORS[code];
      } catch { /* Do not trust error accessors. */ }
      status.textContent = message ?? "比較元の記録を読み取れませんでした。JSONの内容を確認してください。";
    }
  }
  function clearInput() {
    baseline.value = "";
    reset(target ? "比較を消去しました。" : undefined);
  }
  baseline.addEventListener("input", changed);
  compare.addEventListener("click", run);
  clear.addEventListener("click", clearInput);
  reset();
  return Object.freeze({
    setTarget(snapshot) {
      if (disposed) return;
      // Clear first so malformed replacements cannot preserve an old target.
      target = null;
      reset();
      if (snapshot !== null) target = validatePortfolioSnapshot(snapshot);
      reset(target ? "比較元の保存記録を入力して比較してください。" : undefined);
    },
    clearTarget() {
      if (disposed) return;
      target = null;
      baseline.value = "";
      reset();
    },
    dispose() {
      if (disposed) return;
      target = null;
      clearInput();
      disposed = true;
      baseline.removeEventListener("input", changed);
      compare.removeEventListener("click", run);
      clear.removeEventListener("click", clearInput);
      section.remove();
    },
  });
}
