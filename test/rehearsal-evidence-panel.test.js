import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { Element } from './helpers/panel-dom.js';
import { mountRehearsalEvidencePanel } from '../examples/operation-rehearsal-review-panel.js';
import { newReportFixtures } from './helpers/rehearsal-report-fixtures.js';
import { reviewRehearsalReport, encodeRehearsalReviewEvidence, reviewRehearsalEvidence } from '../src/operation-rehearsal-report-review.js';
const options = { subtle: webcrypto.subtle }, source = ' \r\n' + JSON.stringify(newReportFixtures().filtered, null, 2) + '\r\n';
const evidence = encodeRehearsalReviewEvidence(await reviewRehearsalReport(source, options));
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; };
class Node extends Element { set textContent(value) { this.text = value; this.children = []; } get textContent() { return this.text; } }
function setup({ subtle = webcrypto.subtle } = {}) {
  const elements = new Map(), downloads = []; let downloadAction = () => {};
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, new Node('div')); return elements.get(id); }, createElement: tag => new Node(tag) };
  const panel = mountRehearsalEvidencePanel(document, { subtle, download: ({ prepared }) => { const value = downloadAction(); downloads.push(prepared); return value; } });
  const q = id => document.getElementById('report-evidence-' + id);
  const edit = text => { q('text').value = text; q('text').dispatchEvent(new Event('input')); };
  const paste = text => { edit(text); q('paste').click(); };
  const select = file => { q('file').files = file ? [file] : []; q('file').dispatchEvent(new Event('change')); };
  return { panel, q, downloads, paste, edit, select, downloadAction: fn => { downloadAction = fn; } };
}
async function finished(f) {
  const end = Date.now() + 5000;
  while (f.q('status').getAttribute('aria-busy') === 'true' && Date.now() < end) await tick();
  assert.equal(f.q('status').getAttribute('aria-busy'), 'false');
}
function file(text, extra = {}) {
  const bytes = new TextEncoder().encode(text);
  const value = { name: 'synthetic-evidence.json', size: bytes.length, arrayBuffer: async () => bytes.buffer };
  return Object.defineProperties(value, Object.getOwnPropertyDescriptors(extra));
}
test('evidence file verification exports exact source and a reproducible result', async () => {
  const f = setup(); try {
    f.select(file(evidence)); await finished(f);
    assert.equal(f.q('status').className, 'passed'); assert.equal(f.q('results').hidden, false);
    f.q('source-save').click(); f.q('save').click();
    assert.equal(f.downloads[0].text, source); assert.equal(f.downloads[0].filename, 'ThreeCore-evidence-source-report.json');
    assert.deepEqual(JSON.parse(f.downloads[1].text), await reviewRehearsalEvidence(evidence, options));
  } finally { f.panel.dispose(); }
});
test('pasting clears raw input and evaluates receipt differences as text', async () => {
  const changed = JSON.parse(evidence); changed.receipt['<img src=x>'] = true;
  const f = setup(); try {
    f.paste(JSON.stringify(changed)); await finished(f);
    assert.equal(f.q('text').value, ''); assert.equal(f.q('status').className, 'blocked');
    assert.match(f.q('status').textContent, /控え.*一致しません/);
    assert.equal(f.q('differences').children[0].children[1].textContent, '/<img src=x>');
    f.q('save').click(); assert.equal(JSON.parse(f.downloads[0].text).matchesReceipt, false);
  } finally { f.panel.dispose(); }
});
for (const kind of ['calculation', 'checksum', 'expectation']) test('faithfully recorded ' + kind + ' discrepancy is not shown as success', async () => {
  let raw = source, extra = {};
  if (kind === 'calculation') { const report = JSON.parse(raw); report.matchedRecords = 999; raw = JSON.stringify(report); }
  if (kind === 'checksum') extra.expectedSha256 = '0'.repeat(64);
  if (kind === 'expectation') raw = JSON.stringify(newReportFixtures().differing);
  const encoded = encodeRehearsalReviewEvidence(await reviewRehearsalReport(raw, { ...options, ...extra }));
  const f = setup(); try {
    f.paste(encoded); await finished(f); assert.equal(f.q('status').className, 'blocked');
    assert.match(f.q('status').textContent, kind === 'calculation' ? /計算結果に不一致/ : kind === 'checksum' ? /照合値と一致しません/ : /期待結果との差/);
    assert.equal(f.q('save').disabled, false);
  } finally { f.panel.dispose(); }
});
for (const retirement of ['clear', 'edit', 'dispose']) test('late evidence hash completion cannot undo ' + retirement, async () => {
  const gate = deferred(); let started = false;
  const f = setup({ subtle: { async digest(_algorithm, bytes) { started = true; await gate.promise; return Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer; } } });
  try {
    f.paste(evidence); assert.equal(started, true);
    if (retirement === 'clear') f.q('clear').click();
    if (retirement === 'edit') f.edit('{}');
    if (retirement === 'dispose') f.panel.dispose();
    const message = f.q('status').textContent; gate.resolve(); await tick(); await tick();
    assert.equal(f.q('status').textContent, message); assert.equal(f.q('save').disabled, true);
    f.q('save').dispatchEvent(new Event('click')); assert.equal(f.downloads.length, 0);
  } finally { gate.resolve(); f.panel.dispose(); }
});
test('a newer input wins over a late file read', async () => {
  const gate = deferred(), f = setup();
  try {
    f.select(file(evidence, { arrayBuffer: () => gate.promise })); await tick();
    f.paste('{}'); await finished(f); const message = f.q('status').textContent;
    gate.resolve(new TextEncoder().encode(evidence).buffer); await tick(); await tick();
    assert.equal(f.q('status').textContent, message); assert.equal(f.q('save').disabled, true);
  } finally { gate.resolve(new ArrayBuffer(0)); f.panel.dispose(); }
});
test('filename capture cannot continue after clear', async () => {
  const f = setup(); let reads = 0;
  try {
    f.select(file(evidence, { get name() { f.q('clear').click(); return 'older.json'; }, arrayBuffer() { reads++; } }));
    await tick(); assert.equal(reads, 0); assert.equal(f.q('status').getAttribute('aria-busy'), 'false'); assert.equal(f.q('save').disabled, true);
  } finally { f.panel.dispose(); }
});
test('picker dismissal preserves a completed verification', async () => {
  const f = setup(); try {
    f.paste(evidence); await finished(f); const message = f.q('status').textContent;
    f.q('file').dispatchEvent(new Event('cancel')); f.select(null);
    assert.equal(f.q('status').textContent, message); assert.equal(f.q('save').disabled, false);
  } finally { f.panel.dispose(); }
});
test('picker dismissal does not cancel an in-flight verification', async () => {
  const gate = deferred(), f = setup(); try {
    f.select(file(evidence, { arrayBuffer: () => gate.promise })); await tick(); f.select(null);
    f.q('file').dispatchEvent(new Event('cancel')); gate.resolve(new TextEncoder().encode(evidence).buffer);
    await finished(f); assert.equal(f.q('status').className, 'passed');
  } finally { gate.resolve(new ArrayBuffer(0)); f.panel.dispose(); }
});
test('oversized and invalidly encoded files fail before result export', async () => {
  const f = setup(); let reads = 0;
  try {
    f.select({ name: 'large.json', size: 6291457, arrayBuffer() { reads++; } }); await finished(f);
    assert.equal(reads, 0); assert.equal(f.q('save').disabled, true); assert.match(f.q('status').textContent, /6 MiB/);
    f.select({ name: 'bad.json', size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer }); await finished(f);
    assert.equal(f.q('save').disabled, true); assert.match(f.q('status').textContent, /UTF-8/);
  } finally { f.panel.dispose(); }
});
for (const action of ['source-save', 'save']) test(action + ' failure and observer cancellation retain correct ownership', async () => {
  const f = setup(); try {
    f.paste(evidence); await finished(f); f.downloadAction(() => { throw Error('private exception'); }); f.q(action).click();
    assert.match(f.q('export-status').textContent, /保存を開始できません/); assert.equal(f.q(action).disabled, false);
    f.downloadAction(() => {}); f.q(action).click(); assert.equal(f.downloads.length, 1);
    f.downloadAction(() => f.q('clear').click()); f.q(action).click(); assert.equal(f.q('export-status').textContent, '');
    assert.equal(f.q(action).disabled, true);
  } finally { f.panel.dispose(); }
});

