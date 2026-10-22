import { validateSiteOrigin } from "./wallet-session.js";
import { catalogToken, TOKEN_CATALOG_VERSION, reviewCatalogAddress } from "./token-catalog.js";
import { identityAddress, identityFail, identityUnits, TokenIdentityError } from "./token-identity-codec.js";
import { TOKEN_IDENTITY_SCHEMA, validateTokenObservation } from "./token-identity-model.js";

function sessionIdentity(session) {
  const state = session?.state;
  if (!state || state.connected !== true) identityFail("IDENTITY_NOT_CONNECTED");
  const expected = catalogToken({ agent: state.agent, chainId: state.chainId });
  if (state.canSign !== false || state.canSendTransactions !== false || state.canBridge !== false) {
    identityFail("IDENTITY_CAPABILITIES");
  }
  if (!["getBlockSnapshot", "getContractCode", "getNativeBalance", "getTokenBalance", "getTokenMetadata"]
    .every(name => typeof session[name] === "function")) identityFail("IDENTITY_SESSION");
  if (!Number.isSafeInteger(state.connectionEpoch) || state.connectionEpoch < 0) identityFail("IDENTITY_EPOCH");
  let siteOrigin;
  try { siteOrigin = validateSiteOrigin(state.siteOrigin); }
  catch { identityFail("IDENTITY_ORIGIN"); }
  return Object.freeze({ agent: expected.agent, chainId: expected.chainId,
    account: identityAddress(state.account), siteOrigin, connectionEpoch: state.connectionEpoch });
}

function header(value) {
  if (!value || typeof value.number !== "string" ||
      !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value.number) ||
      typeof value.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.hash)) identityFail("IDENTITY_BLOCK");
  return { number: "0x" + BigInt(value.number).toString(16), hash: value.hash.toLowerCase() };
}

function rawUnits(value) {
  if (typeof value !== "bigint") identityFail("IDENTITY_AMOUNT");
  return identityUnits(value.toString());
}

/**
 * All subreads are pinned to one canonical block hash. Never silently fall
 * back to latest, a different address, another provider or a guessed symbol.
 * Aborting ends our wait; it cannot recall the provider's existing request.
 */
export async function readTokenIdentity(session, options = {}) {
  const initial = sessionIdentity(session);
  const selected = catalogToken({ agent: initial.agent, chainId: initial.chainId });
  const tokenAddress = options.tokenAddress ?? selected.address;
  const addressReview = reviewCatalogAddress({ agent: initial.agent, chainId: initial.chainId }, tokenAddress);
  if (!addressReview.matches) identityFail("IDENTITY_CONTRACT_MISMATCH");
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) identityFail("IDENTITY_TIMEOUT_OPTION");
  const signal = options.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) identityFail("IDENTITY_SIGNAL");
  const observer = options.onProgress;
  if (observer !== undefined && typeof observer !== "function") identityFail("IDENTITY_OBSERVER");
  let stopped = false;
  let timer;
  let abort;
  function guard() {
    if (stopped || signal?.aborted) identityFail("IDENTITY_CANCELLED");
    let current;
    try { current = sessionIdentity(session); }
    catch { identityFail("IDENTITY_SESSION_CHANGED"); }
    if (Object.keys(initial).some(key => current[key] !== initial[key])) identityFail("IDENTITY_SESSION_CHANGED");
  }
  function progress(stage) {
    guard();
    if (observer) {
      try { Promise.resolve(observer(Object.freeze({ stage, agent: initial.agent }))).catch(() => {}); }
      catch { /* Display callbacks cannot alter the observed data. */ }
    }
    guard();
  }
  async function read(stage, operation) {
    progress(stage);
    const result = await operation();
    guard();
    return result;
  }
  guard();
  const interruption = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      stopped = true;
      reject(new TokenIdentityError("IDENTITY_TIMEOUT"));
    }, timeoutMs);
    if (signal) {
      abort = () => {
        stopped = true;
        reject(new TokenIdentityError("IDENTITY_CANCELLED"));
      };
      signal.addEventListener("abort", abort, { once: true });
    }
  });
  async function collect() {
    const block = header(await read("block", () => session.getBlockSnapshot()));
    const code = await read("code", () => session.getContractCode(selected.address, block.hash));
    if (!code || code.address !== selected.address || typeof code.deployed !== "boolean") identityFail("IDENTITY_CODE");
    const native = rawUnits(await read("native", () => session.getNativeBalance(block.hash)));
    const metadata = code.deployed
      ? await read("metadata", () => session.getTokenMetadata(selected.address, block.hash)) : null;
    const balance = code.deployed
      ? rawUnits(await read("balance", () => session.getTokenBalance(selected.address, block.hash))) : null;
    const final = header(await read("canonical", () => session.getBlockSnapshot(block.number)));
    if (final.number !== block.number || final.hash !== block.hash) identityFail("IDENTITY_BLOCK_CHANGED");
    const result = validateTokenObservation({
      schema: TOKEN_IDENTITY_SCHEMA,
      catalogVersion: TOKEN_CATALOG_VERSION,
      ...initial,
      blockNumber: BigInt(block.number).toString(),
      blockHash: block.hash,
      tokenAddress: selected.address,
      hasCode: code.deployed,
      metadata,
      balanceBaseUnits: balance,
      nativeBalanceBaseUnits: native,
      readOnly: true,
      securityAudit: false,
    });
    progress("complete");
    return result;
  }
  try { return await Promise.race([collect(), interruption]); }
  finally {
    stopped = true;
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}
