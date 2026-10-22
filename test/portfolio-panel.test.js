import test from "node:test";
import assert from "node:assert/strict";
import { mountPortfolioPanel } from "../examples/portfolio-panel.js";
import { encodePortfolioReport } from "../src/portfolio-report.js";

// Minimal DOM adapter for component lifecycle tests. Real DOM behavior is
// separately exercised by test/browser/ui-tests.js in the in-app browser.
import { Element } from "./helpers/panel-dom.js";
const ACCOUNT = "0x" + "11".repeat(20);
const TOKEN = "0x" + "33".repeat(20);
const OTHER = "0x" + "44".repeat(20);
const HASH = "0x" + "ab".repeat(32);
function snapshot(overrides = {}) {
  return {
    agent: "DAT", account: ACCOUNT, chainId: 84532,
    siteOrigin: "http://localhost:4184", connectionEpoch: 1,
    blockNumber: "42", blockHash: HASH, nativeBalanceBaseUnits: "16",
    holdings: [{ address: TOKEN, hasCode: true, balanceBaseUnits: "42", notice: null }],
    readOnly: true, securityAudit: false, ...overrides,
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(read = async () => snapshot()) {
  const card = new Element("article");
  const calls = [];
  let cancelled = 0;
  const panel = mountPortfolioPanel({
    document: { createElement: tag => new Element(tag) },
    card,
    getContext: () => ({ agent: "DAT", chainId: 84532 }),
    read: options => { calls.push(options); return read(options); },
    onCancel: () => { cancelled++; },
  });
  const field = name => card.find("portfolio-" + name);
  const input = (name, value) => {
    field(name).value = value;
    field(name).dispatchEvent(new Event("input"));
  };
  return {
    card,
    getContext: () => ({ agent: "DAT", chainId: 84532 }), panel, calls, field, input,
    get cancelled() { return cancelled; },
    async ready() {
      input("tokens", TOKEN);
      field("read").click();
      await settle();
      assert.match(field("status").textContent, /完了/);
    },
  };
}

test("mounting the panel never starts a read", () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  assert.equal(f.field("cancel").disabled, true);
  assert.equal(f.field("export").disabled, true);
  assert.equal(f.field("panel").getAttribute("aria-busy"), "false");
  f.panel.dispose();
});

test("loading announces busy state and prevents duplicate refresh clicks", async () => {
  const gate = deferred();
  const f = fixture(() => gate.promise);
  f.input("tokens", TOKEN);
  f.field("read").click();
  f.field("read").click();
  assert.equal(f.calls.length, 1);
  assert.equal(f.field("panel").getAttribute("aria-busy"), "true");
  assert.equal(f.field("cancel").disabled, false);
  assert.equal(f.field("import").disabled, true);
  gate.resolve(snapshot());
  await settle();
  assert.equal(f.field("panel").getAttribute("aria-busy"), "false");
  assert.equal(f.field("read").disabled, false);
});

test("line parsing trims CRLF whitespace without inventing token addresses", async () => {
  const f = fixture();
  f.input("tokens", "  " + TOKEN + "\r\n\r\n  " + OTHER + "  \n");
  f.field("read").click();
  await settle();
  assert.deepEqual(f.calls[0].tokens, [TOKEN, OTHER]);
  assert.equal(f.calls[0].signal instanceof AbortSignal, true);
});

test("raw uint256 balances render exactly without floating point rounding", async () => {
  const value = ((1n << 256n) - 1n).toString();
  const f = fixture(async () => snapshot({
    nativeBalanceBaseUnits: value,
    holdings: [{ address: TOKEN, hasCode: true, balanceBaseUnits: value, notice: null }],
  }));
  await f.ready();
  assert.equal(f.field("details").textContent.split(value).length - 1, 2);
  assert.equal(f.field("status").getAttribute("role"), "status");
  assert.equal(f.field("status").getAttribute("aria-live"), "polite");
});

test("missing contract code is shown as unknown rather than a zero balance", async () => {
  const f = fixture(async () => snapshot({
    holdings: [{ address: TOKEN, hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }],
  }));
  await f.ready();
  assert.match(f.field("details").textContent, /契約コードなし/);
  assert.doesNotMatch(f.field("details").textContent, /最小単位）: 0/);
});

test("zero balance remains an observed result rather than an error", async () => {
  const f = fixture(async () => snapshot({
    nativeBalanceBaseUnits: "0",
    holdings: [{ address: TOKEN, hasCode: true, balanceBaseUnits: "0", notice: null }],
  }));
  await f.ready();
  assert.match(f.field("details").textContent, /wei）: 0/);
  assert.match(f.field("details").textContent, /最小単位）: 0/);
  assert.equal(f.field("export").disabled, false);
});

test("export is explicit and round-trips a historical JSON observation", async () => {
  const f = fixture();
  await f.ready();
  assert.equal(f.field("json").value, "");
  f.field("export").click();
  const report = JSON.parse(f.field("json").value);
  assert.equal(report.historicalObservation, true);
  assert.equal(report.snapshot.account, ACCOUNT);
  assert.equal(report.snapshot.blockHash, HASH);
  assert.equal(f.calls.length, 1);
});

test("a changed plan aborts the pending read and discards its later value", async () => {
  const gate = deferred();
  const f = fixture(() => gate.promise);
  f.input("tokens", TOKEN);
  f.field("read").click();
  f.input("tokens", OTHER);
  assert.equal(f.calls[0].signal.aborted, true);
  gate.resolve(snapshot());
  await settle();
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("export").disabled, true);
  assert.match(f.field("status").textContent, /入力が変わりました/);
});

