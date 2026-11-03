import { OPERATION_BUDGET_SCHEMA, OPERATION_BUDGET_LIMIT, decodeOperationBudget,
  encodeOperationBudget, evaluateOperationBudget, operationBudgetExample } from "../src/operation-budget.js";
import { parseRehearsalUnits, formatRehearsalUnits } from "../src/operation-rehearsal.js";
import { createFileReadScope } from "../src/security-file.js";
import { requireSyncExport } from "../src/export-policy.js";
import { offerWalletDownload } from "./export-download.js";
import { decodePublicTokenBatchFile, publicBatchObservations, PUBLIC_TOKEN_BATCH_FILE_LIMIT } from "../src/public-token-batch-model.js";

const FIELDS = ["agent", "chain", "decimals", "token-balance", "token-reserved", "token-floor", "token-spend",
  "native-balance", "native-reserved", "native-floor", "native-value", "gas", "fee", "l1", "operator", "buffer"];
const LABELS = ["対象トークン", "想定ネットワーク", "小数桁数", "トークン残高", "別用途に確保したトークン", "残しておくトークン", "今回使うトークン",
  "ETH残高", "別用途に確保したETH", "残しておくETH", "費用以外に使うETH", "想定ガス上限", "1ガスあたりの上限（Gwei）", "L1データ費用（ETH）", "運営者費用（ETH）", "追加の余裕分（ETH）"];
const REASONS = { ZERO_TOKEN_SPEND: "今回使うトークンが0です。", TOKEN_BUDGET_SHORTFALL: "トークン元本と予備資金が不足します。",
  FEE_COMPONENT_UNKNOWN: "不明な費用があるため、ETHの総必要額は未確定です。", NATIVE_BUDGET_SHORTFALL: "分かっている費用だけでもETHが不足します。" };

