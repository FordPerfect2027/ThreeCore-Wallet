import { captureDataRecord, captureOptionalDataFields } from './security-data.js';
import { subscribeReadAbort } from './security-abort.js';
import { fetchStateRpcResponse, readStateRpcJson } from './state-rpc-http.js';
import { quoteUnits, quoteTime } from './aerodrome-quote-model.js';

export const BASE_FEE_RPC = 'https://mainnet.base.org';
export const BASE_GAS_ORACLE = '0x420000000000000000000000000000000000000f';
export const BASE_FEE_SELECTORS = Object.freeze({ l1UpperBound: '0xf1c7a58b', operator: '0x275aedd2' });
export class BaseFeeReadError extends Error { constructor(code, details) { super(code); this.name = 'BaseFeeReadError'; this.code = code; this.details = details; } }
export const failBaseFee = (code, details) => { throw new BaseFeeReadError(code, details); };
const fail = failBaseFee, quantity = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/, blockHash = /^0x[0-9a-f]{64}$/;
export const feeHex = value => '0x' + BigInt(value).toString(16);
export function feeQuantity(value) { if (typeof value !== 'string' || !quantity.test(value)) fail('FEE_RPC_QUANTITY'); return BigInt(value).toString(); }
export function feeWord(value) { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail('FEE_RPC_WORD'); return BigInt(value).toString(); }

/** Fixed endpoint, bounded read-only transport. The callback is internal application code. */
export async function withBaseFeeReads(options, work) {
  let s; try { s = captureOptionalDataFields(options, ['fetchImpl', 'signal', 'timeoutMs', 'requestTimeoutMs']); } catch { fail('FEE_READ_OPTIONS'); }
  const timeout = s.timeoutMs ?? 120000, requestTimeout = s.requestTimeoutMs ?? 10000;
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120000 || !Number.isInteger(requestTimeout) || requestTimeout < 100 || requestTimeout > 30000) fail('FEE_READ_TIMEOUT_OPTION');
  const controller = new AbortController(); let subscription, timer, timedOut = false, id = 0;
  const guard = () => { if (controller.signal.aborted) fail(timedOut ? 'FEE_READ_TIMEOUT' : 'FEE_READ_CANCELLED'); };
  try {
    subscription = subscribeReadAbort(s.signal, () => controller.abort()); guard();
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    const read = async (method, params = []) => {
      guard();
      if (!['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getBalance', 'eth_call', 'eth_estimateGas', 'eth_maxPriorityFeePerGas'].includes(method)) fail('FEE_METHOD_BLOCKED');
      const local = new AbortController(), sub = subscribeReadAbort(controller.signal, () => local.abort()), requestId = ++id;
      let expired = false; const deadline = setTimeout(() => { expired = true; local.abort(); }, requestTimeout);
      try {
        const response = await fetchStateRpcResponse(s.fetchImpl ?? globalThis.fetch, BASE_FEE_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: local.signal });
        const json = await readStateRpcJson(response, { signal: local.signal }); guard();
        if (!json || json.jsonrpc !== '2.0' || json.id !== requestId || Object.hasOwn(json, 'result') === Object.hasOwn(json, 'error')) fail('FEE_RPC_RESPONSE');
        if (Object.hasOwn(json, 'error')) fail('FEE_RPC_REJECTED', { method, rpcCode: Number.isSafeInteger(json.error?.code) ? json.error.code : null });
        return json.result;
      } catch (error) { guard(); if (expired) fail('FEE_REQUEST_TIMEOUT'); throw error; }
      finally { clearTimeout(deadline); sub.dispose(); local.abort(); }
    };
    const value = await work(read, guard); guard(); return value;
  } finally { clearTimeout(timer); subscription?.dispose(); controller.abort(); }
}

export async function readFeeHeader(read, height, expectedHash) {
  const raw = await read('eth_getBlockByNumber', [feeHex(height), false]);
  if (!raw || feeQuantity(raw.number) !== height || typeof raw.hash !== 'string' || !blockHash.test(raw.hash) || (expectedHash !== undefined && raw.hash !== expectedHash)) fail('FEE_BLOCK_CHANGED');
  const timestampSeconds = quoteTime(Number(feeQuantity(raw.timestamp)));
  return Object.freeze({ number: height, hash: raw.hash, timestampSeconds, baseFeePerGasWei: feeQuantity(raw.baseFeePerGas) });
}

