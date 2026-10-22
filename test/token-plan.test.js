import test from "node:test";
import assert from "node:assert/strict";
import {
  createTokenPlan, validateTokenPlan, encodeTokenPlan, decodeTokenPlan,
  tokenPlanLinesForContext, TokenPlanError,
} from "../src/token-plan.js";

const A = "0x" + "ab".repeat(20);
const B = "0x" + "cd".repeat(20);
const identity = { agent: "DAT", chainId: 84532 };
const plan = overrides => ({ schema: "threecore-token-plan-v1", ...identity,
  tokens: [A, B], ...overrides });
const address = value => "0x" + value.toString(16).padStart(40, "0");
function code(fn, expected) {
  assert.throws(fn, error => error instanceof TokenPlanError && error.code === expected);
}

test("plan round-trip contains configuration only, with no wallet or authorization data", () => {
  const value = createTokenPlan(identity, A + "\n" + B);
  assert.deepEqual(Object.keys(value).sort(), ["agent", "chainId", "schema", "tokens"]);
  assert.deepEqual(decodeTokenPlan(encodeTokenPlan(value)), value);
  assert.equal(tokenPlanLinesForContext(value, identity), A + "\n" + B);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.tokens), true);
});

test("line parser trims CRLF whitespace and normalizes address case", () => {
  const upper = A.toUpperCase().replace("0X", "0x");
  const value = createTokenPlan(identity, " \r\n " + upper + "\r\n\t" + B + " \n");
  assert.deepEqual(value.tokens, [A, B]);
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chainId of [8453, 84532]) {
    test("supported context round-trip: " + agent + " / " + chainId, () => {
      const selected = { agent, chainId };
      const value = createTokenPlan(selected, A);
      assert.equal(tokenPlanLinesForContext(decodeTokenPlan(encodeTokenPlan(value)), selected), A);
    });
  }
}

test("maximum 32-contract plan is accepted without reordering", () => {
  const tokens = Array.from({ length: 32 }, (_, i) => address(i + 1));
  const value = createTokenPlan(identity, tokens.join("\n"));
  assert.deepEqual(value.tokens, tokens);
  assert.equal(decodeTokenPlan(encodeTokenPlan(value)).tokens.length, 32);
});

for (const lines of ["", "\n \t\r\n", A + "," + B, "0x123", A + "\nnot-a-contract"]) {
  test("invalid line list cannot become a plan: " + JSON.stringify(lines), () => {
    code(() => createTokenPlan(identity, lines), "INVALID_TOKENS");
  });
}

test("33-contract plans are rejected rather than truncated", () => {
  const tokens = Array.from({ length: 33 }, (_, i) => address(i + 1));
  code(() => createTokenPlan(identity, tokens.join("\n")), "INVALID_TOKENS");
});

test("duplicate contracts are rejected even if they use different letter case", () => {
  code(() => createTokenPlan(identity, A + "\n" + A.toUpperCase().replace("0X", "0x")), "DUPLICATE_TOKEN");
});

for (const selected of [
  null, [], {}, { agent: "unknown", chainId: 84532 },
  { agent: "DAT", chainId: "84532" }, { agent: "DAT", chainId: 1 },
  { agent: "DAT", chainId: NaN }, { agent: "DAT", chainId: 84532, account: A },
]) {
  test("invalid context is rejected: " + JSON.stringify(selected), () => {
    assert.throws(() => createTokenPlan(selected, A), TokenPlanError);
  });
}

for (const overrides of [
  { schema: "v2" }, { schema: null }, { tokens: [] }, { tokens: [null] },
  { tokens: [42] }, { tokens: [A, A] }, { agent: "other" }, { chainId: 1 },
]) {
  test("untrusted plan fields are validated: " + JSON.stringify(overrides), () => {
    assert.throws(() => validateTokenPlan(plan(overrides)), TokenPlanError);
    assert.throws(() => decodeTokenPlan(JSON.stringify(plan(overrides))), TokenPlanError);
  });
}

for (const extra of ["account", "privateKey", "balance", "canSign", "authorization", "__proto__"]) {
  test("extra field is not accepted or preserved: " + extra, () => {
    const value = plan();
    Object.defineProperty(value, extra, { enumerable: true, value: "unwanted" });
    code(() => validateTokenPlan(value), "INVALID_PLAN");
  });
}

test("inherited plan fields do not count as explicit configuration data", () => {
  const value = Object.create(plan());
  code(() => validateTokenPlan(value), "INVALID_PLAN");
});

