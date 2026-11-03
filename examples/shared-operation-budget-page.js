import { decodeOperationBudget, OPERATION_BUDGET_LIMIT } from "../src/operation-budget.js";
import { SHARED_BUDGET_SCHEMA, SHARED_BUDGET_LIMIT, decodeSharedOperationBudget,
  encodeSharedOperationBudget, evaluateSharedOperationBudget } from "../src/shared-operation-budget.js";
import { formatRehearsalUnits } from "../src/operation-rehearsal.js";
import { createFileReadScope } from "../src/security-file.js";
import { requireSyncExport } from "../src/export-policy.js";
import { offerWalletDownload } from "./export-download.js";

const REASONS = { ZERO_TOKEN_SPEND: "使う元本が0のトークンがあります。", TOKEN_BUDGET_SHORTFALL: "元本が不足するトークンがあります。",
  FEE_COMPONENT_UNKNOWN: "不明な費用があり、ETHの総必要額は未確定です。", SHARED_ETH_SHORTFALL: "共通のETH残高では、分かっている必要額にも足りません。" };
const ERRORS = { DUPLICATE_AGENT: "同じトークンが重複しています。異なるトークンの入力を選んでください。",
  SHARED_NETWORK_MISMATCH: "ネットワークが異なります。同じネットワークの入力を選んでください。",
  SHARED_BALANCE_MISMATCH: "ETH残高・別用途の確保額・予備資金が一致しません。同じ口座・同じ時点の仮定にそろえてください。" };

