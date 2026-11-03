import test from 'node:test';
import assert from 'node:assert/strict';
const base=new URL('../',import.meta.url);
const formats=[
 ['allowance-file','readAllowanceFile','ALLOWANCE_FILENAME','ALLOWANCE_FILE_READ',240],
 ['allowance-bundle','readAllowanceBundle','ALLOWANCE_FILENAME','ALLOWANCE_FILE_READ',240],
 ['token-identity-report','readTokenIdentityFile','IDENTITY_FILENAME','IDENTITY_FILE_READ',240],
 ['period-file','readPeriodFile','PERIOD_FILENAME','PERIOD_FILE_READ',180],
 ['period-library-file','readPeriodLibraryFile','PERIOD_FILENAME','PERIOD_FILE_READ',180],
 ['period-report-file','readPeriodReportFile','PERIOD_FILENAME','PERIOD_FILE_READ',180],
 ['report-history-file','readReportHistoryFile','PERIOD_FILENAME','PERIOD_FILE_READ',180],
 ['report-set-file','readReportSetFile','PERIOD_FILENAME','PERIOD_FILE_READ',180],
 ['transfer-file','readTransferFile','TRANSFER_FILE_NAME','TRANSFER_FILE_READ',180],
 ['transfer-archive-file','readTransferArchive','TRANSFER_FILE_NAME','TRANSFER_FILE_READ',180],
 ['transfer-vault-file','readVaultFile','TRANSFER_FILE_NAME','TRANSFER_FILE_READ',180],
 ['transfer-vault-collection','readVaultCollection','TRANSFER_FILE_NAME','TRANSFER_FILE_READ',180],
 ['reconciliation-file','readReconciliationFile','RECONCILIATION_FILENAME','RECONCILIATION_FILE_READ',180],
];
for(const [module,method,nameCode,readCode,max] of formats){
 const read=(await import(new URL('src/'+module+'.js',base)))[method];
 test(module+': validates one captured name before reading the payload',async()=>{
   let names=0,bytes=0;
   const file={get name(){names++;if(names>1)throw Error('second read');return 'valid.JSON';},size:1,arrayBuffer(){bytes++;throw Error('read failure');}};
   await assert.rejects(read(file),{code:readCode});assert.equal(names,1);assert.equal(bytes,1);
 });
 test(module+': a changed name cannot erase an oversized first observation',async()=>{
   let names=0,bytes=0;
   const file={get name(){return ++names===1?'x'.repeat(max)+'.json':'ok.json';},size:1,arrayBuffer(){bytes++;throw Error('read failure');}};
   await assert.rejects(read(file),{code:nameCode});assert.equal(names,1);assert.equal(bytes,0);
 });
 test(module+': metadata failure uses the public filename diagnostic',async()=>{
   let bytes=0;const file={get name(){throw Error('private metadata details');},size:1,arrayBuffer(){bytes++;}};
   await assert.rejects(read(file),{code:nameCode});assert.equal(bytes,0);
 });
 test(module+': asynchronous filename failure is consumed without reading',async()=>{
   let bytes=0;const file={get name(){return Promise.reject(Error('async metadata'));},size:1,arrayBuffer(){bytes++;}};
   await assert.rejects(read(file),{code:nameCode});await new Promise(setImmediate);assert.equal(bytes,0);
 });
 test(module+': native File name remains supported',async()=>{
   await assert.rejects(read(new File(['x'],'native.JSON')),error=>typeof error.code==='string'&&error.code!==nameCode);
 });
 test(module+': invalid name objects are never string-coerced',async()=>{
   let coerced=0,bytes=0;const file={name:{toString(){coerced++;return'ok.json';}},size:1,arrayBuffer(){bytes++;}};
   await assert.rejects(read(file),{code:nameCode});assert.equal(coerced,0);assert.equal(bytes,0);
 });
}
