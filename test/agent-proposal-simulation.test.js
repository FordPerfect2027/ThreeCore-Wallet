import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { simulateAgentProposals } from "../examples/agent-proposal-simulation.js";

test("three real session adapters execute synthetic reads with distinct agent accounts", async () => {
  const report = await simulateAgentProposals();
  assert.equal(report.synthetic, true);
  assert.equal(report.liveNetworkVerified, false);
  assert.equal(report.modelInvoked, false);
  for (const key of ["networkRequests", "realWalletRequests", "transactionsExecuted", "filesModified"]) assert.equal(report[key], 0);
  assert.equal(new Set(report.results.map(r => r.account)).size, 3);
  assert.deepEqual(report.results.map(r => r.agent), ["DAT", "EMA", "CAWELON"]);
  for (const result of report.results) {
    assert.equal(result.observation.observation.account, result.account);
    assert.equal(result.observation.observation.agent, result.agent);
    assert.equal(result.observation.observation.chainId, 84532);
    assert.equal(result.additionalRequestsForRejectedAction, 0);
    assert.equal(result.rejectedAction, "ACTION_NOT_ALLOWED");
    assert.equal(result.requests.filter(r => r.method === "eth_requestAccounts").length, 1);
    assert.ok(result.requests.every(r => ["eth_chainId", "eth_requestAccounts", "eth_accounts",
      "eth_getBlockByNumber", "eth_getCode", "eth_call"].includes(r.method)));
    const calls = result.requests.filter(r => r.method === "eth_call");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(r => r.params[0].data.slice(0, 10)), ["0x70a08231", "0xdd62ed3e"]);
    for (const call of calls) assert.deepEqual(call.params[1], {
      blockHash: "0x" + "ab".repeat(32), requireCanonical: true,
    });
  }
});

test("offline simulation command emits parseable evidence and exits successfully", () => {
  const result = spawnSync(process.execPath, ["examples/agent-proposal-simulation.js"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.synthetic, true);
  assert.equal(report.results.length, 3);
});

test("mock model adapter integrates all three session adapters without network or funds", async () => {
  const report = await simulateAgentProposals({ mockModel: true });
  assert.equal(report.mockModelRequests, 3);
  assert.equal(report.modelInvoked, false);
  assert.equal(report.networkRequests, 0);
  for (const result of report.results) {
    assert.equal(result.observation.proposalId, `${result.agent}-mock-model-1`);
    assert.equal(result.observation.transactionExecuted, false);
    assert.equal(result.additionalRequestsForRejectedAction, 0);
  }
});

test("mock CLI is explicit and rejects unknown/live flags", () => {
  for (const flag of ["--mock-model", "--live"]) {
    const result = spawnSync(process.execPath, ["examples/agent-proposal-simulation.js", flag], {
      cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 15000,
    });
    assert.equal(result.status, flag === "--mock-model" ? 0 : 1);
    if (flag === "--mock-model") assert.equal(JSON.parse(result.stdout).mockModelRequests, 3);
    else assert.equal(result.stdout, "");
  }
});
