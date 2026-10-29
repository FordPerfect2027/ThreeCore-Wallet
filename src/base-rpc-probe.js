/**
 * Read-only public Base JSON-RPC connectivity checks for ThreeCore.
 * This module does NOT access browser wallets, ask for account permissions,
 * sign messages, grant allowances, transfer assets, or connect to a dApp.
 *
 * Public Base endpoints are development-only and rate limited.
 * Chain ID alone is NOT proof of site safety or a trusted RPC provider.
 */
import { readStateRpcJson } from "./state-rpc-http.js";
import { RPC_SECURITY_LIMITS } from "./security-rpc.js";
export const BASE_NETWORKS = Object.freeze({
  mainnet: Object.freeze({
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
  }),
  sepolia: Object.freeze({
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
  }),
});

export class BaseRpcProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BaseRpcProbeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new BaseRpcProbeError(code, message);
}

function address(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_ADDRESS", "Expected a complete 20-byte EVM contract address");
  }
  return value.toLowerCase();
}

function rpcUint(value) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)) {
    fail("INVALID_RPC_RESPONSE", "Expected a hexadecimal EVM quantity");
  }
  return BigInt(value);
}

export async function probeBaseRpc({
  network = "sepolia",
  contractAddress,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
} = {}) {
  if (typeof network !== "string" || !Object.hasOwn(BASE_NETWORKS, network))
    fail("UNSUPPORTED_NETWORK", "Only Base and Base Sepolia are supported");
  const target = BASE_NETWORKS[network];
  // Validate user input locally before any network call.
  const contract = contractAddress == null ? null : address(contractAddress);
  if (typeof fetchImpl !== "function") fail("INVALID_TRANSPORT", "Fetch transport is missing");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    fail("INVALID_TIMEOUT", "Timeout must be 100–30000 milliseconds");
  }

  let id = 0;
  async function request(method, params = []) {
    if (!["eth_chainId", "eth_blockNumber", "eth_getCode"].includes(method)) {
      fail("METHOD_BLOCKED", "Only read-only RPC methods are permitted");
    }
    const requestId = ++id, controller = new AbortController();
    let timedOut = false, timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true; controller.abort();
        reject(new BaseRpcProbeError("RPC_TIMEOUT", "Base RPC did not finish within the per-request time limit"));
      }, timeoutMs);
    });
    const work = (async () => {
      const response = await fetchImpl(target.rpcUrl, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
        credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (timedOut || !response?.ok || response.redirected) {
        try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch {}
        fail(timedOut ? "RPC_TIMEOUT" : "HTTP_ERROR", "Base RPC did not return an accepted HTTP response");
      }
      let json;
      try { json = await readStateRpcJson(response, { signal: controller.signal }); }
      catch { fail("INVALID_RPC_RESPONSE", "Base RPC returned an invalid or oversized response"); }
      if (!json || json.jsonrpc !== "2.0" || json.id !== requestId ||
          typeof json.result !== "string" || Object.hasOwn(json, "error")) {
        fail("INVALID_RPC_RESPONSE", "Unexpected or failed Base JSON-RPC response");
      }
      return json.result;
    })();
    try { return await Promise.race([work, deadline]); }
    catch (error) {
      if (timedOut) fail("RPC_TIMEOUT", "Base RPC did not finish within the per-request time limit");
      if (error instanceof BaseRpcProbeError) throw error;
      fail("RPC_TRANSPORT", "Base RPC transport failed");
    } finally { clearTimeout(timer); controller.abort(); }
  }

  const chain = rpcUint(await request("eth_chainId"));
  if (chain !== BigInt(target.chainId)) {
    fail("CHAIN_MISMATCH", "The RPC endpoint is not on the expected Base chain");
  }
  const block = rpcUint(await request("eth_blockNumber"));
  const result = {
    network,
    chainId: target.chainId,
    rpcUrl: target.rpcUrl,
    observedBlockNumber: block.toString(),
    readOnly: true,
    walletConnected: false,
    externalDappIntegrated: false,
  };
  if (contract) {
    const code = await request("eth_getCode", [contract, "0x" + block.toString(16)]);
    if (code.length > RPC_SECURITY_LIMITS.contractCodeCharacters || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) {
      fail("INVALID_RPC_RESPONSE", "Invalid contract-code RPC result");
    }
    result.contractAddress = contract;
    result.contractCodeBlockNumber = block.toString();
    result.contractCodePresent = code !== "0x";
  }
  return Object.freeze(result);
}
