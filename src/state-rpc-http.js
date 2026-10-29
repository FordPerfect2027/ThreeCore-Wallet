import { parseSecurityJson } from "./security-json.js";

export const STATE_RPC_RESPONSE_LIMIT = 2 * 1024 * 1024;
export const STATE_RPC_TIMEOUT_MS = 15_000;
export class StateRpcError extends Error {
  constructor() {
    super("Base本番の読み取り窓口から結果を取得できませんでした。接続を確認して再度読み取ってください。");
    this.code = "STATE_RPC_UNAVAILABLE";
  }
}

/** Stop awaiting headers on abort, even when an injected transport ignores it. */
export async function fetchStateRpcResponse(fetchImpl, url, options) {
  const signal = options?.signal;
  if (typeof fetchImpl !== "function" || !(signal instanceof AbortSignal) || signal.aborted)
    throw new StateRpcError();
  let interrupt;
  const interrupted = new Promise((_, reject) => { interrupt = reject; });
  const abort = () => interrupt(new StateRpcError());
  signal.addEventListener("abort", abort, { once: true });
  const work = (async () => {
    const response = await fetchImpl(url, options);
    if (signal.aborted || !response?.ok || response.redirected) {
      try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch {}
      throw new StateRpcError();
    }
    return response;
  })();
  try { return await Promise.race([work, interrupted]); }
  catch { throw new StateRpcError(); }
  finally { signal.removeEventListener("abort", abort); }
}

/** Bound bytes before JSON parsing; never buffer an unbounded RPC response. */
export async function readStateRpcJson(response, { signal } = {}) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new StateRpcError();
  if (signal?.aborted) {
    try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch {}
    throw new StateRpcError();
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > STATE_RPC_RESPONSE_LIMIT)) {
    try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch {}
    throw new StateRpcError();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new StateRpcError();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  let stopReading;
  const interrupted = new Promise((_, reject) => { stopReading = reject; });
  function abort() {
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
    stopReading(new StateRpcError());
  }
  signal?.addEventListener("abort", abort, { once: true });
  async function consume() {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new StateRpcError();
      if (done) break;
      size += value.byteLength;
      if (size > STATE_RPC_RESPONSE_LIMIT) throw new StateRpcError();
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return parseSecurityJson(text, { bytes: STATE_RPC_RESPONSE_LIMIT, depth: 24,
      nodes: 50_000, stringCharacters: 300_000 });
  }
  try {
    if (signal?.aborted) abort();
    return await Promise.race([consume(), interrupted]);
  } catch {
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
    throw new StateRpcError();
  } finally {
    signal?.removeEventListener("abort", abort);
    try { reader.releaseLock(); } catch {}
  }
}