test("manual cancel aborts the request and informs the outer controller", async () => {
  const gate = deferred();
  const f = fixture(() => gate.promise);
  f.field("read").click();
  f.field("cancel").click();
  assert.equal(f.cancelled, 1);
  assert.equal(f.calls[0].signal.aborted, true);
  gate.reject(Error("late provider rejection"));
  await settle();
  assert.match(f.field("status").textContent, /キャンセル/);
  assert.equal(f.field("details").textContent, "");
});

test("clear after a result removes both display and serialized data", async () => {
  const f = fixture();
  await f.ready();
  f.field("export").click();
  f.field("clear").click();
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("json").value, "");
  assert.equal(f.field("export").disabled, true);
});

test("a failed refresh cannot leave the previous successful result visible", async () => {
  let fail = false;
  const f = fixture(async () => {
    if (fail) throw Error("sensitive provider diagnostic");
    return snapshot();
  });
  await f.ready();
  f.field("export").click();
  fail = true;
  f.field("read").click();
  await settle();
  assert.match(f.field("status").textContent, /確認できません/);
  assert.doesNotMatch(f.field("status").textContent, /sensitive/);
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("json").value, "");
  assert.equal(f.field("export").disabled, true);
});

for (const invalid of [
  { readOnly: false },
  { securityAudit: true },
  { nativeBalanceBaseUnits: "-1" },
  { nativeBalanceBaseUnits: "1e18" },
  { blockHash: "<script>bad</script>" },
  { agent: "unknown" },
  { holdings: [] },
]) {
  test("untrusted reader shape fails closed: " + JSON.stringify(invalid), async () => {
    const f = fixture(async () => snapshot(invalid));
    f.field("read").click();
    await settle();
    assert.match(f.field("status").textContent, /確認できません/);
    assert.equal(f.field("details").textContent, "");
    assert.equal(f.field("export").disabled, true);
  });
}

test("importing a report while disconnected renders historical context without reads", () => {
  const f = fixture();
  f.input("json", encodePortfolioReport(snapshot()));
  f.field("import").click();
  assert.match(f.field("details").textContent, /過去の保存記録/);
  assert.match(f.field("status").textContent, /現在の接続や残高ではありません/);
  assert.equal(f.field("export").disabled, true);
  assert.equal(f.calls.length, 0);
});

for (const invalid of ["", "null", "[]", "{", '{"schema":"unknown"}', "<img src=x>"]) {
  test("invalid import cannot display an observation: " + JSON.stringify(invalid), async () => {
    const f = fixture();
    await f.ready();
    f.input("json", invalid);
    f.field("import").click();
    assert.match(f.field("status").textContent, /正しくありません/);
    assert.equal(f.field("details").textContent, "");
    assert.equal(f.field("export").disabled, true);
    assert.equal(f.calls.length, 1);
  });
}

