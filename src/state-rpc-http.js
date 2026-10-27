import { parseSecurityJson } from "./security-json.js";

export const STATE_RPC_RESPONSE_LIMIT = 2 * 1024 * 1024;
export const STATE_RPC_TIMEOUT_MS = 15_000;
export class StateRpcError extends Error {
  constructor() {
    super("Base本番の読み取り窓口から結果を取得できませんでした。接続を確認して再度読み取ってください。");
    this.code = "STATE_RPC_UNAVAILABLE";
  }
}

/** Bound bytes before JSON parsing; never buffer an unbounded RPC response. */
export async function readStateRpcJson(response) {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > STATE_RPC_RESPONSE_LIMIT)) {
    await response.body?.cancel();
    throw new StateRpcError();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new StateRpcError();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > STATE_RPC_RESPONSE_LIMIT) throw new StateRpcError();
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return parseSecurityJson(text, { bytes: STATE_RPC_RESPONSE_LIMIT, depth: 24,
      nodes: 50_000, stringCharacters: 300_000 });
  } catch {
    try { await reader.cancel(); } catch {}
    throw new StateRpcError();
  } finally { reader.releaseLock(); }
}
