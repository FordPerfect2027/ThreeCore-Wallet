import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolve, win32 } from 'node:path';
import { browserExecutable, browserArguments, stopTestBrowser, removeTestProfile } from '../scripts/browser-runtime.js';
const environment={ProgramFiles:'C:/Apps','ProgramFiles(x86)':'C:/Apps32',LOCALAPPDATA:'C:/User/Local'};
const chrome=win32.resolve(environment.ProgramFiles,'Google/Chrome/Application/chrome.exe');
const edge=win32.resolve(environment['ProgramFiles(x86)'],'Microsoft/Edge/Application/msedge.exe');
test('Windows prefers installed Chrome without consulting an existing user profile',()=>{
  assert.equal(browserExecutable({platform:'win32',environment,exists:path=>[chrome,edge].includes(path)}),chrome);
});
test('Windows falls back to installed Microsoft Edge',()=>{
  assert.equal(browserExecutable({platform:'win32',environment,exists:path=>path===edge}),edge);
});
test('Windows accepts the standard per-user installation',()=>{
  const wanted=win32.resolve(environment.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe');
  assert.equal(browserExecutable({platform:'win32',environment,exists:path=>path===wanted}),wanted);
});
test('missing Windows browser gives an actionable error without a shell search',()=>{
  assert.throws(()=>browserExecutable({platform:'win32',environment,exists:()=>false}),/Install Chrome or Microsoft Edge/);
});
test('Linux retains the existing CI command',()=>assert.equal(browserExecutable({platform:'linux'}),'google-chrome'));
test('unsupported hosts fail explicitly',()=>assert.throws(()=>browserExecutable({platform:'darwin'}),/Windows and Linux/));
test('relative or missing install roots are ignored',()=>{
  let calls=0;assert.throws(()=>browserExecutable({platform:'win32',environment:{ProgramFiles:'relative'},exists:()=>{calls++;return true;}}));assert.equal(calls,0);
});
test('isolated browser arguments keep spaces as one argument and hide extensions',()=>{
  const profile=resolve('threecore-ui-test-with space'),url='http://127.0.0.1:4821/test/browser/?ci-report=example';
  const args=browserArguments(profile,url);assert.ok(args.includes('--user-data-dir='+profile));assert.ok(args.includes('--disable-extensions'));
  assert.equal(args.at(-1),url);assert.ok(!args.some(value=>/no-sandbox|disable-web-security|remote-debugging/.test(value)));
});
for(const url of ['https://example.com/test/browser/','http://127.0.0.1:4821/','http://user@127.0.0.1:4821/test/browser/','--no-sandbox']) {
  test('browser rejects unintended navigation '+url,()=>assert.throws(()=>browserArguments(resolve('threecore-ui-test-safe'),url)));
}
test('browser rejects a normal user-profile name',()=>assert.throws(()=>browserArguments(resolve('Default'),'http://127.0.0.1:4821/test/browser/')));
function child(){const c=new EventEmitter();c.pid=43210;c.exitCode=null;c.signalCode=null;return c;}
test('Windows stops exactly its spawned child PID',async()=>{
  const c=child(),seen=[];await stopTestBrowser(c,{platform:'win32',timeoutMs:100,killTree:async pid=>{seen.push(pid);c.exitCode=0;c.emit('close',0);}});
  assert.deepEqual(seen,[43210]);assert.equal(c.listenerCount('close'),0);
});
test('Linux terminates its own child and detaches the observer',async()=>{
  const c=child();let signal;c.kill=value=>{signal=value;c.signalCode=value;c.emit('close');return true;};
  await stopTestBrowser(c,{platform:'linux',timeoutMs:100});assert.equal(signal,'SIGKILL');assert.equal(c.listenerCount('close'),0);
});
test('shutdown is bounded if the child never exits',async()=>{
  const c=child();await assert.rejects(stopTestBrowser(c,{platform:'win32',timeoutMs:10,killTree:async()=>{}}),/profile is preserved/);
  assert.equal(c.listenerCount('close'),0);
});
test('already-exited and failed-spawn children do not invoke process termination',async()=>{
  let calls=0;const options={platform:'win32',killTree:()=>{calls++;}};
  const ended=child();ended.exitCode=0;await stopTestBrowser(ended,options);
  const failed=child();failed.pid=undefined;await stopTestBrowser(failed,options);assert.equal(calls,0);
});
test('a racing process exit remains successful even if taskkill reports missing PID',async()=>{
  const c=child();await stopTestBrowser(c,{platform:'win32',timeoutMs:100,killTree:async()=>{c.exitCode=0;c.emit('close');throw Error('already exited');}});
});
test('profile cleanup only removes the verified direct temporary child',async()=>{
  const root=resolve('safe-temp'),profile=resolve(root,'threecore-ui-test-123'),calls=[];
  await removeTestProfile(profile,root,{realpath:value=>value,remove:async(...args)=>calls.push(args)});
  assert.equal(calls.length,1);assert.equal(calls[0][0],profile);assert.equal(calls[0][1].recursive,true);
});
for(const target of ['root','escape','unrelated','nested','bare-prefix','redirected'])test('profile cleanup refuses '+target,async()=>{
  const root=resolve('safe-temp'),profile=target==='root'?root:target==='escape'?resolve(root,'..','threecore-ui-test-outside'):
    target==='unrelated'?resolve(root,'user-profile'):target==='nested'?resolve(root,'other','threecore-ui-test-nested'):
    target==='bare-prefix'?resolve(root,'threecore-ui-test-'):resolve(root,'threecore-ui-test-link');
  let calls=0;await assert.rejects(removeTestProfile(profile,root,{realpath:value=>target==='redirected'&&value===profile?resolve(root,'threecore-ui-test-other'):value,
    remove:async()=>{calls++;}}),/nothing removed/);assert.equal(calls,0);
});
