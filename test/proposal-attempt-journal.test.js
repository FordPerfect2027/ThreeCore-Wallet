import nodeTest from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, chmodSync, readFileSync, writeFileSync, symlinkSync, linkSync, renameSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { openProposalAttemptJournal, proposalAttemptJournalSupport } from "../server/proposal-attempt-journal.mjs";

const support=proposalAttemptJournalSupport();
const test=(name,fn)=>nodeTest(name,{skip:!support.supported&&"Optional journal needs Node >=24.15 and verified POSIX privacy"},fn);
const {DatabaseSync}=support.supported?await import("node:sqlite"):{};
nodeTest("optional journal reports runtime/platform limits without reading files",()=>{
  assert.equal(support.supported,support.runtimeAvailable&&support.platformVerified);
  if(!support.supported)assert.throws(()=>openProposalAttemptJournal(),error=>
    error.code===(support.runtimeAvailable?"JOURNAL_PLATFORM_UNVERIFIED":"JOURNAL_RUNTIME_UNAVAILABLE"));
});

const NOW=1800000000000, fingerprint="a".repeat(64);
function fixture(t,options={}) {
  const directory=mkdtempSync(join(tmpdir(),"threecore-journal-test-")),filename=join(directory,"attempts.sqlite");
  const opened=[];let time=NOW;
  const config={filename,scope:"synthetic-deployment",maxAttempts:3,now:()=>time,...options};
  const open=(patch={})=>{const j=openProposalAttemptJournal({...config,...patch});opened.push(j);return j;};
  t.after(()=>{for(const j of opened)j.close();rmSync(directory,{recursive:true,force:true});});
  return {directory,filename,config,open,setTime:v=>{time=v;}};
}
const request=(agent="DAT",requestId="request-1")=>({agent,requestId,fingerprint});
const rejects=code=>error=>error.code===code&&error.message===code;
function child(script,args=[]) {
  return new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,["--input-type=module","-e",script,...args],{stdio:["ignore","pipe","pipe"]});
    let output="",errors="";
    p.stdout.on("data",c=>{output+=c;});p.stderr.on("data",c=>{errors+=c;});p.on("error",reject);
    p.on("exit",(code,signal)=>resolve({code,signal,output,errors}));
  });
}
for(const [name,change,code] of [
  ["older runtime",'Object.defineProperty(process.versions,"node",{value:"22.0.0"});',"JOURNAL_RUNTIME_UNAVAILABLE"],
  ["unverified platform",'Object.defineProperty(process,"getuid",{value:undefined});',"JOURNAL_PLATFORM_UNVERIFIED"],
]) nodeTest(`simulated ${name} rejects optional storage without breaking module import`,async()=>{
  const module=new URL("../server/proposal-attempt-journal.mjs",import.meta.url).href;
  const result=await child(`${change}
    const {openProposalAttemptJournal}=await import(${JSON.stringify(module)});
    try {openProposalAttemptJournal(); process.exitCode=2;} catch(error){console.log(error.code);}`);
  assert.equal(result.code,0,result.errors);
  // On an already older runtime, the runtime guard necessarily runs first.
  assert.equal(result.output.trim(),!support.runtimeAvailable?"JOURNAL_RUNTIME_UNAVAILABLE":code);
});
test("creation is explicit; reopen retains consumed attempts and never returns claim secret",t=>{
  const f=fixture(t);assert.throws(()=>f.open(),rejects("JOURNAL_UNAVAILABLE"));assert.equal(existsSync(f.filename),false);
  const j=f.open({create:true}),claim=j.reserve(request());assert.equal(claim.status,"reserved");
  assert.match(claim.reservation,/^[a-f0-9]{64}$/);assert.equal(statSync(f.filename).mode&0o777,0o600);
  j.close();const recovered=f.open();assert.deepEqual(recovered.reserve(request()),{status:"existing",outcome:"reserved",reservation:null});
  assert.equal(recovered.summary().used,1);assert.equal(recovered.summary().reserved,1);
  assert.equal(recovered.summary().monetaryBudget,false);
});
test("existing database cannot be recreated or quota silently increased",t=>{
  const f=fixture(t);f.open({create:true}).close();const before=readFileSync(f.filename);
  assert.throws(()=>f.open({create:true}),rejects("JOURNAL_UNAVAILABLE"));
  assert.throws(()=>f.open({maxAttempts:4}),rejects("JOURNAL_CONFIG_MISMATCH"));
  assert.throws(()=>f.open({scope:"other-deployment"}),rejects("JOURNAL_CONFIG_MISMATCH"));
  assert.deepEqual(readFileSync(f.filename),before);
});
for(const outcome of ["completed","failed"])test(`${outcome} persists; settlement is idempotent but never reverses`,t=>{
  const f=fixture(t),j=f.open({create:true}),claim=j.reserve(request());
  const data={agent:"DAT",requestId:"request-1",reservation:claim.reservation,outcome};
  assert.deepEqual(j.settle(data),{status:outcome});assert.deepEqual(j.settle(data),{status:outcome});
  assert.throws(()=>j.settle({...data,outcome:outcome==="failed"?"completed":"failed"}),rejects("JOURNAL_OUTCOME_CONFLICT"));
  j.close();const next=f.open();assert.equal(next.reserve(request()).outcome,outcome);assert.equal(next.summary()[outcome],1);
});
test("global quota spans all three agents and reopened handles",t=>{
  const f=fixture(t),j=f.open({create:true});
  for(const agent of ["DAT","EMA","CAWELON"])j.reserve(request(agent));
  assert.equal(j.summary().remaining,0);j.close();
  const next=f.open();assert.throws(()=>next.reserve(request("DAT","new")),rejects("JOURNAL_LIMIT_REACHED"));
  assert.equal(next.reserve(request("DAT")).status,"existing");
});
test("different fingerprint under same agent/request ID is a conflict, not a new attempt",t=>{
  const f=fixture(t),j=f.open({create:true});j.reserve(request());
  assert.throws(()=>j.reserve({...request(),fingerprint:"b".repeat(64)}),rejects("JOURNAL_REQUEST_CONFLICT"));
  assert.equal(j.summary().used,1);
});
test("foreign agent, missing attempt or guessed reservation cannot settle",t=>{
  const f=fixture(t),j=f.open({create:true}),claim=j.reserve(request());
  for(const data of [{agent:"EMA",requestId:"request-1",reservation:claim.reservation},
    {agent:"DAT",requestId:"absent",reservation:claim.reservation},{agent:"DAT",requestId:"request-1",reservation:"0".repeat(64)}])
    assert.throws(()=>j.settle({...data,outcome:"completed"}),rejects("JOURNAL_RESERVATION_MISMATCH"));
  assert.equal(j.summary().reserved,1);
});
for(const data of [{...request(),agent:"X"},{...request(),requestId:""},{...request(),requestId:"a".repeat(97)},
  {...request(),fingerprint:"raw objective"},{...request(),extra:true},Object.defineProperty({...request()},"fingerprint",{get(){throw Error("getter");}})]){
  test("malformed request cannot create a claim",t=>{const f=fixture(t),j=f.open({create:true});assert.throws(()=>j.reserve(data),rejects("INVALID_JOURNAL_REQUEST"));assert.equal(j.summary().used,0);});
}
test("clock rollback across process restart rejects new reservations",t=>{
  const f=fixture(t),j=f.open({create:true});j.reserve(request());j.close();f.setTime(NOW-1);
  const next=f.open();assert.throws(()=>next.reserve(request("EMA")),rejects("JOURNAL_CLOCK_INVALID"));assert.equal(next.summary().used,1);
});
test("throwing/asynchronous clock cannot reserve",t=>{
  const f=fixture(t);f.open({create:true}).close();
  for(const now of [()=>{throw Error("private");},async()=>{throw Error("private");},()=>NaN]) {
    const j=f.open({now});assert.throws(()=>j.reserve(request()),rejects("JOURNAL_CLOCK_INVALID"));assert.equal(j.summary().used,0);j.close();
  }
});
test("closed handles never imply a successful save",t=>{
  const f=fixture(t),j=f.open({create:true});j.close();j.close();
  assert.throws(()=>j.reserve(request()),rejects("JOURNAL_CLOSED"));assert.throws(()=>j.summary(),rejects("JOURNAL_CLOSED"));
});
test("journal stores hashes, not objective/request ID or API credentials",t=>{
  const f=fixture(t),j=f.open({create:true});j.reserve(request("DAT","private-request-marker"));j.close();
  assert.equal(readFileSync(f.filename).includes(Buffer.from("private-request-marker")),false);
});
test("file identity replacement fails closed instead of consuming an unlinked journal",t=>{
  const f=fixture(t),j=f.open({create:true});j.reserve(request());
  renameSync(f.filename,join(f.directory,"original.sqlite"));writeFileSync(f.filename,"replacement",{mode:0o600});
  assert.throws(()=>j.reserve(request("EMA")),rejects("JOURNAL_FILE_CHANGED"));
  assert.throws(()=>j.reserve(request("EMA")),rejects("JOURNAL_UNAVAILABLE"));
});
test("symlink, hardlink, broad permissions and nonprivate directory are rejected",t=>{
  const f=fixture(t),j=f.open({create:true});j.close();
  const target=join(f.directory,"alias.sqlite");symlinkSync(f.filename,target);
  assert.throws(()=>f.open({filename:target}),rejects("INVALID_JOURNAL_FILE"));
  const hard=join(f.directory,"hard.sqlite");linkSync(f.filename,hard);
  assert.throws(()=>f.open(),rejects("INVALID_JOURNAL_FILE"));
  const g=fixture(t);g.open({create:true}).close();chmodSync(g.filename,0o644);
  assert.throws(()=>g.open(),rejects("INVALID_JOURNAL_FILE"));chmodSync(g.filename,0o600);chmodSync(g.directory,0o755);
  assert.throws(()=>g.open(),rejects("JOURNAL_DIRECTORY_NOT_PRIVATE"));
});
test("malformed existing file is preserved, not reset",t=>{
  const f=fixture(t);writeFileSync(f.filename,"corrupt-original",{mode:0o600});
  assert.throws(()=>f.open(),rejects("JOURNAL_UNAVAILABLE"));assert.equal(readFileSync(f.filename,"utf8"),"corrupt-original");
});
test("foreign schema is rejected without deleting it",t=>{
  const f=fixture(t);f.open({create:true}).close();const db=new DatabaseSync(f.filename);db.exec("CREATE TABLE extra (value TEXT)");db.close();
  assert.throws(()=>f.open(),rejects("INVALID_JOURNAL_SCHEMA"));
});
test("rejected unrelated database retains its existing journal mode",t=>{
  const f=fixture(t);writeFileSync(f.filename,"",{mode:0o600});
  const db=new DatabaseSync(f.filename);db.exec("PRAGMA journal_mode=WAL; CREATE TABLE unrelated(value TEXT)");db.close();
  assert.throws(()=>f.open(),rejects("INVALID_JOURNAL_SCHEMA"));
  const preserved=new DatabaseSync(f.filename);
  try {assert.equal(preserved.prepare("PRAGMA journal_mode").get().journal_mode,"wal");}
  finally {preserved.close();}
});
test("storage lock prevents reservation and never automatically retries",t=>{
  const f=fixture(t),j=f.open({create:true}),blocker=new DatabaseSync(f.filename);blocker.exec("BEGIN IMMEDIATE");
  try {assert.throws(()=>j.reserve(request()),rejects("JOURNAL_UNAVAILABLE"));}
  finally {blocker.exec("ROLLBACK");blocker.close();}
  assert.throws(()=>j.reserve(request()),rejects("JOURNAL_UNAVAILABLE"));j.close();assert.equal(f.open().summary().used,0);
});
test("two processes racing for one request create exactly one committed reservation",async t=>{
  const f=fixture(t);f.open({create:true}).close();
  const module=new URL("../server/proposal-attempt-journal.mjs",import.meta.url).href;
  const script=`import {openProposalAttemptJournal} from ${JSON.stringify(module)};
    const j=openProposalAttemptJournal({filename:process.argv[1],scope:"synthetic-deployment",maxAttempts:3,now:()=>${NOW}});
    console.log(JSON.stringify(j.reserve({agent:"DAT",requestId:"request-1",fingerprint:"${fingerprint}"})));j.close();`;
  const results=await Promise.all([child(script,[f.filename]),child(script,[f.filename])]);
  assert.ok(results.every(r=>r.code===0),JSON.stringify(results));
  assert.deepEqual(results.map(r=>JSON.parse(r.output).status).sort(),["existing","reserved"]);
  assert.equal(f.open().summary().used,1);
});
test("abrupt child exit after commit leaves reserved outcome, never an automatic retry",async t=>{
  const f=fixture(t);f.open({create:true}).close();
  const module=new URL("../server/proposal-attempt-journal.mjs",import.meta.url).href;
  const script=`import {openProposalAttemptJournal} from ${JSON.stringify(module)};
    const j=openProposalAttemptJournal({filename:process.argv[1],scope:"synthetic-deployment",maxAttempts:3,now:()=>${NOW}});
    j.reserve({agent:"DAT",requestId:"request-1",fingerprint:"${fingerprint}"});process.exit(7);`;
  assert.equal((await child(script,[f.filename])).code,7);
  const j=f.open();assert.equal(j.reserve(request()).status,"existing");assert.equal(j.summary().reserved,1);
});

test("two processes racing for last global slot never exceed persisted quota",async t=>{
  const f=fixture(t,{maxAttempts:1});f.open({create:true}).close();
  const module=new URL("../server/proposal-attempt-journal.mjs",import.meta.url).href;
  const script=`import {openProposalAttemptJournal} from ${JSON.stringify(module)};
    const j=openProposalAttemptJournal({filename:process.argv[1],scope:"synthetic-deployment",maxAttempts:1,now:()=>${NOW}});
    try { console.log(j.reserve({agent:process.argv[2],requestId:"request-1",fingerprint:"${fingerprint}"}).status); }
    catch(error) { console.log(error.code); } finally { j.close(); }`;
  const results=await Promise.all([child(script,[f.filename,"DAT"]),child(script,[f.filename,"EMA"])]);
  assert.ok(results.every(r=>r.code===0),JSON.stringify(results));
  assert.deepEqual(results.map(r=>r.output.trim()).sort(),["JOURNAL_LIMIT_REACHED","reserved"]);
  assert.equal(f.open().summary().used,1);
});
