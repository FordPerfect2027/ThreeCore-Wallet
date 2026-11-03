#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [output,toolchain,...extra]=process.argv.slice(2);if(!output||!toolchain||extra.length)throw Error('Usage: node scripts/compile-local-aerodrome.js PREPARED_DIRECTORY TOKEN_TOOLCHAIN_DIRECTORY');
const folder=resolve(output),require=createRequire(resolve(toolchain,'package.json')),sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile(resolve(folder,'source-manifest.json'),'utf8')),input=await readFile(resolve(folder,'compiler-input.json'),'utf8');
assert.equal(sha(input),manifest.inputSha256);const compilerPath=resolve(folder,'soljson-0.8.19.cjs');assert.equal(sha(await readFile(compilerPath)),manifest.compiler.sha256);
const solc=require('solc/wrapper')(require(compilerPath));assert.match(solc.version(),/^0\.8\.19\+commit\.7dd6d404/);
const result=JSON.parse(solc.compile(input));for(const error of result.errors??[])if(error.severity==='error')throw Error(error.formattedMessage);
const artifacts={};for(const [source,name]of [['contracts/Router.sol','Router'],['contracts/Pool.sol','Pool'],['contracts/factories/PoolFactory.sol','PoolFactory'],['contracts/factories/FactoryRegistry.sol','FactoryRegistry'],['ThreeCoreTestUSDC.sol','ThreeCoreTestUSDC']]){const c=result.contracts[source][name];artifacts[name]={source,abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,runtimeBytecode:'0x'+c.evm.deployedBytecode.object};assert(artifacts[name].bytecode.length>2);}
const text=JSON.stringify({compiler:solc.version(),sourceInputSha256:sha(input),artifacts},null,2)+'\n';await writeFile(resolve(folder,'compiled-artifacts.json'),text,{flag:'wx'});
console.log(JSON.stringify({compiler:solc.version(),artifacts:Object.keys(artifacts),artifactSha256:sha(text)}));
