import { captureDataRecord } from "./security-data.js";
import { parseSecurityJson,boundedUtf8Length } from "./security-json.js";
import { RehearsalError } from "./operation-rehearsal.js";
import { createRehearsalWorkspace,validateRehearsalWorkspace } from "./operation-rehearsal-workspace.js";
import { createRehearsalScenarioSet,validateRehearsalScenarioSet } from "./operation-rehearsal-scenario-set.js";
import { compareRehearsalWorkspaces } from "./operation-rehearsal-comparison.js";
export const REHEARSAL_SESSION_SCHEMA="threecore.operation-rehearsal-session.v1";
export const REHEARSAL_SESSION_LIMIT=2097152;
const fail=code=>{throw new RehearsalError(code);};
export function validateRehearsalSession(input){let root;try{root=captureDataRecord(input,["schema","simulationOnly","workspace","cases"]);}catch{fail("INVALID_REHEARSAL_SESSION");}
  if(root.schema!==REHEARSAL_SESSION_SCHEMA||root.simulationOnly!==true)fail("INVALID_REHEARSAL_SESSION");
  const session=Object.freeze({schema:REHEARSAL_SESSION_SCHEMA,simulationOnly:true,workspace:validateRehearsalWorkspace(root.workspace),cases:validateRehearsalScenarioSet(root.cases)});
  try{boundedUtf8Length(JSON.stringify(session,null,2)+"\n",REHEARSAL_SESSION_LIMIT);}catch{fail("FILE_TOO_LARGE");}return session;
}
export function encodeRehearsalSession(input){return JSON.stringify(validateRehearsalSession(input),null,2)+"\n";}
export function decodeRehearsalSession(text){let input;try{input=parseSecurityJson(text,{bytes:REHEARSAL_SESSION_LIMIT,depth:24,nodes:150000});}catch{fail("INVALID_SESSION_JSON");}return validateRehearsalSession(input);}
export function compareRehearsalSessions(beforeInput,afterInput){const before=validateRehearsalSession(beforeInput),after=validateRehearsalSession(afterInput);
  const ids=[...new Set([...before.cases.cases,...after.cases.cases].map(item=>item.id))];
  const cases=ids.map(id=>{const old=before.cases.cases.find(row=>row.id===id)??null,next=after.cases.cases.find(row=>row.id===id)??null;
    const changed=JSON.stringify(old)!==JSON.stringify(next);
    return Object.freeze({id,action:!old?"added":!next?"removed":changed?"replaced":"unchanged",before:old,after:next,
      originalInputChanged:Boolean(old&&next&&JSON.stringify(old.before)!==JSON.stringify(next.before)),
      hypotheticalInputChanged:Boolean(old&&next&&JSON.stringify(old.after)!==JSON.stringify(next.after))});
  });
  return Object.freeze({before,after,workspace:compareRehearsalWorkspaces(before.workspace,after.workspace),cases:Object.freeze(cases),
    changed:encodeRehearsalSession(before)!==encodeRehearsalSession(after)});
}

/** The active pair is exchanged once after both replacement stores are fully built. */
export function createRehearsalSession(initialAgent="DAT"){
  let current={workspace:createRehearsalWorkspace(initialAgent),cases:createRehearsalScenarioSet()},disposed=false,revision=0,pending=null;
  const listeners=new Set();const active=()=>{if(disposed)fail("SESSION_DISPOSED");};
  const disposePair=pair=>{pair.workspace.dispose();pair.cases.dispose();};
  const invalidate=()=>{revision++;if(pending){disposePair(pending.next);pending=null;}};
  const notify=()=>{for(const listener of [...listeners]){try{listener();}catch{/* A view failure must not roll back a committed state. */}}};
  const proxies=Object.fromEntries(["workspace","cases"].map(kind=>[kind,Object.freeze(Object.fromEntries(Object.keys(current[kind]).map(name=>[name,(...args)=>{
    active();const mutation=!["state","snapshot"].includes(name);if(mutation)invalidate();
    try{return current[kind][name](...args);}finally{if(mutation)notify();}
  }])))]));
  function snapshot(){active();return validateRehearsalSession({schema:REHEARSAL_SESSION_SCHEMA,simulationOnly:true,workspace:current.workspace.snapshot(),cases:current.cases.state().current});}
  function preview(input){active();invalidate();const own=revision,base=current;
    const document=validateRehearsalSession(input);
    if(disposed||own!==revision||base!==current)fail("STALE_REVIEW");
    const comparison=compareRehearsalSessions(snapshot(),document);
    const next={workspace:createRehearsalWorkspace(document.workspace.activeAgent),cases:createRehearsalScenarioSet(document.cases)};
    try{next.workspace.restore(next.workspace.previewRestore(document.workspace));}
    catch(error){disposePair(next);throw error;}
    if(disposed||own!==revision||base!==current){disposePair(next);fail("STALE_REVIEW");}
    const review=Object.freeze({document,comparison});pending={review,next,base};return review;
  }
  return Object.freeze({...proxies,snapshot,preview,
    commit(review){active();if(!pending||pending.review!==review||pending.base!==current)fail("STALE_REVIEW");
      const previous=current;current=pending.next;pending=null;revision++;disposePair(previous);notify();return snapshot();},
    cancel(){active();invalidate();notify();},
    subscribe(listener){active();if(typeof listener!=="function")fail("INVALID_SESSION_LISTENER");listeners.add(listener);return()=>listeners.delete(listener);},
    dispose(){if(disposed)return;invalidate();disposePair(current);disposed=true;listeners.clear();}
  });
}
