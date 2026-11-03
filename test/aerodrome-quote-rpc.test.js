import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicBaseRpcReader } from '../src/public-base-rpc.js';
import { encodeClassicRouterQuote,CLASSIC_QUOTE_SELECTORS as S } from '../src/aerodrome-quote-reader.js';
import { AERODROME_BASE,THREECORE_BASE_TOKENS } from '../src/aerodrome-readonly.js';
import { BASE_NATIVE_USDC } from '../src/aerodrome-pools.js';
import { word,QUOTE_HASH } from './helpers/aerodrome-quote-fixture.js';
test('quote view selectors accept only exact lengths and canonical single-route ABI',async()=>{
  const calls=[],read=createPublicBaseRpcReader({rpcUrl:AERODROME_BASE.rpcUrl,fetchImpl:async(url,o)=>{const r=JSON.parse(o.body);calls.push(r);return new Response(JSON.stringify({jsonrpc:'2.0',id:r.id,result:'0x'+word(1)}));}});
  const selector={blockHash:QUOTE_HASH,requireCanonical:true},addressWord=THREECORE_BASE_TOKENS.DAT.slice(2).padStart(64,'0');
  const valid=[S.stable,S.factory,S.isPaused,S.defaultFactory,S.poolQuote+word(1)+addressWord,S.getFee+addressWord+word(0),encodeClassicRouterQuote('1',THREECORE_BASE_TOKENS.DAT,BASE_NATIVE_USDC)];
  for(const data of valid)await read('eth_call',[{to:AERODROME_BASE.router,data},selector]);
  const before=calls.length;
  for(const data of [...valid.map(x=>x+'00'),S.poolQuote+word(1)+word(1n<<200n),S.getFee+addressWord+word(2),S.routerQuote+word(1)+word(32)+word(1)+addressWord+addressWord+word(0)+addressWord,'0xa9059cbb'+addressWord+word(1)])await assert.rejects(read('eth_call',[{to:AERODROME_BASE.router,data},selector]),{code:'INVALID_PARAMS'});
  await assert.rejects(read('eth_sendTransaction',[]),{code:'METHOD_BLOCKED'});assert.equal(calls.length,before);
});
test('timestamp-aware headers fail on missing or noncanonical time while old header shape stays unchanged',async()=>{
  let timestamp='0x10';const transport=async(url,o)=>{const r=JSON.parse(o.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{number:'0x2a',hash:QUOTE_HASH,timestamp}}));};
  const plain=createPublicBaseRpcReader({rpcUrl:AERODROME_BASE.rpcUrl,fetchImpl:transport}),timed=createPublicBaseRpcReader({rpcUrl:AERODROME_BASE.rpcUrl,fetchImpl:transport,includeBlockTimestamp:true});
  assert.deepEqual(await plain('eth_getBlockByNumber',['0x2a',false]),{number:'0x2a',hash:QUOTE_HASH});assert.equal((await timed('eth_getBlockByNumber',['0x2a',false])).timestamp,'0x10');
  for(const value of [undefined,'0x01',-1]){timestamp=value;await assert.rejects(timed('eth_getBlockByNumber',['0x2a',false]),{code:'INVALID_RPC_RESPONSE'});}
});
