import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const repo='<WALLET_REPOSITORY>';
const downloads='<PRIVATE_INPUT_DIRECTORY>';
const output=join(downloads,'ThreeCore-private-empty-store-20261102');
await mkdir(output);
const load=file=>import(pathToFileURL(join(repo,file)));
const {createDemoServer}=await load('examples/dev-server.js');
const {SECURITY_HEADERS,inspectLocalRequest}=await load('examples/security-http.js');
const {installBrowserCompletion}=await load('scripts/browser-completion.js');
const {checkBrowserResult}=await load('scripts/browser-result.js');
const {browserExecutable,browserArguments,stopTestBrowser,removeTestProfile}=await load('scripts/browser-runtime.js');
const {decodeVaultCollection}=await load('src/transfer-vault-collection.js');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources=[],fixtures=[],nonce=randomUUID();
for(const name of ['ThreeCore-transfer-vault-collection.json','ThreeCore-transfer-vault-collection (1).json','ThreeCore-transfer-vault-collection (2).json']){
 const bytes=await readFile(join(downloads,name));assert(bytes.length<1024*1024);
 const text=bytes.toString('utf8'),parsed=await decodeVaultCollection(text),digest=sha(bytes);
 sources.push({name,sha256:digest,bytes:bytes.length,entries:parsed.document.entries.length});
 if(!fixtures.some(x=>x.sha256===digest))fixtures.push({text,sha256:digest,database:'threecore-private-recovery-'+randomUUID()});
}
const sourceModule=await readFile(join(repo,'test/browser/transfer-vault-ui-tests.js'),'utf8');
const boundary=sourceModule.indexOf('export function registerVaultUITests');assert(boundary>0);
const runner=sourceModule.slice(0,boundary)+'\nimport { decodeVaultCollection } from "/src/transfer-vault-collection.js";\n'+await readFile('<METHOD_DIRECTORY>/threecore-private-recovery-body-20261102.js','utf8');
const baseHtml=await readFile(join(repo,'test/browser/index.html'),'utf8');
const html=baseHtml.replace('src="/test/browser/ui-tests.js"','src="/test/browser/ui-tests.js?private='+nonce+'"').replaceAll('ThreeCore synthetic Wallet UI tests','ThreeCore private actual-file recovery').replace('ThreeCore Wallet・模擬画面テスト','ThreeCore・実保存ファイルの隔離復元検証');
const server=createDemoServer({uiTest:true}),original=server.listeners('request')[0];
server.removeListener('request',original);
server.on('request',(request,response)=>{
 const allowed=inspectLocalRequest(request);if(allowed.status!==200)return original(request,response);
 const url=new URL(request.url,'http://127.0.0.1:'+server.address().port);
 let content,type;
 if(url.pathname==='/test/browser/'&&url.searchParams.get('private')===nonce){content=html;type='text/html; charset=utf-8';}
 else if(url.pathname==='/test/browser/ui-tests.js'&&url.searchParams.get('private')===nonce){content=runner;type='text/javascript; charset=utf-8';}
 else if(url.pathname==='/test/browser/private-data/'+nonce+'.json'){content=JSON.stringify(fixtures);type='application/json; charset=utf-8';}
 else return original(request,response);
 if(request.method!=='GET'){response.writeHead(405,SECURITY_HEADERS);response.end();return;}
 response.writeHead(200,{...SECURITY_HEADERS,'content-type':type});response.end(content);
});
const temp=resolve(tmpdir()),results=[];let profile,browser,receipt,closed=false,profileRemoved=false;
try{
 profile=await mkdtemp(join(temp,'threecore-ui-test-'));
 await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
 for(const phase of [1,2]){
  receipt=installBrowserCompletion(server,{timeoutMs:90000});
  const url='http://127.0.0.1:'+server.address().port+'/test/browser/?private='+nonce+'&phase='+phase+'&ci-report='+receipt.nonce;
  browser=spawn(browserExecutable(),browserArguments(profile,url),{windowsHide:true,stdio:['ignore','ignore','ignore']});
  browser.on('error',error=>receipt.fail(error));browser.once('close',code=>receipt.fail(Error('Private test browser exited before reporting: '+code)));
  const page=await receipt.result;
  await writeFile(join(output,'phase-'+phase+'.html'),page);
  const result=checkBrowserResult(page,undefined,fixtures.length);assert.equal(result.total,fixtures.length);
  const content=page.match(/<pre id="private-recovery-result">([\s\S]*?)<\/pre>/)?.[1];assert(content);
  const detail=JSON.parse(content.replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&'));
  results.push({phase,...result,...detail});
  console.log(JSON.stringify({phase,passed:result.passed,actualFiles:fixtures.length,processId:browser.pid}));
  await stopTestBrowser(browser);browser=undefined;receipt.dispose();receipt=undefined;
 }
 for(const source of sources)assert.equal(sha(await readFile(join(downloads,source.name))),source.sha256);
}finally{
 await stopTestBrowser(browser);receipt?.dispose();
 server.closeAllConnections();await new Promise(yes=>server.close(yes));closed=true;
 if(profile){await removeTestProfile(profile,temp);profileRemoved=true;}
 const record={recordedAt:new Date().toISOString(),sourceRevision:'0405370b38c43e599dda0b475c88e1ec1850034a',originalFiles:sources,distinctFileContents:fixtures.length,phases:results,allPassed:results.length===2&&results.every(x=>x.failed===0&&x.passed===fixtures.length),independentBrowserProcesses:2,usedSameOwnedProfileAcrossPhases:true,temporaryProfileRemoved:profileRemoved,ownServerClosed:closed,originalUserBrowserTouched:false,original4231ServerTouched:false,realWalletUsed:false,osFilePickerExercised:false,sourceFilesUnmodified:results.length===2};
 await writeFile(join(output,'verification.json'),JSON.stringify(record,null,2)+'\n');
 console.log(JSON.stringify({complete:record.allPassed,output,ownServerClosed:closed,temporaryProfileRemoved:profileRemoved}));
}