test("import controls cannot replace an observation during an active read", async () => {
  const gate = deferred();
  const f = fixture(() => gate.promise);
  f.input("json", encodePortfolioReport(snapshot({ blockNumber: "7" })));
  f.field("read").click();
  f.field("import").click();
  assert.match(f.field("status").textContent, /確認しています/);
  gate.resolve(snapshot());
  await settle();
  assert.match(f.field("details").textContent, /参照ブロック: 42/);
});

test("newest generation wins when an old read resolves after a fresh one", async () => {
  const old = deferred();
  let count = 0;
  const f = fixture(() => ++count === 1 ? old.promise : Promise.resolve(snapshot({ blockNumber: "43" })));
  f.field("read").click();
  f.field("cancel").click();
  f.field("read").click();
  await settle();
  old.resolve(snapshot());
  await settle();
  assert.match(f.field("details").textContent, /参照ブロック: 43/);
  assert.doesNotMatch(f.field("details").textContent, /参照ブロック: 42/);
});

test("dispose aborts pending work and detaches all controls", async () => {
  const gate = deferred();
  const f = fixture(() => gate.promise);
  const read = f.field("read"), clear = f.field("clear");
  read.click();
  f.panel.dispose();
  f.panel.dispose();
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.card.children.length, 0);
  read.click();
  clear.click();
  gate.resolve(snapshot());
  await settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.card.children.length, 0);
});

test("clear during a pending read also releases the parent controller", async () => {
  const gate = deferred();
  const f = fixture(() => gate.promise);
  f.field("read").click();
  const before = f.cancelled;
  f.field("clear").click();
  assert.equal(f.cancelled, before + 1);
  assert.equal(f.calls[0].signal.aborted, true);
  gate.resolve(snapshot());
  await settle();
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("cancel").disabled, true);
});

test("editing a pending plan also releases the parent controller", async () => {
  const gate = deferred();
  const f = fixture(() => gate.promise);
  f.field("read").click();
  const before = f.cancelled;
  f.input("tokens", OTHER);
  assert.equal(f.cancelled, before + 1);
  assert.equal(f.calls[0].signal.aborted, true);
  gate.reject(Error("obsolete"));
  await settle();
  assert.match(f.field("status").textContent, /入力が変わりました/);
  assert.equal(f.field("read").disabled, false);
});

test("reader data accessors are rejected without evaluating provider getters", async () => {
  let evaluated = false;
  const value = snapshot();
  Object.defineProperty(value, "account", {
    enumerable: true,
    get() { evaluated = true; throw Error("provider getter must not run"); },
  });
  const f = fixture(async () => value);
  f.field("read").click();
  await settle();
  assert.equal(evaluated, false);
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("export").disabled, true);
  assert.match(f.field("status").textContent, /確認できません/);
});

test("historical JSON import cannot restore a cleared live connection", () => {
  const f = fixture();
  f.panel.invalidate("未接続");
  f.input("json", encodePortfolioReport(snapshot()));
  f.field("import").click();
  assert.equal(f.calls.length, 0);
  assert.match(f.field("details").textContent, /過去の保存記録/);
  assert.equal(f.field("export").disabled, true);
  f.field("export").click();
  assert.equal(f.field("json").value, "");
});


test("portfolio success exposes a copied target to the comparison panel", async () => {
  const f = fixture();
  await f.ready();
  const run = f.card.find("comparison-run");
  assert.equal(run.disabled, false);
  f.card.find("comparison-baseline").value = encodePortfolioReport(snapshot());
  run.click();
  assert.match(f.card.find("comparison-details").textContent, /42 → 42/);
  assert.match(f.card.find("comparison-details").textContent, /wei）: 0/);
  assert.equal(f.calls.length, 1);
});

test("token-plan changes discard comparison target and baseline with the old observation", async () => {
  const f = fixture();
  await f.ready();
  f.card.find("comparison-baseline").value = encodePortfolioReport(snapshot());
  f.card.find("comparison-run").click();
  f.input("tokens", OTHER);
  assert.equal(f.card.find("comparison-details").textContent, "");
  assert.equal(f.card.find("comparison-baseline").value, "");
  assert.equal(f.card.find("comparison-run").disabled, true);
});

