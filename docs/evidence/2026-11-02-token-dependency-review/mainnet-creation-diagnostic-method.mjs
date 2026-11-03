import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const dir='C:/Users/aseet/Downloads/ThreeCore-mainnet-deployment-check-20261102';
const inputs='C:/Users/aseet/Downloads/ThreeCore-metadata-path-reconstruction-20261102';
const solc=createRequire('C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/token-dependency-repair-DAT-20261102/package.json')('solc');
const raw=JSON.parse(await readFile(dir+'/raw-rpc.json','utf8')),results=JSON.parse(await readFile(dir+'/results.json','utf8'));
function split(code){const n=parseInt(code.slice(-4),16)+2;assert(n>2&&n<(code.length-2)/2);const metadata='0x'+code.slice(-n*2);assert.match(metadata,/^0xa2646970667358221220[0-9a-f]{64}64736f6c63430008220033$/);return {executable:code.slice(0,-n*2),metadata};}
const rows=[];
for(const row of results.rows){
 const input=JSON.parse(await readFile(inputs+'/'+row.token+'-unversioned-import-paths-input.json','utf8'));
 input.settings.outputSelection={'*':{'*':['evm.bytecode.object']}};
 const result=JSON.parse(solc.compile(JSON.stringify(input)));assert(!(result.errors||[]).some(e=>e.severity==='error'));
 const code='0x'+result.contracts['contracts/'+row.token+'Core.sol'][row.token+'Core'].evm.bytecode.object;
 const tx=raw.find(r=>r.method==='eth_getTransactionByHash'&&r.params[0]===row.transaction).result;
 const creation=tx.input.slice(0,-64).toLowerCase();
 const full=creation===code,executable=split(code).executable===split(creation).executable;assert(executable);assert.equal(full,row.token!=='DAT');
 rows.push({token:row.token,transaction:row.transaction,fullCreationBytecodeMatches:full,creationExecutableMatches:executable,metadataMatches:split(code).metadata===split(creation).metadata});
 await writeFile(dir+'/'+row.token+'-reconstructed-creation.txt',code+'\n',{flag:'wx'});
 console.log(JSON.stringify(rows.at(-1)));
}
await writeFile(dir+'/creation-comparison.json',JSON.stringify({compiler:solc.version(),rows},null,2)+'\n',{flag:'wx'});
