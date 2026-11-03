import { captureDataRecord } from "./security-data.js";
import { parseSecurityJson,boundedUtf8Length } from "./security-json.js";
import { RehearsalError } from "./operation-rehearsal.js";
import { createRehearsalWorkspace,validateRehearsalWorkspace } from "./operation-rehearsal-workspace.js";
import { createRehearsalScenarioSet,validateRehearsalScenarioSet } from "./operation-rehearsal-scenario-set.js";
import { compareRehearsalWorkspaces } from "./operation-rehearsal-comparison.js";
import { createStateNotifier } from "./state-notifier.js";
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

/** Page-local comparison with the last offered download or restored local file.
 * This does not prove that the browser completed a download or wrote a file.
 * The currently selected agent is a view choice, not a changed ledger.
 */
export function createRehearsalSaveCheckpoint(){
  let baseline=null,source=null,revision=0;
  const capture=input=>{
    const data=validateRehearsalSession(input);
    return {data,key:JSON.stringify({...data,workspace:{...data.workspace,activeAgent:"DAT"}})};
  };
  return Object.freeze({
    record(input,kind){
      if(!["download","file"].includes(kind))fail("INVALID_SAVE_CHECKPOINT");
      const own=++revision;
      let next;
      try{next=capture(input);}
      catch(error){if(own!==revision)return;throw error;}
      if(own!==revision)return;
      baseline=next.key;source=kind;
    },
    inspect(input){
      const {data,key}=capture(input),ledgers=data.workspace.ledgers.length,cases=data.cases.cases.length;
      const state=!ledgers&&!cases?"empty":baseline===null?"unrecorded":key===baseline?"matched":"changed";
      return Object.freeze({state,hasChanges:state==="unrecorded"||state==="changed",source,
        ledgers,records:data.workspace.ledgers.reduce((count,item)=>count+item.events.length,0),cases});
    },
    clear(){revision++;baseline=null;source=null;}
  });
}
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
  // Views observe the revision, never a payload retained by the notifier. Shared
  // delivery bounds reentrant edits and consumes rejected observer promises.
  const notifier=createStateNotifier({observers:listeners,read:()=>Object.freeze({revision})});
  const notify=()=>notifier.notify();
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
    isCurrentReview(review){return !disposed&&Boolean(pending)&&pending.review===review&&pending.base===current;},
    commit(review){active();if(!pending||pending.review!==review||pending.base!==current)fail("STALE_REVIEW");
      const previous=current;current=pending.next;pending=null;revision++;disposePair(previous);
      // A view may perform another edit or dispose the session during delivery.
      // Preserve this commit's receipt before calling external observers.
      const restored=snapshot();notify();return restored;},
    cancel(){active();invalidate();notify();},
    subscribe(listener){active();if(typeof listener!=="function")fail("INVALID_SESSION_LISTENER");
      if(!listeners.has(listener)&&listeners.size>=64)fail("SESSION_LISTENER_LIMIT");
      listeners.add(listener);return()=>{notifier.forget(listener);return listeners.delete(listener);};},
    dispose(){if(disposed)return;invalidate();disposePair(current);disposed=true;listeners.clear();}
  });
}
