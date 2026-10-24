import { catalogToken } from "/src/token-catalog.js";
import { prepareTokenIdentityFile, decodeTokenIdentityFile } from "/src/token-identity-report.js";
import { TOKEN_IDENTITY_SCHEMA } from "/src/token-identity-model.js";
import { workspaceFromDraft, encodeWorkspace } from "/src/workspace-format.js";
import { createPortfolioHistory } from "/src/portfolio-history.js";

const A = "0x" + "11".repeat(20);
const B = "0x" + "22".repeat(20);
const HASH = "0x" + "ab".repeat(32);
const assert = (value, message) => { if (!value) throw Error(message); };
const word = value => "0x" + BigInt(value).toString(16).padStart(64, "0");
function textWord(value) {
  const bytes = new TextEncoder().encode(value);
  const data = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return word(32) + word(bytes.length).slice(2) + data.padEnd(Math.ceil(bytes.length / 32) * 64, "0");
}
const delay = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw Error("Identity UI did not settle");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { resolve, promise };
}
function row(agent = "DAT", chainId = 8453, changes = {}) {
  const token = catalogToken({ agent, chainId });
  return {
    schema: TOKEN_IDENTITY_SCHEMA, catalogVersion: token.catalogVersion,
    agent, chainId, account: A, siteOrigin: location.origin, connectionEpoch: 1,
    blockNumber: "42", blockHash: HASH, tokenAddress: token.address, hasCode: true,
    metadata: { name: token.name, symbol: token.symbol, decimals: token.decimals, totalSupply: token.initialSupply },
    balanceBaseUnits: "1234567890123456789", nativeBalanceBaseUnits: "9007199254740993123",
    readOnly: true, securityAudit: false, ...changes,
  };
}
function replies(observation = row(), intercept = () => undefined) {
  return async args => {
    const value = await intercept(args);
    if (value !== undefined) return value;
    if (args.method === "eth_chainId") return "0x" + observation.chainId.toString(16);
    if (args.method === "eth_getBlockByNumber") {
      return { number: "0x" + BigInt(observation.blockNumber).toString(16), hash: observation.blockHash };
    }
    if (args.method === "eth_getCode") return observation.hasCode ? "0x6000" : "0x";
    if (args.method === "eth_getBalance") return "0x" + BigInt(observation.nativeBalanceBaseUnits).toString(16);
    if (args.method !== "eth_call") return undefined;
    const data = args.params[0].data;
    if (data === "0x06fdde03") return textWord(observation.metadata.name);
    if (data === "0x95d89b41") return textWord(observation.metadata.symbol);
    if (data === "0x313ce567") return word(observation.metadata.decimals);
    if (data === "0x18160ddd") return word(observation.metadata.totalSupply);
    if (data.startsWith("0x70a08231")) return word(observation.balanceBaseUnits);
    throw Error("Unexpected identity selector");
  };
}
const q = (f, name) => f.field(".identity-" + name);
const details = f => q(f, "details").textContent;
const busy = f => q(f, "panel").getAttribute("aria-busy") === "true";
async function applyCatalog(f) {
  q(f, "catalog").click();
  assert(!q(f, "apply").disabled, "Catalog preview missing");
  q(f, "apply").click();
}
async function inspect(f) {
  q(f, "inspect").click();
  await until(() => !busy(f));
}
async function fileInput(f, observation, mutate) {
  const prepared = await prepareTokenIdentityFile(observation);
  const text = mutate ? mutate(prepared.text) : prepared.text;
  const transfer = new DataTransfer();
  transfer.items.add(new File([text], "identity.json", { type: "application/json" }));
  q(f, "file").files = transfer.files;
  q(f, "file").dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => !busy(f));
}
function safeCalls(calls) {
  const allowed = new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId",
    "eth_getBlockByNumber", "eth_getCode", "eth_getBalance", "eth_call"]);
  assert(calls.every(call => allowed.has(call.method)), "Unexpected permission/sign/send/network request");
}