export function validateFeeBoundsRequest(input) {
  let r; try { r = captureDataRecord(input, ['blockNumber', 'blockHash', 'unsignedTransactionBytes', 'gasLimit']); } catch { fail('FEE_BOUNDS_REQUEST'); }
  if (r.blockNumber !== null) quoteUnits(r.blockNumber);
  if (r.blockHash !== null && (typeof r.blockHash !== 'string' || !blockHash.test(r.blockHash))) fail('FEE_BOUNDS_HASH');
  if (r.blockNumber === null && r.blockHash !== null) fail('FEE_BOUNDS_HASH');
  if (!Number.isSafeInteger(r.unsignedTransactionBytes) || r.unsignedTransactionBytes < 1 || r.unsignedTransactionBytes > 16384) fail('FEE_BOUNDS_SIZE');
  quoteUnits(r.gasLimit); if (BigInt(r.gasLimit) < 21000n || BigInt(r.gasLimit) > 30000000n) fail('FEE_BOUNDS_GAS');
  return r;
}

export async function readFeeBoundsAtBlock(read, request, header) {
  const selector = { blockHash: header.hash, requireCanonical: true };
  const code = await read('eth_getCode', [BASE_GAS_ORACLE, selector]);
  if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){1,32768}$/.test(code)) fail('FEE_ORACLE_CODE');
  const failures = [];
  const call = async (name, value) => {
    try { return feeWord(await read('eth_call', [{ to: BASE_GAS_ORACLE, data: BASE_FEE_SELECTORS[name] + BigInt(value).toString(16).padStart(64, '0') }, selector])); }
    catch (error) { if (!(error instanceof BaseFeeReadError) || error.code !== 'FEE_RPC_REJECTED') throw error; failures.push(name === 'l1UpperBound' ? 'FEE_L1_UNAVAILABLE' : 'FEE_OPERATOR_UNAVAILABLE'); return null; }
  };
  const l1FeeUpperBoundWei = await call('l1UpperBound', request.unsignedTransactionBytes), operatorFeeUpperBoundWei = await call('operator', request.gasLimit);
  return Object.freeze({ l1FeeUpperBoundWei, operatorFeeUpperBoundWei, failures: Object.freeze(failures) });
}

/** A generic size/gas fee calculation, not evidence that any swap can execute. */
export async function readBaseFeeBounds(input, options = {}) {
  const request = validateFeeBoundsRequest(input);
  return withBaseFeeReads(options, async (read) => {
    if (feeQuantity(await read('eth_chainId')) !== '8453') fail('FEE_NETWORK');
    const height = request.blockNumber ?? feeQuantity(await read('eth_blockNumber')), header = await readFeeHeader(read, height, request.blockHash ?? undefined);
    const bounds = await readFeeBoundsAtBlock(read, request, header), final = await readFeeHeader(read, height, header.hash);
    if (JSON.stringify(final) !== JSON.stringify(header)) fail('FEE_BLOCK_CHANGED');
    if (feeQuantity(await read('eth_chainId')) !== '8453') fail('FEE_NETWORK_CHANGED');
    return Object.freeze({ schema: 'threecore.base-fee-bounds.v1', chainId: 8453, rpcUrl: BASE_FEE_RPC, oracleAddress: BASE_GAS_ORACLE,
      blockNumber: height, blockHash: header.hash, blockTimestampSeconds: header.timestampSeconds, observedAtSeconds: Math.floor(Date.now() / 1000),
      baseFeePerGasWei: header.baseFeePerGasWei, unsignedTransactionBytes: request.unsignedTransactionBytes, gasLimit: request.gasLimit, ...bounds,
      canonicalBlockRechecked: true, transactionSimulated: false, boundMethod: 'GasPriceOracle practical upper-bound estimate at this block', readOnly: true, walletConnected: false });
  });
}
