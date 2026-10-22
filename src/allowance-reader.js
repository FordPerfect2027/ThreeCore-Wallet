import { readTokenIdentity } from "./token-identity-reader.js";
import { identityUnits } from "./token-identity-codec.js";
import { allowanceFail, AllowanceError, validateAllowanceTargets, assertAllowanceContext } from "./allowance-targets.js";
import { ALLOWANCE_OBSERVATION_SCHEMA, validateAllowanceObservation } from "./allowance-observation.js";

function sessionKey(session) {
  const state = session?.state;
  if (!state || state.connected !== true || !state.account) allowanceFail("ALLOWANCE_NOT_CONNECTED");
  if (state.canSign !== false || state.canSendTransactions !== false || state.canBridge !== false) {
    allowanceFail("ALLOWANCE_CAPABILITIES");
  }
  if (!Number.isSafeInteger(state.connectionEpoch) || state.connectionEpoch < 0 ||
      typeof session.getTokenAllowance !== "function") allowanceFail("ALLOWANCE_SESSION");
  return JSON.stringify([state.agent, state.account, state.chainId, state.siteOrigin, state.connectionEpoch]);
}

/** Only requested spenders are observed; there is no discovery or approval API. */
export async function readAllowanceSnapshot(session, input, options = {}) {
  const targets = validateAllowanceTargets(input);
  const key = sessionKey(session);
  assertAllowanceContext(targets, session.state);
  const timeoutMs = options.timeoutMs ?? 60000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) allowanceFail("ALLOWANCE_TIMEOUT_OPTION");
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) allowanceFail("ALLOWANCE_SIGNAL");
  if (options.onProgress !== undefined && typeof options.onProgress !== "function") allowanceFail("ALLOWANCE_OBSERVER");
  const observer = options.onProgress;
  const signal = options.signal;
  const aborter = new AbortController();
  let stopped = false;
  let timer;
  let interrupt;
  let stopReason = "ALLOWANCE_CANCELLED";
  const interrupted = new Promise((resolve, reject) => { interrupt = reject; });
  function stop(code) {
    if (stopped) return;
    stopped = true;
    stopReason = code;
    aborter.abort();
    interrupt(new AllowanceError(code));
  }
  function guard() {
    if (stopped || signal?.aborted) allowanceFail(stopReason);
    let current;
    try { current = sessionKey(session); }
    catch { allowanceFail("ALLOWANCE_SESSION_CHANGED"); }
    if (current !== key) allowanceFail("ALLOWANCE_SESSION_CHANGED");
  }
  function progress(stage, completed, spenderAddress = null) {
    guard();
    if (observer) {
      try { Promise.resolve(observer(Object.freeze({
        agent: targets.agent, stage, completed, total: targets.targets.length, spenderAddress,
      }))).catch(() => {}); } catch { /* Observers do not control read results. */ }
    }
    guard();
  }
  async function partial(operation, check) {
    guard();
    let value;
    try { value = await operation(); }
    catch {
      guard(); // Loss of connection is fatal, not a partial amount of zero.
      return { value: null, error: "READ_FAILED" };
    }
    guard();
    try { return { value: check(value), error: null }; }
    catch { return { value: null, error: "INVALID_RESPONSE" }; }
  }
  const cancel = () => stop("ALLOWANCE_CANCELLED");
  if (signal?.aborted) allowanceFail("ALLOWANCE_CANCELLED");
  signal?.addEventListener("abort", cancel, { once: true });
  timer = setTimeout(() => stop("ALLOWANCE_TIMEOUT"), timeoutMs);
  async function collect() {
    progress("token", 0);
    const identity = await readTokenIdentity(session, {
      tokenAddress: targets.tokenAddress, timeoutMs, signal: aborter.signal,
    });
    guard();
    if (JSON.stringify([identity.agent, identity.account, identity.chainId, identity.siteOrigin,
      identity.connectionEpoch]) !== key) allowanceFail("ALLOWANCE_SESSION_CHANGED");
    const rows = [];
    for (const target of targets.targets) {
      progress("spender-code", rows.length, target.address);
      const code = await partial(() => session.getContractCode(target.address, identity.blockHash), result => {
        if (!result || result.address !== target.address || typeof result.deployed !== "boolean") throw Error();
        return result.deployed;
      });
      guard();
      progress("allowance", rows.length, target.address);
      const amount = identity.hasCode
        ? await partial(() => session.getTokenAllowance(targets.tokenAddress, target.address, identity.blockHash), value => {
          if (typeof value !== "bigint") throw Error();
          return identityUnits(value.toString());
        })
        : { value: null, error: "TOKEN_UNAVAILABLE" };
      guard();
      rows.push({ spenderAddress: target.address, label: target.label,
        hasCode: code.value, codeError: code.error, allowanceBaseUnits: amount.value, allowanceError: amount.error });
      progress("row-complete", rows.length, target.address);
    }
    progress("canonical", rows.length);
    const final = await session.getBlockSnapshot("0x" + BigInt(identity.blockNumber).toString(16));
    guard();
    if (!final || typeof final.number !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(final.number) ||
        BigInt(final.number).toString() !== identity.blockNumber ||
        typeof final.hash !== "string" || final.hash.toLowerCase() !== identity.blockHash) {
      allowanceFail("ALLOWANCE_BLOCK_CHANGED");
    }
    const result = validateAllowanceObservation({
      schema: ALLOWANCE_OBSERVATION_SCHEMA, identity, targets, rows,
      readOnly: true, completeDiscovery: false, securityAudit: false,
    });
    progress("complete", rows.length);
    return result;
  }
  try { return await Promise.race([collect(), interrupted]); }
  finally {
    stopped = true;
    aborter.abort();
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
