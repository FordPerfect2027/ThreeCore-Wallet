/**
 * Read-only Aerodrome Classic v2 pool discovery on Base Mainnet.
 * Checks published PoolFactory.getPool(token, USDC, stable) at one block.
 * This module NEVER trades, signs, approves, stakes, or touches private keys.
 *
 * Only classic v2 pools from the published factory are covered. Slipstream
 * (concentrated liquidity), other factories and third-party DEXes are excluded.
 */
import { AERODROME_BASE, THREECORE_BASE_TOKENS } from "./aerodrome-readonly.js";

export const BASE_NATIVE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const USDC_SOURCE = "https://www.circle.com/blog/usdc-now-available-natively-on-base";

const SELECTORS = Object.freeze({
  getPool: "0x79bc57d5", // getPool(address,address,bool)
  token0: "0x0dfe1681",  // token0()
  token1: "0xd21220a7",  // token1()
  getReserves: "0x0902f1ac", // getReserves()
});
const ZERO_ADDRESS = "0x" + "0".repeat(40);

export class AerodromePoolReadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AerodromePoolReadError";
    this.code = code;
  }
}
function fail(code, message) {
  throw new AerodromePoolReadError(code, message);
}
function word(address) {
  return address.slice(2).padStart(64, "0");
}
function decodeAddress(value) {
  if (typeof value !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_ADDRESS_RESULT", "Malformed ABI-encoded contract address");
  }
  return "0x" + value.slice(-40).toLowerCase();
}
function decodeThreeWords(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{192}$/.test(value)) {
    fail("INVALID_RESERVE_RESULT", "Expected three ABI-encoded uint256 reserve words");
  }
  const units = value.slice(2);
  return [0, 1, 2].map(i => BigInt("0x" + units.slice(i * 64, (i + 1) * 64)));
}
function toHexBlock(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    fail("INVALID_RPC_RESULT", "Invalid hexadecimal block or chain quantity");
  }
  return BigInt(value);
}

/**
 * Return stable + volatile Classic v2 pool locations for all 3 tokens vs native
 * Base USDC, and existing reserves if contracts are found and match the pair.
 */
export async function inspectAerodromePools({
  fetchImpl = globalThis.fetch,
  timeoutMs = 12000,
} = {}) {
  if (typeof fetchImpl !== "function") fail("NO_TRANSPORT", "Fetch is required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    fail("INVALID_TIMEOUT", "Timeout must be between 100 and 30000 milliseconds");
  }

  let nextId = 0;
  async function rpc(method, params) {
    if (!["eth_chainId", "eth_blockNumber", "eth_call", "eth_getCode"].includes(method)) {
      fail("FORBIDDEN_METHOD", "Only read-only RPC methods are enabled");
    }
    const id = ++nextId;
    const response = await fetchImpl(AERODROME_BASE.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response?.ok) fail("HTTP_ERROR", "Base RPC rejected the request");
    const json = await response.json();
    if (!json || json.jsonrpc !== "2.0" || json.id !== id || json.error ||
        typeof json.result !== "string") {
      fail("INVALID_RPC_RESULT", "Malformed JSON-RPC response");
    }
    return json.result;
  }
  const chain = toHexBlock(await rpc("eth_chainId", []));
  if (chain !== 8453n) fail("WRONG_CHAIN", "Expected Base Mainnet chain 8453");
  const block = toHexBlock(await rpc("eth_blockNumber", []));
  const blockTag = "0x" + block.toString(16);

  async function call(to, data) {
    return rpc("eth_call", [{ to, data }, blockTag]);
  }

  const results = {};
  for (const [agent, token] of Object.entries(THREECORE_BASE_TOKENS)) {
    const poolTypes = {};
    for (const stable of [false, true]) {
      const calldata = SELECTORS.getPool + word(token) + word(BASE_NATIVE_USDC) +
        (stable ? "1" : "0").padStart(64, "0");
      const poolAddress = decodeAddress(await call(AERODROME_BASE.poolFactory, calldata));
      if (poolAddress === ZERO_ADDRESS) {
        poolTypes[stable ? "stable" : "volatile"] = Object.freeze({
          poolAddress: null, contractCodePresent: false,
          tokenReserveBaseUnits: null, usdcReserveBaseUnits: null,
          reserveTimestamp: null,
        });
        continue;
      }

      const code = await rpc("eth_getCode", [poolAddress, blockTag]);
      if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) {
        fail("INVALID_RPC_RESULT", "Malformed pool bytecode");
      }
      if (code === "0x") {
        poolTypes[stable ? "stable" : "volatile"] = Object.freeze({
          poolAddress, contractCodePresent: false,
          tokenReserveBaseUnits: null, usdcReserveBaseUnits: null,
          reserveTimestamp: null,
        });
        continue;
      }
      const token0 = decodeAddress(await call(poolAddress, SELECTORS.token0));
      const token1 = decodeAddress(await call(poolAddress, SELECTORS.token1));
      if (new Set([token0, token1]).size !== 2 ||
          ![token0, token1].includes(token) ||
          ![token0, token1].includes(BASE_NATIVE_USDC)) {
        fail("POOL_TOKEN_MISMATCH", "Reported pool does not contain expected token and USDC");
      }
      const [reserve0, reserve1, timestamp] = decodeThreeWords(
        await call(poolAddress, SELECTORS.getReserves),
      );
      poolTypes[stable ? "stable" : "volatile"] = Object.freeze({
        poolAddress, contractCodePresent: true,
        tokenReserveBaseUnits: (token0 === token ? reserve0 : reserve1).toString(),
        usdcReserveBaseUnits: (token0 === BASE_NATIVE_USDC ? reserve0 : reserve1).toString(),
        reserveTimestamp: timestamp.toString(),
      });
    }
    results[agent] = Object.freeze(poolTypes);
  }

  return Object.freeze({
    chainId: 8453,
    checkedBlockNumber: block.toString(),
    factoryAddress: AERODROME_BASE.poolFactory,
    quoteTokenAddress: BASE_NATIVE_USDC,
    pools: Object.freeze(results),
    readOnly: true,
    classicFactoryOnly: true,
    walletConnected: false,
    transactionsExecuted: false,
    liquiditySafetyAudited: false,
  });
}
