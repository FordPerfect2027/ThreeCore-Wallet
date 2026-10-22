import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioProgressTracker, PortfolioProgressError } from "../src/portfolio-progress.js";

const A = "0x" + "ab".repeat(20);
const B = "0x" + "cd".repeat(20);
function event(stage, completedTokens = 0, totalTokens = 2, tokenIndex = null, tokenAddress = null) {
  return { stage, completedTokens, totalTokens, tokenIndex, tokenAddress };
}
function code(index, total = 2, address = [A, B][index]) {
  return event("token-code", index, total, index, address);
}
function balance(index, total = 2, address = [A, B][index]) {
  return event("token-balance", index, total, index, address);
}
function start(tokens = [A, B]) {
  const tracker = createPortfolioProgressTracker(tokens);
  tracker.accept(event("block", 0, tokens.length));
  tracker.accept(event("native", 0, tokens.length));
  return tracker;
}
const rejects = fn => assert.throws(fn, PortfolioProgressError);

test("complete two-token progress produces bounded counts and clear labels", () => {
  const tracker = createPortfolioProgressTracker([A, B]);
  const trace = [
    event("block"), event("native"), code(0), balance(0),
    code(1), balance(1), event("canonical", 2), event("complete", 2),
  ].map(value => tracker.accept(value));
  assert.deepEqual(trace.map(row => row.completedTokens), [0, 0, 0, 0, 1, 1, 2, 2]);
  assert.match(trace[0].label, /参照ブロック/);
  assert.match(trace[1].label, /ETH残高/);
  assert.match(trace[2].label, /1件目の契約コード/);
  assert.match(trace[3].label, /1件目のトークン残高/);
  assert.match(trace[6].label, /ブロックが変わっていないか/);
  assert.match(trace[7].label, /読み取り結果を確認/);
  assert.equal(Object.isFrozen(trace[7]), true);
});

test("missing code may skip a balance step without skipping the contract observation", () => {
  const tracker = start();
  tracker.accept(code(0));
  const second = tracker.accept(code(1));
  assert.equal(second.completedTokens, 1);
  tracker.accept(event("canonical", 2));
  assert.equal(tracker.accept(event("complete", 2)).completedTokens, 2);
});

