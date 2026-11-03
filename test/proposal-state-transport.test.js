import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDemoServer } from '../examples/dev-server.js';
import { requestProposalStateReview } from '../src/proposal-state-client.js';
import { readProposalStateReview } from '../src/proposal-state-reader.js';
import { inspectProposalStateReviewFile, prepareProposalStateReview } from '../src/proposal-state-review.js';
import { stateFixture, stateRpcFixture } from './helpers/proposal-state-rpc-fixture.js';
async function serverFor(t, feeFetch) {
  const server = createDemoServer({ feeFetch }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  const origin = 'http://127.0.0.1:' + server.address().port;
  return { origin, fetchImpl: (url, options) => fetch(origin + url, { ...options, headers: { ...options.headers, origin } }) };
}
test('ordinary server and client return the exact plan, pinned fresh block and replayable result', async t => {
  const f = await stateFixture({ buy: true }), rpc = stateRpcFixture(f), server = await serverFor(t, rpc.fetchImpl);
  const text = await requestProposalStateReview(f.prepared.text, server), saved = await inspectProposalStateReviewFile(text);
  assert.equal(saved.files.simulationPlanFile, f.prepared.text); assert(saved.recordedResult.checksSatisfied); assert.equal(saved.recordedResult.observation.blockHash, rpc.hash);
  for (const path of ['/proposals/state/', '/examples/proposal-state-page.js', '/src/proposal-state-review.js', '/src/proposal-state-client.js']) assert.equal((await fetch(server.origin + path)).status, 200);
  assert.equal((await fetch(server.origin + '/src/proposal-state-reader.js')).status, 404);
});
test('new route rejects cross origin, bad body, alternate endpoint and oversized requests before RPC', async t => {
  let calls = 0; const { origin } = await serverFor(t, () => { calls++; throw Error(); });
  for (const [body, other, status] of [['{}', { origin: 'https://example.invalid' }, 403], ['{"simulationPlanFile":"{}","endpoint":"elsewhere"}', {}, 400], [Buffer.from([0xc3, 0x28]), {}, 400], ['x'.repeat(1048577), {}, 413]]) {
    const r = await fetch(origin + '/rpc/proposal-state', { method: 'POST', headers: { origin, 'content-type': 'application/json', ...other }, body }); assert.equal(r.status, status); await r.text();
  } assert.equal(calls, 0);
});
test('512 KiB source survives both HTTP envelopes without weakening the saved source binding', async t => {
  const f = await stateFixture(), rpc = stateRpcFixture(f), server = await serverFor(t, rpc.fetchImpl);
  const source = f.prepared.text + ' '.repeat(524288 - Buffer.byteLength(f.prepared.text));
  const text = await requestProposalStateReview(source, server); assert.equal((await inspectProposalStateReviewFile(text)).files.simulationPlanFile, source);
});
test('client rejects wrong-source, synthetic, malformed and extra-field server responses', async () => {
  const f = await stateFixture(), saved = (await readProposalStateReview(f.prepared.text, stateRpcFixture(f))).review, checked = await inspectProposalStateReviewFile(saved.text);
  const synthetic = await prepareProposalStateReview({ ...checked.files, observation: { ...checked.files.observation, environment: 'synthetic-test' } });
  for (const response of [Response.json({ reviewFile: synthetic.text }), Response.json({ reviewFile: saved.text, extra: 1 }), new Response('{'), new Response('{}', { status: 502 })]) await assert.rejects(requestProposalStateReview(f.prepared.text, { fetchImpl: async () => response }));
  await assert.rejects(requestProposalStateReview(f.prepared.text + '\n', { fetchImpl: async () => Response.json({ reviewFile: saved.text }) }));
});
test('cancel and deadline interrupt a noncooperating HTTP transport; precancel never calls it', async () => {
  const f = await stateFixture(), c = new AbortController(); c.abort(); let calls = 0;
  await assert.rejects(requestProposalStateReview(f.prepared.text, { signal: c.signal, fetchImpl: async () => { calls++; throw Error(); } })); assert.equal(calls, 0);
  let signal; await assert.rejects(requestProposalStateReview(f.prepared.text, { timeoutMs: 10, fetchImpl: (_url, o) => { signal = o.signal; return new Promise(() => {}); } })); assert(signal.aborted);
});