import { walletFileReadService } from '../src/file-read-service.js';
for(const action of ['clear','paste','file'])test('a file-cancellation observer keeps its newer evidence over an older '+action,async()=>{
  const f=setup(),gate=deferred();let armed=false,entered=false,olderReads=0;
  const baseline=walletFileReadService.state().cancelled;
  const unsubscribe=walletFileReadService.subscribe(state=>{if(armed&&!entered&&state.cancelled>baseline){entered=true;f.paste(evidence);}});
  try{
    f.select(file(evidence,{arrayBuffer:()=>gate.promise}));await tick();armed=true;
    if(action==='clear')f.q('clear').click();
    if(action==='paste'){f.q('text').value='{}';f.q('paste').click();}
    if(action==='file')f.select(file('{}',{arrayBuffer:async()=>{olderReads++;return new TextEncoder().encode('{}').buffer;}}));
    assert.equal(entered,true);await finished(f);assert.equal(f.q('status').className,'passed');assert.equal(f.q('save').disabled,false);
    assert.equal(olderReads,0);f.q('source-save').click();assert.equal(f.downloads.pop().text,source);
  }finally{armed=false;unsubscribe();gate.resolve(new TextEncoder().encode(evidence).buffer);f.panel.dispose();await tick();}
});
test('disposal closes evidence input before cancellation observers can start a replacement',async()=>{
  const gate=deferred();let armed=false,calls=0;
  const f=setup({subtle:{digest(...args){calls++;return webcrypto.subtle.digest(...args);}}}),baseline=walletFileReadService.state().cancelled;
  const unsubscribe=walletFileReadService.subscribe(state=>{if(armed&&state.cancelled>baseline){armed=false;f.paste(evidence);}});
  try{f.select(file(evidence,{arrayBuffer:()=>gate.promise}));await tick();armed=true;f.panel.dispose();await tick();
    assert.equal(calls,0);assert.equal(f.q('status').textContent,'');assert.equal(f.q('save').disabled,true);
  }finally{armed=false;unsubscribe();gate.resolve(new TextEncoder().encode(evidence).buffer);f.panel.dispose();await tick();}
});

