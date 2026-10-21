/**
 * Read-only Aerodrome / ThreeCore integration preflight on Base Mainnet.
 * Addresses must be independently cross-checked against official published
 * references before making decisions; code presence does not prove safety.
 *
 * NEVER signs, grants approvals, sends transactions, or handles private keys.
 */
export const AERODROME_BASE = Object.freeze({
  chainId: 8453,
  rpcUrl: "https://mainnet.base.org",
  source: "https://aerodrome.finance/security",
  router: "0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43",
  poolFactory: "0x420dd381b31aef6683db6b902084cb0ffece40da",
  factoryRegistry: "0x5c3f18f06cc09ca1910767a34a20f771039e37c0",
});

export const THREECORE_BASE_TOKENS = Object.freeze({
  DAT: "0x6c83dd253f2f882b9884fd1ac3a7754ed6405de5",
  EMA: "0xbae0933d509b83b7bbab3aab9fed413504382a76",
  CAWELON: "0xb4654b5a4617fe2c27a0dd6eaee98f8aa941b895",
});

export class AerodromeReadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AerodromeReadError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AerodromeReadError(code, message);
}

function address(input) {
  if (typeof input !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(input)) {
    fail("INVALID_ADDRESS", "Expected a complete 20-byte public EVM wallet address");
  }
  return input.toLowerCase();
}

function encodeWord(input) {
  return input.slice(2).padStart(64, "0");
}

function decodeQuantity(result) {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(result)) {
    fail("INVALID_RPC_RESULT", "Malformed EVM RPC quantity");
  }
  return BigInt(result).toString();
}

function decodeUint256Word(result) {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    fail("INVALID_RPC_RESULT", "Expected one complete ABI-encoded uint256 word");
  }
  return BigInt(result).toString();
}

/**
 * Verify known contract bytecode presence and optionally inspect the already
 * existing token holdings/allowances of an explicitly supplied public wallet.
 *
 * The allowance spender is ONLY Aerodrome's published classic Router address;
 * this says nothing about UniversalRouter, Slipstream, Permit2 or other routers.
 * The data is a point-in-time observation, not a DEX trade recommendation.
 */
export async function inspectAerodromeBase({
  publicWalletAddress,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12000,
} = {}) {
  // Validate everything before network access; no wallet is connected here.
  const wallet = publicWalletAddress == null ? null : address(publicWalletAddress);
  if (typeof fetchImpl !== "function") fail("NO_TRANSPORT", "No JSON-RPC transport");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    fail("INVALID_TIMEOUT", "Timeout must be between 100 and 30000 milliseconds");
  }

  let id = 0;
  async function read(method, params = []) {
    if (!["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call"].includes(method)) {
      fail("FORBIDDEN_METHOD", "Only read-only JSON-RPC requests are permitted");
    }
    const currentId = ++id;
    const response = await fetchImpl(AERODROME_BASE.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: currentId, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response?.ok) fail("HTTP_ERROR", "Base RPC rejected the request");
    const value = await response.json();
    if (!value || value.jsonrpc !== "2.0" || value.id !== currentId ||
        value.error || typeof value.result !== "string") {
      fail("INVALID_RPC_RESULT", "Unexpected JSON-RPC response");
    }
    return value.result;
  }

  const actualChain = BigInt(decodeQuantity(await read("eth_chainId")));
  if (actualChain !== BigInt(AERODROME_BASE.chainId)) {
    fail("WRONG_CHAIN", "RPC does not match Base Mainnet");
  }
  const block = decodeQuantity(await read("eth_blockNumber"));
  const blockTag = "0x" + BigInt(block).toString(16);

  const contracts = Object.freeze({
    aerodromeRouter: AERODROME_BASE.router,
    aerodromePoolFactory: AERODROME_BASE.poolFactory,
    aerodromeFactoryRegistry: AERODROME_BASE.factoryRegistry,
    ...THREECORE_BASE_TOKENS,
  });
  const deployed = {};
  for (const [name, contractAddress] of Object.entries(contracts)) {
    const bytecode = await read("eth_getCode", [contractAddress, blockTag]);
    if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(bytecode)) {
      fail("INVALID_RPC_RESULT", "Malformed contract code");
    }
    deployed[name] = bytecode !== "0x";
  }

  const account = {};
  if (wallet) {
    for (const [agent, token] of Object.entries(THREECORE_BASE_TOKENS)) {
      // balanceOf(address)
      const balanceHex = await read("eth_call", [{
        to: token,
        data: "0x70a08231" + encodeWord(wallet),
      }, blockTag]);
      // allowance(owner,spender), Classic Router only. NO approve() call.
      const allowanceHex = await read("eth_call", [{
        to: token,
        data: "0xdd62ed3e" + encodeWord(wallet) + encodeWord(AERODROME_BASE.router),
      }, blockTag]);
      account[agent] = Object.freeze({
        balanceBaseUnits: decodeUint256Word(balanceHex),
        classicRouterAllowanceBaseUnits: decodeUint256Word(allowanceHex),
      });
    }
  }

  return Object.freeze({
    chainId: AERODROME_BASE.chainId,
    blockNumber: block,
    rpcUrl: AERODROME_BASE.rpcUrl,
    contractAddresses: contracts,
    codePresent: Object.freeze(deployed),
    walletAddress: wallet,
    tokenReadings: wallet ? Object.freeze(account) : null,
    readOnly: true,
    userWalletConnected: false,
    tradePerformed: false,
    contractSecurityAudited: false,
    externalDappWalletConnected: false,
  });
}
