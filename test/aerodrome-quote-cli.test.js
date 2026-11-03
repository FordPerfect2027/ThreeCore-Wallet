import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,realpath,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { runAerodromeQuote } from '../scripts/aerodrome-quote.js';
import { quoteFixture } from './helpers/aerodrome-quote-fixture.js';
import { prepareAerodromeQuoteFile } from '../src/aerodrome-quote-model.js';
import { proposalFixture } from './helpers/proposal-fixtures.js';
import { prepareOperationProposalReview } from '../src/operation-proposal-file.js';
import { encodeOperationProposal,encodeProposalReviewPolicy } from '../src/operation-proposal.js';
async function run(args,options={}){let output='',errors='';const code=await runAerodromeQuote(args,{write:s=>{output+=s;}},{write:s=>{errors+=s;}},options);return{code,output,errors};}
test('CLI read preserves explicit agent, input, direction, slippage and optional height',async()=>{
  let observed;const quote=quoteFixture(),r=await run(['read','DAT','sell',quote.inputBaseUnits,'50','42'],{read:async input=>{observed=input;return quote;}});
  assert.equal(r.code,0);assert.equal(observed.agent,'DAT');assert.equal(observed.inputBaseUnits,quote.inputBaseUnits);assert.equal(observed.blockNumber,'42');assert.equal(observed.slippageBps,50);
  assert.equal(JSON.parse(r.output).quote.poolOutputBaseUnits,quote.poolOutputBaseUnits);assert.equal(r.errors,'');
  for(const args of [[],['read'],['read','DAT','sell','1','1.2'],['read','DAT','sell','1','01'],['verify'],['unknown'],[null]])assert.equal((await run(args)).code,1);
  const help=await run(['--help']);assert.equal(help.code,0);assert.match(help.output,/No wallet connection/);
});
test('CLI saved quote validates files read-only and does not report tampered source contents',async()=>{
  const root=await realpath(tmpdir()),dir=await mkdtemp(join(root,'threecore-quote-cli-'));
  try{
    const path=join(dir,'quote.json'),saved=await prepareAerodromeQuoteFile(quoteFixture());await writeFile(path,saved.text);
    const r=await run(['verify',path]);assert.equal(r.code,0);assert.equal(JSON.parse(r.output).authorizesExecution,false);assert.equal(await readFile(path,'utf8'),saved.text);
    const f=await proposalFixture(),review=await prepareOperationProposalReview({proposalFile:encodeOperationProposal(f.proposal),policyFile:encodeProposalReviewPolicy(f.policy),budgetEvidenceFile:f.evidenceText},{nowSeconds:f.nowSeconds});
    const reviewPath=join(dir,'review.json');await writeFile(reviewPath,review.text);
    const compared=await run(['review',reviewPath,path,'300','300','100','50']);assert.equal(compared.code,2);assert(JSON.parse(compared.output).reasons.includes('QUOTE_PROPOSAL_MISMATCH'));assert.equal(await readFile(reviewPath,'utf8'),review.text);
    assert.equal((await run(['review',reviewPath,path,'300','300','10001','50'])).code,1);
    for(const content of [Buffer.from([255]),'{"secret-marker":"do-not-echo"}',' '.repeat(16385)]){
      await writeFile(path,content);const invalid=await run(['verify',path]);assert.equal(invalid.code,1);assert.equal(invalid.output,'');assert.doesNotMatch(invalid.errors,/do-not-echo/);
    }
  }finally{assert.equal(dirname(resolve(dir)),root);assert(basename(dir).startsWith('threecore-quote-cli-'));assert.equal(await realpath(dir),resolve(dir));await rm(dir,{recursive:true});}
});
