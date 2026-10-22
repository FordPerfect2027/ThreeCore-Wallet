import { createTokenPlan, encodeTokenPlan, decodeTokenPlan, tokenPlanLinesForContext, TokenPlanError } from "../src/token-plan.js";

const ERRORS = Object.freeze({
  PLAN_CONTEXT_MISMATCH: "同じエージェント・チェーンのリストを選んでください。",
  PLAN_CHANGED: "確認後にJSONが変わりました。もう一度内容を確認してください。",
  DUPLICATE_TOKEN: "同じ契約アドレスが重複しています。1件ずつに整理してください。",
  INVALID_TOKENS: "1〜32件の異なる契約アドレスを1行に1つ入力してください。",
  INVALID_CONTEXT: "DAT・EMA・CAWELONとBaseチェーンの設定を確認してください。",
  INVALID_PLAN: "入力リストJSONの形式と8,192文字以内のサイズを確認してください。",
});

/** User must preview and then apply. Neither step accepts a wallet provider. */
export function mountTokenPlanPanel({ document, parent, getContext, readLines, applyLines }) {
  const section = document.createElement("section");
  section.className = "token-plan-panel";
  const heading = document.createElement("h4");
  heading.textContent = "トークン入力リストの保存・再利用";
  const label = document.createElement("label");
  label.textContent = "入力リストJSON（アカウント・残高は含みません）";
  const text = document.createElement("textarea");
  text.className = "token-plan-json";
  text.rows = 4;
  text.maxLength = 8192;
  text.spellcheck = false;
  text.setAttribute("aria-label", "トークン入力リストJSON");
  label.append(text);
  const button = (name, caption) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "token-plan-" + name + " secondary";
    item.textContent = caption;
    return item;
  };
  const save = button("save", "入力リストをJSONにする");
  const preview = button("preview", "JSONの内容を確認する");
  const apply = button("apply", "確認したリストを入力欄へ反映");
  const clear = button("clear", "保存・確認欄を消去");
  const status = document.createElement("p");
  status.className = "token-plan-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const details = document.createElement("pre");
  details.className = "token-plan-details";
  const note = document.createElement("p");
  note.className = "notice";
  note.textContent = "JSONをコピーして保存できます。反映は既存リストを置き換えます。接続・残高照会は別の操作です。契約の実在性・安全性を保証するものではありません。";
  section.append(heading, save, label, preview, apply, clear, status, details, note);
  parent.append(section);
  let candidate = null;
  let candidateText = null;
  let disposed = false;
  const listeners = [];
  function listen(item, event, fn) {
    item.addEventListener(event, fn);
    listeners.push(() => item.removeEventListener(event, fn));
  }
  function reset(message = "保存するリストを入力するか、JSONを貼り付けてください。") {
    candidate = null;
    candidateText = null;
    apply.disabled = true;
    details.textContent = "";
    status.textContent = message;
    text.setAttribute("aria-invalid", "false");
  }
  function error(value) {
    reset();
    text.setAttribute("aria-invalid", "true");
    let code;
    try { code = value?.code; } catch { /* Omit untrusted diagnostics. */ }
    status.textContent = typeof code === "string" && Object.hasOwn(ERRORS, code) ? ERRORS[code]
      : "リストを確認できませんでした。入力と設定を確認してください。";
  }
  listen(save, "click", () => {
    if (disposed) return;
    reset();
    text.value = ""; // A failed export must not leave an older list to copy.
    try {
      text.value = encodeTokenPlan(createTokenPlan(getContext(), readLines()));
      status.textContent = "入力リストをJSONにしました。コピーして保存できます。";
    } catch (value) { error(value); }
  });
  listen(text, "input", () => reset("JSONが変わりました。もう一度内容を確認してください。"));
  listen(preview, "click", () => {
    if (disposed) return;
    reset();
    try {
      const plan = decodeTokenPlan(text.value);
      tokenPlanLinesForContext(plan, getContext());
      details.textContent = plan.agent + " / チェーン: " + plan.chainId + " / " + plan.tokens.length + "件\n" + plan.tokens.join("\n");
      candidate = plan;
      candidateText = text.value;
      apply.disabled = false;
      status.textContent = "内容を確認し、反映する場合だけ次のボタンを押してください。";
    } catch (value) { error(value); }
  });
  listen(apply, "click", () => {
    if (disposed || !candidate) return;
    try {
      if (text.value !== candidateText) throw new TokenPlanError("PLAN_CHANGED", "Preview the changed text again");
      const lines = tokenPlanLinesForContext(candidate, getContext());
      reset(); // Consume the candidate before a potentially reentrant callback.
      applyLines(lines);
      status.textContent = "入力欄へ反映しました。残高照会はまだ行っていません。";
    } catch (value) { error(value); }
  });
  listen(clear, "click", () => { text.value = ""; reset("保存・確認欄を消去しました。"); });
  reset();
  return Object.freeze({
    invalidate() { if (!disposed) { text.value = ""; reset(); } },
    dispose() {
      if (disposed) return;
      disposed = true;
      text.value = "";
      reset();
      for (const stop of listeners) stop();
      section.remove();
    },
  });
}