test("refresh clears comparison while waiting and a failed read does not restore it", async () => {
  const pending = deferred();
  let count = 0;
  const f = fixture(() => ++count === 1 ? Promise.resolve(snapshot()) : pending.promise);
  await f.ready();
  f.card.find("comparison-baseline").value = encodePortfolioReport(snapshot());
  f.card.find("comparison-run").click();
  f.field("read").click();
  assert.equal(f.card.find("comparison-run").disabled, true);
  assert.equal(f.card.find("comparison-details").textContent, "");
  pending.reject(Error("provider unavailable"));
  await settle();
  assert.equal(f.card.find("comparison-run").disabled, true);
  assert.equal(f.card.find("comparison-baseline").value, "");
});

test("invalid portfolio import cannot leave a previous comparison target active", async () => {
  const f = fixture();
  await f.ready();
  f.card.find("comparison-baseline").value = encodePortfolioReport(snapshot());
  f.card.find("comparison-run").click();
  f.input("json", "null");
  f.field("import").click();
  assert.equal(f.card.find("comparison-run").disabled, true);
  assert.equal(f.card.find("comparison-details").textContent, "");
  assert.equal(f.card.find("comparison-baseline").value, "");
});

test("imported historical observations can be compared without restoring a live export", () => {
  const f = fixture();
  f.input("json", encodePortfolioReport(snapshot()));
  f.field("import").click();
  assert.equal(f.field("export").disabled, true);
  assert.equal(f.card.find("comparison-run").disabled, false);
  f.card.find("comparison-baseline").value = encodePortfolioReport(snapshot());
  f.card.find("comparison-run").click();
  assert.match(f.card.find("comparison-status").textContent, /比較が完了/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.field("export").disabled, true);
});

test("outer invalidation removes sensitive observation text from both views", async () => {
  const f = fixture();
  await f.ready();
  f.card.find("comparison-baseline").value = encodePortfolioReport(snapshot());
  f.card.find("comparison-run").click();
  f.panel.invalidate();
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("json").value, "");
  assert.equal(f.card.find("comparison-baseline").value, "");
  assert.equal(f.card.find("comparison-details").textContent, "");
  assert.equal(f.card.find("comparison-run").disabled, true);
});

test("outer disposal detaches comparison listeners as well as portfolio controls", async () => {
  const f = fixture();
  await f.ready();
  const compare = f.card.find("comparison-run");
  const baseline = f.card.find("comparison-baseline");
  const details = f.card.find("comparison-details");
  baseline.value = encodePortfolioReport(snapshot());
  compare.click();
  f.panel.dispose();
  baseline.value = encodePortfolioReport(snapshot());
  baseline.dispatchEvent(new Event("input"));
  compare.click();
  assert.equal(details.textContent, "");
  assert.equal(f.card.children.length, 0);
  assert.equal(f.calls.length, 1);
});


test("token plan export reads the current list without refreshing the portfolio", () => {
  const f = fixture();
  f.input("tokens", TOKEN + "\n" + OTHER);
  f.card.find("token-plan-save").click();
  const plan = JSON.parse(f.card.find("token-plan-json").value);
  assert.deepEqual(plan.tokens, [TOKEN, OTHER]);
  assert.equal(plan.agent, "DAT");
  assert.equal(plan.chainId, 84532);
  assert.equal(f.calls.length, 0);
});

function previewTokenPlan(f, tokens = [OTHER]) {
  f.card.find("token-plan-json").value = JSON.stringify({
    schema: "threecore-token-plan-v1", agent: "DAT", chainId: 84532, tokens,
  });
  f.card.find("token-plan-preview").click();
}

test("previewing a token plan does not replace the list or discard a valid observation", async () => {
  const f = fixture();
  await f.ready();
  const before = f.field("details").textContent;
  previewTokenPlan(f);
  assert.equal(f.field("tokens").value, TOKEN);
  assert.equal(f.field("details").textContent, before);
  assert.equal(f.calls.length, 1);
});

