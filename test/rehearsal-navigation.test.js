import test from "node:test";import assert from "node:assert/strict";
import{mountRehearsalNavigation}from"../examples/operation-rehearsal-page.js";
class Link extends EventTarget{constructor(id,href="#"+id){super();this.id=id;this.href=href;}getAttribute(name){return name==="href"?this.href:this.id;}}
function setup(){
 const ancestor={tagName:"DETAILS",open:false,parentElement:null},target={parentElement:ancestor,focus(){focus++;}},link=new Link("report-evidence-title");let focus=0;
 const panel=mountRehearsalNavigation({querySelectorAll:()=>[link],getElementById:()=>target});return{link,target,ancestor,panel,focus:()=>focus};
}
test("rehearsal links open their containing details and move focus without cancelling native navigation",()=>{
 const f=setup();try{const event=new Event("click",{cancelable:true});f.link.dispatchEvent(event);assert.equal(f.focus(),1);assert.equal(f.ancestor.open,true);assert.equal(event.defaultPrevented,false);}finally{f.panel.dispose();}
});
test("modified or previously cancelled navigation leaves focus and disclosure unchanged",()=>{
 const f=setup();try{for(const field of["ctrlKey","metaKey","shiftKey","altKey","button","defaultPrevented"]){const event=new Event("click",{cancelable:true});
 if(field==="defaultPrevented")event.preventDefault();else Object.defineProperty(event,field,{value:field==="button"?1:true});f.link.dispatchEvent(event);assert.equal(f.focus(),0);assert.equal(f.ancestor.open,false);
 }}finally{f.panel.dispose();}
});
test("disposal removes focus side effects and a new mount restores them once",()=>{
 const f=setup();f.panel.dispose();f.panel.dispose();f.link.dispatchEvent(new Event("click"));assert.equal(f.focus(),0);
 const again=mountRehearsalNavigation({querySelectorAll:()=>[f.link],getElementById:()=>f.target});try{f.link.dispatchEvent(new Event("click"));assert.equal(f.focus(),1);}finally{again.dispose();}
});
test("unknown destinations, external links and missing targets are not intercepted",()=>{
 let focus=0;const links=[new Link("unexpected"),new Link("session-title","https://example.invalid/#session-title"),new Link("workspace-title")];
 const panel=mountRehearsalNavigation({querySelectorAll:()=>links,getElementById:id=>id==="workspace-title"?null:{focus(){focus++;}}});
 try{for(const link of links)link.dispatchEvent(new Event("click"));assert.equal(focus,0);}finally{panel.dispose();}
});