test("maximum-size plans keep progress monotonic with mixed code availability", () => {
  const tokens = Array.from({ length: 32 }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0"));
  const tracker = start(tokens);
  let previous = 0;
  for (let index = 0; index < tokens.length; index++) {
    const value = tracker.accept(code(index, 32, tokens[index]));
    assert.equal(value.totalTokens, 32);
    assert.ok(value.completedTokens >= previous && value.completedTokens <= 32);
    previous = value.completedTokens;
    if (index % 2 === 0) tracker.accept(balance(index, 32, tokens[index]));
  }
  tracker.accept(event("canonical", 32, 32));
  const final = tracker.accept(event("complete", 32, 32));
  assert.equal(final.completedTokens, 32);
});

for (const tokens of [null, [], "bad", new Array(1), [A, A], [A, "bad"], Array(33).fill(A)]) {
  test("invalid input plan cannot create a progress tracker: " + JSON.stringify(tokens), () => {
    rejects(() => createPortfolioProgressTracker(tokens));
  });
}

test("tracker copies plan addresses and normalizes case before accepting events", () => {
  const input = [A.toUpperCase().replace("0X", "0x")];
  const tracker = start(input);
  input[0] = B;
  assert.equal(tracker.accept(code(0, 1, A)).tokenAddress, A);
});

for (const value of [
  null, [], {}, event("unknown"), event("block", -1), event("block", 1),
  event("block", 0, 0), event("block", 0, 33), event("block", 0, 1.5),
  event("block", 0, "2"), event("block", 0, 2, 0, A),
  { ...event("block"), arbitraryProviderMessage: "untrusted" },
]) {
  test("malformed metadata cannot appear in progress: " + JSON.stringify(value), () => {
    const tracker = createPortfolioProgressTracker([A, B]);
    rejects(() => tracker.accept(value));
    assert.equal(tracker.accept(event("block")).stage, "block");
  });
}

test("progress accessors are rejected without executing a provider-controlled getter", () => {
  const tracker = createPortfolioProgressTracker([A, B]);
  let ran = false;
  const value = event("block");
  Object.defineProperty(value, "stage", { enumerable: true, get() { ran = true; return "block"; } });
  rejects(() => tracker.accept(value));
  assert.equal(ran, false);
  assert.equal(tracker.accept(event("block")).stage, "block");
});

test("plan accessors are rejected without reading token getters", () => {
  let ran = false;
  const values = [A];
  Object.defineProperty(values, "0", { get() { ran = true; return A; } });
  rejects(() => createPortfolioProgressTracker(values));
  assert.equal(ran, false);
});

for (const bad of [
  event("native"), code(0), balance(0), event("canonical", 2), event("complete", 2),
]) {
  test("progress cannot start midway through a read: " + bad.stage, () => {
    rejects(() => createPortfolioProgressTracker([A, B]).accept(bad));
  });
}

test("wrong contract, plan size or index cannot replace valid next progress", () => {
  const tracker = start();
  rejects(() => tracker.accept(code(0, 2, B)));
  rejects(() => tracker.accept(code(0, 1, A)));
  rejects(() => tracker.accept(code(1)));
  assert.equal(tracker.accept(code(0)).tokenAddress, A);
});

test("progress cannot go backward, repeat a phase or skip an unobserved token", () => {
  const tracker = start();
  tracker.accept(code(0));
  tracker.accept(balance(0));
  rejects(() => tracker.accept(code(0)));
  rejects(() => tracker.accept(balance(0)));
  rejects(() => tracker.accept(event("native")));
  rejects(() => tracker.accept(event("canonical", 2)));
  assert.equal(tracker.accept(code(1)).tokenIndex, 1);
});

test("completion requires canonical-block checking, not just a full token count", () => {
  const tracker = start([A]);
  tracker.accept(code(0, 1, A));
  rejects(() => tracker.accept(event("complete", 1, 1)));
  tracker.accept(event("canonical", 1, 1));
  tracker.accept(event("complete", 1, 1));
  rejects(() => tracker.accept(event("complete", 1, 1)));
  rejects(() => tracker.accept(event("block", 0, 1)));
});

for (const bad of [
  event("token-code", 0, 2, -1, A), event("token-code", 0, 2, 0.5, A),
  event("token-code", 1, 2, 0, A), event("token-code", 0, 2, 0, null),
  event("canonical", 1), event("canonical", 2, 2, 0, A),
]) {
  test("inconsistent token counters are rejected: " + JSON.stringify(bad), () => {
    const tracker = start();
    rejects(() => tracker.accept(bad));
  });
}

test("accepted event data is copied and cannot be rewritten through its source", () => {
  const tracker = createPortfolioProgressTracker([A, B]);
  const input = event("block");
  const output = tracker.accept(input);
  input.stage = "complete";
  input.completedTokens = 2;
  assert.equal(output.stage, "block");
  assert.equal(output.completedTokens, 0);
  assert.equal(tracker.accept(event("native")).stage, "native");
});

test("progress output never claims a balance, permission or transaction outcome", () => {
  const tracker = createPortfolioProgressTracker([A]);
  const result = tracker.accept(event("block", 0, 1));
  assert.deepEqual(Object.keys(result).sort(), [
    "completedTokens", "label", "stage", "tokenAddress", "tokenIndex", "totalTokens",
  ]);
  assert.equal(Object.hasOwn(result, "holdings"), false);
  assert.equal(Object.hasOwn(result, "canSign"), false);
  assert.equal(Object.hasOwn(result, "account"), false);
});

test("symbol metadata is rejected instead of being silently discarded", () => {
  const tracker = createPortfolioProgressTracker([A, B]);
  const input = event("block");
  input[Symbol("provider")] = "hidden";
  rejects(() => tracker.accept(input));
});

test("known read failures give finite guidance rather than raw provider text", async () => {
  const { portfolioFailureStatus } = await import("../src/portfolio-progress.js");
  const cases = [
    ["INVALID_ADDRESS", /42文字/], ["INVALID_TOKENS", /1〜32件/],
    ["DUPLICATE_TOKEN", /重複/], ["SNAPSHOT_TIMEOUT", /待機時間/],
    ["READ_TIMEOUT", /応答がありません/], ["BLOCK_CHANGED", /ブロックが変わりました/],
    ["SESSION_CHANGED", /アカウントまたはチェーン/], ["DISCONNECTED", /明示的に接続/],
    ["ABORTED", /キャンセル/], [4100, /接続許可/], [4900, /切断/], [4901, /チェーンへの接続/],
  ];
  for (const [code, label] of cases) {
    const value = portfolioFailureStatus({ code, message: "private provider payload" });
    assert.equal(value.code, String(code));
    assert.match(value.message, label);
    assert.doesNotMatch(value.message, /private provider/);
    assert.equal(Object.isFrozen(value), true);
  }
});

test("unknown or inaccessible failure codes never run coercion or leak diagnostics", async () => {
  const { portfolioFailureStatus } = await import("../src/portfolio-progress.js");
  let ran = false;
  const hostile = { code: { toString() { ran = true; throw Error("must not run"); } } };
  const accessor = { get code() { throw Error("private diagnostic"); } };
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  for (const input of [null, undefined, "raw error", { code: "UNKNOWN" }, hostile, accessor, proxy]) {
    const value = portfolioFailureStatus(input);
    assert.equal(value.code, "PORTFOLIO_UNAVAILABLE");
    assert.equal(value.message, "確認できませんでした。接続と入力を確認してください。");
  }
  assert.equal(ran, false);
});

test("inherited Object prototype names cannot resolve to a failure label", async () => {
  const { portfolioFailureStatus } = await import("../src/portfolio-progress.js");
  for (const code of ["constructor", "toString", "__proto__"]) {
    assert.equal(portfolioFailureStatus({ code }).code, "PORTFOLIO_UNAVAILABLE");
  }
});
