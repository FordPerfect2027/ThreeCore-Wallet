import test from "node:test";
import assert from "node:assert/strict";
import { mountTokenIdentityPanel } from "../examples/token-identity-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { observation, ACCOUNT, OTHER, deferred, tick, fileFor } from "./helpers/identity-fixtures.js";

async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error("Identity panel did not settle");
    await tick();
  }
}

function fixture(options = {}) {
  const parent = new Element("section");
  const document = { createElement: tag => new Element(tag) };
  const context = { agent: "DAT", chainId: 8453, account: ACCOUNT, tokenAddress: observation().tokenAddress };
  const calls = [];
  const applied = [];
  const downloads = [];
  const states = [];
  let result = observation();
  const panel = mountTokenIdentityPanel({ document, parent,
    getContext: () => ({ ...context }),
    read: async input => { calls.push(input); return options.read ? options.read(input) : result; },
    applyAddress(address) { applied.push(address); context.tokenAddress = address; },
    downloadFile: options.downloadFile ?? (file => downloads.push(file)),
    onStateChange: state => states.push(state),
  });
  const q = name => parent.find("identity-" + name);
  return {
    panel, parent, context, calls, applied, downloads, states, q,
    setResult: value => { result = value; },
    async click(name) {
      assert.equal(q(name).disabled, false, name + " unexpectedly disabled");
      q(name).click();
      await until(() => q("panel").getAttribute("aria-busy") === "false");
    },
    async import(file) {
      q("file").files = [file];
      q("file").dispatchEvent(new Event("change"));
      await until(() => q("panel").getAttribute("aria-busy") === "false");
    },
  };
}

test("panel starts inert with no result, no downloads and no calls", () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  assert.equal(f.q("status").textContent, "未照合");
  assert.equal(f.q("save").disabled, true);
  assert.equal(f.q("baseline").disabled, true);
  assert.equal(f.q("compare").disabled, true);
  assert.equal(f.q("cancel").disabled, true);
  assert.equal(f.q("apply").disabled, true);
  assert.equal(f.q("status").getAttribute("role"), "status");
  assert.equal(f.q("status").getAttribute("aria-live"), "polite");
  f.panel.dispose();
});

test("showing the catalog does not change the form or read a wallet", async () => {
  const f = fixture();
  f.context.tokenAddress = "";
  await f.click("catalog");
  assert.match(f.q("catalog-details").textContent, /DATCORE/);
  assert.match(f.q("catalog-details").textContent, /Base Mainnet/);
  assert.equal(f.context.tokenAddress, "");
  assert.equal(f.q("apply").disabled, false);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.applied, []);
});

test("explicit apply inserts only the selected contract", async () => {
  const f = fixture();
  f.context.tokenAddress = "";
  await f.click("catalog");
  await f.click("apply");
  assert.deepEqual(f.applied, [observation().tokenAddress]);
  assert.deepEqual(f.calls, []);
  assert.equal(f.context.account, ACCOUNT);
  assert.equal(f.context.chainId, 8453);
  assert.equal(f.q("apply").disabled, true);
});

test("changing chain after catalog preview blocks application", async () => {
  const f = fixture();
  await f.click("catalog");
  f.context.chainId = 84532;
  await f.click("apply");
  assert.deepEqual(f.applied, []);
  assert.match(f.q("status").textContent, /入力が変わりました/);
});

test("explicit inspection shows exact amounts and full contract identity", async () => {
  const f = fixture();
  await f.click("inspect");
  const text = f.q("details").textContent;
  assert.match(text, /1\.234567890123456789 DAT/);
  assert.match(text, /9\.007199254740993123 ETH/);
  assert.match(text, /1234567890123456789/);
  assert.match(text, /参照ブロック: 42/);
  assert.equal(text.includes(observation().tokenAddress), true);
  assert.equal(text.includes(ACCOUNT), true);
  assert.equal(f.q("save").disabled, false);
  assert.equal(f.calls.length, 1);
});

test("metadata mismatch removes token-unit formatting but retains raw evidence", async () => {
  const f = fixture();
  const row = observation();
  row.metadata.decimals = 6;
  f.setResult(row);
  await f.click("inspect");
  assert.match(f.q("details").textContent, /一致しない項目/);
  assert.match(f.q("details").textContent, /照合未完了/);
  assert.equal(f.q("details").textContent.includes("1.234567890123456789 DAT"), false);
  assert.equal(f.q("details").textContent.includes("1234567890123456789"), true);
});

test("provider-controlled markup is assigned as text only", async () => {
  const f = fixture();
  const row = observation();
  row.metadata.name = "<img src=x onerror=alert(1)>";
  f.setResult(row);
  await f.click("inspect");
  assert.match(f.q("details").textContent, /<img src=x/);
  assert.equal(f.q("details").children.length, 0);
  assert.equal("innerHTML" in f.q("details"), false);
});

