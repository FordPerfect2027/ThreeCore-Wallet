import { captureDataRecord } from "../src/security-data.js";
import { parseSecurityJson } from "../src/security-json.js";
import { guardRpcRequest, guardRpcResponse, RPC_SECURITY_LIMITS } from "../src/security-rpc.js";
import { catalogToken } from "../src/token-catalog.js";
import { normalizeAddress } from "../src/wallet-session.js";
import { BASE_STATE_METHODS } from "../src/base-state-provider.js";
import { readStateRpcJson, STATE_RPC_TIMEOUT_MS } from "../src/state-rpc-http.js";

export const BASE_MAINNET_RPC = "https://mainnet.base.org";
const MAX_BODY = 8192;

/** No URL/config passthrough, credentials, writes, permission calls or retries. */
export function createBaseStateRpcHandler(fetchImpl = globalThis.fetch) {
  let active = 0;
  return async function serveBaseStateRpc(request, response) {
    const origin = "http://" + request.headers.host;
    if (request.method !== "POST" || request.headers.origin !== origin ||
        request.headers["content-type"] !== "application/json") {
      response.writeHead(403); response.end(); return;
    }
    if (active >= 12) { response.writeHead(429); response.end(); return; }
    active++;
    const aborter = new AbortController();
    const timer = setTimeout(() => {
      aborter.abort();
      if (!request.complete) request.destroy();
    }, STATE_RPC_TIMEOUT_MS);
    const close = () => aborter.abort();
    response.once("close", close);
    const send = (status, body) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(body));
    };
    try {
      if (Number(request.headers["content-length"] ?? 0) > MAX_BODY) { send(413, { error: "STATE_RPC_REQUEST" }); return; }
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY || aborter.signal.aborted) { send(413, { error: "STATE_RPC_REQUEST" }); return; }
        chunks.push(chunk);
      }
      let envelope, rpc;
      try {
        envelope = captureDataRecord(parseSecurityJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
          { bytes: MAX_BODY, depth: 12, nodes: 100, stringCharacters: 1024 }), ["agent", "account", "request"]);
        const account = normalizeAddress(envelope.account);
        const tokenAddress = catalogToken({ agent: envelope.agent, chainId: 8453 }).address;
        rpc = guardRpcRequest(envelope.request, { account, tokenAddress });
        if (!BASE_STATE_METHODS.includes(rpc.method)) throw Error();
      } catch { send(400, { error: "STATE_RPC_REQUEST" }); return; }
      if (aborter.signal.aborted) { send(504, { error: "STATE_RPC_UNAVAILABLE" }); return; }
      const upstream = await fetchImpl(BASE_MAINNET_RPC, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...rpc }),
        credentials: "omit", redirect: "error", cache: "no-store", signal: aborter.signal,
      });
      if (!upstream.ok) { try { await upstream.body?.cancel(); } catch {} throw Error(); }
      const body = await readStateRpcJson(upstream);
      if (!body || body.id !== 1 || body.jsonrpc !== "2.0" || Object.hasOwn(body, "error") ||
          !Object.hasOwn(body, "result")) throw Error();
      if (rpc.method === "eth_getLogs" && (!Array.isArray(body.result) || body.result.length > RPC_SECURITY_LIMITS.logEntries)) throw Error();
      const result = guardRpcResponse(rpc.method, body.result);
      if (!aborter.signal.aborted) send(200, { result });
      else send(504, { error: "STATE_RPC_UNAVAILABLE" });
    } catch { send(502, { error: "STATE_RPC_UNAVAILABLE" }); }
    finally {
      active--; clearTimeout(timer); response.removeListener("close", close); aborter.abort();
    }
  };
}
