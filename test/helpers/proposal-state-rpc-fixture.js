import { feeReaderFixture } from './proposal-fee-rpc-fixture.js';
import { BASE_GAS_ORACLE, BASE_FEE_SELECTORS } from '../../src/base-fee-reader.js';
export { feeReaderFixture as stateFixture };
export function stateRpcFixture(f, modify = () => {}) {
  const calls = []; let headers = 0, chains = 0;
  const word = n => BigInt(n).toString(16).padStart(64, '0');
  const height = String(BigInt(f.request.blockNumber) + 1n), hash = '0x' + 'a'.repeat(64);
  return { calls, height, hash, fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body); calls.push(request); const { method, params } = request; let result;
    if (method === 'eth_chainId') { chains++; result = '0x2105'; }
    else if (method === 'eth_blockNumber') result = '0x' + BigInt(height).toString(16);
    else if (method === 'eth_getBlockByNumber') { headers++; const fresh = BigInt(params[0]) === BigInt(height); result = { number: params[0], hash: fresh ? hash : f.request.blockHash, timestamp: '0x' + BigInt(f.observation.blockTimestampSeconds + (fresh ? 1 : 0)).toString(16), baseFeePerGas: '0x1' }; }
    else if (method === 'eth_getCode') result = '0x6000';
    else if (method === 'eth_getBalance') result = '0x' + BigInt(f.observation.nativeBalanceBaseUnits).toString(16);
    else if (method === 'eth_maxPriorityFeePerGas') result = '0x1';
    else if (method === 'eth_estimateGas') result = '0x249f0';
    else if (method === 'eth_call' && params[0].to === BASE_GAS_ORACLE) result = '0x' + word(params[0].data.startsWith(BASE_FEE_SELECTORS.l1UpperBound) ? 1000 : 0);
    else if (method === 'eth_call' && params[0].data.startsWith('0x70a08231')) result = '0x' + word(f.observation.tokenBalanceBaseUnits);
    else if (method === 'eth_call' && params[0].data.startsWith('0xdd62ed3e')) result = '0x' + word(f.observation.allowanceBaseUnits);
    else if (method === 'eth_call') result = '0x' + [32, 2, f.quote.inputBaseUnits, f.quote.routerOutputBaseUnits].map(word).join('');
    else throw Error('Unexpected RPC');
    const response = { jsonrpc: '2.0', id: request.id, result }, c = { request, response, url, options, headers, chains, height, hash }; modify(c); return Response.json(c.response);
  } };
}