test("wrong token gives a readable error with no adapter request", async () => {
  const f = fixture();
  f.context.tokenAddress = OTHER;
  await f.click("inspect");
  assert.match(f.q("status").textContent, /公式アドレスと一致しません/);
  assert.deepEqual(f.calls, []);
  assert.equal(f.q("save").disabled, true);
});

test("busy controls prevent overlapping user operations", async () => {
  const gate = deferred();
  const f = fixture({ read: () => gate.promise });
  f.q("inspect").click();
  assert.equal(f.q("panel").getAttribute("aria-busy"), "true");
  for (const name of ["inspect", "save", "file", "catalog", "baseline", "compare"]) {
    assert.equal(f.q(name).disabled, true, name);
  }
  assert.equal(f.q("cancel").disabled, false);
  f.q("inspect").click();
  assert.equal(f.calls.length, 1);
  gate.resolve(observation());
  await until(() => f.q("inspect").disabled === false);
});

test("cancel button hides pending result and aborts the local operation", async () => {
  const gate = deferred();
  const f = fixture({ read: () => gate.promise });
  f.q("inspect").click();
  await f.click("cancel");
  assert.equal(f.calls[0].signal.aborted, true);
  gate.resolve(observation());
  await tick();
  assert.equal(f.q("details").textContent, "");
  assert.match(f.q("status").textContent, /中止/);
});

test("save prepares a valid file without claiming disk completion", async () => {
  const f = fixture();
  await f.click("inspect");
  await f.click("save");
  await until(() => f.downloads.length === 1);
  assert.equal(f.downloads[0].filename, "ThreeCore-DAT-identity-42.json");
  assert.equal(JSON.parse(f.downloads[0].text).observation.account, ACCOUNT);
  assert.match(f.q("status").textContent, /ダウンロード完了を確認/);
  assert.equal(f.calls.length, 1);
});

test("download failure is visible and does not erase the observation", async () => {
  const f = fixture({ downloadFile() { throw Error("Unavailable"); } });
  await f.click("inspect");
  await f.click("save");
  await until(() => /開始できません/.test(f.q("status").textContent));
  assert.match(f.q("details").textContent, /DATCORE/);
  assert.equal(f.q("save").disabled, false);
});

test("file selection displays imported provenance without any wallet call", async () => {
  const f = fixture();
  await f.import(await fileFor());
  assert.match(f.q("status").textContent, /過去の保存記録/);
  assert.match(f.q("details").textContent, /ファイルから読み込んだ/);
  assert.equal(f.q("file").value, "");
  assert.deepEqual(f.calls, []);
});

test("cancelled file picker keeps the previous result", async () => {
  const f = fixture();
  await f.click("inspect");
  const text = f.q("details").textContent;
  f.q("file").files = [];
  f.q("file").dispatchEvent(new Event("change"));
  assert.equal(f.q("details").textContent, text);
});

test("baseline and comparison display one-unit change accurately", async () => {
  const f = fixture();
  await f.import(await fileFor(observation({ blockNumber: "41", balanceBaseUnits: "1234567890123456788" })));
  await f.click("baseline");
  await f.click("inspect");
  await f.click("compare");
  assert.match(f.q("baseline-status").textContent, /block 41/);
  assert.match(f.q("comparison").textContent, /\+0\.000000000000000001/);
  assert.match(f.q("comparison").textContent, /利益や送金履歴ではありません/);
});

test("clear removes only this panel's transient evidence", async () => {
  const f = fixture();
  await f.click("inspect");
  await f.click("baseline");
  await f.click("clear");
  assert.equal(f.q("details").textContent, "");
  assert.equal(f.q("save").disabled, true);
  assert.equal(f.q("compare").disabled, true);
  assert.equal(f.context.account, ACCOUNT);
  assert.equal(f.context.tokenAddress, observation().tokenAddress);
});

test("external invalidation clears stale catalog review and loaded evidence", async () => {
  const f = fixture();
  await f.click("catalog");
  await f.click("inspect");
  f.panel.invalidate();
  assert.equal(f.q("catalog-details").textContent, "");
  assert.equal(f.q("apply").disabled, true);
  assert.equal(f.q("details").textContent, "");
});

test("disposed panel cannot trigger reads through detached controls", async () => {
  const f = fixture();
  const button = f.q("inspect");
  f.panel.dispose();
  button.click();
  await tick();
  assert.equal(f.parent.children.length, 0);
  assert.deepEqual(f.calls, []);
  f.panel.dispose();
});

test("summary observer receives imported and invalidated states", async () => {
  const f = fixture();
  await f.import(await fileFor());
  assert.equal(f.states.at(-1).provenance, "imported");
  f.panel.invalidate();
  assert.equal(f.states.at(-1).observation, null);
});