export function mountSharedBudgetPage(document, { download = offerWalletDownload } = {}) {
  const get = name => document.getElementById("shared-" + name), reader = createFileReadScope(), remove = [];
  let revision = 0, disposed = false, pending = null, calculated = null;
  const eth = v => v === null ? "未確定" : formatRehearsalUnits(v, 18) + " ETH";
  const listen = (name, event, action) => {
    const handler = () => { if (!disposed) return action(); };
    get(name).addEventListener(event, handler); remove.push(() => get(name).removeEventListener(event, handler));
  };
  function clearResult() { calculated = null; get("result").hidden = true; get("save").disabled = true; get("save-status").textContent = ""; }
  function invalidate() {
    revision++; reader.cancel(); pending = null; clearResult(); get("preview").hidden = true;
    get("preview-rows").replaceChildren(); get("assume").checked = false; get("apply").disabled = true;
  }
  function table(id, rows, rowHeadings = false) {
    get(id).replaceChildren(...rows.map(values => {
      const row = document.createElement("tr");
      values.forEach((value, i) => { const cell = document.createElement(rowHeadings && i === 0 ? "th" : "td");
        if (rowHeadings && i === 0) cell.setAttribute("scope", "row"); cell.textContent = value; row.append(cell); });
      return row;
    }));
  }
  listen("file", "change", async () => {
    const files = Array.from(get("file").files ?? []); if (!files.length) return;
    invalidate(); const own = revision; get("file").value = "";
    get("status").textContent = "入力ファイルを確認しています。前回の結果は解除しました。";
    try {
      if (files.length > 3) throw Error("COUNT");
      let input;
      if (files.length === 1) {
        input = decodeSharedOperationBudget(await reader.readText(files[0], { maxBytes: SHARED_BUDGET_LIMIT }));
      } else {
        const budgets = [];
        for (const file of files) {
          if (disposed || own !== revision) return;
          budgets.push(decodeOperationBudget(await reader.readText(file, { maxBytes: OPERATION_BUDGET_LIMIT })));
        }
        input = { schema: SHARED_BUDGET_SCHEMA, simulationOnly: true, sameAccount: true, budgets };
      }
      if (disposed || own !== revision) return;
      const r = evaluateSharedOperationBudget(input), first = r.input.budgets[0];
      table("preview-rows", r.results.map(row => [row.input.agent,
        formatRehearsalUnits(row.input.token.spendUnits, row.input.token.decimals) + " " + row.input.agent,
        formatRehearsalUnits(row.token.shortfall, row.input.token.decimals) + " " + row.input.agent,
        eth(row.input.native.valueWei), eth(row.plannedFeeBudgetWei), row.constraintsSatisfied ? "仮定上は足りる" : "不足または未確認"]));
      get("context").textContent = (first.chainId === 8453 ? "Base Mainnet" : "Base Sepolia") + " · " + r.results.length + "トークン";
      get("reserves").textContent = "共通の仮定：ETH残高 " + eth(first.native.balanceWei) + " ／ 別用途 " + eth(first.native.reservedWei) + " ／ 予備資金 " + eth(first.native.reserveFloorWei);
      if (disposed || own !== revision) return;
      pending = r.input; get("preview").hidden = false;
      get("status").textContent = "入力を確認しました。同じ口座の仮定を選んでから計算してください。";
    } catch (error) {
      if (!disposed && own === revision) get("status").textContent = ERRORS[error.code] ?? "読み込めませんでした。予算入力2〜3個（各16 KiB以内）、またはまとめファイル1個（48 KiB以内）を選んでください。";
    }
  });
  for (const event of ["input", "change"]) listen("assume", event, () => {
    revision++; reader.cancel(); clearResult(); get("apply").disabled = !pending || get("assume").checked !== true;
  });
  listen("apply", "click", () => {
    if (!pending || get("assume").checked !== true) return;
    clearResult(); const own = ++revision;
    try {
      const r = evaluateSharedOperationBudget(pending), text = encodeSharedOperationBudget(r.input);
      table("rows", [["全トークンの費用とETH使用額", eth(r.plannedNativeCostWei)],
        ["ETH必要額（別用途・予備資金を含む）", eth(r.native?.required ?? null)],
        ["ETH不足額", eth(r.native?.shortfall ?? null)], ["ETH余裕額", eth(r.native?.surplus ?? null)],
        ["分かっている必要額の下限", eth(r.knownNativeMinimum.required)]], true);
      get("outcome").textContent = r.constraintsSatisfied ? "入力した共通の仮定では、まとめて使う予算が足ります。" :
        r.individuallySatisfied ? "単独では足りても、まとめると共通のETH残高が不足します。" : "まとめて使う予算に、不足または未確認の項目があります。";
      get("reasons").textContent = r.reasons.map(code => REASONS[code]).join(" ");
      if (disposed || own !== revision || get("assume").checked !== true) return;
      calculated = text; get("result").hidden = false; get("save").disabled = false;
    } catch { if (!disposed && own === revision) get("status").textContent = "予算を計算できませんでした。入力ファイルを確認してください。"; }
  });
  listen("save", "click", () => {
    if (!calculated) return; const own = revision, text = calculated;
    if (get("assume").checked !== true) { clearResult(); get("apply").disabled = true; return; }
    try {
      requireSyncExport(download({ document, prepared: { text, filename: "ThreeCore-shared-budget-input.json", mimeType: "application/json" } }));
      if (!disposed && own === revision) get("save-status").textContent = "まとめた入力の保存を開始しました。保存先のファイルを確認してください。";
    } catch { if (!disposed && own === revision) get("save-status").textContent = "保存できませんでした。確認中の入力は保持しています。"; }
  });
  listen("cancel", "click", () => { invalidate(); get("status").textContent = "ファイル確認と計算結果を取り消しました。元の保存ファイルは変更していません。"; });
  const view = document.defaultView;
  if (view?.addEventListener && view?.removeEventListener) {
    view.addEventListener("pagehide", invalidate); remove.push(() => view.removeEventListener("pagehide", invalidate));
  }
  return Object.freeze({ dispose() { if (disposed) return; disposed = true; invalidate(); remove.forEach(fn => fn()); } });
}
if (typeof document !== "undefined") mountSharedBudgetPage(document);
