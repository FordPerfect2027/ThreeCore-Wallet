/**
 * Read-only public Base JSON-RPC connectivity checks for ThreeCore.
 * This module does NOT access browser wallets, ask for account permissions,
 * sign messages, grant allowances, transfer assets, or connect to a dApp.
 *
 * Public Base endpoints are development-only and rate limited.
 * Chain ID alone is NOT proof of site safety or a trusted RPC provider.
 */
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
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
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
  const target = BASE_NETWORKS[network];
  if (!target) fail("UNSUPPORTED_NETWORK", "Only Base and Base Sepolia are supported");
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
    const response = await fetchImpl(target.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response?.ok) fail("HTTP_ERROR", "Base RPC returned a non-2xx HTTP status");
    const json = await response.json();
    if (!json || json.jsonrpc !== "2.0" || json.id !== id ||
        typeof json.result !== "string" || json.error) {
      fail("INVALID_RPC_RESPONSE", "Unexpected or failed Base JSON-RPC response");
    }
    return json.result;
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
    const code = await request("eth_getCode", [contract, "latest"]);
    if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) {
      fail("INVALID_RPC_RESPONSE", "Invalid contract-code RPC result");
    }
    result.contractAddress = contract;
    result.contractCodePresent = code !== "0x";
  }
  return Object.freeze(result);
}
