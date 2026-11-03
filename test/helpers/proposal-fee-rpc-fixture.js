import { allowanceFixture } from './proposal-allowance-fixture.js';
import { prepareProposalAllowanceReview } from '../../src/proposal-allowance.js';
import { prepareProposalSimulationPlan } from '../../src/proposal-simulation-plan.js';
import { BASE_GAS_ORACLE, BASE_FEE_SELECTORS } from '../../src/base-fee-reader.js';
export async function feeReaderFixture(options = {}) {
  const f = await allowanceFixture({ nowSeconds: Math.floor(Date.now() / 1000), ...options }), a = await prepareProposalAllowanceReview(f.files, f.options), prepared = await prepareProposalSimulationPlan(a.text, f.options);
  return { ...f, prepared, quote: a.result.quoteReview.quote.quote };
}
export function feeRpcFixture(f, modify = () => {}) {
  const calls = []; let headers = 0, chains = 0;
  const word = n => BigInt(n).toString(16).padStart(64, '0');
  return { calls, fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body); calls.push(request); const { method, params } = request; let result;
    if (method === 'eth_chainId') { chains++; result = '0x2105'; }
    else if (method === 'eth_blockNumber') result = '0x' + BigInt(f.request.blockNumber).toString(16);
    else if (method === 'eth_getBlockByNumber') { headers++; result = { number: params[0], hash: f.request.blockHash, timestamp: '0x' + BigInt(f.observation.blockTimestampSeconds).toString(16), baseFeePerGas: '0x1' }; }
    else if (method === 'eth_getCode') result = '0x6000';
    else if (method === 'eth_maxPriorityFeePerGas') result = '0x1';
    else if (method === 'eth_estimateGas') result = '0x249f0';
    else if (method === 'eth_call' && params[0].to === BASE_GAS_ORACLE) result = '0x' + word(params[0].data.startsWith(BASE_FEE_SELECTORS.l1UpperBound) ? 1000 : 0);
    else if (method === 'eth_call') result = '0x' + [32, 2, f.quote.inputBaseUnits, f.quote.routerOutputBaseUnits].map(word).join('');
    else throw Error('Unexpected RPC method');
    const response = { jsonrpc: '2.0', id: request.id, result };
    const context = { response, request, headers, chains, url, options }; modify(context);
    return Response.json(context.response);
  } };
}
