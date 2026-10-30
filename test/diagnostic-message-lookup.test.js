import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenIdentityErrorMessage } from '../src/token-identity-view.js';
import { allowanceErrorMessage } from '../src/allowance-view.js';
import { transferErrorText } from '../src/transfer-messages.js';
import { vaultErrorText } from '../src/transfer-vault-messages.js';
import { periodMessage } from '../src/period-view.js';
import { libraryErrorText } from '../src/period-library-view.js';
import { reportErrorText, reportStatusText, reportIssueText } from '../src/period-report-view.js';
import { historyErrorText } from '../src/report-history-view.js';
import { setErrorText, setIssueText } from '../src/report-set-view.js';

const views=[
  ['identity',tokenIdentityErrorMessage,'IDENTITY_DOWNLOAD'],['allowance',allowanceErrorMessage,'ALLOWANCE_ADDRESS'],
  ['transfer',transferErrorText,'TRANSFER_REVIEW_REQUIRED'],['vault',vaultErrorText,'TRANSFER_VAULT_EMPTY'],
  ['period',periodMessage,'PERIOD_BLOCK'],['library',libraryErrorText,'PERIOD_LIBRARY_NOT_LOADED'],
  ['report',reportErrorText,'PERIOD_REPORT_NOT_LOADED'],['report-status',reportStatusText,'missing'],
  ['report-issue',reportIssueText,'MISSING_TOKEN'],['history',historyErrorText,'PERIOD_HISTORY_FAILED'],
  ['set',setErrorText,'PERIOD_SET_FAILED'],['set-issue',setIssueText,'SINGLE_REPORT'],
];
for(const [name,view,known] of views) {
  const fallback=view('__unknown_test_code__');
  for(const code of ['constructor','toString','__proto__','hasOwnProperty']) test(`${name}: inherited ${code} is not a message`,()=>{
    assert.equal(typeof view(code),'string');assert.equal(view(code),fallback);
  });
  for(const type of ['primitive-hook','toString','proxy','boxed']) test(`${name}: ${type} is not coerced into a code`,()=>{
    let calls=0;
    const value=type==='primitive-hook'?{[Symbol.toPrimitive](){calls++;return known;}}
      :type==='toString'?{toString(){calls++;return known;}}
      :type==='proxy'?new Proxy({},{get(){calls++;throw Error('synthetic coercion');}}):new String(known);
    assert.equal(view(value),fallback);assert.equal(calls,0);
  });
  test(`${name}: ordinary unknown primitive codes have safe text`,()=>{
    for(const value of [undefined,null,0,1n,false,Symbol('unknown')])assert.equal(view(value),fallback);
  });
}
test('known ordinary diagnostics keep their specific messages',()=>{
  for(const [name,view,code] of views){
    assert.equal(typeof view(code),'string',name);assert.notEqual(view(code),view('__unknown_test_code__'),name);
  }
});
