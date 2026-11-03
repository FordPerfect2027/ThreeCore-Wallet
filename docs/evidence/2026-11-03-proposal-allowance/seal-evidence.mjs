import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const here=new URL('./',import.meta.url),root=new URL('../../../',here);
const sourceFiles=['src/proposal-allowance.js','src/proposal-allowance-reader.js','src/proposal-allowance-client.js','examples/proposal-allowance-http.js','examples/proposal-allowance-page.js','examples/proposal-allowance.html','examples/dev-server.js','examples/proposal-quote.html','test/proposal-allowance.test.js','test/proposal-allowance-page.test.js','test/helpers/proposal-allowance-fixture.js','integration/proposal-allowance-server.test.mjs'];
const hash=data=>createHash('sha256').update(data).digest('hex');
const sources=[];for(const path of sourceFiles){const bytes=await readFile(new URL(path,root));sources.push({path,bytes:bytes.length,sha256:hash(bytes)});}
await writeFile(new URL('source-inventory.json',here),JSON.stringify({baseCommit:'232e496',sources},null,2)+'\n');
const lines=[];for(const name of (await readdir(here)).filter(n=>n!=='SHA256SUMS.txt').sort()){const bytes=await readFile(new URL(name,here));lines.push(hash(bytes)+'  '+name);}
await writeFile(new URL('SHA256SUMS.txt',here),lines.join('\n')+'\n');console.log(JSON.stringify({sources:sources.length,evidenceFiles:lines.length}));
