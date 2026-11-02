import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const root="C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/token-toolchain-empty-data-DAT-20261102", logRoot="C:/Users/aseet/AppData/Local/Temp/threecore-zod4-applied-20261103/DAT";
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|systemdrive|windir|temp|tmp|comspec|pathext)$/i.test(key)));
const startedAt=new Date().toISOString();
const run=spawnSync(process.execPath,['C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js','ls','--all','--json','--userconfig='+logRoot+'/empty-user.npmrc','--globalconfig='+logRoot+'/empty-global.npmrc'],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:2000000});
await writeFile(logRoot+'/installed-graph.json',run.stdout);await writeFile(logRoot+'/installed-graph-stderr.log',run.stderr);const result={startedAt,endedAt:new Date().toISOString(),code:run.status,signal:run.signal,problems:JSON.parse(run.stdout).problems??[]};await writeFile(logRoot+'/installed-graph-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exitCode=run.status??1;
