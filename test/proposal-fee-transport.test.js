import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDemoServer } from '../examples/dev-server.js';
import { requestProposalFeeReview } from '../src/proposal-fee-client.js';
import { readProposalFeeReview } from '../src/proposal-fee-reader.js';
import { prepareProposalFeeReview, inspectProposalFeeReviewFile } from '../src/proposal-fee-review.js';
import { validateProposalFeeReadRequest, PROPOSAL_FEE_READ_LIMIT } from '../src/proposal-fee-request.js';
import { feeReaderFixture, feeRpcFixture } from './helpers/proposal-fee-rpc-fixture.js';

async function serverFor(t, feeFetch) {
  const server = createDemoServer({ feeFetch }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = 'http://127.0.0.1:' + server.address().port;
  return { origin, post: (body, options = {}) => fetch(origin + '/rpc/proposal-fees', { method: 'POST', headers: { origin, 'content-type': 'application/json', ...options.headers }, body, signal: options.signal }) };
}

test('browser client and ordinary HTTP server round trip preserve exact source and offline-replayable result', async t => {
  const f = await feeReaderFixture(), rpc = feeRpcFixture(f), { origin } = await serverFor(t, rpc.fetchImpl);
  const text = await requestProposalFeeReview(f.prepared.text, { fetchImpl: (url, options) => {
    assert.equal(url, '/rpc/proposal-fees'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return fetch(origin + url, { ...options, headers: { ...options.headers, origin } });
  } });
  const decoded = await inspectProposalFeeReviewFile(text);
  assert.equal(decoded.files.simulationPlanFile, f.prepared.text); assert.equal(decoded.recordedResult.checksSatisfied, true);
  assert.equal(decoded.recordedResult.environment, 'public-rpc'); assert.equal(decoded.recordedResult.authorizesExecution, false);
  assert(rpc.calls.some(c => c.method === 'eth_estimateGas'));
  for (const path of ['/proposals/fees/', '/src/proposal-fee-client.js', '/src/proposal-fee-request.js']) {
    const response = await fetch(origin + path); assert.equal(response.status, 200); await response.text();
  }
});

test('HTTP rejects cross-origin, extra fields, malformed UTF-8 and oversized requests before public RPC', async t => {
  let calls = 0; const { post } = await serverFor(t, () => { calls++; throw Error(); });
  for (const [body, options, status] of [
    ['{}', { headers: { origin: 'https://unrelated.invalid' } }, 403],
    ['{}', { headers: { 'content-type': 'text/plain' } }, 403],
    [JSON.stringify({ simulationPlanFile: '{}', rpcUrl: 'https://unrelated.invalid' }), {}, 400],
    [Buffer.from([0xc3, 0x28]), {}, 400],
    [JSON.stringify({ simulationPlanFile: 'x'.repeat(PROPOSAL_FEE_READ_LIMIT + 1) }), {}, 400],
    ['x'.repeat(1048577), {}, 413],
    ['{"simulationPlanFile":"{}","simulationPlanFile":"{}"}', {}, 400],
  ]) { const r = await post(body, options); assert.equal(r.status, status); await r.text(); }
  assert.equal(calls, 0);
});

test('a valid source at the 512 KiB input boundary survives both JSON envelopes with exact bytes', async t => {
  const f = await feeReaderFixture(), rpc = feeRpcFixture(f), { origin } = await serverFor(t, rpc.fetchImpl);
  const source = f.prepared.text + ' '.repeat(PROPOSAL_FEE_READ_LIMIT - Buffer.byteLength(f.prepared.text));
  const text = await requestProposalFeeReview(source, { fetchImpl: (url, options) => fetch(origin + url, { ...options, headers: { ...options.headers, origin } }) });
  assert.equal((await inspectProposalFeeReviewFile(text)).files.simulationPlanFile, source);
});

test('HTTP capacity is bounded and cancelling requests releases both public reads and capacity', async t => {
  const f = await feeReaderFixture(), signals = []; let wait = true;
  const rpc = feeRpcFixture(f), { post } = await serverFor(t, (url, options) => { if (!wait) return rpc.fetchImpl(url, options); signals.push(options.signal); return new Promise(() => {}); });
  const body = JSON.stringify({ simulationPlanFile: f.prepared.text }), controllers = [new AbortController(), new AbortController()];
  const requests = controllers.map(c => post(body, { signal: c.signal }).then(r => r.text(), () => null));
  const deadline = Date.now() + 5000;
  while (signals.length < 2) { if (Date.now() > deadline) throw Error('SERVER_WAIT'); await new Promise(r => setTimeout(r, 5)); }
  const busy = await post(body); assert.equal(busy.status, 429); await busy.text();
  controllers.forEach(c => c.abort()); await Promise.all(requests);
  while (signals.some(s => !s.aborted)) { if (Date.now() > deadline) throw Error('ABORT_WAIT'); await new Promise(r => setTimeout(r, 5)); }
  wait = false; const again = await post(body); assert.equal(again.status, 200); await again.text();
});

test('client rejects another source, synthetic response, extra envelope fields, malformed and oversized replies', async () => {
  const f = await feeReaderFixture(), other = await feeReaderFixture({ agent: 'EMA', buy: true });
  const valid = await readProposalFeeReview(f.prepared.text, { fetchImpl: feeRpcFixture(f).fetchImpl });
  const otherReply = await readProposalFeeReview(other.prepared.text, { fetchImpl: feeRpcFixture(other).fetchImpl });
  const decoded = await inspectProposalFeeReviewFile(valid.review.text);
  const synthetic = await prepareProposalFeeReview({ ...decoded.files, observation: { ...decoded.files.observation, environment: 'synthetic-test' } });
  for (const response of [Response.json({ reviewFile: otherReply.review.text }), Response.json({ reviewFile: synthetic.text }), Response.json({ reviewFile: valid.review.text, extra: true }), new Response('{'), new Response('{}', { status: 502 }), new Response('{}', { headers: { 'content-length': '3000000' } })]) {
    await assert.rejects(requestProposalFeeReview(f.prepared.text, { fetchImpl: async () => response }));
  }
});

test('client input validation, pre-cancellation and deadlines prevent or interrupt transport', async () => {
  let calls = 0; const fetchImpl = () => { calls++; throw Error(); };
  assert.throws(() => validateProposalFeeReadRequest({ simulationPlanFile: '{}', method: 'eth_sendTransaction' }));
  for (const text of [null, 'x'.repeat(PROPOSAL_FEE_READ_LIMIT + 1)]) await assert.rejects(requestProposalFeeReview(text, { fetchImpl }));
  const c = new AbortController(); c.abort(); await assert.rejects(requestProposalFeeReview('{}', { fetchImpl, signal: c.signal })); assert.equal(calls, 0);
  for (const body of [false, true]) for (const cancel of [false, true]) {
    const controller = new AbortController(); let signal;
    const promise = requestProposalFeeReview('{}', { timeoutMs: cancel ? 1000 : 10, signal: controller.signal, fetchImpl: async (_url, options) => { signal = options.signal; return body ? new Response(new ReadableStream({ start() {} })) : new Promise(() => {}); } });
    const rejected = assert.rejects(promise); if (cancel) controller.abort(); await rejected; assert.equal(signal.aborted, true);
  }
});