test('receipt and source difference browsing keep separate totals and reset page when switching', async () => {
  const input = JSON.parse(source); for (let i = 0; i < 103; i++) input['extra' + String(i).padStart(3, '0')] = i;
  const packageValue = JSON.parse(encodeRehearsalReviewEvidence(await reviewRehearsalReport(JSON.stringify(input), options)));
  for (let i = 0; i < 87; i++) packageValue.receipt['extra' + String(i).padStart(3, '0')] = i;
  const f = setup(); try {
    f.paste(JSON.stringify(packageValue)); await finished(f); assert.equal(f.q('difference-kind').value, 'receipt');
    const paths = []; for (let page = 0; page < 3; page++) { paths.push(...f.q('differences').children.map(row => row.children[1].textContent)); if (page < 2) f.q('next').click(); }
    assert.equal(paths.length, 87); assert.equal(new Set(paths).size, 87); assert.equal(f.q('next').disabled, true); assert.match(f.q('difference-status').textContent, /81〜87/);
    f.q('difference-kind').value = 'source'; f.q('difference-kind').dispatchEvent(new Event('change'));
    assert.equal(f.q('previous').disabled, true); assert.match(f.q('difference-status').textContent, /全103箇所/);
    f.q('next').click(); f.q('next').click(); assert.equal(f.q('differences').children.length, 23);
    f.q('save').click(); const result = JSON.parse(f.downloads.pop().text); assert.equal(result.differenceCount, 87); assert.equal(result.reportReview.differenceCount, 103);
    f.q('clear').click(); assert.equal(f.q('difference-kind').disabled, true); f.q('next').dispatchEvent(new Event('click')); assert.equal(f.q('difference-status').textContent, '');
  } finally { f.panel.dispose(); }
});
