#!/usr/bin/env node
/** Explicit public testnet reads only. No wallet, secrets, mainnet or deployment. */
import { pathToFileURL } from "node:url";
import { TOKEN_CATALOG, TOKEN_CATALOG_VERSION } from "../src/token-catalog.js";
import { decodeMetadataField, METADATA_FIELDS } from "../src/token-identity-codec.js";
import { parseSecurityJson } from "../src/security-json.js";
import { consumeCallback } from "../src/security-callback.js";

const ENDPOINT = "https://sepolia.base.org";
const codes = new WeakMap();
class ProbeError extends Error { constructor(code) { super(code); this.code = code; codes.set(this, code); } }
const fail = code => { throw new ProbeError(code); };
const quantity = value => typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value);
function header(value) {
  if (!value || !quantity(value.number) || !/^0x[0-9a-fA-F]{64}$/.test(value.hash ?? "")) fail("INVALID_BLOCK");
  return { number: "0x" + BigInt(value.number).toString(16), hash: value.hash.toLowerCase() };
}

export async function probeTestnetCatalog({ fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (typeof fetchImpl !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail("INVALID_PROBE_CONFIG");
  let count = 0;
  async function rpc(method, params = []) {
    const id = ++count, abort = new AbortController();
    let timer, response, reader, expired = false;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
      expired = true; abort.abort(); reject(new ProbeError("RPC_TIMEOUT"));
    }, timeoutMs); });
    const bounded = work => Promise.race([work, deadline]);
    try {
      response = await bounded(Promise.resolve().then(() => fetchImpl(ENDPOINT, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: abort.signal,
      })).then(value => {
        if (expired) { consumeCallback(() => value?.body?.cancel()); fail("RPC_TIMEOUT"); }
        response = value; return value;
      }));
      if (!response?.ok || response.redirected) fail("RPC_HTTP_ERROR");
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) fail("RPC_CONTENT_TYPE");
      reader = response.body?.getReader(); if (!reader) fail("RPC_BODY_MISSING");
      const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
      while (true) {
        const part = await bounded(reader.read()); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > 131072) fail("RPC_RESPONSE_TOO_LARGE");
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
      const value = parseSecurityJson(text, { bytes: 131072, depth: 8, nodes: 2048, stringCharacters: 100000 });
      if (!value || value.jsonrpc !== "2.0" || value.id !== id || Object.hasOwn(value, "error") || !Object.hasOwn(value, "result")) fail("RPC_RESPONSE_INVALID");
      return value.result;
    } catch (error) { throw new ProbeError(codes.get(error) ?? "RPC_FAILED"); }
    finally { clearTimeout(timer); abort.abort(); consumeCallback(() => reader ? reader.cancel() : response?.body?.cancel()); }
  }
  try {
    if (await rpc("eth_chainId") !== "0x14a34") fail("CHAIN_MISMATCH");
    const block = header(await rpc("eth_getBlockByNumber", ["latest", false]));
    const at = { blockHash: block.hash, requireCanonical: true }, results = [];
    for (const token of TOKEN_CATALOG.filter(row => row.chainId === 84532)) {
      const code = await rpc("eth_getCode", [token.address, at]);
      if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) fail("CATALOG_CODE_MISSING_OR_INVALID");
      const metadata = {};
      for (const field of ["name", "symbol", "decimals", "totalSupply"]) {
        metadata[field] = decodeMetadataField(field, await rpc("eth_call", [{ to: token.address, data: METADATA_FIELDS[field] }, at]));
      }
      if (metadata.name !== token.name || metadata.symbol !== token.symbol || metadata.decimals !== token.decimals) fail("CATALOG_METADATA_MISMATCH");
      results.push({ agent: token.agent, address: token.address, metadata, initialSupply: token.initialSupply,
        supplyMatchesInitialReference: metadata.totalSupply === token.initialSupply });
    }
    const final = header(await rpc("eth_getBlockByNumber", [block.number, false]));
    if (final.number !== block.number || final.hash !== block.hash) fail("BLOCK_CHANGED");
    if (await rpc("eth_chainId") !== "0x14a34") fail("CHAIN_MISMATCH");
    return { schema: "threecore-public-testnet-catalog-probe-v1", catalogVersion: TOKEN_CATALOG_VERSION,
      checkedAt: new Date().toISOString(), endpoint: ENDPOINT, chainId: 84532,
      blockNumber: BigInt(block.number).toString(), blockHash: block.hash, results, requests: count,
      readOnly: true, walletConnected: false, securityAudit: false, transactionsExecuted: 0 };
  } catch (error) { throw new ProbeError(codes.get(error) ?? "CATALOG_PROBE_FAILED"); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== "--public") {
    console.error("Usage: node scripts/probe-testnet-catalog.js --public (19 read-only Base Sepolia RPC calls)"); process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await probeTestnetCatalog(), null, 2)); }
    catch (error) { console.error(codes.get(error) ?? "CATALOG_PROBE_FAILED"); process.exitCode = 1; }
  }
}
