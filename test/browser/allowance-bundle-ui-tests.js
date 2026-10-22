import { catalogToken } from "/src/token-catalog.js";
import { prepareAllowanceFile } from "/src/allowance-file.js";
import { captureAllowanceBundle, prepareAllowanceBundle } from "/src/allowance-bundle.js";
import { ALLOWANCE_OBSERVATION_SCHEMA } from "/src/allowance-observation.js";
import { ALLOWANCE_TARGET_SCHEMA } from "/src/allowance-targets.js";
import { TOKEN_IDENTITY_SCHEMA } from "/src/token-identity-model.js";

const agents = ["DAT", "EMA", "CAWELON"];
const spender = "0x" + "55".repeat(20);
const assert = (value, message) => { if (!value) throw Error(message); };
const q = name => document.querySelector(".allowance-bundle-" + name);
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error("Bundle UI did not settle");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function records() {
  return agents.map((agent, index) => {
    const token = catalogToken({ agent, chainId: 8453 });
    return {
      schema: ALLOWANCE_OBSERVATION_SCHEMA,
      identity: {
        schema: TOKEN_IDENTITY_SCHEMA, catalogVersion: token.catalogVersion,
        agent, account: "0x" + String(index + 1).repeat(40), chainId: 8453,
        siteOrigin: location.origin, connectionEpoch: 1, blockNumber: String(42 + index),
        blockHash: "0x" + "ab".repeat(32), tokenAddress: token.address, hasCode: true,
        metadata: { name: token.name, symbol: token.symbol, decimals: token.decimals, totalSupply: token.initialSupply },
        balanceBaseUnits: "1000000000000000000", nativeBalanceBaseUnits: "100000000000000000",
        readOnly: true, securityAudit: false,
      },
      targets: {
        schema: ALLOWANCE_TARGET_SCHEMA, agent, chainId: 8453, tokenAddress: token.address,
        targets: [{ address: spender, label: "Mock target" }],
      },
      rows: [{ spenderAddress: spender, label: "Mock target", hasCode: true, codeError: null,
        allowanceBaseUnits: String(index), allowanceError: null }],
      readOnly: true, completeDiscovery: false, securityAudit: false,
    };
  });
}
async function inputFile(element, text) {
  const transfer = new DataTransfer();
  transfer.items.add(new File([text], "records.json", { type: "application/json" }));
  element.files = transfer.files;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
async function loadCards() {
  for (const record of records()) {
    const card = document.querySelector('[data-agent="' + record.identity.agent + '"]');
    const chain = card.querySelector(".chain");
    chain.value = String(record.identity.chainId);
    chain.dispatchEvent(new Event("change", { bubbles: true }));
    const token = card.querySelector(".token");
    token.value = record.identity.tokenAddress;
    token.dispatchEvent(new Event("input", { bubbles: true }));
    await inputFile(card.querySelector(".allowance-file"), (await prepareAllowanceFile("observation", record)).text);
    await until(() => card.querySelector(".allowance-panel").getAttribute("aria-busy") === "false");
  }
}
export function registerAllowanceBundleUITests(test) {
  test("allowance: bundle review requires all three cards", async make => {
    const f = make();
    q("review").click();
    assert(q("save").disabled, "Incomplete bundle downloadable");
    assert(q("status").textContent.includes("3件"), "Missing-card explanation absent");
    assert(f.calls.length === 0, "Review connected wallet");
  });
  test("allowance: bundle review includes every token account and observed block", async make => {
    const f = make();
    await loadCards();
    q("review").click();
    const text = q("details").textContent;
    for (const record of records()) {
      assert(text.includes(record.identity.agent), "Token omitted");
      assert(text.includes(record.identity.account), "Account abbreviated/omitted");
      assert(text.includes("block " + record.identity.blockNumber), "Block omitted");
    }
    assert(text.includes("別々の時点"), "Atomic snapshot implied");
    assert(!q("save").disabled, "Valid bundle download unavailable");
    assert(f.calls.length === 0, "Offline review invoked wallet");
  });
  test("allowance: changed card invalidates reviewed bundle before download", async make => {
    make();
    await loadCards();
    q("review").click();
    const dat = document.querySelector('[data-agent="DAT"]');
    dat.querySelector(".allowance-clear").click();
    q("save").click();
    await until(() => q("panel").getAttribute("aria-busy") === "false");
    assert(q("save").disabled, "Stale review still downloadable");
    assert(!q("status").textContent.includes("用意しました"), "Stale save claimed success");
  });
  test("allowance: bundle import displays historical record without filling cards", async make => {
    const f = make();
    const prepared = await prepareAllowanceBundle(captureAllowanceBundle(records()));
    await inputFile(q("file"), prepared.text);
    await until(() => q("panel").getAttribute("aria-busy") === "false");
    assert(q("status").textContent.includes("過去の一括記録"), "Historical label absent");
    assert(q("details").textContent.includes("CAWELON"), "Bundle missing third token");
    for (const agent of agents) {
      assert(document.querySelector('[data-agent="' + agent + '"] .allowance-details').textContent === "", "Import overwrote card");
    }
    assert(f.calls.length === 0, "Import invoked wallet");
  });
  test("allowance: bundle corruption cannot display partial records", async make => {
    make();
    const prepared = await prepareAllowanceBundle(captureAllowanceBundle(records()));
    const changed = prepared.text.replace('"allowanceBaseUnits": "1"', '"allowanceBaseUnits": "100"');
    await inputFile(q("file"), changed);
    await until(() => q("panel").getAttribute("aria-busy") === "false");
    assert(q("details").textContent === "", "Corrupt bundle partially displayed");
    assert(q("save").disabled, "Corrupt bundle save enabled");
  });
  test("allowance: bundle clear affects only its separate display", async make => {
    make();
    await loadCards();
    q("review").click();
    q("clear").click();
    assert(q("details").textContent === "", "Bundle display remains");
    for (const agent of agents) {
      assert(document.querySelector('[data-agent="' + agent + '"] .allowance-details').textContent.includes(agent), "Card accidentally cleared");
    }
  });
  test("allowance: bundle no-file event does not erase a valid preview", async make => {
    make();
    await loadCards();
    q("review").click();
    const text = q("details").textContent;
    const transfer = new DataTransfer();
    q("file").files = transfer.files;
    q("file").dispatchEvent(new Event("change", { bubbles: true }));
    assert(q("details").textContent === text, "Cancelled file chooser erased preview");
  });
}
