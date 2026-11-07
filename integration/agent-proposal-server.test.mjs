import test from "node:test";
import assert from "node:assert/strict";
import { createProposalHttpHost } from "../server/proposal-http-host.mjs";
import { createAgentProposalService } from "../server/agent-proposal-service.mjs";
import { createOpenAIReadProposer } from "../server/openai-read-proposer.mjs";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { parseAgentProposalRecord } from "../src/agent-proposal-record.js";
import { mountAgentProposalPanel } from "../examples/agent-proposal-panel.js";
import { Element } from "../test/helpers/panel-dom.js";
import { openProposalAttemptJournal, proposalAttemptJournalSupport } from "../server/proposal-attempt-journal.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW=1800000000000, HASH="0x"+"ab".repeat(32);
const address=n=>"0x"+String(n).repeat(40);
async function settle(panel) {
  for(let i=0;i<100;i++) {
    if(panel.getAttribute("aria-busy")==="false") return;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error("UI fixture did not settle");
}

// Production HTTP host on an ephemeral loopback port, with a host-owned service.
// Browser fixture, model and wallet provider remain synthetic.
for (const [index,agent] of ["DAT","EMA","CAWELON"].entries()) for(const chainId of [8453,84532]) {
  test(`${agent}/${chainId}: local HTTP -> mock model -> UI -> pinned read -> saved historical record`,async()=>{
    let service, origin, journal, modelCalls=0;
    const directory=mkdtempSync(join(tmpdir(),"threecore-http-journal-"));
    const journalConfig={filename:join(directory,"attempts.sqlite"),scope:"synthetic-http",maxAttempts:1,now:()=>NOW};
    // Test-owned delegation permits deliberate service recreation below while
    // preserving the origin. No HTTP request can replace this service.
    const host=createProposalHttpHost({enabled:true,createService:()=>({
      handle:r=>service.handle(r),register:r=>service.register(r),revoke:a=>service.revoke(a),dispose:()=>service?.dispose()})});
    origin=(await host.start()).origin;
    const rpc=[],files=[],registry=createAgentReadPolicyRegistry();
    const account=address(index+1),tokenAddress=address(4),spenderAddress=address(5);
    const provider={async request(input){rpc.push(input);switch(input.method){
      case "eth_chainId":return "0x"+chainId.toString(16);
      case "eth_accounts":case "eth_requestAccounts":return [account];
      case "eth_getBlockByNumber":return {number:"0x2a",hash:HASH};
      case "eth_getCode":return "0x6000";
      case "eth_call":return "0x"+"0".repeat(63)+"7";
      default:throw Error("Forbidden synthetic RPC: "+input.method);
    }}};
    const controller=createWalletCardController({agent,siteOrigin:origin,isAccessAllowed:()=>true});
    const parent=new Element("div"),document={createElement:tag=>new Element(tag)};
    let panel,restored;
    try {
      await controller.connect({provider,account,chainId});
      panel=mountAgentProposalPanel({document,parent,agent,registry,
        getContext:()=>({connection:controller.state.connection,tokenAddress,spenderAddress}),
        read:(text,policy,clock)=>controller.inspectAgentProposal(text,policy,clock),
        onCancel:()=>controller.clearResult(),now:()=>NOW,downloadFile:file=>files.push(file),
        newRequestId:()=>"read-1",proposalTransport:{origin,enabled:true,
          // Native browsers supply Origin. This Node-only transport emulates it.
          fetchImpl:(url,init)=>fetch(url,{...init,headers:{...init.headers,origin}})}});
      const q=name=>parent.find("agent-proposal-"+name);
      q("apply").click();
      const adapter=createOpenAIReadProposer({enabled:true,model:"synthetic-no-network",apiKey:"sk-synthetic-test-only",
        now:()=>NOW,newId:()=>`${agent}-http-synthetic`,fetchImpl:async()=>{modelCalls++;
          return new Response(JSON.stringify({status:"completed",output:[{type:"message",role:"assistant",status:"completed",
            content:[{type:"output_text",text:JSON.stringify({decision:"inspect",targetIndex:0,rationale:"Inspect the configured target"})}]}]}),
            {headers:{"content-type":"application/json"}});}});
      if(proposalAttemptJournalSupport().supported)journal=openProposalAttemptJournal({...journalConfig,create:true});
      service=createAgentProposalService({origin,enabled:true,now:()=>NOW,attemptJournal:journal??null});
      const grant=host.register({agent,readContext:()=>({policyText:registry.readPolicyText(agent),sessionState:controller.state.connection}),
        propose:input=>adapter.propose(input),expiresAtMs:NOW+120000});
      const init={method:"POST",headers:{origin,"content-type":"application/json",authorization:`Bearer ${grant.token}`},
        body:JSON.stringify({agent,requestId:"read-1",objective:"Inspect configured target"})};
      const before=rpc.length;
      const unauth=await fetch(grant.endpoint,{...init,headers:{...init.headers,authorization:""}});
      assert.equal(unauth.status,401);await unauth.text();assert.equal(modelCalls,0);
      const denied=await fetch(grant.endpoint,{...init,headers:{...init.headers,origin:"https://other.example"}});
      assert.equal(denied.status,403);await denied.text();assert.equal(modelCalls,0);
      assert.equal(panel.acceptProposalGrant(grant),true);assert.equal(modelCalls,0);
      q("objective").value="Inspect configured target";q("objective").dispatchEvent(new Event("input"));
      q("model-request").click();await settle(q("panel"));
      assert.equal(modelCalls,1);assert.equal(rpc.length,before);
      assert.match(q("model-status").textContent,/入力欄に反映/);
      const response=await fetch(grant.endpoint,init);assert.equal(response.status,200);
      assert.equal(response.headers.get("cache-control"),"no-store");
      const data=await response.json();assert.equal(data.executed,false);assert.equal(modelCalls,1);
      assert.equal(rpc.length,before);assert.equal(q("draft").value,data.proposalText);
      q("model-request").click();await settle(q("panel"));assert.equal(modelCalls,1);
      assert.equal(rpc.length,before); // Receipt is not wallet execution.
      assert.deepEqual(await (await fetch(grant.endpoint,init)).json(),data);assert.equal(modelCalls,1);
      q("inspect").click();await settle(q("panel"));
      assert.equal(controller.state.result.observation.account,account);
      assert.equal(controller.state.result.observation.chainId,chainId);
      assert.equal(controller.state.result.transactionExecuted,false);
      assert.ok(rpc.every(r=>["eth_chainId","eth_accounts","eth_requestAccounts","eth_getBlockByNumber","eth_getCode","eth_call"].includes(r.method)));
      assert.ok(rpc.filter(r=>r.method==="eth_call").every(r=>r.params[1].blockHash===HASH&&r.params[1].requireCanonical===true));
      q("save").click();await settle(q("panel"));assert.equal(files.length,1);
      const record=parseAgentProposalRecord(files[0].text,agent);assert.equal(record.authenticated,false);
      assert.equal(record.result.observation.blockHash,HASH);
      const destination=new Element("div"),unconnectedRegistry=createAgentReadPolicyRegistry();
      restored=mountAgentProposalPanel({document,parent:destination,agent,registry:unconnectedRegistry,
        getContext:()=>({connection:null}),read:()=>{throw Error("Restoration must not read");},onCancel:()=>{},now:()=>NOW+600000});
      const savedRpc=rpc.length;
      const input=destination.find("agent-proposal-file");input.files=[new File([files[0].text],"record.json",{type:"application/json"})];
      input.dispatchEvent(new Event("change"));await settle(destination.find("agent-proposal-panel"));
      destination.find("agent-proposal-restore").click();
      assert.equal(JSON.parse(destination.find("agent-proposal-result").textContent).result.observation.account,account);
      assert.equal(unconnectedRegistry.read(agent),null);assert.equal(rpc.length,savedRpc);
      service.revoke(agent);
      const revoked=await fetch(grant.endpoint,init);assert.equal(revoked.status,401);await revoked.text();assert.equal(modelCalls,1);
      if(journal) {
      service.dispose();journal.close();journal=openProposalAttemptJournal(journalConfig);
      // Allow two local request IDs so the second request exercises the lower
      // persisted limit, rather than stopping at the volatile default of one.
      service=createAgentProposalService({origin,enabled:true,now:()=>NOW,maxRequests:2,attemptJournal:journal});
      const reopened=service.register({agent,readContext:()=>({policyText:registry.readPolicyText(agent),sessionState:controller.state.connection}),
        propose:input=>adapter.propose(input),expiresAtMs:NOW+120000});
      const reissued={...init,headers:{...init.headers,authorization:`Bearer ${reopened.token}`}};
      const duplicate=await fetch(reopened.endpoint,reissued);assert.equal(duplicate.status,409);
      assert.equal((await duplicate.json()).error,"PREVIOUS_ATTEMPT_RECORDED");assert.equal(modelCalls,1);
      const exhausted=await fetch(reopened.endpoint,{...reissued,body:JSON.stringify({agent,requestId:"read-2",objective:"Inspect configured target"})});
      assert.equal(exhausted.status,429);assert.equal((await exhausted.json()).error,"DURABLE_ATTEMPT_LIMIT");
      assert.equal(journal.summary().used,1);assert.equal(modelCalls,1);
      }
    } finally {
      restored?.dispose();panel?.dispose();controller.dispose();await host.close();
      journal?.close();rmSync(directory,{recursive:true,force:true});
    }
  });
}
