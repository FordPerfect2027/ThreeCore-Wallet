import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Element } from './helpers/panel-dom.js';
import { allowanceFixture } from './helpers/proposal-allowance-fixture.js';
import { prepareProposalAllowanceReview } from '../src/proposal-allowance.js';
import { prepareProposalSimulationPlan } from '../src/proposal-simulation-plan.js';
import { PROPOSAL_FEE_SCHEMA, prepareProposalFeeReview, inspectProposalFeeReviewFile } from '../src/proposal-fee-review.js';
import { mountProposalFeePage } from '../examples/proposal-fee-page.js';
const tick = () => new Promise(r => setImmediate(r));
async function until(fn) { const end = Date.now() + 5000; while (!fn()) { if (Date.now() > end) throw Error('WAIT_TIMEOUT'); await tick(); } }
async function fixture(old = false, unknown = false) {
  const f = await allowanceFixture({ nowSeconds: Math.floor(Date.now() / 1000) - (old ? 1000 : 0) }), a = await prepareProposalAllowanceReview(f.files, f.options), p = await prepareProposalSimulationPlan(a.text, f.options);
  const files = { simulationPlanFile: p.text, observation: { schema: PROPOSAL_FEE_SCHEMA, planSha256: createHash('sha256').update(p.text).digest('hex'), environment: 'synthetic-test', chainId: 8453, blockNumber: p.plan.call.blockNumber, blockHash: p.plan.call.blockHash, observedAtSeconds: p.plan.evaluatedAtSeconds, estimatedGas: '100000', baseFeePerGasWei: '1', priorityFeePerGasWei: '0', l1FeeUpperBoundWei: unknown ? null : '0', operatorFeeUpperBoundWei: '0', readOnly: true } };
  return { files, saved: await prepareProposalFeeReview(files, { nowSeconds: p.plan.evaluatedAtSeconds }) };
}
function setup(options = {}) {
  const elements = new Map(), downloads = [], view = new EventTarget();
  const document = { defaultView: view, createElement: tag => new Element(tag), getElementById(id) { if (!elements.has(id)) elements.set(id, new Element('div')); return elements.get(id); } }, get = name => document.getElementById('fee-' + name);
  get('age').value = '60'; get('result').hidden = true;
  const page = mountProposalFeePage(document, { ...options, download: r => { if (options.download) options.download(r, get); else downloads.push(r.prepared); } });
  const choose = (...texts) => { get('files').files = texts.map(text => { const bytes = new TextEncoder().encode(text); return { size: bytes.length, arrayBuffer: async () => bytes.buffer }; }); get('files').dispatchEvent(new Event('change')); };
  return { get, page, choose, downloads, view };
}
test('recorded results remain distinct from current expiry and reexport preserves the complete original', async () => {
  const f = await fixture(true), ui = setup(); ui.choose(f.saved.text); await until(() => !ui.get('save').disabled);
  assert.match(ui.get('period').textContent, /保存時/); assert.match(ui.get('outcome').textContent, /範囲内/); assert.match(ui.get('environment').textContent, /模擬データ/);
  ui.get('save').click(); assert.equal(ui.downloads[0].text, f.saved.text);
  ui.get('check').click(); await until(() => !ui.get('save').disabled); assert.match(ui.get('period').textContent, /現在/); assert.match(ui.get('outcome').textContent, /問題/);
  ui.get('save').click(); const rechecked = await inspectProposalFeeReviewFile(ui.downloads[1].text); assert.deepEqual(rechecked.files, f.files); assert(rechecked.recordedResult.reasons.includes('FEE_PLAN_BLOCKED'));
  ui.get('age').value = '59'; ui.get('save').click(); assert(ui.get('save').disabled); assert.equal(ui.downloads.length, 2); ui.page.dispose();
});
test('two-file import accepts either order, shows unknown totals and rejects duplicates or malformed files', async () => {
  const f = await fixture(false, true), ui = setup();
  for (const pair of [[f.files.simulationPlanFile, JSON.stringify(f.files.observation)], [JSON.stringify(f.files.observation), f.files.simulationPlanFile]]) {
    ui.choose(...pair); await until(() => !ui.get('check').disabled); assert(ui.get('save').disabled); ui.get('check').click(); await until(() => !ui.get('save').disabled);
    assert.match(ui.get('total').textContent, /未確認/); assert.match(ui.get('extra').textContent, /未確認/); assert(ui.get('reasons').children.some(e => e.textContent.includes('L1')));
  }
  for (const files of [[f.saved.text, f.saved.text], ['{'], [f.saved.text, f.saved.text, f.saved.text]]) {
    ui.choose(...files); await until(() => ui.get('status').textContent.startsWith('読み込めません')); assert(ui.get('save').disabled); assert(ui.get('check').disabled);
  }
  ui.page.dispose();
});
test('cancel, edit, replacement, navigation and disposal suppress delayed results', async () => {
  const f = await fixture();
  for (const action of ['cancel', 'edit', 'replacement', 'pagehide', 'dispose']) {
    let release, signal; const ui = setup({ prepare: (_files, s) => { signal = s.signal; return new Promise(r => { release = r; }); } });
    ui.choose(f.saved.text); await until(() => !ui.get('check').disabled); ui.get('check').click(); await until(() => !!release);
    if (action === 'cancel') ui.get('cancel').click(); if (action === 'edit') ui.get('age').dispatchEvent(new Event('input'));
    if (action === 'replacement') ui.choose('{'); if (action === 'pagehide') ui.view.dispatchEvent(new Event('pagehide')); if (action === 'dispose') ui.page.dispose();
    assert.equal(signal.aborted, true); release(f.saved); await tick(); assert(ui.get('save').disabled); assert(ui.get('result').hidden); ui.page.dispose();
  }
});
test('invalid age, failed comparison and failed download cannot advertise an unsaved or stale success', async () => {
  const f = await fixture(), ui = setup({ prepare: async () => { throw Error(); }, download() { throw Error(); } });
  ui.choose(f.saved.text); await until(() => !ui.get('save').disabled); ui.get('save').click(); assert.match(ui.get('save-status').textContent, /保持/);
  for (const age of ['', '0', '601', '1.5']) { ui.get('age').value = age; ui.get('check').click(); assert(ui.get('save').disabled); assert.match(ui.get('status').textContent, /1〜600/); }
  ui.get('age').value = '60'; ui.get('check').click(); await until(() => !ui.get('check').disabled); assert(ui.get('save').disabled); assert.match(ui.get('status').textContent, /再試行/); ui.page.dispose();
});

