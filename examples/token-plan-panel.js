import { createTokenPlan, encodeTokenPlan, decodeTokenPlan, tokenPlanLinesForContext, TokenPlanError } from "../src/token-plan.js";

import { readOwnErrorCode } from "../src/provider-error.js";
import { observeCallbackResult } from "../src/security-callback.js";
import { captureDataRecord } from "../src/security-data.js";
import { readSecurityFileText } from "../src/security-file.js";
import { offerWalletDownload } from "./export-download.js";

const ERRORS = Object.freeze({
  PLAN_APPLY: "入力欄への反映を確認できませんでした。入力欄の現在の内容を確認してください。",
  PLAN_CONTEXT_MISMATCH: "同じエージェント・チェーンのリストを選んでください。",
  PLAN_CHANGED: "確認後にJSONが変わりました。もう一度内容を確認してください。",
  DUPLICATE_TOKEN: "同じ契約アドレスが重複しています。1件ずつに整理してください。",
  INVALID_TOKENS: "1〜32件の異なる契約アドレスを1行に1つ入力してください。",
  INVALID_CONTEXT: "DAT・EMA・CAWELONとBaseチェーンの設定を確認してください。",
  INVALID_PLAN: "入力リストJSONの形式と8,192文字以内のサイズを確認してください。",
});

