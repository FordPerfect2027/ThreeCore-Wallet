import { readStateRpcJson } from "./state-rpc-http.js";
import { RPC_SECURITY_LIMITS } from "./security-rpc.js";

const ENDPOINTS = new Set(["https://mainnet.base.org", "https://sepolia.base.org"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/;
const ADDRESS_WORD = /^0{24}[0-9a-fA-F]{40}$/;

export class PublicBaseRpcError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicBaseRpcError";
    this.code = code;
  }
}
function fail(code, message) { throw new PublicBaseRpcError(code, message); }
function cancel(body) {
  try { Promise.resolve(body?.cancel()).catch(() => {}); } catch {}
}

// This diagnostic reader accepts only the selectors used by the existing
// balance/allowance and Classic-pool inspections. No wallet transport is used.
function allowedCall(call) {
  if (!call || Object.getPrototypeOf(call) !== Object.prototype ||
      Object.keys(call).length !== 2 || !Object.hasOwn(call, "to") ||
      !Object.hasOwn(call, "data") || typeof call.to !== "string" || !ADDRESS.test(call.to) ||
      typeof call.data !== "string" || !/^0x[0-9a-fA-F]+$/.test(call.data)) return false;
  const selector = call.data.slice(0, 10).toLowerCase();
  const data = call.data.slice(10);
  if (["0x0dfe1681", "0xd21220a7", "0x0902f1ac"].includes(selector)) return data.length === 0;
  if (selector === "0x70a08231") return data.length === 64 && ADDRESS_WORD.test(data);
  if (selector === "0xdd62ed3e") return data.length === 128 &&
    ADDRESS_WORD.test(data.slice(0, 64)) && ADDRESS_WORD.test(data.slice(64));
  return selector === "0x79bc57d5" && data.length === 192 &&
    ADDRESS_WORD.test(data.slice(0, 64)) && ADDRESS_WORD.test(data.slice(64, 128)) &&
    /^0{63}[01]$/.test(data.slice(128));
}
function validateRequest(method, params) {
  if (!["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call"].includes(method))
    fail("METHOD_BLOCKED", "Only supported diagnostic read methods are permitted");
  if (!Array.isArray(params)) fail("INVALID_PARAMS", "Invalid diagnostic read parameters");
  if (method === "eth_chainId" || method === "eth_blockNumber") {
    if (params.length !== 0) fail("INVALID_PARAMS", "This diagnostic read has no parameters");
  } else if (params.length !== 2 || typeof params[1] !== "string" || !QUANTITY.test(params[1]) ||
      (method === "eth_getCode" ? typeof params[0] !== "string" || !ADDRESS.test(params[0]) : !allowedCall(params[0]))) {
    fail("INVALID_PARAMS", "Diagnostic state reads require a supported input and explicit block number");
  }
}

/** Bounded, per-request deadline transport for fixed public Base diagnostics. */
export function createPublicBaseRpcReader({ rpcUrl, fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (!ENDPOINTS.has(rpcUrl)) fail("UNSUPPORTED_ENDPOINT", "Only fixed public Base endpoints are supported");
  if (typeof fetchImpl !== "function") fail("INVALID_TRANSPORT", "Fetch transport is missing");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000)
    fail("INVALID_TIMEOUT", "Timeout must be 100–30000 milliseconds");
  let id = 0;
  return async function read(method, params = []) {
    validateRequest(method, params);
    const requestId = ++id;
    const body = JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params });
    const controller = new AbortController();
    let timedOut = false, timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true; controller.abort();
        reject(new PublicBaseRpcError("RPC_TIMEOUT", "Base RPC did not finish within the per-request time limit"));
      }, timeoutMs);
    });
    const work = (async () => {
      const response = await fetchImpl(rpcUrl, {
        method: "POST", headers: { "content-type": "application/json" }, body,
        credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (timedOut || !response?.ok || response.redirected) {
        cancel(response?.body);
        fail(timedOut ? "RPC_TIMEOUT" : "HTTP_ERROR", "Base RPC did not return an accepted HTTP response");
      }
      let json;
      try { json = await readStateRpcJson(response, { signal: controller.signal }); }
      catch { fail("INVALID_RPC_RESPONSE", "Base RPC returned an invalid or oversized response"); }
      if (!json || json.jsonrpc !== "2.0" || json.id !== requestId ||
          typeof json.result !== "string" || Object.hasOwn(json, "error"))
        fail("INVALID_RPC_RESPONSE", "Unexpected or failed Base JSON-RPC response");
      if ((method === "eth_chainId" || method === "eth_blockNumber") && !QUANTITY.test(json.result))
        fail("INVALID_RPC_RESPONSE", "Expected a canonical hexadecimal EVM quantity");
      if (method === "eth_getCode" && (json.result.length > RPC_SECURITY_LIMITS.contractCodeCharacters ||
          !/^0x(?:[0-9a-fA-F]{2})*$/.test(json.result)))
        fail("INVALID_RPC_RESPONSE", "Invalid contract-code RPC result");
      return json.result;
    })();
    try { return await Promise.race([work, deadline]); }
    catch (error) {
      if (timedOut) fail("RPC_TIMEOUT", "Base RPC did not finish within the per-request time limit");
      if (error instanceof PublicBaseRpcError) throw error;
      fail("RPC_TRANSPORT", "Base RPC transport failed");
    } finally { clearTimeout(timer); controller.abort(); }
  };
}