export function mountOperationBudgetPage(document, { download = offerWalletDownload, decodePublicSource = decodePublicTokenBatchFile } = {}) {
  const get = name => document.getElementById("budget-" + name), fileReader = createFileReadScope();
  const listeners = []; let revision = 0, disposed = false, calculated = null, pending = null, pendingSource = null, sourceAbort = null;
  const listen = (name, type, action) => {
    const handler = () => { if (!disposed) return action(); };
    get(name).addEventListener(type, handler); listeners.push(() => get(name).removeEventListener(type, handler));
  };
  function clearImport() {
    sourceAbort?.abort(); sourceAbort = null; pendingSource = null;
    get("source-apply").disabled = true; get("source-preview").hidden = true;
    get("source-rows").replaceChildren(); get("source-status").textContent = "";
    pending = null; get("apply").disabled = true; get("preview").hidden = true;
    get("preview-rows").replaceChildren(); get("import-status").textContent = ""; fileReader.cancel();
  }
  function invalidate() {
    revision++; calculated = null; clearImport(); get("result").hidden = true;
    get("save").disabled = true; get("save-status").textContent = "";
    get("status").textContent = "入力が変わりました。もう一度予算を確認してください。";
  }
  function readFields() {
    const values = Object.fromEntries(FIELDS.map(name => [name, get(name).value]));
    if (!/^(0|[1-9]|1[0-8])$/.test(values.decimals) || !["8453", "84532"].includes(values.chain)) throw Error("INPUT");
    const decimals = Number(values.decimals), units = (name, precision) => parseRehearsalUnits(values[name], precision);
    return { schema: OPERATION_BUDGET_SCHEMA, simulationOnly: true, agent: values.agent, chainId: Number(values.chain),
      token: { decimals, balanceUnits: units("token-balance", decimals), reservedUnits: units("token-reserved", decimals),
        reserveFloorUnits: units("token-floor", decimals), spendUnits: units("token-spend", decimals) },
      native: { balanceWei: units("native-balance", 18), reservedWei: units("native-reserved", 18), reserveFloorWei: units("native-floor", 18), valueWei: units("native-value", 18) },
      fees: { gasLimit: values.gas, maxFeePerGasWei: units("fee", 9), l1FeeBudgetWei: values.l1 === "" ? null : units("l1", 18),
        operatorFeeBudgetWei: values.operator === "" ? null : units("operator", 18), bufferWei: units("buffer", 18) } };
  }
  function valuesOf(data) {
    const fmt = formatRehearsalUnits, t = data.token, n = data.native, f = data.fees;
    return [data.agent, String(data.chainId), String(t.decimals), ...[t.balanceUnits, t.reservedUnits, t.reserveFloorUnits, t.spendUnits].map(v => fmt(v, t.decimals)),
      ...[n.balanceWei, n.reservedWei, n.reserveFloorWei, n.valueWei].map(v => fmt(v, 18)), f.gasLimit, fmt(f.maxFeePerGasWei, 9),
      f.l1FeeBudgetWei === null ? "" : fmt(f.l1FeeBudgetWei, 18), f.operatorFeeBudgetWei === null ? "" : fmt(f.operatorFeeBudgetWei, 18), fmt(f.bufferWei, 18)];
  }
  function table(name, rows) {
    const nodes = rows.map(([label, value]) => {
      const row = document.createElement("tr"), heading = document.createElement("th"), cell = document.createElement("td");
      heading.setAttribute("scope", "row"); heading.textContent = label; cell.textContent = value;
      row.append(heading, cell); return row;
    });
    get(name).replaceChildren(...nodes);
  }
  function calculate() {
    invalidate(); const own = revision;
    try {
      const report = evaluateOperationBudget(readFields()), text = encodeOperationBudget(report.input);
      if (disposed || own !== revision) return;
      const eth = v => v === null ? "未確定" : formatRehearsalUnits(v, 18) + " ETH";
      const token = v => formatRehearsalUnits(v, report.input.token.decimals) + " " + report.input.agent;
      table("rows", [["トークン必要額（別用途・予備資金を含む）", token(report.token.required)], ["トークン不足額", token(report.token.shortfall)],
        ["トークン余裕額", token(report.token.surplus)], ["実行ガス代の予算", eth(report.executionBudgetWei)],
        ["分かっている費用の合計", eth(report.knownFeeBudgetWei)], ["全費用の予算", eth(report.plannedFeeBudgetWei)],
        ["ETH必要額（別用途・予備資金を含む）", eth(report.native?.required ?? null)],
        ["ETH不足額", eth(report.native?.shortfall ?? null)], ["ETH余裕額", eth(report.native?.surplus ?? null)]]);
      get("outcome").textContent = report.constraintsSatisfied ? "入力した仮定では、元本とETHの予算が足ります。" : "不足または未確認の項目があります。";
      get("reasons").textContent = report.reasons.map(reason => REASONS[reason]).join(" ");
      if (disposed || own !== revision) return;
      calculated = text; get("result").hidden = false; get("save").disabled = false;
      get("status").textContent = "入力した仮定から再計算しました。現在の資産や費用を確認した結果ではありません。";
    } catch {
      if (!disposed && own === revision) get("status").textContent = "入力を確認してください。必要な欄には0以上の数値を入れ、ガス上限と1ガスあたりの上限は0より大きくしてください。小数桁数や金額の上限を超える入力も使えません。";
    }
  }
  for (const name of FIELDS) for (const type of ["input", "change"]) listen(name, type, invalidate);
  listen("calculate", "click", calculate);
  listen("example", "click", () => {
    invalidate(); const values = valuesOf(operationBudgetExample()); FIELDS.forEach((name, i) => { get(name).value = values[i]; });
    get("status").textContent = "仮の数値を入れました。運営者費用は不明のままです。実際の残高や手数料ではありません。";
  });
  listen("save", "click", () => {
    if (!calculated) return; const text = calculated, own = revision;
    try {
      if (encodeOperationBudget(readFields()) !== text) { invalidate(); return; }
      if (disposed || own !== revision) return;
      requireSyncExport(download({ document, prepared: { text, filename: "ThreeCore-budget-input.json", mimeType: "application/json" } }));
      if (!disposed && own === revision) get("save-status").textContent = "入力ファイルの保存を開始しました。保存先にファイルがあることを確認してください。";
    } catch { if (!disposed && own === revision) get("save-status").textContent = "保存できませんでした。入力は保持しています。"; }
  });
  listen("file", "change", async () => {
    const file = get("file").files?.[0]; if (!file) return;
    revision++; clearImport(); const own = revision; get("file").value = "";
    get("import-status").textContent = "保存した予算入力を確認しています。";
    try {
      const data = decodeOperationBudget(await fileReader.readText(file, { maxBytes: OPERATION_BUDGET_LIMIT }));
      if (disposed || own !== revision) return;
      evaluateOperationBudget(data); // Reject inputs whose derived amounts overflow before offering restoration.
      const values = valuesOf(data); table("preview-rows", LABELS.map((label, i) => [label,
        i === 1 ? (data.chainId === 8453 ? "Base Mainnet" : "Base Sepolia") : values[i] === "" ? "不明" : values[i]]));
      if (disposed || own !== revision) return;
      pending = data; get("preview").hidden = false; get("apply").disabled = false;
      get("import-status").textContent = "復元する入力を確認してください。現在の入力欄はまだ変更していません。";
    } catch { if (!disposed && own === revision) get("import-status").textContent = "予算入力を読み込めませんでした。16 KiB以内の対応するJSONファイルを選んでください。現在の入力は保持しています。"; }
  });
  listen("apply", "click", () => {
    if (!pending) return; const values = valuesOf(pending); invalidate();
    FIELDS.forEach((name, i) => { get(name).value = values[i]; }); calculate();
  });
  listen("cancel", "click", () => { revision++; clearImport(); get("import-status").textContent = "ファイル確認を取り消しました。現在の入力は保持しています。"; });
  listen("source-file", "change", async () => {
    const file = get("source-file").files?.[0]; if (!file) return;
    revision++; clearImport(); const own = revision, agent = get("agent").value, chainId = Number(get("chain").value);
    const aborter = new AbortController(); sourceAbort = aborter; get("source-file").value = "";
    get("source-status").textContent = "公開残高ファイルのチェックサムと対象トークンを確認しています。";
    try {
      const text = await fileReader.readText(file, { maxBytes: PUBLIC_TOKEN_BATCH_FILE_LIMIT });
      if (disposed || own !== revision) return;
      const { batch } = await decodePublicSource(text, { signal: aborter.signal });
      if (disposed || own !== revision) return;
      const row = publicBatchObservations(batch).find(item => item.agent === agent);
      if (batch.chainId !== chainId || !row?.identityMatches || row.metadata.decimals > 18) throw Error("SOURCE_CONTEXT");
      table("source-rows", [["対象", agent + " / " + (chainId === 8453 ? "Base Mainnet" : "Base Sepolia")],
        ["公開口座", batch.account], ["ブロック", batch.blockNumber + " / " + batch.blockHash],
        ["転記するトークン残高", formatRehearsalUnits(row.balanceBaseUnits, row.metadata.decimals)],
        ["転記するETH残高", formatRehearsalUnits(batch.nativeBalanceBaseUnits, 18) + " ETH"]]);
      if (disposed || own !== revision) return;
      pendingSource = row; get("source-preview").hidden = false; get("source-apply").disabled = false;
      get("source-status").textContent = "口座・ブロック・残高を確認してから転記してください。現在の入力はまだ変更していません。";
    } catch {
      if (!disposed && own === revision) get("source-status").textContent = "残高を転記できません。選択中のトークンとネットワークに対応する、情報照合済みの公開残高ファイルを選んでください。チェックサムや容量も確認します。";
    } finally { aborter.abort(); if (!disposed && own === revision) sourceAbort = null; }
  });
  listen("source-apply", "click", () => {
    if (!pendingSource) return; const row = pendingSource;
    if (get("agent").value !== row.agent || Number(get("chain").value) !== row.chainId) { invalidate(); return; }
    invalidate();
    get("decimals").value = String(row.metadata.decimals);
    get("token-balance").value = formatRehearsalUnits(row.balanceBaseUnits, row.metadata.decimals);
    get("native-balance").value = formatRehearsalUnits(row.nativeBalanceBaseUnits, 18);
    get("source-status").textContent = row.agent + "のブロック" + row.blockNumber + "の残高を転記しました。使用額・予備資金・費用は元の入力を保っています。予算を再確認してください。";
  });
  listen("source-cancel", "click", () => { revision++; clearImport(); get("source-status").textContent = "残高ファイルの確認を取り消しました。現在の入力は保持しています。"; });
  const view = document.defaultView;
  if (view?.addEventListener && view?.removeEventListener) {
    for (const type of ["pagehide"]) {
      view.addEventListener(type, invalidate); listeners.push(() => view.removeEventListener(type, invalidate));
    }
  }
  return Object.freeze({ dispose() {
    if (disposed) return; disposed = true; invalidate(); for (const remove of listeners) remove();
  } });
}
if (typeof document !== "undefined") mountOperationBudgetPage(document);