/** User must preview and then apply. Neither step accepts a wallet provider. */
export function mountTokenPlanPanel({ document, parent, getContext, readLines, applyLines, download = offerWalletDownload }) {
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
  const downloadButton = button("download", "入力リストをファイル保存");
  const fileLabel = document.createElement("label"); fileLabel.textContent = "保存した入力リストを読み込む（JSON・8 KiBまで）";
  const file = document.createElement("input"); file.className = "token-plan-file"; file.type = "file"; file.accept = ".json,application/json"; fileLabel.append(file);
  const stop = button("stop", "ファイル読み込みを中止");
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
  note.textContent = "入力リストはファイル保存・読み込みできます。読み込んだだけでは反映されません。反映は既存リストを置き換えます。接続・残高照会は別の操作です。契約の実在性・安全性を保証するものではありません。";
  section.append(heading, save, downloadButton, fileLabel, stop, label, preview, apply, clear, status, details, note);
  parent.append(section);
  let candidate = null;
  let candidateText = null;
  let disposed = false;
  let generation = 0;
  let reading = null;
  const current = id => !disposed && id === generation;
  const listeners = [];
  function fileControls() { const busy = Boolean(reading); save.disabled = downloadButton.disabled = preview.disabled = file.disabled = busy; stop.disabled = !busy; section.setAttribute("aria-busy", String(busy)); }
  function retireRead() { const previous = reading; reading = null; previous?.abort(); fileControls(); }
  function listen(item, event, fn) {
    const listener = () => { if (!disposed) return fn(); };
    item.addEventListener(event, listener);
    listeners.push(() => item.removeEventListener(event, listener));
  }
  function reset(message = "保存するリストを入力するか、JSONを貼り付けてください。") {
    retireRead();
    candidate = null;
    candidateText = null;
    apply.disabled = true;
    details.textContent = "";
    status.textContent = message;
    text.setAttribute("aria-invalid", "false");
  }
  function syncSource(callback, code) {
    const value = callback();
    if (observeCallbackResult(value) !== "synchronous") throw new TokenPlanError(code, "Expected synchronous local data");
    return value;
  }
  function context() {
    return captureDataRecord(syncSource(getContext, "INVALID_CONTEXT"), ["agent", "chainId"]);
  }
  function error(value, id, override) {
    if (!current(id)) return;
    const code = override ?? readOwnErrorCode(value);
    if (!current(id)) return;
    reset();
    text.setAttribute("aria-invalid", "true");
    status.textContent = typeof code === "string" && Object.hasOwn(ERRORS, code) ? ERRORS[code]
      : "リストを確認できませんでした。入力と設定を確認してください。";
  }
  function sameInput(value) {
    if (text.value !== value) throw new TokenPlanError("PLAN_CHANGED", "Preview the changed text again");
  }
  function currentPlan(id) {
    const identity = context(); if (!current(id)) return null;
    const lines = syncSource(readLines, "INVALID_TOKENS"); if (!current(id)) return null;
    const plan = createTokenPlan(identity, lines); tokenPlanLinesForContext(plan, context());
    return current(id) ? plan : null;
  }
  listen(save, "click", () => {
    const id = ++generation;
    reset();
    text.value = "";
    try {
      const plan = currentPlan(id); if (!plan) return;
      text.value = encodeTokenPlan(plan);
      status.textContent = "入力リストをJSONにしました。コピーして保存できます。";
    } catch (value) { error(value, id); }
  });
  listen(downloadButton, "click", () => {
    if (reading) return; const id = ++generation; reset();
    try { const plan = currentPlan(id); if (!plan) return;
      const prepared = { text: encodeTokenPlan(plan), filename: `ThreeCore-${plan.agent}-token-plan-${plan.chainId}.json`, mimeType: "application/json;charset=utf-8", containsOriginalEvidence: false, restorable: false };
      const result = download({ document, prepared }), kind = observeCallbackResult(result); if (!current(id)) return;
      if (kind !== "synchronous" || result === false) throw Error();
      status.textContent = "入力リストの保存を開始しました。ダウンロード先をご確認ください。";
    } catch { if (current(id)) status.textContent = "入力リストを保存できませんでした。入力と設定、ダウンロード先を確認してください。"; }
  });
  listen(file, "change", () => {
    const chosen = file.files?.[0]; file.value = ""; if (!chosen || reading) return;
    const id = ++generation; reset(); const local = new AbortController(); reading = local; fileControls();
    status.textContent = "入力リストのファイルを読み込んでいます。反映はまだ行っていません。";
    void (async () => { try {
      const source = await readSecurityFileText(chosen, { maxBytes: 8192, signal: local.signal });
      if (!current(id) || local.signal.aborted) return;
      const plan = decodeTokenPlan(source); tokenPlanLinesForContext(plan, context());
      if (!current(id) || local.signal.aborted) return;
      text.value = source; status.textContent = "入力リストを読み込みました。「JSONの内容を確認する」で確認してから反映してください。";
    } catch (value) { if (current(id) && !local.signal.aborted) { const code = readOwnErrorCode(value); if (current(id)) status.textContent = code === "PLAN_CONTEXT_MISMATCH" ? ERRORS[code] : "入力リストを読み込めませんでした。8 KiB以内のUTF-8 JSONを確認してください。元の入力欄は保持しています。"; } }
    finally { if (current(id) && reading === local) { reading = null; local.abort(); fileControls(); } } })();
  });
  listen(stop, "click", () => { if (reading) { generation++; reset("ファイル読み込みを中止しました。元の入力欄は保持しています。"); } });
  listen(text, "input", () => { generation++; reset("JSONが変わりました。もう一度内容を確認してください。"); });
  listen(preview, "click", () => {
    const id = ++generation, source = text.value;
    reset();
    try {
      const plan = decodeTokenPlan(source);
      tokenPlanLinesForContext(plan, context());
      if (!current(id)) return;
      sameInput(source);
      details.textContent = plan.agent + " / チェーン: " + plan.chainId + " / " + plan.tokens.length + "件\n" + plan.tokens.join("\n");
      candidate = plan;
      candidateText = source;
      apply.disabled = false;
      status.textContent = "内容を確認し、反映する場合だけ次のボタンを押してください。";
    } catch (value) { error(value, id); }
  });
  listen(apply, "click", () => {
    if (!candidate) return;
    const id = ++generation, plan = candidate, source = candidateText;
    let handedOff = false;
    try {
      sameInput(source);
      const lines = tokenPlanLinesForContext(plan, context());
      if (!current(id)) return;
      sameInput(source);
      reset(); // Consume the candidate before invoking application code.
      handedOff = true;
      const receipt = applyLines(lines);
      const kind = observeCallbackResult(receipt);
      if (!current(id)) return;
      if (kind !== "synchronous" || receipt === false) throw new TokenPlanError("PLAN_APPLY", "Unconfirmed application");
      status.textContent = "入力欄へ反映しました。残高照会はまだ行っていません。";
    } catch (value) { error(value, id, handedOff ? "PLAN_APPLY" : undefined); }
  });
  listen(clear, "click", () => { generation++; text.value = ""; reset("保存・確認欄を消去しました。"); });
  reset();
  return Object.freeze({
    stagePlan(value) {
      if (disposed) return false;
      const id = ++generation, previousText = text.value;
      reset();
      try {
        const encoded = encodeTokenPlan(value); if (!current(id)) return false;
        const plan = decodeTokenPlan(encoded); tokenPlanLinesForContext(plan, context());
        if (!current(id)) return false; sameInput(previousText);
        text.value = encoded;
        status.textContent = "過去の記録から契約一覧を準備しました。内容を確認してから反映してください。接続・残高照会は行っていません。";
        try { text.focus?.(); } catch {}
        return current(id) && text.value === encoded;
      } catch (value) { error(value, id); return false; }
    },
    invalidate() { if (!disposed) { generation++; text.value = ""; reset(); } },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      text.value = "";
      reset();
      for (const stop of listeners) stop();
      section.remove();
    },
  });
}