test("applying a reviewed token plan clears old results and releases outer controls", async () => {
  const f = fixture();
  await f.ready();
  f.field("export").click();
  previewTokenPlan(f);
  const before = f.cancelled;
  f.card.find("token-plan-apply").click();
  assert.equal(f.field("tokens").value, OTHER);
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("json").value, "");
  assert.equal(f.field("export").disabled, true);
  assert.equal(f.card.find("comparison-run").disabled, true);
  assert.equal(f.cancelled, before + 1);
  assert.equal(f.calls.length, 1);
});

test("applying a plan during a read aborts the obsolete observation locally", async () => {
  const pending = deferred();
  const f = fixture(() => pending.promise);
  f.input("tokens", TOKEN);
  f.field("read").click();
  previewTokenPlan(f);
  f.card.find("token-plan-apply").click();
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.field("tokens").value, OTHER);
  pending.resolve(snapshot());
  await settle();
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("export").disabled, true);
});

test("disconnect-style invalidation removes the plan candidate and stored JSON", () => {
  const f = fixture();
  previewTokenPlan(f);
  f.panel.invalidate();
  assert.equal(f.card.find("token-plan-json").value, "");
  assert.equal(f.card.find("token-plan-apply").disabled, true);
  assert.equal(f.card.find("token-plan-details").textContent, "");
});

test("manual token entry invalidates an already previewed list", () => {
  const f = fixture();
  previewTokenPlan(f);
  f.input("tokens", TOKEN);
  assert.equal(f.card.find("token-plan-json").value, "");
  assert.equal(f.card.find("token-plan-apply").disabled, true);
  assert.equal(f.field("tokens").value, TOKEN);
});

test("late read rejection after applying a plan cannot overwrite its new input notice", async () => {
  const pending = deferred();
  const f = fixture(() => pending.promise);
  f.input("tokens", TOKEN);
  f.field("read").click();
  previewTokenPlan(f);
  f.card.find("token-plan-apply").click();
  pending.reject(Error("obsolete provider failure"));
  await settle();
  assert.equal(f.field("tokens").value, OTHER);
  assert.equal(f.field("details").textContent, "");
  assert.match(f.field("status").textContent, /入力リストを変更/);
  assert.equal(f.field("export").disabled, true);
});

function progressEvent(stage, total = 1, index = null, address = null) {
  const completed = ["canonical", "complete"].includes(stage) ? total : index ?? 0;
  return { stage, completedTokens: completed, totalTokens: total, tokenIndex: index, tokenAddress: address };
}
function progressThroughToken(notify) {
  notify(progressEvent("block"));
  notify(progressEvent("native"));
  notify(progressEvent("token-code", 1, 0, TOKEN));
  notify(progressEvent("token-balance", 1, 0, TOKEN));
}

test("progress is visible only during an active observation", async () => {
  let notify;
  const pending = deferred();
  const f = fixture(options => { notify = options.onProgress; return pending.promise; });
  assert.equal(f.field("progress").hidden, true);
  f.input("tokens", TOKEN);
  f.field("read").click();
  assert.equal(f.field("progress").hidden, false);
  progressThroughToken(notify);
  assert.match(f.field("status").textContent, /1件目のトークン残高/);
  assert.equal(f.field("progress").value, 0);
  notify(progressEvent("canonical"));
  assert.equal(f.field("progress").value, 1);
  assert.match(f.field("status").textContent, /再確認/);
  pending.resolve(snapshot());
  await settle();
  assert.equal(f.field("progress").hidden, true);
  assert.match(f.field("status").textContent, /完了/);
});

test("late progress after successful completion cannot replace the ready message", async () => {
  let notify;
  const f = fixture(async options => { notify = options.onProgress; return snapshot(); });
  await f.ready();
  const status = f.field("status").textContent;
  notify(progressEvent("block"));
  assert.equal(f.field("status").textContent, status);
  assert.equal(f.field("progress").hidden, true);
});

