import { inspectReadPacket, snapshotFileChunk } from "./file-read-source.js";
import { consumeCallback } from "./security-callback.js";
import { parseSecurityJson } from "./security-json.js";
import { captureOptionalDataFields } from "./security-data.js";
import { subscribeReadAbort } from "./security-abort.js";

export const STATE_RPC_RESPONSE_LIMIT = 2 * 1024 * 1024;
const STATE_RPC_CHUNK_LIMIT = 100_000;
export const STATE_RPC_TIMEOUT_MS = 15_000;
export class StateRpcError extends Error {
  constructor() {
    super("Base本番の読み取り窓口から結果を取得できませんでした。接続を確認して再度読み取ってください。");
    this.code = "STATE_RPC_UNAVAILABLE";
  }
}

/** Stop awaiting headers on abort, even when an injected transport ignores it. */
export async function fetchStateRpcResponse(fetchImpl, url, options) {
  let interrupt, cancellation;
  const interrupted = new Promise((_, reject) => { interrupt = reject; });
  interrupted.catch(() => {});
  const abort = () => interrupt(new StateRpcError());
  try {
    const { signal } = captureOptionalDataFields(options, ["signal"]);
    if (typeof fetchImpl !== "function" || signal === undefined) throw new StateRpcError();
    cancellation = subscribeReadAbort(signal, abort);
    if (cancellation.aborted()) throw new StateRpcError();
    const work = (async () => {
      let response;
      try {
        response = await fetchImpl(url, options);
        if (cancellation.aborted() || !response?.ok || response.redirected || cancellation.aborted()) throw new StateRpcError();
        return response;
      } catch {
        consumeCallback(() => response?.body?.cancel());
        throw new StateRpcError();
      }
    })();
    return await Promise.race([work, interrupted]);
  }
  catch { throw new StateRpcError(); }
  finally { cancellation?.dispose(); }
}

/** Bound bytes before JSON parsing; never buffer an unbounded RPC response. */
export async function readStateRpcJson(response, options = {}) {
  let reader, cancellation, cancelledTarget;
  function stopBody() {
    consumeCallback(() => {
      const target = reader ?? response?.body;
      if (!target || target === cancelledTarget) return;
      cancelledTarget = target;
      return target.cancel();
    });
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "", chunks = 0;
  let stopReading;
  const interrupted = new Promise((_, reject) => { stopReading = reject; });
  interrupted.catch(() => {});
  function abort() {
    stopBody();
    stopReading(new StateRpcError());
  }
  async function consume() {
    while (true) {
      const packet = await reader.read();
      if (cancellation.aborted()) throw new StateRpcError();
      const { done, value } = inspectReadPacket(packet);
      if (cancellation.aborted()) throw new StateRpcError();
      if (done) break;
      if (++chunks > STATE_RPC_CHUNK_LIMIT) throw new StateRpcError();
      const bytes = snapshotFileChunk(value, STATE_RPC_RESPONSE_LIMIT - size);
      if (cancellation.aborted()) throw new StateRpcError();
      size += bytes.byteLength;
      text += decoder.decode(bytes, { stream: true });
    }
    text += decoder.decode();
    return parseSecurityJson(text, { bytes: STATE_RPC_RESPONSE_LIMIT, depth: 24,
      nodes: 50_000, stringCharacters: 300_000 });
  }
  try {
    const { signal } = captureOptionalDataFields(options, ["signal"]);
    cancellation = subscribeReadAbort(signal, abort);
    if (cancellation.aborted()) throw new StateRpcError();
    const declared = response.headers.get("content-length");
    if (cancellation.aborted() || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > STATE_RPC_RESPONSE_LIMIT))) throw new StateRpcError();
    reader = response.body?.getReader();
    if (!reader || cancellation.aborted()) throw new StateRpcError();
    return await Promise.race([consume(), interrupted]);
  } catch {
    stopBody();
    throw new StateRpcError();
  } finally {
    cancellation?.dispose();
    consumeCallback(() => reader?.releaseLock());
  }
}
