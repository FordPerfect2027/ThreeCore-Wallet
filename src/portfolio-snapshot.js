import { AGENT_IDS, normalizeAddress, validateSiteOrigin } from "./wallet-session.js";

const MAX_UINT256 = (1n << 256n) - 1n;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const HEIGHT = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/;

export class PortfolioSnapshotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PortfolioSnapshotError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PortfolioSnapshotError(code, message);
}

function identity(session) {
  const state = session?.state;
  if (!state || !AGENT_IDS.includes(state.agent) ||
      !Number.isSafeInteger(state.chainId) || state.chainId < 1 ||
      !Number.isSafeInteger(state.connectionEpoch) || state.connectionEpoch < 0 ||
      !["getBlockSnapshot", "getNativeBalance", "getContractCode", "getTokenBalance"]
        .every(name => typeof session[name] === "function")) {
    fail("INVALID_SESSION", "Expected a ThreeCore read-only session");
  }
  if (state.connected !== true || !state.account) {
    fail("DISCONNECTED", "Explicit connection is required before reading");
  }
  if (state.canSign !== false || state.canSendTransactions !== false || state.canBridge !== false) {
    fail("UNSAFE_CAPABILITIES", "Only read-only sessions can be inspected");
  }
  return Object.freeze({
    agent: state.agent,
    account: normalizeAddress(state.account),
    chainId: state.chainId,
    siteOrigin: validateSiteOrigin(state.siteOrigin),
    connectionEpoch: state.connectionEpoch,
  });
}

function unchanged(session, initial) {
  let current;
  try { current = identity(session); }
  catch { fail("SESSION_CHANGED", "The wallet changed during the snapshot"); }
  for (const key of Object.keys(initial)) {
    if (current[key] !== initial[key]) {
      fail("SESSION_CHANGED", "The wallet changed during the snapshot");
    }
  }
}

function blockHeader(value) {
  if (!value || typeof value.number !== "string" || !HEIGHT.test(value.number) ||
      typeof value.hash !== "string" || !HASH.test(value.hash)) {
    fail("INVALID_BLOCK", "Expected a mined block number and hash");
  }
  return Object.freeze({
    number: "0x" + BigInt(value.number).toString(16),
    hash: value.hash.toLowerCase(),
  });
}

function units(value) {
  if (typeof value !== "bigint" || value < 0n || value > MAX_UINT256) {
    fail("INVALID_AMOUNT", "Expected unsigned raw base units within uint256");
  }
  return value.toString();
}

function tokenList(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > 32) {
    fail("INVALID_TOKENS", "Choose between one and 32 token contracts");
  }
  for (let index = 0; index < tokens.length; index++) {
    if (!Object.hasOwn(tokens, index)) fail("INVALID_TOKENS", "Sparse token plans are forbidden");
  }
  const seen = new Set();
  return Object.freeze(tokens.map(input => {
    const address = normalizeAddress(input);
    if (seen.has(address)) fail("DUPLICATE_TOKEN", "Token addresses must be unique");
    seen.add(address);
    return address;
  }));
}

function optionsFor(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    fail("INVALID_OPTIONS", "Snapshot options must be an object");
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    fail("INVALID_TIMEOUT", "Snapshot timeout must be 1..120000ms");
  }
  const signal = options.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    fail("INVALID_SIGNAL", "Expected an AbortSignal");
  }
  const onProgress = options.onProgress;
  if (onProgress !== undefined && typeof onProgress !== "function") {
    fail("INVALID_PROGRESS_OBSERVER", "Expected a progress callback");
  }
  return { tokens: tokenList(options.tokens), timeoutMs, signal, onProgress };
}

/**
 * Inspect explicitly supplied token contracts at a single canonical block.
 * No connect, signing, approval or send method is ever called here.
 * Missing bytecode is reported as unknown balance, never as zero.
 * Inputs are copied before awaiting; callers cannot alter the read plan.
 * A caller abort ends the local wait, not the provider's underlying request.
 */
export async function readPortfolioSnapshot(session, options) {
  const { tokens, timeoutMs, signal, onProgress } = optionsFor(options);
  const initial = identity(session);
  let timer;
  let abort;
  let stopped = false;
  const stop = (code, message) => {
    stopped = true;
    return new PortfolioSnapshotError(code, message);
  };
  const guard = () => {
    if (stopped || signal?.aborted) fail("ABORTED", "Snapshot was cancelled");
    unchanged(session, initial);
  };
  if (signal?.aborted) fail("ABORTED", "Snapshot was cancelled");
  const interruption = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(stop("SNAPSHOT_TIMEOUT", "Snapshot deadline exceeded")), timeoutMs);
    if (signal) {
      abort = () => reject(stop("ABORTED", "Snapshot was cancelled"));
      signal.addEventListener("abort", abort, { once: true });
    }
  });
  const read = async operation => {
    guard();
    const value = await operation();
    guard();
    return value;
  };
  const notify = (stage, completedTokens, tokenIndex = null, tokenAddress = null) => {
    guard();
    if (onProgress) {
      const event = Object.freeze({ stage, completedTokens, totalTokens: tokens.length, tokenIndex, tokenAddress });
      try {
        // A failing or asynchronous display observer must not stall the read.
        Promise.resolve(onProgress(event)).catch(() => {});
      } catch { /* Display failures cannot alter portfolio contents. */ }
    }
    guard(); // Observers may synchronously cancel or invalidate a session.
  };
  const collect = async () => {
    notify("block", 0);
    const block = blockHeader(await read(() => session.getBlockSnapshot()));
    notify("native", 0);
    const nativeBalanceBaseUnits = units(await read(() => session.getNativeBalance(block.hash)));
    const holdings = [];
    for (const address of tokens) {
      const index = holdings.length;
      notify("token-code", index, index, address);
      const code = await read(() => session.getContractCode(address, block.hash));
      if (!code || code.address !== address || typeof code.deployed !== "boolean") {
        fail("INVALID_CODE_RESULT", "Contract code result does not match the requested address");
      }
      const hasCode = code.deployed;
      let balanceBaseUnits = null;
      if (hasCode) {
        notify("token-balance", index, index, address);
        balanceBaseUnits = units(await read(() => session.getTokenBalance(address, block.hash)));
      }
      holdings.push(Object.freeze({
        address,
        hasCode,
        balanceBaseUnits,
        notice: hasCode ? null : "TOKEN_CODE_MISSING",
      }));
    }
    notify("canonical", tokens.length);
    const finalBlock = blockHeader(await read(() => session.getBlockSnapshot(block.number)));
    if (finalBlock.number !== block.number || finalBlock.hash !== block.hash) {
      fail("BLOCK_CHANGED", "The selected block changed; take a fresh snapshot");
    }
    guard();
    notify("complete", tokens.length);
    return Object.freeze({
      ...initial,
      blockNumber: BigInt(block.number).toString(),
      blockHash: block.hash,
      nativeBalanceBaseUnits,
      holdings: Object.freeze(holdings),
      readOnly: true,
      securityAudit: false,
    });
  };
  try {
    return await Promise.race([collect(), interruption]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}
