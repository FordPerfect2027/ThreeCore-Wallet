import test from 'node:test';
import assert from 'node:assert/strict';
import { Element } from './helpers/panel-dom.js';
import { stateFixture, stateRpcFixture } from './helpers/proposal-state-rpc-fixture.js';
import { readProposalStateReview } from '../src/proposal-state-reader.js';
import { inspectProposalStateReviewFile } from '../src/proposal-state-review.js';
import { mountProposalStatePage } from '../examples/proposal-state-page.js';
const tick = () => new Promise(r => setImmediate(r));
async function until(fn) { const end = Date.now() + 5000; while (!fn()) { if (Date.now() > end) throw Error('WAIT_TIMEOUT'); await tick(); } }
function setup(options = {}) {
  const elements = new Map(), downloads = [], view = new EventTarget();
  const document = { defaultView: view, createElement: tag => new Element(tag), getElementById(id) { if (!elements.has(id)) elements.set(id, new Element('div')); return elements.get(id); } }, get = n => document.getElementById('state-' + n);
  get('result').hidden = true;
  const page = mountProposalStatePage(document, { ...options, download: r => { if (options.download) return options.download(r); downloads.push(r.prepared); } });
  const choose = (...texts) => { get('file').files = texts.map(text => { const bytes = new TextEncoder().encode(text); return { size: bytes.length, arrayBuffer: async () => bytes.buffer }; }); get('file').dispatchEvent(new Event('change')); };
  return { get, page, choose, downloads, view };
}
test('page imports a source without RPC, explicitly acquires, shows values and saves an exact replayable result', async () => {
  const f = await stateFixture({ buy: true }); let calls = 0;
  const ui = setup({ read: async (text, options) => { calls++; return (await readProposalStateReview(text, { ...stateRpcFixture(f), signal: options.signal })).review.text; } });
  ui.choose(f.prepared.text); await until(() => !ui.get('read').disabled); assert.equal(calls, 0); assert(ui.get('save').disabled);
  ui.get('read').click(); await until(() => !ui.get('save').disabled); assert.equal(calls, 1); assert.match(ui.get('outcome').textContent, /条件を満たし/); assert.match(ui.get('balances').textContent, /残高：10/);
  ui.get('save').click(); const record = await inspectProposalStateReviewFile(ui.downloads[0].text); assert.equal(record.files.simulationPlanFile, f.prepared.text); assert.equal(record.recordedResult.authorizesExecution, false); ui.page.dispose();
});
test('saved archive is replayed and reexported unchanged; new-time check shows expiry and preserves original bytes', async () => {
  const f = await stateFixture({ nowSeconds: Math.floor(Date.now() / 1000) - 1000 }), saved = (await readProposalStateReview(f.prepared.text, stateRpcFixture(f))).review, ui = setup();
  ui.choose(saved.text); await until(() => !ui.get('save').disabled); assert.match(ui.get('period').textContent, /保存時/);
  ui.get('save').click(); assert.equal(ui.downloads[0].text, saved.text);
  ui.get('check').click(); await until(() => !ui.get('save').disabled); assert.match(ui.get('period').textContent, /今回/); assert(ui.get('reasons').children.some(e => e.textContent.includes('有効期限')));
  ui.get('save').click(); assert.equal((await inspectProposalStateReviewFile(ui.downloads[1].text)).files.simulationPlanFile, f.prepared.text); ui.page.dispose();
});
test('late acquisition after cancel, source replacement, page navigation or disposal is ignored', async () => {
  const f = await stateFixture(), result = (await readProposalStateReview(f.prepared.text, stateRpcFixture(f))).review;
  for (const action of ['cancel', 'replacement', 'pagehide', 'dispose']) {
    let release, signal; const ui = setup({ read: (_text, o) => { signal = o.signal; return new Promise(resolve => { release = resolve; }); } });
    ui.choose(f.prepared.text); await until(() => !ui.get('read').disabled); ui.get('read').click(); await until(() => !!release);
    if (action === 'cancel') ui.get('cancel').click(); if (action === 'replacement') ui.choose('{'); if (action === 'pagehide') ui.view.dispatchEvent(new Event('pagehide')); if (action === 'dispose') ui.page.dispose();
    assert(signal.aborted); release(result.text); await tick(); assert(ui.get('save').disabled); assert(ui.get('result').hidden); ui.page.dispose();
  }
});
test('bad imports and failed acquisition/download do not advertise success or discard source for retry', async () => {
  const f = await stateFixture(), ui = setup({ read: async () => { throw Error(); }, download() { throw Error(); } });
  for (const inputs of [['{'], [f.prepared.text, f.prepared.text]]) { ui.choose(...inputs); await until(() => ui.get('status').textContent.startsWith('読み込めません')); assert(ui.get('read').disabled); }
  ui.choose(f.prepared.text); await until(() => !ui.get('read').disabled); ui.get('read').click(); await until(() => !ui.get('read').disabled); assert.match(ui.get('status').textContent, /保持/); assert(ui.get('save').disabled);
  const saved = (await readProposalStateReview(f.prepared.text, stateRpcFixture(f))).review;
  ui.choose(saved.text); await until(() => !ui.get('save').disabled); ui.get('save').click(); assert.match(ui.get('save-status').textContent, /保持/); ui.page.dispose();
});
