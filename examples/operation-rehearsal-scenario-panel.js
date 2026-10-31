import { consumeCallback } from "../src/security-callback.js";
import { requireSyncExport } from "../src/export-policy.js";
import { buildRehearsalScenario, compareRehearsalScenario, encodeRehearsalScenario,
  rehearsalScenarioParameters, REHEARSAL_SCENARIO_FIELDS } from "../src/operation-rehearsal-scenario.js";
import { validateRehearsal, encodeRehearsal, formatRehearsalUnits, parseRehearsalUnits, REHEARSAL_SCHEMA_V2 } from "../src/operation-rehearsal.js";

export const SCENARIO_LABELS = Object.freeze({ openingBalance: "開始時の資金", maxPerOperation: "1回の元本上限",
  maxOutstanding: "未決済元本の上限", reserveFloor: "予備資金", lossLimit: "損失上限",
  buybackBps: "還元割合", paused: "新しい利用の停止", maxEntryFee: "開始費用上限", maxExitFee: "決済費用上限",
  cash: "手元資金", outstanding: "未決済元本", realizedPnl: "累計実現損益", fees: "費用合計",
  reservedExitFees: "確保した決済費用", reservedAllocations: "予約済み還元", availableCash: "予約を除く手元資金",
  allocationShortfall: "利益を超える予約額", proposedOwnTokenBuybackBudget: "追加予約可能額", pnlChange: "その記録の損益" });
const ROW_AMOUNTS = ["cash", "outstanding", "realizedPnl", "pnlChange", "reservedExitFees", "reservedAllocations", "availableCash"];
const LABELS = SCENARIO_LABELS;


/** Field-level guidance belongs to one form; original accessibility descriptions survive clearing. */
export function createRehearsalFieldFeedback(document, statusId) {
  const errors=new WeakMap(), marked=new Map();
  const attributes=["aria-invalid","aria-errormessage","aria-describedby"];
  function fail(id,label,message){const error=new Error("Invalid rehearsal field");errors.set(error,{id,message:label+"："+message});throw error;}
  function clear(){for(const [control,values] of marked){attributes.forEach((name,i)=>{
    if(values[i]==null)control.removeAttribute(name);else control.setAttribute(name,values[i]);
  });}marked.clear();}
  return Object.freeze({clear,
    units(id,label,decimals,maximum=null){
      let value;
      try{value=parseRehearsalUnits(document.getElementById(id).value,decimals);}
      catch{fail(id,label,"0以上の数値を入力してください。小数は"+decimals+"桁までです。桁数が大きすぎる数値・符号・区切り文字は使えません。");}
      if(maximum!==null&&BigInt(value)>maximum)fail(id,label,"0〜100%で入力してください。");
      return value;
    },
    identifier(id,label){const value=document.getElementById(id).value;
      if(typeof value!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))fail(id,label,"先頭は英数字、全体は英数字・ハイフン・下線で1〜64文字にしてください。");
      return value;
    },
    report(error){const detail=errors.get(error);if(!detail)return false;
      clear();const control=document.getElementById(detail.id),status=document.getElementById(statusId);
      const values=attributes.map(name=>control.getAttribute(name));marked.set(control,values);
      control.setAttribute("aria-invalid","true");control.setAttribute("aria-errormessage",statusId);
      control.setAttribute("aria-describedby",[...new Set([...(values[2]||"").split(/\s+/).filter(Boolean),statusId])].join(" "));
      status.textContent=detail.message;control.focus?.();return true;
    }
  });
}

