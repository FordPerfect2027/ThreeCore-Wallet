// Test-process preload: every outbound fetch is replaced, never forwarded.
import { AERODROME_BASE, THREECORE_BASE_TOKENS } from "../../src/aerodrome-readonly.js";
import { BASE_NATIVE_USDC } from "../../src/aerodrome-pools.js";
const scenario = process.env.THREECORE_TEST_RPC_CASE;
const pool = "0x" + "a".repeat(40);
const word = value => BigInt(value).toString(16).padStart(64, "0");
const address = value => "0x" + value.slice(2).padStart(64, "0");
globalThis.fetch = async (url, options) => {
  if (scenario === "no-network") {
    process.stderr.write("UNEXPECTED_NETWORK_CALL\n");
    throw new Error("RPC must not run");
  }
  if (scenario === "transport-failure") throw new Error("PRIVATE_PROVIDER_DETAIL");
  if (![AERODROME_BASE.rpcUrl, "https://sepolia.base.org"].includes(url))
    throw new Error("Unexpected diagnostic endpoint");
  const { method, id, params } = JSON.parse(options.body);
  if (options.credentials !== "omit" || options.redirect !== "error")
    throw new Error("Unexpected transport settings");
  let result;
  if (method === "eth_chainId") result = url.includes("sepolia") ? "0x14a34" : "0x2105";
  else if (method === "eth_blockNumber") result = "0x1234";
  else if (method === "eth_getCode") result = "0x6000";
  else if (method === "eth_call") {
    if (params[1] !== "0x1234") throw new Error("Unpinned read");
    const { to, data } = params[0];
    if (to === AERODROME_BASE.poolFactory) {
      const token = "0x" + data.slice(34, 74);
      const volatile = data.slice(-1) === "0";
      result = scenario === "funded" && token === THREECORE_BASE_TOKENS.DAT && volatile ?
        address(pool) : "0x" + "0".repeat(64);
    } else if (to === pool) {
      if (data === "0x0dfe1681") result = address(BASE_NATIVE_USDC);
      else if (data === "0xd21220a7") result = address(THREECORE_BASE_TOKENS.DAT);
      else if (data === "0x0902f1ac") result = "0x" + word(100000000) + word(200) + word(1);
      else throw new Error("Unexpected pool selector");
    } else if (Object.values(THREECORE_BASE_TOKENS).includes(to)) {
      if (data.startsWith("0x70a08231")) result = "0x" + word(100);
      else if (data.startsWith("0xdd62ed3e")) result = "0x" + word(0);
      else throw new Error("Unexpected token selector");
    } else throw new Error("Unexpected contract");
  } else throw new Error("Non-read method");
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
};
