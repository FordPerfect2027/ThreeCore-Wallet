import {readFileSync,writeFileSync} from 'node:fs';
const base='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/',dat=base+'token-dependency-repair-DAT-20261102';
for(const token of ['DAT','EMA','CAWELON']){
 const root=base+'token-dependency-repair-'+token+'-20261102';
 for(const file of ['scripts/test-contracts.js','integration/test-routing.test.mjs'])if(root!==dat)writeFileSync(root+'/'+file,readFileSync(dat+'/'+file));
 const path=root+'/package.json';let text=readFileSync(path,'utf8');
 text=text.replace('"test": "hardhat test nodejs"','"test": "node scripts/test-contracts.js"').replace('"test:source": "node --test integration/source-portability.test.mjs"','"test:source": "node --test integration/source-portability.test.mjs integration/test-routing.test.mjs"');writeFileSync(path,text);
 const doc=root+'/docs/SOURCE_PORTABILITY_2026-11-02.md';writeFileSync(doc,readFileSync(doc,'utf8')+`
## Test routing correction

The legacy Hardhat command recursively discovered every JavaScript/TypeScript
file under test, including the CLI-only preload in test/support. A complete DAT
attempt produced 288 passing cases and one failure because that preload correctly
refused to run without its test-owned loopback configuration. It also repeated
the 251 read-only cases already assigned to test:read-only.

The test command now enumerates all top-level TypeScript specs for Hardhat;
operational *.test.mjs cases remain in test:read-only, and both groups remain in
npm run check. Support files are loaded only by their owning fixtures. The runner
passes through Hardhat arguments and failure status, rejects an empty suite, and
checks source encoding before Hardhat can implicitly compile. Routing regression
tests exercise the real runner with a fixture child command. No test assertion
was removed or relaxed. New nested TypeScript suites would need an explicit
runner policy update rather than silently entering this top-level suite.
`);
}
console.log('Updated the three test commands and routing regressions.');
