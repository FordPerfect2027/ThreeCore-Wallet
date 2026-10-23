import { catalogToken } from "./token-catalog.js";
import {
  MAX_TRANSFER_EVENTS, TRANSFER_SCHEMA, TransferError, hexQuantity,
  normalizeTransferEvents, quantity, resolveTransferRange, transferFail,
  transferHash, validateTransferContext, validateTransferRequest, validateTransferSnapshot,
} from "./transfer-codec.js";

function binding(session) {
  const state = session?.state;
  if (!state || state.connected !== true) transferFail("TRANSFER_NOT_CONNECTED");
  if (state.canSign !== false || state.canBridge !== false || state.canSendTransactions !== false) {
    transferFail("TRANSFER_CAPABILITIES");
  }
  if (!Number.isSafeInteger(state.connectionEpoch) || state.connectionEpoch < 0) transferFail("TRANSFER_SESSION");
  const context = validateTransferContext({ agent: state.agent, chainId: state.chainId, account: state.account });
  for (const method of ["getBlockSnapshot", "getContractCode", "getTokenMetadata", "getTransferEvents"]) {
    if (typeof session[method] !== "function") transferFail("TRANSFER_SESSION");
  }
  return {
    context,
    key: JSON.stringify([context, state.siteOrigin, state.connectionEpoch]),
  };
}

function header(value, expected = null) {
  if (!value || typeof value !== "object") transferFail("TRANSFER_BLOCK_HEADER");
  const number = quantity(value.number);
  const hash = transferHash(value.hash);
  if (expected !== null && number !== expected) transferFail("TRANSFER_BLOCK_HEADER");
  return Object.freeze({ number, hash });
}

/**
 * Bounded provider observation, never a proof that the provider returned every log.
 * Both address-filtered queries must succeed; no failed query becomes an empty list.
 * The provider has no general cancellation API. Cancellation discards late replies
 * and prevents subsequent requests; it does not claim to stop an RPC already sent.
 */
export async function readTransferSnapshot(session, input, options = {}) {
  const request = validateTransferRequest(input);
  const initial = binding(session);
  const context = initial.context;
  const token = catalogToken({ agent: context.agent, chainId: context.chainId });
  const timeoutMs = options.timeoutMs ?? 60000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) transferFail("TRANSFER_TIMEOUT_OPTION");
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) transferFail("TRANSFER_SIGNAL");
  if (options.onProgress !== undefined && typeof options.onProgress !== "function") transferFail("TRANSFER_OBSERVER");
  if (options.signal?.aborted) transferFail("TRANSFER_CANCELLED");
  let stopped = false;
  let reason = "TRANSFER_CANCELLED";
  let rejectInterrupt;
  const interrupted = new Promise((resolve, reject) => { rejectInterrupt = reject; });
  function stop(code) {
    if (stopped) return;
    reason = code;
    stopped = true;
    rejectInterrupt(new TransferError(code));
  }
  function guard() {
    if (stopped) transferFail(reason);
    let current;
    try { current = binding(session).key; }
    catch { transferFail("TRANSFER_SESSION_CHANGED"); }
    if (current !== initial.key) transferFail("TRANSFER_SESSION_CHANGED");
  }
  function progress(stage, completed = 0, total = 0) {
    guard();
    if (options.onProgress) {
      try {
        Promise.resolve(options.onProgress(Object.freeze({ stage, completed, total }))).catch(() => {});
      } catch { /* Presentation callbacks cannot alter success or failure. */ }
    }
    guard();
  }
  async function read(operation) {
    guard();
    let value;
    try { value = await operation(); }
    catch (error) {
      guard();
      if (error instanceof TransferError) throw error;
      transferFail("TRANSFER_RPC_FAILED");
    }
    guard();
    return value;
  }
  const cancel = () => stop("TRANSFER_CANCELLED");
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => stop("TRANSFER_TIMEOUT"), timeoutMs);
  async function collect() {
    progress("range");
    const latest = header(await read(() => session.getBlockSnapshot()));
    const range = resolveTransferRange(request, latest.number);
    const end = range.toBlock === latest.number ? latest :
      header(await read(() => session.getBlockSnapshot(hexQuantity(range.toBlock))), range.toBlock);
    const start = range.fromBlock === end.number ? end :
      header(await read(() => session.getBlockSnapshot(hexQuantity(range.fromBlock))), range.fromBlock);
    progress("token");
    const code = await read(() => session.getContractCode(token.address, end.hash));
    if (!code || code.address !== token.address || code.deployed !== true) transferFail("TRANSFER_TOKEN_UNAVAILABLE");
    const metadata = await read(() => session.getTokenMetadata(token.address, end.hash));
    // Reject a mismatched token before asking the provider for any events.
    validateTransferSnapshot({
      schema: TRANSFER_SCHEMA, context, tokenAddress: token.address, metadata, range,
      fromBlockHash: start.hash, toBlockHash: end.hash, events: [],
      readOnly: true, completeHistory: false, independentVerification: false,
    });
    const observed = [];
    for (const direction of ["outgoing", "incoming"]) {
      progress(direction);
      const rows = await read(() => session.getTransferEvents({ ...range, direction }));
      if (!Array.isArray(rows) || rows.length > MAX_TRANSFER_EVENTS) transferFail("TRANSFER_EVENT_LIMIT");
      const keys = new Set();
      for (const row of rows) {
        if (row?.[direction === "outgoing" ? "from" : "to"] !== context.account) transferFail("TRANSFER_FILTER_MISMATCH");
        const key = row.transactionHash + ":" + row.logIndex;
        if (keys.has(key)) transferFail("TRANSFER_DUPLICATE_RESPONSE");
        keys.add(key);
        observed.push(row);
      }
    }
    const events = normalizeTransferEvents(observed, context, range);
    const blocks = new Map(events.map(event => [event.blockNumber, event.blockHash]));
    let completed = 0;
    for (const [number, hash] of blocks) {
      progress("blocks", completed, blocks.size);
      const current = header(await read(() => session.getBlockSnapshot(hexQuantity(number))), number);
      if (current.hash !== hash) transferFail("TRANSFER_BLOCK_CHANGED");
      completed++;
    }
    progress("canonical", completed, blocks.size);
    // The boundaries are checked after metadata, all logs and event headers.
    // An honest provider's canonical end hash commits to its ancestor chain.
    for (const boundary of start.number === end.number ? [end] : [start, end]) {
      const current = header(await read(() => session.getBlockSnapshot(hexQuantity(boundary.number))), boundary.number);
      if (current.hash !== boundary.hash) transferFail("TRANSFER_BLOCK_CHANGED");
    }
    const snapshot = validateTransferSnapshot({
      schema: TRANSFER_SCHEMA, context, tokenAddress: token.address, metadata, range,
      fromBlockHash: start.hash, toBlockHash: end.hash, events,
      readOnly: true, completeHistory: false, independentVerification: false,
    });
    progress("complete", completed, blocks.size);
    return snapshot;
  }
  try { return await Promise.race([collect(), interrupted]); }
  finally {
    stopped = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
