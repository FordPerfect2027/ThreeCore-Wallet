import {readFileSync,writeFileSync} from 'node:fs';
const base='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/';
for(const token of ['DAT','EMA','CAWELON']){
 const root=base+'token-dependency-repair-'+token+'-20261102',path=root+'/package.json',old=readFileSync(path,'utf8');
 writeFileSync(path,old.replace('"test:read-only": "node --test test/*.test.mjs"','"test:read-only": "node --test --test-concurrency=1 test/*.test.mjs"'));
 const doc=root+'/docs/SOURCE_PORTABILITY_2026-11-02.md';writeFileSync(doc,readFileSync(doc,'utf8')+'\nThe read-only command explicitly uses one test file at a time, matching the\nprevious complete passing runs and avoiding test-process startup contention.\nThe request deadlines, assertion coverage and child watchdogs are unchanged.\n');
}