for (const action of ["cancel", "clear"]) {
  test("late progress after " + action + " cannot revive a loading display", async () => {
    let notify;
    const pending = deferred();
    const f = fixture(options => { notify = options.onProgress; return pending.promise; });
    f.input("tokens", TOKEN);
    f.field("read").click();
    f.field(action).click();
    const message = f.field("status").textContent;
    progressThroughToken(notify);
    assert.equal(f.field("status").textContent, message);
    assert.equal(f.field("progress").hidden, true);
    assert.equal(f.field("progress").value, 0);
    pending.resolve(snapshot());
    await settle();
    assert.equal(f.field("status").textContent, message);
  });
}

test("malformed progress is ignored without rendering untrusted messages", async () => {
  let notify;
  const pending = deferred();
  const f = fixture(options => { notify = options.onProgress; return pending.promise; });
  f.input("tokens", TOKEN);
  f.field("read").click();
  const before = f.field("status").textContent;
  notify({ ...progressEvent("block"), message: "<img src=x>" });
  assert.equal(f.field("status").textContent, before);
  notify(progressEvent("block"));
  assert.match(f.field("status").textContent, /参照ブロック/);
  pending.resolve(snapshot());
  await settle();
  assert.match(f.field("status").textContent, /完了/);
});

test("progress for another token address does not advance the display", async () => {
  let notify;
  const pending = deferred();
  const f = fixture(options => { notify = options.onProgress; return pending.promise; });
  f.input("tokens", TOKEN);
  f.field("read").click();
  notify(progressEvent("block"));
  notify(progressEvent("native"));
  const message = f.field("status").textContent;
  notify(progressEvent("token-code", 1, 0, OTHER));
  assert.equal(f.field("status").textContent, message);
  notify(progressEvent("token-code", 1, 0, TOKEN));
  assert.match(f.field("status").textContent, /契約コード/);
  pending.resolve(snapshot());
  await settle();
});

test("a superseded observation cannot send progress to the newer generation", async () => {
  const callbacks = [], tasks = [deferred(), deferred()];
  const f = fixture(options => {
    callbacks.push(options.onProgress);
    return tasks[callbacks.length - 1].promise;
  });
  f.input("tokens", TOKEN);
  f.field("read").click();
  f.field("cancel").click();
  f.field("read").click();
  callbacks[1](progressEvent("block"));
  const current = f.field("status").textContent;
  progressThroughToken(callbacks[0]);
  assert.equal(f.field("status").textContent, current);
  tasks[1].resolve(snapshot());
  tasks[0].resolve(snapshot());
  await settle();
  assert.match(f.field("status").textContent, /完了/);
});

test("progress does not create a portfolio export before the snapshot resolves", async () => {
  let notify;
  const pending = deferred();
  const f = fixture(options => { notify = options.onProgress; return pending.promise; });
  f.input("tokens", TOKEN);
  f.field("read").click();
  progressThroughToken(notify);
  notify(progressEvent("canonical"));
  notify(progressEvent("complete"));
  assert.equal(f.field("export").disabled, true);
  assert.equal(f.field("details").textContent, "");
  pending.resolve(snapshot());
  await settle();
  assert.equal(f.field("export").disabled, false);
});

test("late progress after a failed read cannot hide the failure message", async () => {
  let notify;
  const f = fixture(async options => { notify = options.onProgress; throw Error("provider failed"); });
  f.input("tokens", TOKEN);
  f.field("read").click();
  await settle();
  const message = f.field("status").textContent;
  assert.match(message, /確認できません/);
  notify(progressEvent("block"));
  assert.equal(f.field("status").textContent, message);
  assert.equal(f.field("progress").hidden, true);
});

for (const [code, label] of [
  ["BLOCK_CHANGED", /ブロックが変わりました/],
  ["SNAPSHOT_TIMEOUT", /待機時間/],
  ["DUPLICATE_TOKEN", /重複/],
]) {
  test("portfolio view explains a safe failure cause: " + code, async () => {
    const f = fixture(async () => { throw { code, message: "private provider payload" }; });
    f.input("tokens", TOKEN);
    f.field("read").click();
    await settle();
    assert.match(f.field("status").textContent, label);
    assert.doesNotMatch(f.field("status").textContent, /private provider/);
    assert.equal(f.field("progress").hidden, true);
    assert.equal(f.field("export").disabled, true);
  });
}