test("null-prototype plain records are copied into ordinary immutable output", () => {
  const value = Object.assign(Object.create(null), plan());
  const result = validateTokenPlan(value);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepEqual(result.tokens, [A, B]);
});

test("symbol fields are rejected instead of silently disappearing in JSON", () => {
  const value = plan();
  value[Symbol("authorization")] = true;
  code(() => validateTokenPlan(value), "INVALID_PLAN");
});

test("plan accessors are rejected before reading any of their values", () => {
  let ran = false;
  const value = plan();
  Object.defineProperty(value, "tokens", { enumerable: true,
    get() { ran = true; return [A]; } });
  code(() => validateTokenPlan(value), "INVALID_PLAN");
  assert.equal(ran, false);
});

test("array accessors are rejected without executing a token getter", () => {
  let ran = false;
  const tokens = [A];
  Object.defineProperty(tokens, "0", { get() { ran = true; return A; } });
  code(() => validateTokenPlan(plan({ tokens })), "INVALID_TOKENS");
  assert.equal(ran, false);
});

test("sparse token arrays are rejected without substituting addresses", () => {
  code(() => validateTokenPlan(plan({ tokens: new Array(2) })), "INVALID_TOKENS");
});

test("mutation of caller arrays cannot change a captured plan", () => {
  const input = plan();
  const result = validateTokenPlan(input);
  input.tokens[0] = address(99);
  input.chainId = 8453;
  assert.deepEqual(result.tokens, [A, B]);
  assert.equal(result.chainId, 84532);
});

test("context is rechecked at application time rather than trusted from preview", () => {
  code(() => tokenPlanLinesForContext(plan(), { agent: "EMA", chainId: 84532 }), "PLAN_CONTEXT_MISMATCH");
  code(() => tokenPlanLinesForContext(plan(), { agent: "DAT", chainId: 8453 }), "PLAN_CONTEXT_MISMATCH");
});

for (const text of ["", "null", "[]", "{", "<script>bad</script>", " ".repeat(8193)]) {
  test("malformed or oversized JSON is rejected: length " + text.length, () => {
    code(() => decodeTokenPlan(text), "INVALID_PLAN");
  });
}

test("JSON exactly at its size limit remains valid if the content is a valid plan", () => {
  const raw = JSON.stringify(plan());
  const value = decodeTokenPlan(raw + " ".repeat(8192 - raw.length));
  assert.deepEqual(value.tokens, [A, B]);
});

test("text beyond the size limit is rejected even if JSON content is otherwise valid", () => {
  const raw = JSON.stringify(plan());
  code(() => decodeTokenPlan(raw + " ".repeat(8193 - raw.length)), "INVALID_PLAN");
});

test("line input is bounded before parsing, including whitespace-only excess", () => {
  code(() => createTokenPlan(identity, A + " ".repeat(8192)), "INVALID_TOKENS");
});

test("serialization validates again rather than trusting a fabricated token plan", () => {
  code(() => encodeTokenPlan({ ...plan(), canSign: true }), "INVALID_PLAN");
});

test("a revoked proxy is rejected without exposing its internal error", () => {
  const { proxy, revoke } = Proxy.revocable(plan(), {});
  revoke();
  code(() => validateTokenPlan(proxy), "INVALID_PLAN");
});

test("independent validation calls do not share output arrays", () => {
  const first = validateTokenPlan(plan());
  const second = validateTokenPlan(plan());
  assert.notEqual(first.tokens, second.tokens);
  assert.deepEqual(first.tokens, second.tokens);
});

test("all supported list sizes round-trip without losing order or adding data", () => {
  for (let count = 1; count <= 32; count++) {
    const tokens = Array.from({ length: count }, (_, i) => address(i + 1));
    const captured = createTokenPlan(identity, tokens.join("\r\n"));
    const imported = decodeTokenPlan(encodeTokenPlan(captured));
    assert.deepEqual(imported.tokens, tokens);
    assert.equal(tokenPlanLinesForContext(imported, identity), tokens.join("\n"));
    assert.equal(Object.isFrozen(imported.tokens), true);
  }
});

test("the previewed configuration cannot authorize another agent through extra fields", () => {
  const value = plan();
  value.allowOtherAgent = true;
  code(() => tokenPlanLinesForContext(value, { agent: "EMA", chainId: 84532 }), "INVALID_PLAN");
});

test("import ignores neither nested transaction instructions nor token objects", () => {
  const value = plan({ tokens: [{ address: A, method: "eth_sendTransaction" }] });
  code(() => decodeTokenPlan(JSON.stringify(value)), "INVALID_TOKENS");
});
