import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CLASSIC_QUOTE_SELECTORS as S,encodeClassicRouterQuote } from '../../../src/aerodrome-quote-reader.js';
import { AERODROME_BASE,THREECORE_BASE_TOKENS } from '../../../src/aerodrome-readonly.js';
import { BASE_NATIVE_USDC } from '../../../src/aerodrome-pools.js';
const dir=new URL('./',import.meta.url),pin='1ba30815bba620f7e9faa34769ffd00c214c9b82';
const refs=[];
for(const path of ['README.md','contracts/Pool.sol','contracts/Router.sol','contracts/interfaces/IRouter.sol','contracts/factories/PoolFactory.sol']){
  const url='https://raw.githubusercontent.com/aerodrome-finance/contracts/'+pin+'/'+path;
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);const source=await response.text();
  assert(source.length<100000);if(path==='README.md'){assert(source.toLowerCase().includes(AERODROME_BASE.router));assert(source.toLowerCase().includes(AERODROME_BASE.poolFactory));}
  refs.push({path,url,bytes:Buffer.byteLength(source),sha256:createHash('sha256').update(source).digest('hex')});
}
const project=JSON.parse(await readFile(new URL('../2026-11-03-token-simulation/preflight.json',dir),'utf8'))[0].root;
const require=createRequire(pathToFileURL(project+'/package.json')),viem=require('viem');
const signatures={getPool:'getPool(address,address,bool)',token0:'token0()',token1:'token1()',reserves:'getReserves()',stable:'stable()',factory:'factory()',isPaused:'isPaused()',defaultFactory:'defaultFactory()',decimals:'decimals()',getFee:'getFee(address,bool)',poolQuote:'getAmountOut(uint256,address)',routerQuote:'getAmountsOut(uint256,(address,address,bool,address)[])'};
const selectors=[];for(const [key,signature] of Object.entries(signatures)){const generated=viem.toFunctionSelector(signature);assert.equal(generated,S[key]);selectors.push({signature,selector:generated});}
const abi=viem.parseAbi(['function getAmountsOut(uint256 amountIn, (address from,address to,bool stable,address factory)[] routes) view returns (uint256[])']);
const generated=viem.encodeFunctionData({abi,functionName:'getAmountsOut',args:[1n,[{from:THREECORE_BASE_TOKENS.DAT,to:BASE_NATIVE_USDC,stable:false,factory:AERODROME_BASE.poolFactory}]]});
assert.equal(generated,encodeClassicRouterQuote('1',THREECORE_BASE_TOKENS.DAT,BASE_NATIVE_USDC));
const report={recordedAt:new Date().toISOString(),officialRevision:pin,references:refs,independentAbiLibrary:'viem '+JSON.parse(await readFile(project+'/node_modules/viem/package.json','utf8')).version,selectors,singleRouteCalldata:generated,allMatches:true};
await writeFile(new URL('protocol-reference-verification.json',dir),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({officialRevision:pin,referenceFiles:refs.length,selectorsVerified:selectors.length,singleRouteMatches:true}));
