import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkspace, encodeWorkspace, decodeWorkspace, workspaceData,
  captureWorkspaceDraft, workspaceFromDraft, workspaceToDraft, workspaceDraftKey,
  workspaceOptions, WORKSPACE_TEXT_LIMIT } from "../src/workspace-format.js";
import { AGENTS, ACCOUNTS, CONTRACTS, draft, bundle, text, clone, OPTIONS, snapshot } from "./helpers/workspace-fixtures.js";
import { archive } from "./helpers/history-fixtures.js";

test("workspace round trip retains all three settings token lists and histories", () => {
  const original = draft();
  const result = workspaceToDraft(decodeWorkspace(encodeWorkspace(workspaceFromDraft(original))));
  assert.deepEqual(result, original);
  assert.equal(result.length, 3);
  assert.equal(JSON.parse(result[2].history).reports[0].snapshot.agent, "CAWELON");
});

test("workspace canonical agent order does not depend on file order", () => {
  const value = bundle();
  value.entries.reverse();
  assert.deepEqual(validateWorkspace(value).entries.map(row => row.agent), AGENTS);
  assert.equal(encodeWorkspace(value), text());
});

test("workspace addresses are normalized while retaining exact integer balances", () => {
  const value = bundle();
  value.entries[0].account = "0x" + "AB".repeat(20);
  value.entries[0].tokens = ["0x" + "CD".repeat(20)];
  const result = validateWorkspace(value);
  assert.equal(result.entries[0].account, "0x" + "ab".repeat(20));
  assert.equal(result.entries[0].tokens[0], "0x" + "cd".repeat(20));
  assert.equal(result.entries[0].history.reports[0].snapshot.nativeBalanceBaseUnits, "16");
});

test("workspace unassigned accounts and empty token lists are valid", () => {
  const value = bundle({ accounts: false, populated: false });
  value.entries.forEach(row => { row.tokenAddress = null; row.tokens = []; });
  const result = validateWorkspace(value);
  assert.ok(result.entries.every(row => row.account === null && !row.tokens.length));
  assert.ok(workspaceToDraft(result).every(row => row.tokens === ""));
});

for (const extra of ["seed", "privateKey", "provider", "connected", "spender", "approval", "password"]) {
  test("workspace excludes unsupported sensitive field " + extra, () => {
    const value = bundle();
    value.entries[0][extra] = "not accepted";
    assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_SHAPE" });
  });
}

for (const changes of [
  { schema: "unknown" },
  { historicalObservation: false },
  { historicalObservation: "true" },
  { createdBy: "extension" },
]) {
  test("workspace rejects an incompatible document: " + JSON.stringify(changes), () => {
    assert.throws(() => validateWorkspace({ ...bundle(), ...changes }));
  });
}

for (const agent of ["DOT", "KWY", "EMA-Draft", "dat", "", null]) {
  test("workspace refuses unknown card identity " + agent, () => {
    const value = bundle();
    value.entries[1].agent = agent;
    assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_AGENT" });
  });
}

for (const count of [0, 1, 2, 4]) {
  test("workspace requires exactly three complete entries: " + count, () => {
    const value = bundle();
    value.entries = Array.from({ length: count }, (_, index) => value.entries[index % 3]);
    assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_ENTRIES" });
  });
}

test("workspace rejects a duplicated agent even with a distinct address", () => {
  const value = bundle();
  value.entries[1].agent = "DAT";
  assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_AGENT" });
});

for (const chainId of [1, 0, -1, "84532", 8453.5, null]) {
  test("workspace rejects unsupported configured network " + chainId, () => {
    const value = bundle();
    value.entries[2].chainId = chainId;
    assert.throws(() => validateWorkspace(value), { code: chainId === 8453.5 ? "WORKSPACE_SHAPE" : "WORKSPACE_CHAIN" });
  });
}

test("workspace rejects one public account assigned to two agents", () => {
  const value = bundle();
  value.entries[1].account = value.entries[0].account;
  value.entries[1].chainId = 8453;
  assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_DUPLICATE" });
});

for (const field of ["account", "tokenAddress"]) {
  for (const address of ["0x123", "0x" + "00".repeat(20), ACCOUNTS[0] + " ", 42, {}, "<script>"]) {
    test("workspace rejects invalid " + field + " " + JSON.stringify(address), () => {
      const value = bundle();
      value.entries[0][field] = address;
      assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_ADDRESS" });
    });
  }
}

test("workspace rejects duplicate token contracts case insensitively", () => {
  const value = bundle();
  value.entries[0].tokens = ["0x" + "ab".repeat(20), "0x" + "AB".repeat(20)];
  assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_TOKENS" });
});

test("workspace allows the same token on different cards", () => {
  const value = bundle();
  value.entries.forEach(row => { row.tokens = [CONTRACTS[0]]; });
  assert.equal(validateWorkspace(value).entries[2].tokens[0], CONTRACTS[0]);
});

test("workspace permits 32 tokens but refuses 33", () => {
  const value = bundle();
  const contracts = Array.from({ length: 33 }, (_, index) => "0x" + (index + 1).toString(16).padStart(40, "0"));
  value.entries[0].tokens = contracts.slice(0, 32);
  assert.equal(validateWorkspace(value).entries[0].tokens.length, 32);
  value.entries[0].tokens = contracts;
  assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_TOKENS" });
});

test("workspace history remains tied to its original agent", () => {
  const value = bundle();
  value.entries[1].history = value.entries[0].history;
  assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_AGENT" });
});

test("workspace retains historical addresses different from current settings", () => {
  const value = bundle();
  value.entries[0].account = "0x" + "99".repeat(20);
  assert.equal(validateWorkspace(value).entries[0].history.reports[0].snapshot.account, ACCOUNTS[0]);
});

