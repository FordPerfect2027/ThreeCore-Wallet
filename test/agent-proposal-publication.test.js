import test from "node:test";
import assert from "node:assert/strict";
import { createAgentProposalController } from "../src/agent-proposal-controller.js";

const NOW = 1800000000000;
const HASH = "0x" + "aa".repeat(32);
const address = n => "0x" + String(n).repeat(40);

// In-memory read adapters only: no provider, connection request or transport.
function fixture(onChange) {
  const reads = [];
  let binding = { agent: "DAT", account: address(1), chainId: 84532,
    siteOrigin: "https://fixture.example" };
  let epoch = 1;
  const makeSession = () => {
    const state = Object.freeze({ ...binding, connectionEpoch: epoch, connected: true,
      canSign: false, canSendTransactions: false, canBridge: false });
    const note = method => reads.push({ method, account: state.account, chainId: state.chainId });
    return {
      state,
      async getBlockSnapshot() { note("block"); return { number: "0x2a", hash: HASH }; },
      async getContractCode(address) { note("code"); return { address, deployed: true }; },
      async getTokenBalance() { note("balance"); return 0n; },
      async getTokenAllowance() { note("allowance"); return 0n; },
    };
  };
  let session = makeSession();
  const policy = () => ({ schema: "threecore-agent-read-policy-v1", revision: `v${epoch}`,
    ...binding, maxProposalAgeMs: 1000,
    targets: [{ tokenAddress: address(4), spenderAddress: address(5) }] });
  const controller = createAgentProposalController({ agent: "DAT", getSession: () => session,
    readPolicyText: () => JSON.stringify(policy()), now: () => NOW,
    onChange: state => onChange(state, controller) });
  const run = id => controller.inspect(JSON.stringify({
    schema: "threecore-agent-read-proposal-v1", id, ...binding, connectionEpoch: epoch,
    policyRevision: policy().revision, createdAtMs: NOW, expiresAtMs: NOW + 1000,
    rationale: "Offline publication lifecycle fixture", action: { kind: "inspect-spender", ...policy().targets[0] },
  }));
  return { controller, reads, run, get session() { return session; },
    replaceSession() {
      binding = { ...binding, account: address(2), chainId: 8453 };
      epoch++;
      session = makeSession();
    },
  };
}

for (const action of ["stop", "dispose"]) {
  test(`${action} during final proposal publication cannot report acceptance`, async t => {
    let cancelOnPublication = true;
    const f = fixture((state, controller) => {
      if (cancelOnPublication && state.status === "observed-read-only") controller[action]();
    });
    t.after(() => f.controller.dispose());
    const accepted = await f.run("cancelled-result");
    assert.equal(f.controller.state.status, "stopped");
    assert.equal(f.controller.state.result, null);
    assert.equal(f.session.state.connected, true, "proposal cancellation does not revoke the wallet session");
    assert.equal(f.reads.length, 6);
    assert.equal(accepted, false, "the caller must not accept a synchronously cancelled result");

    cancelOnPublication = false;
    const recovered = await f.run("explicit-recovery");
    assert.equal(recovered, action === "stop");
    assert.equal(f.reads.length, action === "stop" ? 12 : 6);
    if (action === "stop") assert.equal(f.controller.state.result.proposalId, "explicit-recovery");
    else assert.equal(f.controller.state.status, "stopped");
  });
}

test("publication cancellation preserves an explicitly restarted replacement session", async t => {
  let replacement;
  const f = fixture((state, controller) => {
    if (state.status === "observed-read-only" && state.result.proposalId === "old-session") {
      controller.stop();
      f.replaceSession();
      replacement = f.run("new-session");
    }
  });
  t.after(() => f.controller.dispose());
  const oldAccepted = await f.run("old-session");
  assert.equal(await replacement, true);
  assert.equal(f.controller.state.status, "observed-read-only");
  assert.equal(f.controller.state.result.proposalId, "new-session");
  assert.equal(f.controller.state.result.observation.account, address(2));
  assert.equal(f.controller.state.result.observation.chainId, 8453);
  assert.deepEqual(f.reads.map(row => row.account), [
    ...Array(6).fill(address(1)), ...Array(6).fill(address(2)),
  ]);
  assert.equal(oldAccepted, false, "completion of the old operation cannot stand for the replacement");
});
