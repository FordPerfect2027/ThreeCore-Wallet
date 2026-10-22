import test from "node:test";
import assert from "node:assert/strict";
import { readAgentPortfolios } from "../src/agent-portfolios.js";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";
import { encodePortfolioReport, decodePortfolioReport } from "../src/portfolio-report.js";
import { createPortfolioController } from "../src/portfolio-controller.js";

const AGENTS = ["DAT", "EMA", "CAWELON"];
const accounts = ["11", "22", "33"].map(byte => "0x" + byte.repeat(20));
const tokens = ["44", "55", "66"].map(byte => "0x" + byte.repeat(20));
const HASH = "0x" + "ab".repeat(32);

function plan() {
  return AGENTS.map((agent, index) => {
    const state = {
      agent,
      account: accounts[index],
      chainId: 8453,
      siteOrigin: "https://example.test",
      connectionEpoch: 1,
      connected: true,
      canSign: false,
      canSendTransactions: false,
      canBridge: false,
    };
    return {
      agent,
      tokens: [tokens[index]],
      session: { get state() { return {...state}; } },
      state,
    };
  });
}

function snapshot(entry) {
  const {agent, account, chainId, siteOrigin, connectionEpoch} = entry.session.state;
  return {
    agent,
    account,
    chainId,
    siteOrigin,
    connectionEpoch,
    blockNumber: "42",
    blockHash: HASH,
    nativeBalanceBaseUnits: "0",
    holdings: entry.tokens.map(address => ({
      address,
      hasCode: true,
      balanceBaseUnits: "17",
      notice: null,
    })),
    readOnly: true,
    securityAudit: false,
  };
}

function readerFor(entries, hook = () => {}) {
  const calls = [];
  return {
    calls,
    async reader(session, options) {
      const entry = entries.find(row => row.session === session);
      calls.push(entry.agent);
      const changed = await hook(entry, options);
      return changed ?? snapshot(entry);
    },
  };
}

test("collect three independent accounts in canonical agent order", async () => {
  const entries = plan();
  entries.reverse();
  const f = readerFor(entries);
  const result = await readAgentPortfolios(entries, { reader: f.reader });
  assert.deepEqual(f.calls, AGENTS);
  assert.deepEqual(result.portfolios.map(row => row.agent), AGENTS);
  assert.deepEqual(result.portfolios.map(row => row.account), accounts);
  assert.equal(result.atomicAcrossAgents, false);
  assert.equal(result.readOnly, true);
  assert.equal(result.securityAudit, false);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.portfolios));
  assert.ok(result.portfolios.every(Object.isFrozen));
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("multiple token plans are preserved per agent without mixing results", async () => {
  const entries = plan();
  entries[0].tokens = [tokens[0], tokens[1]];
  const f = readerFor(entries);
  const result = await readAgentPortfolios(entries, { reader: f.reader });
  assert.deepEqual(result.portfolios[0].holdings.map(row => row.address), [tokens[0], tokens[1]]);
  assert.deepEqual(result.portfolios[1].holdings.map(row => row.address), [tokens[1]]);
  assert.deepEqual(result.portfolios[2].holdings.map(row => row.address), [tokens[2]]);
});

for (const mutate of [
  rows => rows.pop(),
  rows => rows.push(rows[0]),
  rows => { rows[1].agent = "DAT"; },
  rows => { rows[0].agent = "UNKNOWN"; },
  rows => { rows[1].tokens = []; },
  rows => { rows[1].tokens = [tokens[0], tokens[0]]; },
  rows => { rows[2].tokens = ["bad"]; },
  rows => { rows[0].tokens = null; },
  rows => { rows[0].session = null; },
]) {
  test("invalid complete-agent plan is rejected before any reads: " + mutate.toString(), async () => {
    const entries = plan();
    mutate(entries);
    let reads = 0;
    await assert.rejects(readAgentPortfolios(entries, { reader() { reads++; } }));
    assert.equal(reads, 0);
  });
}

test("an account shared between agents is rejected before any read", async () => {
  const entries = plan();
  entries[1].state.account = entries[0].state.account;
  const f = readerFor(entries);
  await assert.rejects(readAgentPortfolios(entries, {reader: f.reader}), {code: "SHARED_AGENT_ACCOUNT"});
  assert.equal(f.calls.length, 0);
});