test("workspace retains historical network and origin without rebinding them", () => {
  const value = bundle();
  value.entries[0].chainId = 8453;
  const row = validateWorkspace(value).entries[0].history.reports[0].snapshot;
  assert.equal(row.chainId, 84532);
  assert.equal(row.siteOrigin, "http://localhost:4184");
});

test("workspace refuses corrupted observation flags", () => {
  const value = bundle();
  value.entries[2].history.reports[0].snapshot.securityAudit = true;
  assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_HISTORY" });
});

test("workspace refuses unknown balances disguised as zero", () => {
  const value = bundle();
  const token = value.entries[0].history.reports[0].snapshot.holdings[0];
  token.hasCode = false;
  token.notice = "TOKEN_CODE_MISSING";
  token.balanceBaseUnits = "0";
  assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_HISTORY" });
});

test("workspace data never invokes nested getters or toJSON", () => {
  let calls = 0;
  for (const place of [value => value, value => value.entries[1], value => value.entries[2].history.reports[0].snapshot]) {
    const value = bundle();
    Object.defineProperty(place(value), "extra", { enumerable: true, get() { calls++; return "secret"; } });
    assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_SHAPE" });
  }
  const value = bundle();
  value.toJSON = () => { calls++; return bundle(); };
  assert.throws(() => validateWorkspace(value), { code: "WORKSPACE_SHAPE" });
  assert.equal(calls, 0);
});

test("workspace refuses sparse arrays and symbol properties", () => {
  const sparse = bundle();
  delete sparse.entries[1];
  assert.throws(() => validateWorkspace(sparse), { code: "WORKSPACE_SHAPE" });
  const symbol = bundle();
  symbol[Symbol("hidden")] = true;
  assert.throws(() => validateWorkspace(symbol), { code: "WORKSPACE_SHAPE" });
});

test("workspace rejects circular inherited and prototype-pollution payloads", () => {
  const circular = bundle();
  circular.entries[0].history = circular;
  assert.throws(() => validateWorkspace(circular), { code: "WORKSPACE_SHAPE" });
  const inherited = Object.create(bundle());
  assert.throws(() => validateWorkspace(inherited), { code: "WORKSPACE_SHAPE" });
  assert.throws(() => workspaceData(JSON.parse('{"__proto__":{"polluted":true}}')), { code: "WORKSPACE_SHAPE" });
  assert.equal({}.polluted, undefined);
});

test("workspace rejects deep graphs and accepts shared ordinary values", () => {
  let nested = {};
  for (let index = 0; index < 20; index++) nested = { child: nested };
  assert.throws(() => workspaceData(nested), { code: "WORKSPACE_COMPLEXITY" });
  const common = { value: 1 };
  assert.equal(workspaceData([common, common])[1].value, 1);
});

test("workspace import enforces text bounds and accepts a UTF-8 BOM", () => {
  assert.equal(decodeWorkspace("\ufeff" + text()).entries.length, 3);
  for (const value of ["", null, "x".repeat(WORKSPACE_TEXT_LIMIT + 1)]) {
    assert.throws(() => decodeWorkspace(value), { code: "WORKSPACE_SIZE" });
  }
  assert.throws(() => decodeWorkspace("{broken"), { code: "WORKSPACE_JSON" });
});

test("workspace raw capture preserves unfinished forms for rollback", () => {
  const value = draft();
  value[0].account = " 0xunfinished ";
  value[1].tokens = "not yet a contract";
  assert.equal(captureWorkspaceDraft(value)[0].account, value[0].account);
  assert.throws(() => workspaceFromDraft(value));
  assert.equal(workspaceDraftKey(value), workspaceDraftKey(clone(value)));
});

test("workspace export trims forms without changing the live input", () => {
  const value = draft();
  value[0].account = " " + ACCOUNTS[0] + " ";
  value[0].tokens = "\n" + CONTRACTS[0] + "\r\n";
  const result = workspaceFromDraft(value);
  assert.equal(result.entries[0].account, ACCOUNTS[0]);
  assert.deepEqual(result.entries[0].tokens, [CONTRACTS[0]]);
  assert.equal(value[0].account, " " + ACCOUNTS[0] + " ");
});

test("workspace snapshots are deeply frozen and independent of source mutations", () => {
  const value = bundle();
  const result = validateWorkspace(value);
  value.entries[0].tokens.length = 0;
  assert.equal(result.entries[0].tokens.length, 1);
  assert.ok(Object.isFrozen(result.entries[0].history.reports[0].snapshot));
  assert.throws(() => result.entries[0].tokens.push(CONTRACTS[1]), TypeError);
});

test("workspace selected sections require explicit boolean flags and a known mode", () => {
  assert.deepEqual(workspaceOptions(OPTIONS), OPTIONS);
  for (const value of [null, {}, { ...OPTIONS, settings: 1 }, { ...OPTIONS, mode: "append" },
    { ...OPTIONS, settings: false, histories: false }, { ...OPTIONS, extra: true }]) {
    assert.throws(() => workspaceOptions(value));
  }
});

test("workspace history maximum is enforced before export", () => {
  const value = draft();
  value[0].history = archive(Array.from({ length: 64 }, (_, index) => snapshot(0, String(index))));
  assert.equal(workspaceFromDraft(value).entries[0].history.reports.length, 64);
  const tooMany = bundle();
  tooMany.entries[0].history.reports = Array.from({ length: 65 }, () => tooMany.entries[0].history.reports[0]);
  assert.throws(() => validateWorkspace(tooMany), { code: "WORKSPACE_HISTORY" });
});
