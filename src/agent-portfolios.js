import { AGENT_IDS } from "./wallet-session.js";
import { readPortfolioSnapshot } from "./portfolio-snapshot.js";
import { validatePortfolioSnapshot } from "./portfolio-report.js";
import { captureWalletReadState } from "./wallet-read-scope.js";
import { captureDataArray, captureOptionalDataFields } from "./security-data.js";
import { subscribeReadAbort } from "./security-abort.js";

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
  let state;
  try { state = captureWalletReadState(session); }
  catch { fail("INVALID_AGENT_SESSION", "Expected own-data agent session state"); }
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
export async function readAgentPortfolios(entries, options = {}) {
  try { options = captureOptionalDataFields(options, ["timeoutMs", "signal", "reader"]); }
  catch { fail("INVALID_OPTIONS", "Expected own-data coordinated read options"); }
  const { timeoutMs = 60_000, signal, reader = readPortfolioSnapshot } = options;
  try { entries = captureDataArray(entries, AGENT_IDS.length, AGENT_IDS.length); }
  catch { fail("INVALID_AGENT_PLAN", "Expected three own-data agent entries"); }
  if (typeof reader !== "function") {
    fail("INVALID_AGENT_PLAN", "Exactly DAT, EMA and CAWELON are required");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    fail("INVALID_TIMEOUT", "Overall timeout must be 1..120000ms");
  }
  const accounts = new Set();
  const agents = new Set();
  const plan = entries.map(entry => {
    try { entry = captureOptionalDataFields(entry, ["agent", "session", "tokens"]); }
    catch { fail("INVALID_AGENT_PLAN", "Expected own-data agent fields"); }
    if (!AGENT_IDS.includes(entry.agent) || agents.has(entry.agent)) {
      fail("INVALID_AGENT_PLAN", "Each agent and token plan must be explicit and unique");
    }
    let tokenInputs;
    try { tokenInputs = captureDataArray(entry.tokens, 32, 1); }
    catch { fail("INVALID_AGENT_PLAN", "Expected bounded own-data token lists"); }
    agents.add(entry.agent);
    const initial = capture(entry.session, entry.agent);
    if (accounts.has(initial.account)) fail("SHARED_AGENT_ACCOUNT", "Agent accounts must be distinct");
    accounts.add(initial.account);
    const tokens = tokenInputs.map(value => {
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
  let cancellation;
  let stopped = false;
  let rejectInterrupt;
  let reason = "ABORTED";
  const interruption = new Promise((resolve, reject) => { rejectInterrupt = reject; });
  const stop = (code, message) => {
    if (stopped) return;
    stopped = true;
    reason = code;
    rejectInterrupt(new AgentPortfoliosError(code, message));
    abort.abort();
  };
  const guard = () => {
    if (stopped || cancellation?.aborted()) fail(reason, "Agent portfolio read ended");
    current();
  };
  const collect = async () => {
    const portfolios = [];
    for (const entry of plan) {
      guard();
      const result = validatePortfolioSnapshot(await reader(entry.session, {
        tokens: [...entry.tokens], timeoutMs, signal: abort.signal,
      }));
      guard();
      for (const key of Object.keys(entry.initial)) {
        if (result[key] !== entry.initial[key]) fail("WRONG_AGENT_RESULT", "Reader returned a different identity");
      }
      if (result.holdings.length !== entry.tokens.length ||
          result.holdings.some((row, index) => row.address !== entry.tokens[index])) {
        fail("WRONG_AGENT_RESULT", "Reader returned a different token plan");
      }
      portfolios.push(result);
    }
    guard();
    return Object.freeze({
      portfolios: Object.freeze(portfolios),
      readOnly: true,
      securityAudit: false,
      atomicAcrossAgents: false,
    });
  };
  interruption.catch(() => {});
  try {
    try { cancellation = subscribeReadAbort(signal, () => stop("ABORTED", "Agent portfolio read cancelled")); }
    catch { fail("INVALID_SIGNAL", "Expected a native AbortSignal"); }
    guard();
    timer = setTimeout(() => stop("AGENT_PORTFOLIOS_TIMEOUT", "Overall read deadline exceeded"), timeoutMs);
    return await Promise.race([collect(), interruption]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    cancellation?.dispose();
    abort.abort();
  }
}
