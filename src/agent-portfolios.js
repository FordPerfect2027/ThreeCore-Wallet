import { AGENT_IDS } from "./wallet-session.js";
import { readPortfolioSnapshot } from "./portfolio-snapshot.js";
import { validatePortfolioSnapshot } from "./portfolio-report.js";

export class AgentPortfoliosError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentPortfoliosError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AgentPortfoliosError(code, message);
}

function capture(session, expectedAgent) {
  const state = session?.state;
  if (!state || state.agent !== expectedAgent || state.connected !== true ||
      typeof state.account !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(state.account) ||
      !Number.isSafeInteger(state.connectionEpoch) || state.connectionEpoch < 0 ||
      !Number.isSafeInteger(state.chainId) || state.chainId < 1 ||
      typeof state.siteOrigin !== "string" ||
      state.canSign !== false || state.canBridge !== false || state.canSendTransactions !== false) {
    fail("INVALID_AGENT_SESSION", "Each agent requires its own explicitly connected read-only session");
  }
  return Object.freeze({
    agent: state.agent,
    account: state.account.toLowerCase(),
    chainId: state.chainId,
    siteOrigin: state.siteOrigin,
    connectionEpoch: state.connectionEpoch,
  });
}

/**
 * Coordinate three independent read-only agent sessions, with no connection
 * permission request. Reject all results if any identity changes or read fails.
 * Each portfolio pins its own canonical block. This coordinator does NOT claim
 * an atomic cross-wallet or cross-chain snapshot and never aggregates prices.
 */
export async function readAgentPortfolios(entries, {
  timeoutMs = 60_000,
  signal,
  reader = readPortfolioSnapshot,
} = {}) {
  if (!Array.isArray(entries) || entries.length !== AGENT_IDS.length ||
      typeof reader !== "function") {
    fail("INVALID_AGENT_PLAN", "Exactly DAT, EMA and CAWELON are required");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    fail("INVALID_TIMEOUT", "Overall timeout must be 1..120000ms");
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    fail("INVALID_SIGNAL", "Expected an AbortSignal");
  }
  const accounts = new Set();
  for (let index = 0; index < entries.length; index++) {
    if (!Object.hasOwn(entries, index)) fail("INVALID_AGENT_PLAN", "Sparse agent plans are forbidden");
  }
  const agents = new Set();
  const plan = entries.map(entry => {
    if (!entry || !AGENT_IDS.includes(entry.agent) || agents.has(entry.agent) ||
        !Array.isArray(entry.tokens) || entry.tokens.length < 1 || entry.tokens.length > 32) {
      fail("INVALID_AGENT_PLAN", "Each agent and token plan must be explicit and unique");
    }
    agents.add(entry.agent);
    const initial = capture(entry.session, entry.agent);
    if (accounts.has(initial.account)) fail("SHARED_AGENT_ACCOUNT", "Agent accounts must be distinct");
    accounts.add(initial.account);
    for (let index = 0; index < entry.tokens.length; index++) {
      if (!Object.hasOwn(entry.tokens, index)) fail("INVALID_AGENT_PLAN", "Sparse token plans are forbidden");
    }
    const tokens = entry.tokens.map(value => {
      if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
        fail("INVALID_AGENT_PLAN", "Expected explicit token contract addresses");
      }
      return value.toLowerCase();
    });
    if (new Set(tokens).size !== tokens.length) fail("INVALID_AGENT_PLAN", "Duplicate token contracts");
    return Object.freeze({ agent: entry.agent, session: entry.session, initial,
      tokens: Object.freeze(tokens) });
  });
  plan.sort((a, b) => AGENT_IDS.indexOf(a.agent) - AGENT_IDS.indexOf(b.agent));
  const current = () => {
    for (const entry of plan) {
      let state;
      try { state = capture(entry.session, entry.agent); }
      catch { fail("SESSION_CHANGED", "An agent session changed during the coordinated read"); }
      for (const key of Object.keys(entry.initial)) {
        if (state[key] !== entry.initial[key]) fail("SESSION_CHANGED", "An agent session changed");
      }
    }
  };
  const abort = new AbortController();
  let timer;
  let forward;
  let stopped = false;
  if (signal?.aborted) fail("ABORTED", "Agent portfolio read cancelled");
  const interruption = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      stopped = true;
      reject(new AgentPortfoliosError("AGENT_PORTFOLIOS_TIMEOUT", "Overall read deadline exceeded"));
      abort.abort();
    }, timeoutMs);
    forward = () => {
      stopped = true;
      reject(new AgentPortfoliosError("ABORTED", "Agent portfolio read cancelled"));
      abort.abort();
    };
    signal?.addEventListener("abort", forward, { once: true });
  });
  const collect = async () => {
    const portfolios = [];
    for (const entry of plan) {
      if (stopped) fail("ABORTED", "Agent portfolio read cancelled");
      current();
      const result = validatePortfolioSnapshot(await reader(entry.session, {
        tokens: [...entry.tokens], timeoutMs, signal: abort.signal,
      }));
      if (stopped) fail("ABORTED", "Agent portfolio read cancelled");
      current();
      for (const key of Object.keys(entry.initial)) {
        if (result[key] !== entry.initial[key]) fail("WRONG_AGENT_RESULT", "Reader returned a different identity");
      }
      if (result.holdings.length !== entry.tokens.length ||
          result.holdings.some((row, index) => row.address !== entry.tokens[index])) {
        fail("WRONG_AGENT_RESULT", "Reader returned a different token plan");
      }
      portfolios.push(result);
    }
    current();
    return Object.freeze({
      portfolios: Object.freeze(portfolios),
      readOnly: true,
      securityAudit: false,
      atomicAcrossAgents: false,
    });
  };
  try {
    return await Promise.race([collect(), interruption]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
    abort.abort();
  }
}