export function registerTokenIdentityUITests(test) {
  for (const settings of [true, false]) {
    test("identity: workspace restore invalidates identity only when configuration changes: " + settings, async make => {
      const f = make(replies());
      await fileInput(f, row());
      q(f, "baseline").click();
      const draft = ["DAT", "EMA", "CAWELON"].map((agent, index) => ({
        agent, account: "0x" + String(index + 4).repeat(40), chainId: 84532,
        tokenAddress: catalogToken({ agent, chainId: 84532 }).address,
        tokens: "", history: createPortfolioHistory().exportText(),
      }));
      const json = document.querySelector(".workspace-json");
      json.value = encodeWorkspace(workspaceFromDraft(draft));
      json.dispatchEvent(new Event("input", { bubbles: true }));
      if (!settings) {
        const checkbox = document.querySelector(".workspace-settings");
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.querySelector(".workspace-preview").click();
      const confirmed = document.querySelector(".workspace-confirmed");
      confirmed.checked = true;
      confirmed.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector(".workspace-apply").click();
      if (settings) {
        assert(details(f) === "" && q(f, "save").disabled, "Restored configuration retained stale identity");
        assert(q(f, "baseline-status").textContent.includes("未設定"), "Baseline remained after restore");
        assert(f.field(".chain").value === "84532", "Restore itself failed");
      } else {
        assert(details(f).includes("過去の記録"), "History-only restore erased unrelated observation");
        assert(q(f, "baseline-status").textContent.includes("block 42"), "History-only restore erased baseline");
        assert(f.field(".chain").value === "8453", "History-only restore changed chain");
      }
      assert(f.calls.length === 0, "Restore connected a wallet");
    });
  }

  test("identity: catalog preview is local and address application is explicit", async make => {
    const f = make(replies());
    const previous = f.field(".token").value;
    q(f, "catalog").click();
    assert(f.field(".token").value === previous, "Preview changed input");
    assert(q(f, "catalog-details").textContent.includes(catalogToken({ agent: "DAT", chainId: 8453 }).address), "Address missing");
    assert(f.calls.length === 0, "Preview opened wallet");
    q(f, "apply").click();
    assert(f.field(".token").value === row().tokenAddress, "Explicit application failed");
    assert(f.field(".account").value === A && f.field(".chain").value === "8453", "Unrelated fields changed");
    assert(f.calls.length === 0, "Application connected wallet");
  });

  test("identity: input change clears a pending catalog choice", async make => {
    const f = make(replies());
    q(f, "catalog").click();
    f.input(".chain", "84532", "change");
    assert(q(f, "apply").disabled, "Obsolete application enabled");
    assert(q(f, "catalog-details").textContent === "", "Obsolete catalog displayed");
    assert(f.calls.length === 0, "Network choice made RPC");
  });

  test("identity: no connection is opened by inspection", async make => {
    const f = make(replies());
    await applyCatalog(f);
    await inspect(f);
    assert(q(f, "status").textContent.includes("接続"), "Missing connection guidance");
    assert(details(f) === "" && q(f, "save").disabled, "Invented result");
    assert(f.calls.length === 0, "Inspection automatically requested accounts");
  });

  test("identity: an unrelated contract is rejected before onchain reads", async make => {
    const f = make(replies());
    await f.connect();
    const count = f.calls.length;
    await inspect(f);
    assert(q(f, "status").textContent.includes("一致しません"), "Wrong contract accepted");
    assert(f.calls.length === count, "Wrong contract reached provider");
    assert(q(f, "save").disabled, "Wrong contract exported");
  });

  for (const chainId of [8453, 84532]) {
    test("identity: exact token and ETH amounts on chain " + chainId, async make => {
      const observation = row("DAT", chainId);
      const f = make(replies(observation));
      f.input(".chain", String(chainId), "change");
      await applyCatalog(f);
      await f.connect();
      await inspect(f);
      assert(details(f).includes("1.234567890123456789 DAT"), "Token rounding");
      assert(details(f).includes("9.007199254740993123 ETH"), "Native rounding");
      assert(details(f).includes(observation.tokenAddress) && details(f).includes(HASH), "Identity provenance missing");
      assert(!f.output().includes("コードが見つかりません"), "Card contradicts identity result");
      assert(!q(f, "save").disabled && q(f, "progress").hidden, "Completion controls incorrect");
      assert(f.calls.filter(call => call.method === "eth_requestAccounts").length === 1, "Repeated permission");
      const pinned = f.calls.filter(call => ["eth_getCode", "eth_call", "eth_getBalance"].includes(call.method));
      assert(pinned.every(call => call.params.at(-1).blockHash === HASH), "Unpinned read");
      assert(pinned.every(call => call.params.at(-1).requireCanonical === true), "Canonical flag absent");
      safeCalls(f.calls);
    });
  }

  for (const [label, patch, expected] of [
    ["name", { name: "DAT impostor" }, "名前"],
    ["symbol", { symbol: "OTHER" }, "シンボル"],
    ["decimals", { decimals: 6 }, "小数桁"],
    ["supply", { totalSupply: "1000000000000000000000000001" }, "発行上限"],
  ]) {
    test("identity: mismatch is visible without misleading amounts: " + label, async make => {
      const observation = row();
      Object.assign(observation.metadata, patch);
      const f = make(replies(observation));
      await applyCatalog(f);
      await f.connect();
      await inspect(f);
      assert(details(f).includes("一致しない") && details(f).includes(expected), "Mismatch invisible");
      assert(!details(f).includes("トークン残高: 1.234"), "Mislabelled amount");
      assert(details(f).includes(observation.balanceBaseUnits), "Raw units removed");
      assert(!q(f, "save").disabled, "Mismatch evidence should remain exportable");
    });
  }

  test("identity: missing contract keeps native balance and marks token unknown", async make => {
    const f = make(replies(row("DAT", 8453, { hasCode: false, metadata: null, balanceBaseUnits: null })));
    await applyCatalog(f);
    await f.connect();
    await inspect(f);
    assert(details(f).includes("契約コードが見つかりません"), "Missing code not visible");
    assert(details(f).includes("9.007199254740993123 ETH"), "Native result lost");
    assert(details(f).includes("トークンの最小単位: 不明"), "Unknown became zero");
    assert(!f.calls.some(call => call.method === "eth_call"), "Called nonexistent contract");
  });

  test("identity: malformed ABI clears earlier results", async make => {
    let broken = false;
    const f = make(replies(row(), args => broken && args.method === "eth_call" ? "0x" : undefined));
    await applyCatalog(f);
    await f.connect();
    await inspect(f);
    assert(details(f).includes("登録した公式情報と一致"), "Initial read failed");
    broken = true;
    await inspect(f);
    assert(details(f) === "" && q(f, "save").disabled, "Old result survived failure");
    assert(q(f, "status").textContent.includes("応答形式"), "ABI error missing");
  });

  test("identity: account event invalidates an in-flight observation", async make => {
    const gate = deferred();
    const f = make(replies(row(), args => args.method === "eth_getCode" ? gate.promise : undefined));
    await applyCatalog(f);
    await f.connect();
    q(f, "inspect").click();
    await until(() => f.calls.some(call => call.method === "eth_getCode"));
    f.provider.emit("accountsChanged", [B]);
    gate.resolve("0x6000");
    await delay();
    await until(() => !busy(f));
    assert(details(f) === "" && q(f, "save").disabled, "Old account result adopted");
    assert(f.field(".read").disabled, "Session stayed connected");
  });

  test("identity: cancel prevents late responses and allows a fresh read", async make => {
    const gate = deferred();
    let hold = true;
    const f = make(replies(row(), args => hold && args.method === "eth_getCode" ? gate.promise : undefined));
    await applyCatalog(f);
    await f.connect();
    q(f, "inspect").click();
    await until(() => f.calls.some(call => call.method === "eth_getCode"));
    assert(!q(f, "cancel").disabled && q(f, "save").disabled, "Busy controls wrong");
    assert(q(f, "progress").textContent.includes("契約"), "Stage not rendered");
    q(f, "cancel").click();
    gate.resolve("0x6000");
    await delay();
    assert(details(f) === "" && q(f, "progress").hidden, "Cancelled progress returned");
    hold = false;
    await inspect(f);
    assert(details(f).includes("1.234567890123456789 DAT"), "Retry failed");
    assert(f.calls.filter(call => call.method === "eth_requestAccounts").length === 1, "Retry requested permission");
  });

  test("identity: reorganization rejects the completed subreads", async make => {
    const f = make(replies(row(), args => args.method === "eth_getBlockByNumber" && args.params[0] === "0x2a"
      ? { number: "0x2a", hash: "0x" + "cd".repeat(32) } : undefined));
    await applyCatalog(f);
    await f.connect();
    await inspect(f);
    assert(details(f) === "" && q(f, "save").disabled, "Reorganized result accepted");
    assert(q(f, "status").textContent.includes("参照ブロック"), "Retry reason missing");
  });

  test("identity: imported record is historical and does not connect", async make => {
    const f = make(replies());
    await fileInput(f, row());
    assert(details(f).includes("過去の記録"), "Imported result represented as current");
    assert(details(f).includes("真正性を証明しません"), "Checksum confused with authentication");
    assert(f.calls.length === 0, "Import contacted provider");
    assert(f.field(".read").disabled, "Import connected wallet");
    assert(!q(f, "save").disabled && q(f, "file").value === "", "Import controls failed");
    assert(document.querySelector(".identity-overview-details").textContent.includes("DAT"), "Summary missing");
  });

  test("identity: other account imports stay visibly separate from form account", async make => {
    const f = make(replies());
    await fileInput(f, row("DAT", 8453, { account: B }));
    assert(details(f).includes(B), "Historical account hidden");
    assert(f.field(".account").value === A, "Import changed connection");
    assert(f.calls.length === 0, "Cross-account import connected");
  });

  test("identity: another token file cannot populate DAT", async make => {
    const f = make(replies());
    await fileInput(f, row("EMA"));
    assert(details(f) === "", "Other token imported");
    assert(q(f, "status").textContent.includes("別のトークン"), "Wrong-token guidance missing");
    assert(f.calls.length === 0, "Wrong-token import requested RPC");
  });

  test("identity: corruption is rejected without replacing form values", async make => {
    const f = make(replies());
    await fileInput(f, row(), text => text.replace("1234567890123456789", "2234567890123456789"));
    assert(q(f, "status").textContent.includes("破損確認"), "Tampering accepted");
    assert(details(f) === "" && q(f, "save").disabled, "Corrupt file accepted");
    assert(f.field(".account").value === A && f.calls.length === 0, "Import changed live state");
  });

  test("identity: JSON with misleading HTML is rejected or rendered as inert text", async make => {
    const f = make(replies());
    const observation = row();
    observation.metadata.name = "<img src=x onerror=alert(1)>";
    await fileInput(f, observation);
    assert(details(f).includes("<img"), "Observed text omitted");
    assert(q(f, "panel").querySelector("img") === null, "Metadata executed as HTML");
    assert(details(f).includes("一致しない"), "Untrusted name matched");
  });

  test("identity: baseline survives next import and shows exact smallest-unit delta", async make => {
    const f = make(replies());
    await fileInput(f, row());
    q(f, "baseline").click();
    assert(q(f, "baseline-status").textContent.includes("block 42"), "Baseline missing");
    await fileInput(f, row("DAT", 8453, { blockNumber: "43", blockHash: "0x" + "cd".repeat(32),
      balanceBaseUnits: "1234567890123456790" }));
    q(f, "compare").click();
    assert(q(f, "comparison").textContent.includes("+0.000000000000000001"), "Small change rounded");
    assert(q(f, "comparison").textContent.includes("利益や送金履歴ではありません"), "Delta overclaimed");
    assert(f.calls.length === 0, "Historical comparison issued RPC");
  });

  test("identity: different accounts cannot be compared", async make => {
    const f = make(replies());
    await fileInput(f, row());
    q(f, "baseline").click();
    await fileInput(f, row("DAT", 8453, { account: B, blockNumber: "43" }));
    q(f, "compare").click();
    assert(q(f, "comparison").textContent === "", "Cross-account comparison shown");
    assert(q(f, "status").textContent.includes("同じWallet"), "Wrong-context guidance missing");
    assert(details(f).includes(B), "Failed comparison discarded imported evidence");
  });

  for (const [selector, value, event] of [
    [".account", B, "input"], [".chain", "84532", "change"],
    [".token", "0x" + "77".repeat(20), "input"], [".provider", "legacy", "change"],
  ]) {
    test("identity: changing " + selector + " clears results and baseline", async make => {
      const f = make(replies());
      await fileInput(f, row());
      q(f, "baseline").click();
      f.input(selector, value, event);
      assert(details(f) === "" && q(f, "save").disabled, "Stale result survived");
      assert(q(f, "baseline-status").textContent.includes("未設定"), "Stale baseline survived");
      assert(q(f, "comparison").textContent === "", "Stale comparison survived");
      assert(f.calls.length === 0, "Input change made a wallet request");
    });
  }

  test("identity: clearing one card does not erase the other card's imported record", async make => {
    const f = make(replies());
    await fileInput(f, row());
    const ema = document.querySelector('[data-agent="EMA"]');
    const data = await prepareTokenIdentityFile(row("EMA", 8453, { account: B }));
    const transfer = new DataTransfer();
    transfer.items.add(new File([data.text], "EMA.json", { type: data.mimeType }));
    const input = ema.querySelector(".identity-file");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => ema.querySelector(".identity-details").textContent.includes("過去の記録"));
    q(f, "clear").click();
    assert(details(f) === "", "DAT clear failed");
    assert(ema.querySelector(".identity-details").textContent.includes(B), "DAT cleared EMA");
    assert(f.calls.length === 0, "Clear made provider requests");
  });

  test("identity: all three cards import independently without automatic permissions", async make => {
    const f = make(replies());
    for (const [index, agent] of ["DAT", "EMA", "CAWELON"].entries()) {
      const section = document.querySelector('[data-agent="' + agent + '"]');
      const observation = row(agent, 8453, { account: "0x" + String(index + 1).repeat(40) });
      const prepared = await prepareTokenIdentityFile(observation);
      const transfer = new DataTransfer();
      transfer.items.add(new File([prepared.text], agent + ".json", { type: prepared.mimeType }));
      const input = section.querySelector(".identity-file");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await until(() => section.querySelector(".identity-details").textContent.includes("1.234567890123456789 " + agent));
    }
    const summary = document.querySelector(".identity-overview-details").textContent;
    assert(["DAT", "EMA", "CAWELON"].every(agent => summary.includes(agent)), "Summary omitted a token");
    assert(summary.includes("3"), "Summary failed to count all cards");
    assert(f.calls.length === 0, "Three-file import contacted wallet");
  });

  test("identity: browser save produces the same decodable file and revokes its object URL", async make => {
    const f = make(replies());
    await fileInput(f, row());
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    const created = [], revoked = [], anchors = [];
    URL.createObjectURL = blob => { created.push(blob); return "blob:" + location.origin + "/synthetic-token-identity"; };
    URL.revokeObjectURL = url => { revoked.push(url); };
    HTMLAnchorElement.prototype.click = function () { anchors.push({ href: this.href, filename: this.download }); };
    try {
      q(f, "save").click();
      await until(() => created.length === 1);
      const decoded = await decodeTokenIdentityFile(new Uint8Array(await created[0].arrayBuffer()));
      assert(decoded.observation.balanceBaseUnits === row().balanceBaseUnits, "File lost exact balance");
      assert(decoded.authenticated === false, "File claimed authentication");
      assert(anchors[0].filename === "ThreeCore-DAT-identity-42.json", "Wrong filename");
      assert(q(f, "status").textContent.includes("ダウンロード完了を確認"), "Claimed disk save without evidence");
      await until(() => revoked.length === 1);
      assert(revoked[0] === "blob:" + location.origin + "/synthetic-token-identity", "Object URL not revoked");
      assert(q(f, "panel").querySelector("a[download]") === null, "Download anchor leaked");
      assert(f.calls.length === 0, "Save contacted provider");
    } finally {
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
      HTMLAnchorElement.prototype.click = click;
    }
  });

  test("identity: disconnect clears connected observations", async make => {
    const f = make(replies());
    await applyCatalog(f);
    await f.connect();
    await inspect(f);
    q(f, "baseline").click();
    f.field(".disconnect").click();
    assert(details(f) === "" && q(f, "save").disabled, "Disconnect left active observation");
    assert(q(f, "baseline-status").textContent.includes("未設定"), "Disconnect left baseline");
  });

  test("identity: rerender and disposal remove identity controls", async make => {
    const f = make(replies());
    await fileInput(f, row());
    f.app.dispose();
    assert(document.querySelector(".identity-panel") === null, "Disposed cards remain");
    assert(document.querySelector(".identity-overview") === null, "Disposed summary remains");
    safeCalls(f.calls);
  });
}