for (const field of ["connected", "canSign", "canBridge", "canSendTransactions", "connectionEpoch", "chainId", "account"]) {
  test("invalid session " + field + " is rejected before reads", async () => {
    const entries = plan();
    const invalid = { connected: false, canSign: true, canBridge: true,
      canSendTransactions: true, connectionEpoch: -1, chainId: 0, account: "wrong" };
    entries[2].state[field] = invalid[field];
    const f = readerFor(entries);
    await assert.rejects(readAgentPortfolios(entries, {reader: f.reader}));
    assert.equal(f.calls.length, 0);
  });
}

for (const index of [0, 1, 2]) {
  for (const field of ["account", "connectionEpoch", "chainId", "siteOrigin", "connected"]) {
    test("changing agent " + index + " " + field + " during first read rejects all results", async () => {
      const entries = plan();
      const changes = {account: "0x" + "ff".repeat(20), connectionEpoch: 2,
        chainId: 1, siteOrigin: "https://other.test", connected: false};
      const f = readerFor(entries, entry => {
        const response = snapshot(entry);
        entries[index].state[field] = changes[field];
        return response;
      });
      await assert.rejects(readAgentPortfolios(entries, {reader: f.reader}), {code: "SESSION_CHANGED"});
      assert.deepEqual(f.calls, ["DAT"]);
    });
  }
}

test("failure in second agent never returns the already read first result", async () => {
  const entries = plan();
  const f = readerFor(entries, entry => {
    if (entry.agent === "EMA") throw Object.assign(Error("offline"), {code: "READ_TIMEOUT"});
  });
  await assert.rejects(readAgentPortfolios(entries, {reader: f.reader}), {code: "READ_TIMEOUT"});
  assert.deepEqual(f.calls, ["DAT", "EMA"]);
});

test("reader cannot substitute a different account identity", async () => {
  const entries = plan();
  const f = readerFor(entries, entry => ({...snapshot(entry), account: accounts[2]}));
  await assert.rejects(readAgentPortfolios(entries, {reader: f.reader}), {code: "WRONG_AGENT_RESULT"});
});

test("reader cannot substitute token contracts while retaining the agent", async () => {
  const entries = plan();
  const f = readerFor(entries, entry => {
    const response = snapshot(entry);
    response.holdings[0].address = tokens[2];
    return response;
  });
  await assert.rejects(readAgentPortfolios(entries, {reader: f.reader}), {code: "WRONG_AGENT_RESULT"});
});

test("reader cannot omit an explicitly requested token", async () => {
  const entries = plan();
  entries[0].tokens.push(tokens[1]);
  const f = readerFor(entries, entry => {
    const response = snapshot(entry);
    response.holdings.pop();
    return response;
  });
  await assert.rejects(readAgentPortfolios(entries, {reader: f.reader}), {code: "WRONG_AGENT_RESULT"});
});

test("caller mutations to later agent token lists are detected as result mismatch", async () => {
  const entries = plan();
  const f = readerFor(entries, entry => {
    const response = snapshot(entry);
    if (entry.agent === "DAT") entries[1].tokens[0] = tokens[2];
    return response;
  });
  await assert.rejects(readAgentPortfolios(entries, {reader: f.reader}), {code: "WRONG_AGENT_RESULT"});
});

test("already aborted coordinated read makes no reader calls", async () => {
  const entries = plan();
  const abort = new AbortController();
  abort.abort();
  const f = readerFor(entries);
  await assert.rejects(readAgentPortfolios(entries, {reader: f.reader, signal: abort.signal}), {code: "ABORTED"});
  assert.equal(f.calls.length, 0);
});

test("overall deadline aborts a custom hanging reader without starting later agents", async () => {
  const entries = plan();
  let calls = 0;
  let receivedSignal;
  await assert.rejects(readAgentPortfolios(entries, {
    timeoutMs: 10,
    reader(session, options) {
      calls++;
      receivedSignal = options.signal;
      return new Promise(() => {});
    },
  }), {code: "AGENT_PORTFOLIOS_TIMEOUT"});
  assert.equal(calls, 1);
  assert.equal(receivedSignal.aborted, true);
});

