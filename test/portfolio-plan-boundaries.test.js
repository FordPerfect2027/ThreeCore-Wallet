import test from "node:test";
import assert from "node:assert/strict";
import { readPortfolioSnapshot } from "../src/portfolio-snapshot.js";
import { readAgentPortfolios } from "../src/agent-portfolios.js";
import { validatePortfolioSnapshot } from "../src/portfolio-report.js";

const ADDRESS = "0x" + "aa".repeat(20);

test("sparse token list is rejected before reading the session", async () => {
  let inspected = false;
  const session = {get state() { inspected = true; throw Error("must not inspect"); }};
  await assert.rejects(readPortfolioSnapshot(session, {tokens: new Array(2)}), {code: "INVALID_TOKENS"});
  assert.equal(inspected, false);
});

test("sparse three-agent list cannot be mistaken for three completed sessions", async () => {
  let reads = 0;
  await assert.rejects(readAgentPortfolios(new Array(3), {
    reader() { reads++; },
  }), {code: "INVALID_AGENT_PLAN"});
  assert.equal(reads, 0);
});

test("sparse holdings cannot be serialized into null entries in a report", () => {
  const input = {
    agent: "DAT",
    account: ADDRESS,
    chainId: 8453,
    siteOrigin: "https://example.test",
    connectionEpoch: 1,
    blockNumber: "42",
    blockHash: "0x" + "ab".repeat(32),
    nativeBalanceBaseUnits: "0",
    holdings: new Array(1),
    readOnly: true,
    securityAudit: false,
  };
  assert.throws(() => validatePortfolioSnapshot(input), {code: "INVALID_PORTFOLIO_REPORT"});
});

test("explicit null token entries also fail validation before any session read", async () => {
  let inspected = false;
  const session = {get state() { inspected = true; return {}; }};
  await assert.rejects(readPortfolioSnapshot(session, {tokens: [null]}));
  assert.equal(inspected, false);
});

test("a non-object report with inherited data cannot masquerade as a snapshot", () => {
  const source = {agent: "DAT", account: ADDRESS};
  assert.throws(() => validatePortfolioSnapshot(Object.create(source)), {code: "INVALID_PORTFOLIO_REPORT"});
});

test("undefined report is rejected with a structured validation error", () => {
  assert.throws(() => validatePortfolioSnapshot(undefined), {code: "INVALID_PORTFOLIO_REPORT"});
});