/** Owns only a hypothetical comparison draft. Never commits to the workspace. */
export function mountRehearsalScenarioPanel(document, { download, reasons, kinds, onChange = () => {} }) {
  const offerDownload = payload => requireSyncExport(download(payload));
  const get = name => document.getElementById("whatif-" + name);
  const feedback=createRehearsalFieldFeedback(document,"whatif-status");
  let source = null, comparison = null, disposed = false, revision = 0;
  const listeners = [];
  function listen(name, type, handler) {
    get(name).addEventListener(type, handler);
    listeners.push(() => get(name).removeEventListener(type, handler));
  }
  const money = value => formatRehearsalUnits(value, source.asset.decimals) + " " + source.asset.symbol;
  const displayParameter = (field, value) => value === null ? "旧形式には項目なし"
    : field === "paused" ? (value ? "停止する想定" : "停止しない想定")
    : field === "buybackBps" ? formatRehearsalUnits(String(value), 2) + "%" : money(value);
  function notifyChanged(){consumeCallback(()=>onChange());}
  function invalidate(message = "比較条件が変わりました。もう一度比較してください。元の履歴は保持しています。", notify = true) {
    feedback.clear();
    const own=++revision;comparison=null;
    for(const name of ["parameters","metrics","rows","summary","export-status","row-status","blockers"])get(name).textContent="";
    get("results").hidden=true;get("save").disabled=true;get("input-save").disabled=true;
    get("status").textContent=message;
    if(notify)notifyChanged();
    return own;
  }
  function refresh(input) {
    if(disposed)return;
    const own=++revision;
    let next;
    try{next=input?validateRehearsal(input):null;}
    catch(error){if(disposed||own!==revision)return;throw error;}
    if(disposed||own!==revision)return;
    source=next;
    const rendered=invalidate(source?"表示中の履歴の条件をコピーしました。別の条件を入力して比較できます。元の履歴は変更しません。"
      :"先に例を表示するか、保存した履歴を復旧してください。");
    if(disposed||rendered!==revision)return;
    renderSource();
  }
  function renderSource() {
    get("compare").disabled = !source; get("reset").disabled = !source;
    const parameters = source ? rehearsalScenarioParameters(source) : null;
    for (const field of REHEARSAL_SCENARIO_FIELDS) {
      const control = get(field), value = parameters?.[field];
      control.disabled = !source || value === null;
      if (field === "paused") control.checked = value ?? false;
      else control.value = value == null ? "" : formatRehearsalUnits(String(value), field === "buybackBps" ? 2 : source.asset.decimals);
    }
    get("context").textContent = source ? source.agent + " / " + source.events.length + "件の同じ記録を順番どおりに再計算 / ネットワーク " +
      source.chainId + " / 口座 " + source.account + " / 資産 " + source.asset.symbol + " (" + source.asset.address +
      ") / サイト " + source.policy.origin + " / 利用先契約 " + source.policy.spender : "";
    get("version").textContent = source?.schema !== REHEARSAL_SCHEMA_V2 && source
      ? "旧形式の意味を保って比較します。この形式にない費用上限は入力できません。" : "";
  }
  function appendRow(target, values, className = "") {
    const tr = document.createElement("tr"); tr.className = className;
    for (const value of values) { const td = document.createElement("td"); td.textContent = value; tr.append(td); }
    get(target).append(tr);
  }
  function renderRows() {
    get("rows").textContent = "";
    if (!comparison) return;
    const rows = comparison.rows.filter(row => get("filter").value !== "changed" || row.changed);
    const decision = row => row.withinEnteredLimits ? "仮の条件内" : "見送り: " + row.reasons.map(code => reasons[code] ?? code).join("・");
    for (const row of rows) {
      const amounts = ROW_AMOUNTS.filter(key => row.before[key] !== row.after[key]).map(key =>
        LABELS[key] + " " + money(row.before[key]) + " → " + money(row.after[key])).join(" / ");
      appendRow("rows", [row.recordNumber + "番目: " + row.id + " / " + kinds[row.kind], decision(row.before), decision(row.after),
        amounts || "金額の変化なし"], row.after.withinEnteredLimits ? "" : "blocked");
    }
    get("row-status").textContent = "表示 " + rows.length + "件 / 全 " + comparison.rows.length + "件。" +
      (rows.length === 0 ? "この表示条件に該当する記録はありません。" : "金額の増減は改善・悪化の判定ではありません。");
  }
  function render() {
    get("results").hidden = false;
    const summary = comparison.summary;
    get("summary").textContent = "変更した条件 " + summary.changedParameters + "項目 / 結果が変わる記録 " + summary.changedRecords +
      "件 / 新たな見送り " + summary.newlyRejected + "件 / 見送りから条件内へ " + summary.newlyAccepted +
      "件。未決済 " + summary.beforeOpenPositions + " → " + summary.afterOpenPositions + "件。";
    for (const row of comparison.parameters.filter(row => row.changed)) appendRow("parameters",
      [LABELS[row.field], displayParameter(row.field, row.before), displayParameter(row.field, row.after)]);
    if (!summary.changedParameters) appendRow("parameters", ["条件の変更なし", "元と同じ条件", "元と同じ条件"]);
    for (const row of comparison.metrics) appendRow("metrics", [LABELS[row.field], money(row.before), money(row.after),
      (BigInt(row.delta) > 0n ? "+" : "") + money(row.delta)]);
    const blockers = codes => codes.length ? codes.map(code => reasons[code] ?? code).join("・") : "該当なし";
    get("blockers").textContent = "追加予約を止める理由 — 元の条件: " + blockers(summary.beforeAllocationBlockers) +
      " / 比較条件: " + blockers(summary.afterAllocationBlockers);
    renderRows(); get("save").disabled = false; get("input-save").disabled = false; notifyChanged();
  }
  for (const field of REHEARSAL_SCENARIO_FIELDS) listen(field, field === "paused" ? "change" : "input", () => {
    if (!disposed && source) invalidate();
  });
  listen("filter", "change", () => { if (!disposed) renderRows(); });
  listen("reset", "click", () => { if (!disposed) refresh(source); });
  listen("compare", "click", () => {
    if(disposed||!source)return;
    const own=invalidate();
    if(disposed||own!==revision||!source)return;
    const base=source;
    try{
      const values={};
      for(const field of REHEARSAL_SCENARIO_FIELDS){
        if(field==="paused")values[field]=get(field).checked;
        else if(base.schema!==REHEARSAL_SCHEMA_V2&&["maxEntryFee","maxExitFee"].includes(field))values[field]=null;
        else{
          const value=feedback.units("whatif-"+field,LABELS[field],field==="buybackBps"?2:base.asset.decimals,field==="buybackBps"?10000n:null);
          values[field]=field==="buybackBps"?Number(value):value;
        }
      }
      if(disposed||own!==revision||source!==base)return;
      const candidate=buildRehearsalScenario(base,values);
      comparison=compareRehearsalScenario(base,candidate);render();
      if(disposed||own!==revision||source!==base)return;
      get("status").textContent="比較が完了しました。これは全履歴を別条件で再計算した仮の結果です。元の履歴・取り消し履歴は変更していません。";
    }catch(error){
      if(disposed||own!==revision||source!==base)return;
      const failed=invalidate("比較条件を確認してください。金額は0以上・この資産の小数桁数まで、還元割合は0〜100%です。元の履歴は保持しています。");
      if(!disposed&&failed===revision&&source===base)feedback.report(error);
    }
  });
  for (const [name, inputOnly] of [["save", false], ["input-save", true]]) listen(name, "click", () => {
    if (disposed || !comparison) return;
    const own=revision; try {
      const data = comparison;
      offerDownload({ document, prepared: { text: inputOnly ? encodeRehearsal(data.inputs.after)
        : encodeRehearsalScenario(data.inputs.before, data.inputs.after),
      filename: "ThreeCore-" + source.agent + (inputOnly ? "-hypothetical-input.json" : "-scenario-comparison.json"), mimeType: "application/json" } });if(disposed||own!==revision)return;
      get("export-status").textContent = inputOnly ? "比較条件の入力記録を別ファイルに保存し始めました。元の履歴には反映していません。"
        : "元の入力・比較条件の入力・全記録の結果を保存し始めました。表示の絞り込みに関係なく全件を含みます。";
    } catch {if(disposed||own!==revision)return; get("export-status").textContent = "保存を開始できませんでした。比較結果と元の履歴は保持しています。"; }
  });
  refresh(null);
  return Object.freeze({ refresh, comparison: () => disposed ? null : comparison, dispose() {
    if (disposed) return; disposed = true; source = null;
    invalidate("", false); renderSource();
    for (const name of ["status", "row-status", "blockers", "context", "version"]) get(name).textContent = "";
    for (const remove of listeners) remove();
    notifyChanged();
  } });
}
