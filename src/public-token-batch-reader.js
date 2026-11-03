import { captureOptionalDataFields } from "./security-data.js";
import { subscribeReadAbort } from "./security-abort.js";
import { createPublicBaseRpcReader } from "./public-base-rpc.js";
import { catalogToken } from "./token-catalog.js";
import { identityAddress, identityUnits, METADATA_FIELDS, decodeMetadataField, decodeMetadataWord } from "./token-identity-codec.js";
import { PUBLIC_TOKEN_BATCH_SCHEMA, PUBLIC_TOKEN_ENDPOINTS, validatePublicTokenBatch, failPublicTokenBatch as fail } from "./public-token-batch-model.js";

/** One fixed public endpoint, one account, one canonical hash. Never uses a wallet transport. */
export async function readPublicTokenBatch(input = {}) {
  let options;
  try { options = captureOptionalDataFields(input, ["chainId", "account", "blockNumber", "fetchImpl", "signal", "timeoutMs", "requestTimeoutMs"]); }
  catch { fail("BATCH_OPTIONS"); }
  const { chainId, blockNumber, fetchImpl = globalThis.fetch, signal, timeoutMs = 120000, requestTimeoutMs = 10000 } = options;
  if (![8453, 84532].includes(chainId)) fail("BATCH_NETWORK");
  const account = identityAddress(options.account);
  if (blockNumber !== undefined) identityUnits(blockNumber);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) fail("BATCH_TIMEOUT_OPTION");
  const controller = new AbortController(); let timer, timedOut = false, cancellation;
  function guard() { if (controller.signal.aborted) fail(timedOut ? "BATCH_TIMEOUT" : "BATCH_CANCELLED"); }
  try {
    try { cancellation = subscribeReadAbort(signal, () => controller.abort()); }
    catch { fail("BATCH_SIGNAL"); }
    guard();
    const rpcUrl = PUBLIC_TOKEN_ENDPOINTS[chainId];
    const transport = createPublicBaseRpcReader({ rpcUrl, fetchImpl, signal: controller.signal, timeoutMs: requestTimeoutMs });
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const read = async (method, params = []) => { guard(); const value = await transport(method, params); guard(); return value; };
    if (BigInt(await read("eth_chainId")) !== BigInt(chainId)) fail("BATCH_NETWORK_MISMATCH");
    const height = blockNumber === undefined ? await read("eth_blockNumber") : "0x" + BigInt(blockNumber).toString(16);
    const block = await read("eth_getBlockByNumber", [height, false]);
    const selector = Object.freeze({ blockHash: block.hash, requireCanonical: true });
    const nativeBalanceBaseUnits = BigInt(await read("eth_getBalance", [account, selector])).toString();
    const tokens = [];
    for (const agent of ["DAT", "EMA", "CAWELON"]) {
      const tokenAddress = catalogToken({ agent, chainId }).address;
      const code = await read("eth_getCode", [tokenAddress, selector]);
      const hasCode = code !== "0x"; let metadata = null, balanceBaseUnits = null;
      if (hasCode) {
        metadata = {};
        for (const [field, data] of Object.entries(METADATA_FIELDS))
          metadata[field] = decodeMetadataField(field, await read("eth_call", [{ to: tokenAddress, data }, selector]));
        balanceBaseUnits = decodeMetadataWord(await read("eth_call", [
          { to: tokenAddress, data: "0x70a08231" + account.slice(2).padStart(64, "0") }, selector])).toString();
      }
      tokens.push({ agent, tokenAddress, hasCode, metadata, balanceBaseUnits });
    }
    const finalBlock = await read("eth_getBlockByNumber", [block.number, false]);
    if (finalBlock.hash !== block.hash || finalBlock.number !== block.number) fail("BATCH_BLOCK_CHANGED");
    const result = validatePublicTokenBatch({ schema: PUBLIC_TOKEN_BATCH_SCHEMA, chainId, rpcUrl, account,
      blockNumber: BigInt(block.number).toString(), blockHash: block.hash, nativeBalanceBaseUnits, tokens,
      readOnly: true, walletConnected: false, canonicalBlockRechecked: true, securityAudit: false });
    guard(); return result;
  } catch (error) { guard(); throw error; }
  finally { clearTimeout(timer); cancellation?.dispose(); controller.abort(); }
}
