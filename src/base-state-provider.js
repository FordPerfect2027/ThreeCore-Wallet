import { normalizeAddress, validateSiteOrigin } from "./wallet-session.js";
import { catalogToken } from "./token-catalog.js";
import { guardRpcRequest, guardRpcResponse } from "./security-rpc.js";
import { readStateRpcJson, StateRpcError, STATE_RPC_TIMEOUT_MS } from "./state-rpc-http.js";

export const BASE_STATE_METHODS = Object.freeze([
  "eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_call", "eth_getLogs",
]);

/** Same-origin, fixed-Base read transport. Cannot request accounts or transact. */
export function createBaseStateProvider({ agent, account, siteOrigin, fetchImpl = globalThis.fetch }) {
  account = normalizeAddress(account);
  const origin = validateSiteOrigin(siteOrigin);
  const tokenAddress = catalogToken({ agent, chainId: 8453 }).address;
  if (typeof fetchImpl !== "function") throw new StateRpcError();
  return Object.freeze({
    async request(input) {
      const request = guardRpcRequest(input, { account, tokenAddress });
      if (!BASE_STATE_METHODS.includes(request.method)) throw new StateRpcError();
      const aborter = new AbortController();
      const timer = setTimeout(() => aborter.abort(), STATE_RPC_TIMEOUT_MS);
      try {
        const response = await fetchImpl(origin + "/rpc/base-mainnet", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ agent, account, request }), credentials: "omit",
          redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: aborter.signal,
        });
        if (!response.ok) { try { await response.body?.cancel(); } catch {} throw new StateRpcError(); }
        const body = await readStateRpcJson(response);
        if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, "result")) throw new StateRpcError();
        return guardRpcResponse(request.method, body.result);
      } catch { throw new StateRpcError(); }
      finally { clearTimeout(timer); aborter.abort(); }
    },
  });
}
