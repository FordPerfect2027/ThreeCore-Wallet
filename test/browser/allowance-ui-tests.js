import { catalogToken } from "/src/token-catalog.js";
import { prepareAllowanceFile } from "/src/allowance-file.js";
import { ALLOWANCE_TARGET_SCHEMA } from "/src/allowance-targets.js";
import { ALLOWANCE_OBSERVATION_SCHEMA } from "/src/allowance-observation.js";
import { TOKEN_IDENTITY_SCHEMA } from "/src/token-identity-model.js";

const A = "0x" + "11".repeat(20), B = "0x" + "22".repeat(20);
const S1 = "0x" + "55".repeat(20), S2 = "0x" + "66".repeat(20);
const HASH = "0x" + "ab".repeat(32);
const MAX = (2n ** 256n - 1n).toString();
const assert = (value, message) => { if (!value) throw Error(message); };
const word = value => "0x" + BigInt(value).toString(16).padStart(64, "0");
function textWord(value) {
  const bytes = new TextEncoder().encode(value);
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return word(32) + word(bytes.length).slice(2) + hex.padEnd(Math.ceil(bytes.length / 32) * 64, "0");
}
function plan(agent = "DAT", chainId = 8453) {
  const token = catalogToken({ agent, chainId });
  return { schema: ALLOWANCE_TARGET_SCHEMA, agent, chainId, tokenAddress: token.address,
    targets: [{ address: S1, label: "Exchange A" }, { address: S2, label: "Exchange B" }] };
}
function record(agent = "DAT", chainId = 8453) {
  const token = catalogToken({ agent, chainId });
  return {
    schema: ALLOWANCE_OBSERVATION_SCHEMA,
    identity: {
      schema: TOKEN_IDENTITY_SCHEMA, catalogVersion: token.catalogVersion, agent, chainId,
      account: A, siteOrigin: location.origin, connectionEpoch: 1, blockNumber: "42", blockHash: HASH,
      tokenAddress: token.address, hasCode: true,
      metadata: { name: token.name, symbol: token.symbol, decimals: token.decimals, totalSupply: token.initialSupply },
      balanceBaseUnits: "1234567890123456789", nativeBalanceBaseUnits: "100000000000000001",
      readOnly: true, securityAudit: false,
    },
    targets: plan(agent, chainId),
    rows: [
      { spenderAddress: S1, label: "Exchange A", hasCode: true, codeError: null, allowanceBaseUnits: "0", allowanceError: null },
      { spenderAddress: S2, label: "Exchange B", hasCode: true, codeError: null, allowanceBaseUnits: "10", allowanceError: null },
    ],
    readOnly: true, completeDiscovery: false, securityAudit: false,
  };
}
function replies(value = record(), intercept = () => undefined) {
  const id = value.identity;
  return async args => {
    const custom = await intercept(args);
    if (custom !== undefined) return custom;
    if (args.method === "eth_chainId") return "0x" + id.chainId.toString(16);
    if (args.method === "eth_getBlockByNumber") return { number: "0x" + BigInt(id.blockNumber).toString(16), hash: id.blockHash };
    if (args.method === "eth_getBalance") return "0x" + BigInt(id.nativeBalanceBaseUnits).toString(16);
    if (args.method === "eth_getCode") {
      const row = value.rows.find(row => row.spenderAddress === args.params[0]);
      return (row ? row.hasCode : id.hasCode) ? "0x6000" : "0x";
    }
    if (args.method !== "eth_call") return undefined;
    const data = args.params[0].data;
    if (data === "0x06fdde03") return textWord(id.metadata.name);
    if (data === "0x95d89b41") return textWord(id.metadata.symbol);
    if (data === "0x313ce567") return word(id.metadata.decimals);
    if (data === "0x18160ddd") return word(id.metadata.totalSupply);
    if (data.startsWith("0x70a08231")) return word(id.balanceBaseUnits);
    if (data.startsWith("0xdd62ed3e")) {
      const row = value.rows.find(row => row.spenderAddress === "0x" + data.slice(-40));
      if (!row || row.allowanceBaseUnits === null) throw Error("Synthetic allowance unavailable");
      return word(row.allowanceBaseUnits);
    }
    throw Error("Forbidden synthetic selector");
  };
}
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { resolve, promise };
}
async function until(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw Error("Allowance UI did not settle");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const q = (f, name) => f.field(".allowance-" + name);
const busy = f => q(f, "panel").getAttribute("aria-busy") === "true";
const details = f => q(f, "details").textContent;
function configure(f, agent = "DAT", chainId = 8453) {
  f.input(".token", catalogToken({ agent, chainId }).address);
  f.input(".allowance-draft", S1 + " | Exchange A\n" + S2 + " | Exchange B");
  q(f, "preview").click();
  q(f, "apply").click();
  assert(!q(f, "inspect").disabled, "Target plan was not applied");
}
async function inspect(f) {
  q(f, "inspect").click();
  await until(() => !busy(f));
}
async function importFile(f, value = record(), kind = "observation", mutate) {
  const prepared = await prepareAllowanceFile(kind, value);
  const text = mutate ? mutate(prepared.text) : prepared.text;
  const transfer = new DataTransfer();
  transfer.items.add(new File([text], "allowance.json", { type: "application/json" }));
  q(f, "file").files = transfer.files;
  q(f, "file").dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => !busy(f));
}
function safe(calls) {
  const methods = new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId",
    "eth_getBlockByNumber", "eth_getCode", "eth_getBalance", "eth_call"]);
  assert(calls.every(call => methods.has(call.method)), "Unexpected transaction/permission RPC");
}
export function registerAllowanceUITests(test) {
  test("allowance: initial screen never requests wallet or persists permission", async make => {
    const f = make(replies());
    assert(f.calls.length === 0, "Unexpected automatic request");
    assert(q(f, "inspect").disabled, "Read enabled without target review");
    assert(q(f, "save").disabled, "Download enabled without result");
    assert(q(f, "file").getAttribute("aria-label").includes("JSON"), "File input lacks label");
  });
  test("allowance: review and apply targets do not query wallet", async make => {
    const f = make(replies());
    configure(f);
    assert(f.calls.length === 0, "Review requested account access");
    assert(q(f, "targets").textContent.includes(S1), "Full target missing");
    assert(q(f, "targets").textContent.includes("2件"), "Target count missing");
  });
  for (const chainId of [8453, 84532]) {
    test("allowance: actual card connect and read, chain " + chainId, async make => {
      const f = make(replies(record("DAT", chainId)));
      f.input(".chain", String(chainId), "change");
      configure(f, "DAT", chainId);
      await f.connect();
      await inspect(f);
      assert(details(f).includes("承認額あり 1件"), "Amounts missing");
      assert(details(f).includes("ゼロ 1件"), "Zero missing");
      assert(details(f).includes(HASH), "Pinned block hash missing");
      assert(f.output().includes("参照ブロック: 42"), "Main card block missing");
      assert(!f.output().includes("undefined"), "Undefined card result");
      assert(document.querySelector(".allowance-overview-details").textContent.includes("DAT: 指定 2件"), "Overview missing");
      safe(f.calls);
    });
  }
  test("allowance: existing allowance may be nonzero even if spender has no code", async make => {
    const value = record();
    value.rows[1].hasCode = false;
    const f = make(replies(value));
    configure(f);
    await f.connect();
    await inspect(f);
    assert(details(f).includes("相手のコード: なし"), "Code absence not visible");
    assert(details(f).includes("承認額あり 1件"), "Allowance incorrectly skipped");
  });
  test("allowance: maximum uint256 is exact and not a claim of safety", async make => {
    const value = record();
    value.rows[1].allowanceBaseUnits = MAX;
    const f = make(replies(value));
    configure(f);
    await f.connect();
    await inspect(f);
    assert(details(f).includes(MAX), "Large value rounded");
    assert(details(f).includes("uint256最大値"), "Maximum label missing");
    assert(details(f).includes("安全性や実際に移動できる金額を判断できません"), "Scope text missing");
  });
  test("allowance: failed row remains unknown, not zero", async make => {
    const value = record();
    Object.assign(value.rows[1], { allowanceBaseUnits: null, allowanceError: "READ_FAILED" });
    const f = make(replies(value));
    configure(f);
    await f.connect();
    await inspect(f);
    assert(details(f).includes("未確認 1件"), "Partial failure not counted");
    assert(details(f).includes("ゼロ 1件"), "Failure incorrectly counted as zero");
    assert(details(f).includes("ゼロとして扱っていません"), "Unknown warning missing");
  });
  test("allowance: identity mismatch withholds token-unit interpretation", async make => {
    const value = record();
    value.identity.metadata.symbol = "OTHER";
    const f = make(replies(value));
    configure(f);
    await f.connect();
    await inspect(f);
    assert(details(f).includes("不一致"), "Identity mismatch missing");
    assert(details(f).includes("照合未完了・未確認のため表示しません"), "Unverified decimal rendered");
  });
  test("allowance: filter and search are local views, not new provider reads", async make => {
    const f = make(replies());
    configure(f);
    await f.connect();
    await inspect(f);
    const count = f.calls.length;
    f.input(".allowance-filter", "nonzero", "change");
    assert(details(f).includes("表示対象: 1 / 2件"), "Filter not applied");
    assert(!details(f).includes(S1), "Zero target shown in nonzero view");
    f.input(".allowance-search", "not found");
    assert(details(f).includes("表示対象: 0 / 2件"), "Search not applied");
    assert(f.calls.length === count, "Filter queried provider");
  });
  for (const [selector, value, event] of [
    [".account", B, "input"], [".chain", "84532", "change"],
    [".token", S1, "input"], [".provider", "none", "change"],
  ]) {
    test("allowance: field change invalidates historical result " + selector, async make => {
      const f = make(replies());
      f.input(".token", catalogToken({ agent: "DAT", chainId: 8453 }).address);
      await importFile(f);
      assert(details(f).includes(A), "Precondition missing");
      f.input(selector, value, event);
      assert(details(f) === "", "Stale result remained");
      assert(q(f, "save").disabled, "Stale save remained enabled");
    });
  }
  test("allowance: draft edits retire applied targets without losing typed content", async make => {
    const f = make(replies());
    configure(f);
    await f.connect();
    await inspect(f);
    f.input(".allowance-draft", S1);
    assert(q(f, "inspect").disabled, "Edited target did not require review");
    assert(details(f) === "", "Prior result still visible");
    assert(q(f, "draft").value === S1, "User text lost");
  });
  test("allowance: cancel pending request and ignore late reply", async make => {
    const gate = deferred();
    let entered = false;
    const f = make(replies(record(), args => {
      if (args.method === "eth_call" && args.params[0].data.startsWith("0xdd62ed3e")) {
        entered = true;
        return gate.promise;
      }
    }));
    configure(f);
    await f.connect();
    q(f, "inspect").click();
    await until(() => entered);
    assert(!q(f, "cancel").disabled, "Cancel disabled during read");
    q(f, "cancel").click();
    gate.resolve(word(10));
    await until(() => !busy(f));
    assert(details(f) === "", "Cancelled result shown");
    assert(q(f, "status").textContent.includes("中止"), "Cancellation status missing");
  });
  test("allowance: account event disconnects and clears all permission observations", async make => {
    const f = make(replies());
    configure(f);
    await f.connect();
    await inspect(f);
    f.provider.emit("accountsChanged", [B]);
    assert(details(f) === "", "Disconnected observation retained");
    assert(f.output().includes("未接続"), "Card remained connected");
  });
  test("allowance: canonical block change never yields a saved record", async make => {
    let blocks = 0;
    const f = make(replies(record(), args => {
      if (args.method === "eth_getBlockByNumber" && ++blocks === 3) return { number: "0x2a", hash: "0x" + "cd".repeat(32) };
    }));
    configure(f);
    await f.connect();
    await inspect(f);
    assert(details(f) === "", "Reorganized result shown");
    assert(q(f, "save").disabled, "Reorganized result downloadable");
    assert(q(f, "status").textContent.includes("ブロック"), "Reorganization status missing");
  });
  test("allowance: target file import requires explicit apply and does not connect", async make => {
    const f = make(replies());
    f.input(".token", plan().tokenAddress);
    await importFile(f, plan(), "targets");
    assert(!q(f, "apply").disabled, "Imported target review missing");
    assert(q(f, "inspect").disabled, "Unreviewed import allowed read");
    q(f, "apply").click();
    assert(q(f, "draft").value.includes(S1), "Applied list not written");
    assert(f.calls.length === 0, "Import requested wallet");
  });
  test("allowance: offline record import has historical badge and no provider calls", async make => {
    const f = make(replies());
    f.input(".token", plan().tokenAddress);
    await importFile(f);
    assert(details(f).includes("過去の承認記録"), "Imported record not labelled historical");
    assert(f.calls.length === 0, "Import requested provider");
    assert(q(f, "inspect").disabled, "Record import automatically applied target list");
  });
  test("allowance: another card's record rejected", async make => {
    const f = make(replies());
    f.input(".token", plan().tokenAddress);
    await importFile(f, record("EMA"));
    assert(details(f) === "", "Other token record shown in DAT card");
    assert(q(f, "status").textContent.includes("トークン"), "Mismatch explanation missing");
  });
  test("allowance: tampered file clears prior results and download", async make => {
    const f = make(replies());
    f.input(".token", plan().tokenAddress);
    await importFile(f);
    await importFile(f, record(), "observation", text => text.replace('"allowanceBaseUnits": "10"', '"allowanceBaseUnits": "11"'));
    assert(details(f) === "", "Corrupted observation displayed");
    assert(q(f, "save").disabled, "Corrupted observation downloadable");
  });
  test("allowance: full addresses and hostile labels rendered as text only", async make => {
    const f = make(replies());
    f.input(".token", plan().tokenAddress);
    const value = record();
    value.targets.targets[0].label = value.rows[0].label = "<img src=x onerror=alert(1)>";
    await importFile(f, value);
    assert(details(f).includes("<img"), "Label text missing");
    assert(q(f, "details").querySelector("img") === null, "Markup executed");
  });
  test("allowance: offline comparison computes precise delta", async make => {
    const f = make(replies());
    f.input(".token", plan().tokenAddress);
    const before = record();
    await importFile(f, before);
    q(f, "baseline").click();
    const after = record();
    after.identity.blockNumber = "43";
    after.identity.blockHash = "0x" + "cd".repeat(32);
    after.rows[1].allowanceBaseUnits = "11";
    await importFile(f, after);
    q(f, "compare").click();
    assert(q(f, "comparison").textContent.includes("+0.000000000000000001"), "Exact delta missing");
    assert(f.calls.length === 0, "Offline comparison queried wallet");
  });
  test("allowance: cross-account comparison fails without discarding imported record", async make => {
    const f = make(replies());
    f.input(".token", plan().tokenAddress);
    await importFile(f);
    q(f, "baseline").click();
    const after = record();
    after.identity.account = B;
    await importFile(f, after);
    q(f, "compare").click();
    assert(q(f, "comparison").textContent === "", "Different account compared");
    assert(details(f).includes(B), "Historical record unnecessarily removed");
  });
  test("allowance: explicit clear also removes overview and baseline", async make => {
    const f = make(replies());
    f.input(".token", plan().tokenAddress);
    await importFile(f);
    q(f, "baseline").click();
    q(f, "clear").click();
    assert(details(f) === "", "Clear failed");
    assert(q(f, "baseline-status").textContent.includes("未設定"), "Baseline remained");
    assert(document.querySelector(".allowance-overview-details").textContent.includes("DAT: 未確認"), "Overview remained");
  });
  test("allowance: official token selection invalidates old imported record", async make => {
    const f = make(replies());
    f.input(".token", plan().tokenAddress);
    await importFile(f);
    f.field(".identity-catalog").click();
    f.field(".identity-apply").click();
    assert(details(f) === "", "Programmatic token selection left allowance result");
    assert(q(f, "inspect").disabled, "Programmatic selection retained applied target list");
  });
  test("allowance: exactly twenty targets can be reviewed, twenty-one rejected", async make => {
    const f = make(replies());
    f.input(".token", plan().tokenAddress);
    const lines = Array.from({ length: 20 }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0"));
    f.input(".allowance-draft", lines.join("\n"));
    q(f, "preview").click();
    assert(q(f, "targets").textContent.includes("20件"), "Capacity boundary rejected");
    f.input(".allowance-draft", [...lines, S1].join("\n"));
    q(f, "preview").click();
    assert(q(f, "apply").disabled, "Over-capacity plan staged");
  });
}
