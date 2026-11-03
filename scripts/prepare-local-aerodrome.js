#!/usr/bin/env node
// Prepare pinned upstream sources/compiler in a NEW local simulation directory.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,posix} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [output,...extra]=process.argv.slice(2);if(!output||extra.length)throw Error('Usage: node scripts/prepare-local-aerodrome.js NEW_OUTPUT_DIRECTORY');
const folder=resolve(output);await mkdir(folder);
const pin='1ba30815bba620f7e9faa34769ffd00c214c9b82',oz='7b3e7b7055d6e1226d4920ca7d7c446c0c0bfff5';
const sha=b=>createHash('sha256').update(b).digest('hex'),sources={},references=[];
async function fetchBytes(url,maxBytes){const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,url);const bytes=new Uint8Array(await response.arrayBuffer());assert(bytes.length<=maxBytes);return bytes;}
const pending=['contracts/Router.sol','contracts/Pool.sol','contracts/factories/PoolFactory.sol','contracts/factories/FactoryRegistry.sol'];
while(pending.length){const key=pending.shift();if(sources[key])continue;
 assert(!key.includes('..')&&key.endsWith('.sol')&&(key.startsWith('contracts/')||key.startsWith('@openzeppelin/contracts/')),'Unexpected import');
 const url=key.startsWith('@openzeppelin/')?'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/'+oz+'/'+key.slice('@openzeppelin/'.length):'https://raw.githubusercontent.com/aerodrome-finance/contracts/'+pin+'/'+key;
 const bytes=await fetchBytes(url,200000),content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);sources[key]={content};references.push({key,url,bytes:bytes.length,sha256:sha(bytes)});
 for(const match of content.matchAll(/import\s+(?:[^;]*?from\s*)?["']([^"']+)["']\s*;/g)){const target=match[1].startsWith('.')?posix.normalize(posix.join(posix.dirname(key),match[1])):match[1];pending.push(target);}
 if(references.length%10===0)console.log('Pinned sources: '+references.length);
}
sources['ThreeCoreTestUSDC.sol']={content:await readFile(new URL('../integration/fixtures/ThreeCoreTestUSDC.sol',import.meta.url),'utf8')};
const licenses=[];for(const [project,revision,names]of [['aerodrome-finance/contracts',pin,['LICENSE','LICENSE.GPL3','LICENSE.MIT']],['OpenZeppelin/openzeppelin-contracts',oz,['LICENSE']]])for(const name of names){const url='https://raw.githubusercontent.com/'+project+'/'+revision+'/'+name;const bytes=await fetchBytes(url,100000);licenses.push({project,name,url,sha256:sha(bytes),text:new TextDecoder().decode(bytes)});}
const compilerUrl='https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/bin/soljson-v0.8.19+commit.7dd6d404.js';
const compiler=await fetchBytes(compilerUrl,12000000);assert.equal(sha(compiler),'e0b74e0a16e783a35169f74d1a615ecb48d07c30f97346b83cd587949268681e');
await writeFile(resolve(folder,'soljson-0.8.19.cjs'),compiler,{flag:'wx'});
const bundle=JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}},null,2)+'\n';
await writeFile(resolve(folder,'compiler-input.json'),bundle,{flag:'wx'});
await writeFile(resolve(folder,'source-manifest.json'),JSON.stringify({aerodromeRevision:pin,openzeppelinRevision:oz,compiler:{url:compilerUrl,sha256:sha(compiler)},inputSha256:sha(bundle),references,licenses,testToken:'ThreeCoreTestUSDC is a local six-decimal fixture; it is not Circle USDC.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({folder,upstreamSources:references.length,compilerVerified:true}));
