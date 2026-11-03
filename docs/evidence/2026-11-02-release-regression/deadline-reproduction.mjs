import assert from 'node:assert/strict';
import {readAllowanceFile} from '../../../src/allowance-file.js';
import {walletFileReadService} from '../../../src/file-read-service.js';

// Deliberately spend 20 ms in synthetic metadata to reproduce pre-worker expiry.
let reads=0;
const file={
  name:'synthetic.json',
  get size(){
    const until=performance.now()+20;
    while(performance.now()<until) {}
    return 1;
  },
  arrayBuffer(){ reads++; throw Error('Must not start after deadline'); },
};
const before=walletFileReadService.state();
await assert.rejects(readAllowanceFile(file,{timeoutMs:5}),{code:'ALLOWANCE_FILE_READ'});
const after=walletFileReadService.state();
assert.equal(reads,0);
assert.equal(after.timedOut,before.timedOut+1);
assert.equal(after.active,0);
assert.equal(after.retained,0);
console.log(JSON.stringify({
  scenario:'Metadata consumes the caller deadline before arrayBuffer starts',
  synthetic:true,callerTimeoutMs:5,metadataDelayMs:20,reads,
  timedOutDelta:after.timedOut-before.timedOut,retained:after.retained,active:after.active,
  oldUnconditionalRetainedAssertionWouldPass:after.retained===1,
  newReservationInvariantPassed:true,
},null,2));
