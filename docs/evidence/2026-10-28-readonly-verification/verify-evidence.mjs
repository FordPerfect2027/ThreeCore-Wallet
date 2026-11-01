import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const check=(v,m)=>{if(!v)throw new Error(m)};
const manifest=await read('sha256sums.json');
for(const f of manifest){const b=await readFile(new URL(f.file,import.meta.url));check(b.length===f.bytes&&createHash('sha256').update(b).digest('hex')===f.sha256,'File integrity failed: '+f.file)}
const r=await read('result.json'),b=await read('chrome-20000-summary.json'),ui=await read('chrome-history-checks.json'),p=await read('chrome-portfolio.json');
check(r.ranges.length===39&&r.ranges[0].fromBlock===51281431&&r.ranges.at(-1).toBlock===53198900,'Range bounds');
for(let i=0;i<r.ranges.length;i++){const x=r.ranges[i];check(!i||r.ranges[i-1].toBlock+1===x.fromBlock,'Range gap');const e=await read(x.requestFile),q=e.request.params[0];check(e.httpStatus===200&&!e.response.error&&e.response.result.length===0,'RPC response');check(Number(BigInt(q.fromBlock))===x.fromBlock&&Number(BigInt(q.toBlock))===x.toBlock,'RPC bounds');check(q.topics[2]==='0x'+r.account.slice(2).padStart(64,'0'),'Recipient');check(q.address.length===3&&r.tokens.every(t=>q.address.includes(t.address)),'Contracts')}
check(b.records.length===30&&b.savedFiles===60,'Chrome batch counts');
for(const x of b.records){check(x.files.length===2&&x.events===0,'Batch record');for(const f of x.files){const raw=await readFile(new URL(f.path,import.meta.url));check(createHash('sha256').update(raw).digest('hex')===f.sha256,'Original download hash')}}
check(ui.records.length===6,'Chrome cross-check count');
for(const x of ui.records){const f='ThreeCore-'+x.token+'-8453-cfae4279-transfers-'+x.fromBlock+'-'+x.toBlock+'.json';const e=await read(f);check(e.payload.context.account===r.account&&e.payload.events.length===0,'Chrome result')}
check(p.snapshot.blockNumber==='53198984'&&p.snapshot.holdings.length===3&&p.snapshot.holdings.every(h=>h.hasCode&&h.balanceBaseUnits==='0'),'Balance record');
console.log(JSON.stringify({verified:true,files:manifest.length,rpcRanges:39,chromeBatchReads:30,chromeBatchFiles:60,chromeCrossChecks:6,incomingEvents:0}));
