import { requestPublicTokenBatch } from "../src/public-token-batch-client.js";
import { validatePublicBatchRequest } from "../src/public-token-batch-request.js";
import { preparePublicTokenBatchFile, publicBatchObservations } from "../src/public-token-batch-model.js";
import { offerWalletDownload } from "./export-download.js";
import { requireSyncExport } from "../src/export-policy.js";

function units(value, decimals) {
  if (value === null || decimals === null) return "未確認";
  const digits = value.padStart(decimals + 1, "0");
  if (!decimals) return digits;
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return digits.slice(0, -decimals) + (fraction ? "." + fraction : "");
}

export function mountPublicTokenBatchPage(document, { read = requestPublicTokenBatch,
  prepare = preparePublicTokenBatchFile, download = offerWalletDownload } = {}) {
  const get = name => document.getElementById("batch-" + name), removers = [];
  let revision = 0, disposed = false, controller = null, prepared = null;
  const current = own => !disposed && own === revision;
  function reset() {
    revision++; controller?.abort(); controller = null; prepared = null;
    get("read").disabled = false; get("cancel").disabled = true; get("save").disabled = true;
    get("result").hidden = true; get("rows").replaceChildren(); get("save-status").textContent = "";
  }
  const listen = (name, event, action) => {
    const handler = () => { if (!disposed) return action(); };
    get(name).addEventListener(event, handler); removers.push(() => get(name).removeEventListener(event, handler));
  };
  for (const name of ["account", "chain", "block"]) listen(name, "input", () => {
    reset(); get("status").textContent = "入力が変わりました。「3トークンを読み取る」で確認してください。";
  });
  listen("read", "click", async () => {
    reset(); const own = revision; let request;
    try { request = validatePublicBatchRequest({ account: get("account").value.trim(), chainId: Number(get("chain").value),
      blockNumber: get("block").value.trim() || null }); }
    catch { get("status").textContent = "0xから始まる公開アドレス、ネットワーク、整数のブロック番号を確認してください。"; return; }
    const aborter = new AbortController(); controller = aborter;
    get("read").disabled = true; get("cancel").disabled = false;
    get("status").textContent = "3トークンとETHを同じブロックから読み取っています。最大約2分です。";
    try {
      const batch = await read(request, { signal: aborter.signal }); if (!current(own)) return;
      if (batch.account !== request.account || batch.chainId !== request.chainId ||
          (request.blockNumber !== null && batch.blockNumber !== request.blockNumber)) throw Error("CONTEXT");
      const rows = publicBatchObservations(batch);
      const file = await prepare(batch, { signal: aborter.signal }); if (!current(own)) return;
      get("context").textContent = (batch.chainId === 8453 ? "Base Mainnet" : "Base Sepolia") + " / " + batch.account;
      get("block-result").textContent = "ブロック " + batch.blockNumber + " / " + batch.blockHash;
      get("source").textContent = "取得先：" + batch.rpcUrl + "　取得後も同じブロックのハッシュを確認済み";
      get("native").textContent = "この口座のETH：" + units(batch.nativeBalanceBaseUnits, 18) + " ETH";
      get("rows").replaceChildren(...rows.map(row => {
        const tr = document.createElement("tr");
        for (const value of [row.agent, row.tokenAddress, units(row.balanceBaseUnits, row.metadata?.decimals ?? null),
          row.identityMatches ? "登録済みのトークン情報と一致" : "トークン情報に不一致・未確認あり"]) {
          const td = document.createElement("td"); td.textContent = value; tr.append(td);
        } return tr;
      }));
      if (!current(own)) return;
      prepared = file; get("result").hidden = false; get("save").disabled = false;
      get("status").textContent = rows.every(row => row.identityMatches)
        ? "3トークンの取得と情報照合が完了しました。保存できます。"
        : "取得は完了しましたが、トークン情報に不一致・未確認があります。内容を確認してください。";
    } catch {
      if (current(own)) get("status").textContent = "取得できませんでした。途中の結果は採用していません。入力・接続を確認して再試行できます。";
    } finally {
      aborter.abort();
      if (current(own)) { controller = null; get("read").disabled = false; get("cancel").disabled = true; }
    }
  });
  listen("cancel", "click", () => { reset(); get("status").textContent = "読み取りを中止しました。途中の結果は保存しません。"; });
  listen("save", "click", () => {
    if (!prepared) return; const own = revision;
    try {
      requireSyncExport(download({ document, prepared }));
      if (current(own)) get("save-status").textContent = "保存を開始しました。保存先のファイルを確認してください。";
    } catch { if (current(own)) get("save-status").textContent = "保存できませんでした。結果は保持しています。再度保存できます。"; }
  });
  const view = document.defaultView;
  const hide = () => { reset(); get("status").textContent = "読み取りを終了しました。再開するには読み取りボタンを押してください。"; };
  if (view?.addEventListener && view?.removeEventListener) {
    view.addEventListener("pagehide", hide); removers.push(() => view.removeEventListener("pagehide", hide));
  }
  reset();
  return Object.freeze({ dispose() { if (disposed) return; disposed = true; reset(); removers.forEach(fn => fn()); } });
}
if (typeof document !== "undefined") mountPublicTokenBatchPage(document);