test('one-plan import reads only on explicit click, preserves source and saves a replayable acquired review', async () => {
  const f = await fixture(); let calls = 0;
  const publicRecord = await prepareProposalFeeReview({ ...f.files, observation: { ...f.files.observation, environment: 'public-rpc' } });
  const ui = setup({ read: async (text, options) => { calls++; assert.equal(text, f.files.simulationPlanFile); assert.equal(options.signal.aborted, false); return publicRecord.text; } });
  ui.choose(f.files.simulationPlanFile); await until(() => !ui.get('read').disabled);
  assert.equal(calls, 0); assert(ui.get('check').disabled); assert(ui.get('save').disabled);
  ui.get('read').click(); await until(() => !ui.get('save').disabled); assert.equal(calls, 1);
  ui.get('save').click(); const saved = await inspectProposalFeeReviewFile(ui.downloads[0].text);
  assert.equal(saved.files.simulationPlanFile, f.files.simulationPlanFile); assert.equal(saved.recordedResult.environment, 'public-rpc');
  assert.equal(saved.recordedResult.authorizesExecution, false); ui.page.dispose();
});

test('failed or wrong-context acquisition retains input; cancelling or replacing rejects delayed acquired results', async () => {
  const f = await fixture();
  for (const reply of [null, f.saved.text]) {
    const ui = setup({ read: async () => { if (reply === null) throw Error(); return reply; } });
    ui.choose(f.files.simulationPlanFile); await until(() => !ui.get('read').disabled); ui.get('read').click();
    await until(() => !ui.get('read').disabled); assert.match(ui.get('status').textContent, /資料は保持/); assert(ui.get('save').disabled); assert(ui.get('check').disabled); ui.page.dispose();
  }
  for (const action of ['cancel', 'replacement', 'edit', 'pagehide', 'dispose']) {
    let release, signal; const ui = setup({ read: (_text, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); } });
    ui.choose(f.files.simulationPlanFile); await until(() => !ui.get('read').disabled); ui.get('read').click(); await until(() => !!release);
    if (action === 'cancel') ui.get('cancel').click(); if (action === 'replacement') ui.choose('{'); if (action === 'edit') ui.get('age').dispatchEvent(new Event('input'));
    if (action === 'pagehide') ui.view.dispatchEvent(new Event('pagehide')); if (action === 'dispose') ui.page.dispose();
    assert.equal(signal.aborted, true); release(f.saved.text); await tick(); assert(ui.get('save').disabled); assert(ui.get('result').hidden); ui.page.dispose();
  }
});