test("external abort rejects a hanging reader even if it ignores the signal", async () => {
  const entries = plan();
  const abort = new AbortController();
  let started;
  let resolveReader;
  const ready = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const pending = readAgentPortfolios(entries, {
    signal: abort.signal,
    reader() {
      calls++;
      started();
      return new Promise(resolve => { resolveReader = resolve; });
    },
  });
  await ready;
  abort.abort();
  await assert.rejects(pending, {code: "ABORTED"});
  resolveReader(snapshot(entries[0]));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
});

for (const timeoutMs of [0, -1, 120001, 1.2, "50"]) {
  test("invalid overall timeout rejected: " + timeoutMs, async () => {
    const f = readerFor(plan());
    await assert.rejects(readAgentPortfolios(plan(), {timeoutMs, reader: f.reader}), {code: "INVALID_TIMEOUT"});
    assert.equal(f.calls.length, 0);
  });
}

test("an imported report cannot pretend to be a currently connected session", async () => {
  const entries = plan();
  const imported = decodePortfolioReport(encodePortfolioReport(snapshot(entries[0])));
  entries[0].session = imported;
  const f = readerFor(entries);
  await assert.rejects(readAgentPortfolios(entries, {reader: f.reader}), {code: "INVALID_AGENT_SESSION"});
  assert.equal(f.calls.length, 0);
});

test("different per-agent block heights are preserved without claiming atomicity", async () => {
  const entries = plan();
  const f = readerFor(entries, entry => ({...snapshot(entry), blockNumber: String(100 + AGENTS.indexOf(entry.agent))}));
  const result = await readAgentPortfolios(entries, {reader: f.reader});
  assert.deepEqual(result.portfolios.map(row => row.blockNumber), ["100", "101", "102"]);
  assert.equal(result.atomicAcrossAgents, false);
});

test("default reader integrates all three real session classes with offline providers", async () => {
  const calls = [];
  const entries = [];
  for (let index = 0; index < AGENTS.length; index++) {
    const provider = { async request({method}) {
      calls.push([AGENTS[index], method]);
      if (method === "eth_chainId") return "0x2105";
      if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [accounts[index]];
      if (method === "eth_getBlockByNumber") return {number: "0x2a", hash: HASH};
      if (method === "eth_getBalance") return "0x0";
      if (method === "eth_getCode") return "0x6000";
      if (method === "eth_call") return "0x" + "0".repeat(63) + String(index + 1);
      throw Error("Forbidden method " + method);
    } };
    const session = new ThreeCoreWalletSession({
      provider,
      agent: AGENTS[index],
      chainId: 8453,
      expectedAccount: accounts[index],
      siteOrigin: "https://example.test",
      approvedOrigins: ["https://example.test"],
    });
    await session.connect();
    entries.push({agent: AGENTS[index], session, tokens: [tokens[index]]});
  }
  calls.length = 0;
  const result = await readAgentPortfolios(entries);
  assert.deepEqual(result.portfolios.map(row => row.holdings[0].balanceBaseUnits), ["1", "2", "3"]);
  assert.equal(calls.some(([, method]) => method === "eth_requestAccounts"), false);
  assert.ok(calls.every(([, method]) => ["eth_chainId", "eth_accounts", "eth_getBlockByNumber",
    "eth_getBalance", "eth_getCode", "eth_call"].includes(method)));
  for (const entry of entries) entry.session.disconnect();
});

test("coordinated result retains independent JSON-exportable per-agent observations", async () => {
  const entries = plan();
  const f = readerFor(entries);
  const result = await readAgentPortfolios(entries, {reader: f.reader});
  const imported = result.portfolios.map(row => decodePortfolioReport(encodePortfolioReport(row)));
  assert.deepEqual(imported.map(report => report.snapshot.agent), AGENTS);
  assert.ok(imported.every(report => report.historicalObservation));
  assert.ok(imported.every(report => !report.canAuthorizeConnection && !report.canAuthorizeTransaction));
});

test("single-card controller rejects a coordinated report used as its reader result", async () => {
  const entries = plan();
  const f = readerFor(entries);
  const coordinated = await readAgentPortfolios(entries, {reader: f.reader});
  const controller = createPortfolioController({reader: async () => coordinated});
  const result = await controller.refresh({});
  assert.equal(result.accepted, false);
  assert.equal(controller.state.errorCode, "INVALID_SNAPSHOT");
  controller.dispose();
});
