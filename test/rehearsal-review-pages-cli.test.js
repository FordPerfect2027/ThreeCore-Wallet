import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { webcrypto } from 'node:crypto';
import { newReportFixtures } from './helpers/rehearsal-report-fixtures.js';
import { reviewRehearsalReport, encodeRehearsalReviewEvidence } from '../src/operation-rehearsal-report-review.js';
import { runRehearsalDifferencePage } from '../scripts/inspect-rehearsal-differences.js';
const options = { subtle: webcrypto.subtle };
async function fixture(action) {
  const root = await realpath(tmpdir()), dir = await mkdtemp(join(root, 'threecore-review-pages-'));
  const file = join(dir, 'report.json'), evidenceFile = join(dir, 'evidence.json');
  const report = structuredClone(newReportFixtures().filtered);
  for (let i = 0; i < 103; i++) report['extra' + String(i).padStart(3, '0')] = i;
  const text = JSON.stringify(report), packageValue = JSON.parse(encodeRehearsalReviewEvidence(await reviewRehearsalReport(text, options)));
  for (let i = 0; i < 87; i++) packageValue.receipt['extra' + String(i).padStart(3, '0')] = i;
  const evidence = JSON.stringify(packageValue);
  try { await writeFile(file, text); await writeFile(evidenceFile, evidence); await action({ dir, file, evidenceFile, text, evidence }); }
  finally {
    assert.equal(dirname(resolve(dir)), root); assert.ok(basename(dir).startsWith('threecore-review-pages-'));
    assert.equal(await realpath(dir), resolve(dir)); await rm(dir, { recursive: true });
  }
}
async function run(args) { let output = '', errors = ''; const code = await runRehearsalDifferencePage(args, { write: s => { output += s; } }, { write: s => { errors += s; } }); return { code, output, errors }; }
test('offline report pages expose every difference once and retain source files', () => fixture(async ({ dir, file, text }) => {
  const before = await readdir(dir), paths = [];
  for (const number of [1, 2, 3]) {
    const result = await run([file, '--page', String(number)]); assert.equal(result.code, 2); assert.equal(result.errors, '');
    const page = JSON.parse(result.output); assert.equal(page.page, number); assert.equal(page.totalDifferences, 103);
    assert.equal(page.target, 'report'); paths.push(...page.differences.map(d => d.path));
  }
  assert.equal(new Set(paths).size, 103); assert.equal(paths.length, 103);
  assert.equal(await readFile(file, 'utf8'), text); assert.deepEqual(await readdir(dir), before);
}));
test('evidence receipt and source pages retain complete verification status', () => fixture(async ({ evidenceFile, evidence }) => {
  for (const [kind, total, length] of [['receipt', 87, 7], ['source', 103, 23]]) {
    const result = await run([evidenceFile, '--page', '3', '--evidence', kind]); assert.equal(result.code, 2);
    const page = JSON.parse(result.output); assert.equal(page.totalDifferences, total); assert.equal(page.differences.length, length);
    assert.equal(page.summary.matchesReceipt, false); assert.equal(page.summary.matchesRecomputation, false);
  }
  assert.equal(await readFile(evidenceFile, 'utf8'), evidence);
}));
test('default page is the first page and malformed requests emit no partial data', () => fixture(async ({ file, evidenceFile, dir }) => {
  assert.equal(JSON.parse((await run([file])).output).page, 1);
  for (const args of [[], ['--help'], [file, '--page'], [file, '--page', '0'], [file, '--page', '-1'], [file, '--page', '1.5'],
    [file, '--page', '01'], [file, '--page', '100000000'], [file, '--page', '4'], [file, '--page', '1', '--evidence', 'unknown'],
    [evidenceFile, '--page', '4', '--evidence', 'receipt'], [dir], [join(dir, 'absent.json')]]) {
    const result = await run(args); assert.equal(result.code, 1); assert.equal(result.output, '');
  }
}));
test('empty selected evidence differences cannot hide a bad checksum elsewhere', () => fixture(async ({ evidenceFile }) => {
  const report = JSON.stringify(newReportFixtures().filtered);
  await writeFile(evidenceFile, encodeRehearsalReviewEvidence(await reviewRehearsalReport(report, { ...options, expectedSha256: '0'.repeat(64) })));
  for (const kind of ['receipt', 'source']) {
    const result = await run([evidenceFile, '--page', '1', '--evidence', kind]); assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.output).totalDifferences, 0); assert.equal(JSON.parse(result.output).summary.checksumMatches, false);
  }
}));
test('consistent reports have one empty page while their failing expected outcomes stay visible', () => fixture(async ({ file }) => {
  await writeFile(file, JSON.stringify(newReportFixtures().differing));
  const result = await run([file]); assert.equal(result.code, 0); const page = JSON.parse(result.output);
  assert.equal(page.totalDifferences, 0); assert.equal(page.totalPages, 1); assert.equal(page.summary.reportOutcome.allMatched, false);
}));

