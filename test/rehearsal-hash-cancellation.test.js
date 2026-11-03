import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { Element } from "./helpers/panel-dom.js";
import { newReportFixtures } from "./helpers/rehearsal-report-fixtures.js";
import { deferred, tick } from "./helpers/file-boundary-fixtures.js";
import { mountRehearsalReviewPanel } from "../examples/operation-rehearsal-review-panel.js";
const text = JSON.stringify(newReportFixtures().matching);

function setup(subtle) {
  const tasks = [], elements = new Map(), downloads = [];
  class Node extends Element {
    constructor(tag) { super(tag); this.callbacks = new Map(); }
    set textContent(value) { this.text=value;this.children=[]; }
    get textContent() { return this.text; }
    addEventListener(type, callback, options) {
      const wrapped = event => { const result=callback(event); if(result?.then)tasks.push(result); };
      this.callbacks.set(callback,wrapped); super.addEventListener(type,wrapped,options);
    }
    removeEventListener(type, callback, options) { super.removeEventListener(type,this.callbacks.get(callback),options);this.callbacks.delete(callback); }
  }
  const document = {getElementById(id){if(!elements.has(id))elements.set(id,new Node("div"));return elements.get(id);},createElement:tag=>new Node(tag)};
  const field = name => document.getElementById("report-review-"+name);
  const panel=mountRehearsalReviewPanel(document,{subtle,download:value=>downloads.push(value)});
  const paste=()=>{field("text").value=text;field("text").dispatchEvent(new Event("input"));field("paste").click();return tasks.at(-1);};
  return {panel,field,paste,downloads};
}

for (const action of ["clear","expected","text","dispose"]) {
  test(`rehearsal review: ${action} ends the obsolete digest wait`, async () => {
    const gate=deferred(),started=deferred();let settled=false;
    const f=setup({digest(){started.resolve();return gate.promise;}});
    const pending=f.paste().then(()=>{settled=true;});
    try {
      await started.promise;
      if(action==="dispose")f.panel.dispose();
      else if(action==="clear")f.field("clear").click();
      else {f.field(action).value=action==="expected"?"0".repeat(64):"new input";f.field(action).dispatchEvent(new Event("input"));}
      await tick();assert.equal(settled,true);assert.equal(f.field("save").disabled,true);assert.equal(f.downloads.length,0);
    } finally {gate.resolve(new ArrayBuffer(32));await pending;f.panel.dispose();await tick();}
  });
}

test("an obsolete review cannot cancel a newer digest or publish its receipt", async () => {
  const first=deferred(),second=deferred();let calls=0;
  const f=setup({digest(){return ++calls===1?first.promise:second.promise;}});
  const older=f.paste();f.field("clear").click();const newer=f.paste();
  first.resolve(new ArrayBuffer(32));await older;await tick();
  assert.equal(f.field("save").disabled,true);
  second.resolve(await webcrypto.subtle.digest("SHA-256",new TextEncoder().encode(text)));
  await newer;assert.equal(f.field("save").disabled,false);assert.match(f.field("status").textContent,/再計算と一致/);
  f.panel.dispose();
});