test('offline individual differences use one-based numbering with exact recorded values', () => fixture(async ({ file, text }) => {
  for(const number of [1,40,41,103]){
    const result=await run([file,'--difference',String(number)]);assert.equal(result.code,2);assert.equal(result.errors,'');
    const detail=JSON.parse(result.output);assert.equal(detail.schema,'threecore.operation-rehearsal-difference-detail.v1');
    assert.equal(detail.number,number);assert.equal(detail.index,number-1);assert.equal(detail.actual.json,String(number-1));
    assert.equal(detail.expected.present,false);assert.equal(detail.summary.matchesRecomputation,false);
  }
  assert.equal(await readFile(file,'utf8'),text);
}));
test('offline receipt and source details retain all verification outcomes', () => fixture(async ({ evidenceFile,evidence }) => {
  for(const kind of ['receipt','source']){
    const result=await run([evidenceFile,'--difference','41','--evidence',kind]);assert.equal(result.code,2);
    const detail=JSON.parse(result.output);assert.equal(detail.target,'evidence-'+kind);assert.equal(detail.actual.json,'40');
    assert.equal(detail.summary.matchesReceipt,false);assert.equal(detail.summary.matchesRecomputation,false);
  }
  assert.equal(await readFile(evidenceFile,'utf8'),evidence);
}));
test('invalid detail selections never output partial evidence or silently choose page one', () => fixture(async ({ file,evidenceFile }) => {
  for(const args of [[file,'--difference','0'],[file,'--difference','01'],[file,'--difference','-1'],[file,'--difference','1.1'],
    [file,'--difference','104'],[file,'--difference','1','--page','1'],[evidenceFile,'--difference','88','--evidence','receipt']]){
    const result=await run(args);assert.equal(result.code,1);assert.equal(result.output,'');assert.notEqual(result.errors,'');
  }
}));

test('offline full values retain complete inspection data without changing sources', () => fixture(async ({file,text})=>{
  const input=JSON.parse(text);input.extra102="x".repeat(3000)+"🚀";const updated=JSON.stringify(input);await writeFile(file,updated);
  const result=await run([file,'--full-values','103']);assert.equal(result.code,2);assert.equal(result.errors,'');
  const detail=JSON.parse(result.output);assert.equal(detail.schema,'threecore.operation-rehearsal-difference-values.v1');
  assert.equal(detail.valuesComplete,true);assert.equal(detail.actual.value,input.extra102);assert.equal(detail.summary.matchesRecomputation,false);
  assert.equal(await readFile(file,'utf8'),updated);
}));
test('offline full evidence values distinguish receipt and source while keeping both outcomes', () => fixture(async ({evidenceFile,evidence})=>{
  for(const kind of ['receipt','source']){
    const result=await run([evidenceFile,'--full-values','41','--evidence',kind]);assert.equal(result.code,2);
    const detail=JSON.parse(result.output);assert.equal(detail.target,'evidence-'+kind);assert.equal(detail.actual.value,40);
    assert.equal(detail.summary.matchesReceipt,false);assert.equal(detail.summary.matchesRecomputation,false);
  }
  assert.equal(await readFile(evidenceFile,'utf8'),evidence);
}));
test('offline invalid full-value requests produce no partial artifact', () => fixture(async({file,evidenceFile})=>{
  for(const args of [[file,'--full-values','0'],[file,'--full-values','104'],[file,'--full-values','1','--difference','1'],
    [evidenceFile,'--full-values','88','--evidence','receipt']]){
    const result=await run(args);assert.equal(result.code,1);assert.equal(result.output,'');assert.notEqual(result.errors,'');
  }
}));
