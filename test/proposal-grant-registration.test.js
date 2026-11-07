import test from "node:test";
import assert from "node:assert/strict";
import { createAgentProposalService } from "../server/agent-proposal-service.mjs";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";

// Native in-memory Request/Response and synthetic identities only; no network.
const ORIGIN = "http://127.0.0.1:4230";
const NOW = 1800000000000;
const address = n => "0x" + n.repeat(40);
const result = () => ({ status: "abstained", rationale: "Synthetic registration boundary",
  proposalText: null, executed: false, grantsAuthority: false });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function host(agent = "DAT", propose = result) {
  const registry = createAgentReadPolicyRegistry();
  const state = { agent, account: address({ DAT: "a", EMA: "b", CAWELON: "c" }[agent]),
    chainId: 84532, siteOrigin: ORIGIN, connectionEpoch: 1, connected: true,
    canSign: false, canSendTransactions: false, canBridge: false };
  registry.set(agent, JSON.stringify({ schema: "threecore-agent-read-config-v1", agent,
    account: state.account, chainId: state.chainId, siteOrigin: ORIGIN, maxProposalAgeMs: 60000,
    targets: [{ tokenAddress: address("1"), spenderAddress: address("2") }] }));
  const readContext = () => ({ policyText: registry.readPolicyText(agent), sessionState: { ...state } });
  let calls = 0;
  return { readContext, calls: () => calls, registration: { agent, readContext, expiresAtMs: NOW + 120000,
    propose: input => { calls++; return propose(input); } } };
}
function fixture(t) {
  let time = NOW, clocks = 0, clockHook = null, hookIndex = 0;
  const service = createAgentProposalService({ origin: ORIGIN, enabled: true, timeoutMs: 5000,
    now: () => {
      clocks++;
      if (clockHook && --hookIndex === 0) {
        const callback = clockHook; clockHook = null; callback();
      }
      return time;
    } });
  t.after(() => service.dispose());
  return { service, setTime: value => { time = value; }, clocks: () => clocks,
    onClock(callback, index = 1) { clockHook = callback; hookIndex = index; } };
}
function attempt(service, registration) {
  try { return { grant: service.register(registration), code: null }; }
  catch (error) { return { grant: null, code: error.code }; }
}
async function use(service, grant, requestId = "synthetic-registration") {
  if (!grant) return null;
  return (await service.handle(new Request(grant.endpoint, { method: "POST", headers: {
    origin: ORIGIN, "content-type": "application/json", authorization: `Bearer ${grant.token}`,
  }, body: JSON.stringify({ agent: grant.agent, requestId, objective: "Inspect configured target" }) }))).status;
}
function stop(service, action, newest) {
  if (action === "revoke") service.revoke("DAT");
  else if (action === "dispose") service.dispose();
  else newest.grant = service.register(newest.host.registration);
}

for (const boundary of ["clock", "context"]) for (const action of ["revoke", "dispose", "replace"]) {
  test(`registration ${boundary} ${action} cannot commit an obsolete grant`, async t => {
    // Exercise every registration clock boundary without depending on its count.
    const probe = fixture(t);
    probe.service.register(host().registration);
    const count = boundary === "clock" ? probe.clocks() : 1;
    for (let index = 1; index <= count; index++) {
      const f = fixture(t), outer = host(), newest = { host: host(), grant: null };
      const callback = () => stop(f.service, action, newest);
      if (boundary === "clock") f.onClock(callback, index);
      else {
        let pending = true;
        outer.registration.readContext = () => {
          if (pending) { pending = false; callback(); }
          return outer.readContext();
        };
      }
      const issued = attempt(f.service, outer.registration);
      const outerStatus = await use(f.service, issued.grant);
      const newestStatus = await use(f.service, newest.grant);
      assert.deepEqual({ issued: !!issued.grant, code: issued.code, outerStatus,
        outerCalls: outer.calls(), newestStatus, newestCalls: newest.host.calls() },
      { issued: false, code: "SESSION_REVOKED", outerStatus: null, outerCalls: 0,
        newestStatus: action === "replace" ? 200 : null, newestCalls: action === "replace" ? 1 : 0 },
      `${boundary} callback ${index}`);
    }
  });
}

async function running(t, callback) {
  const f = fixture(t), started = deferred(), finish = deferred();
  let callbackError = null;
  const old = host("DAT", ({ signal }) => {
    signal.addEventListener("abort", () => {
      try { callback(f); } catch (error) { callbackError = error; }
      finally { finish.resolve(result()); }
    }, { once: true });
    started.resolve();
    return finish.promise;
  });
  const grant = f.service.register(old.registration);
  const pending = use(f.service, grant, "old-running-request");
  await started.promise;
  t.after(() => finish.resolve(result()));
  return { ...f, old, grant, pending, callbackError: () => callbackError };
}
for (const action of ["revoke", "dispose", "replace"]) {
  test(`replacement abort listener ${action} cannot be overwritten by outer registration`, async t => {
    const newest = { host: host(), grant: null };
    const f = await running(t, ({ service }) => stop(service, action, newest));
    const outer = host(), issued = attempt(f.service, outer.registration);
    const oldStatus = await f.pending;
    const outerStatus = await use(f.service, issued.grant);
    const newestStatus = await use(f.service, newest.grant);
    assert.equal(f.callbackError(), null);
    assert.deepEqual({ issued: !!issued.grant, code: issued.code, oldStatus,
      oldCalls: f.old.calls(), outerStatus, outerCalls: outer.calls(), newestStatus,
      newestCalls: newest.host.calls() },
    { issued: false, code: "SESSION_REVOKED", oldStatus: 499, oldCalls: 1,
      outerStatus: null, outerCalls: 0, newestStatus: action === "replace" ? 200 : null,
      newestCalls: action === "replace" ? 1 : 0 });
  });
}

test("registration expiring during context validation preserves the existing usable grant", async t => {
  const f = fixture(t), old = host(), incoming = host();
  const grant = f.service.register(old.registration);
  incoming.registration.expiresAtMs = NOW + 1000;
  incoming.registration.readContext = () => {
    f.setTime(NOW + 1000);
    return incoming.readContext();
  };
  const issued = attempt(f.service, incoming.registration);
  const oldStatus = await use(f.service, grant);
  assert.deepEqual({ issued: !!issued.grant, code: issued.code, oldStatus,
    oldCalls: old.calls(), incomingCalls: incoming.calls() },
  { issued: false, code: "INVALID_SESSION_CONFIG", oldStatus: 200, oldCalls: 1, incomingCalls: 0 });
});

test("replacement expiring during the old request abort does not report a new grant", async t => {
  const f = await running(t, f => f.setTime(NOW + 1000));
  const incoming = host(); incoming.registration.expiresAtMs = NOW + 1000;
  const issued = attempt(f.service, incoming.registration);
  assert.deepEqual({ issued: !!issued.grant, code: issued.code, oldStatus: await f.pending,
    oldTokenStatus: await use(f.service, f.grant), incomingCalls: incoming.calls() },
  { issued: false, code: "INVALID_SESSION_CONFIG", oldStatus: 499, oldTokenStatus: 401, incomingCalls: 0 });
});

test("registration and revocation of other agents do not cancel the pending registration", async t => {
  const f = fixture(t), first = host("DAT"), other = host("EMA");
  let otherGrant, pending = true;
  first.registration.readContext = () => {
    if (pending) {
      pending = false;
      otherGrant = f.service.register(other.registration);
      f.service.revoke("CAWELON");
    }
    return first.readContext();
  };
  const grant = f.service.register(first.registration);
  assert.equal(await use(f.service, grant), 200);
  assert.equal(await use(f.service, otherGrant), 200);
  assert.equal(first.calls(), 1); assert.equal(other.calls(), 1);
});

test("invalid replacement leaves the existing grant usable", async t => {
  const f = fixture(t), old = host(), incoming = host();
  const grant = f.service.register(old.registration);
  incoming.registration.readContext = () => ({ ...incoming.readContext(), policyText: "{}" });
  const issued = attempt(f.service, incoming.registration);
  assert.deepEqual({ issued: !!issued.grant, code: issued.code,
    oldStatus: await use(f.service, grant), oldCalls: old.calls(), incomingCalls: incoming.calls() },
  { issued: false, code: "CONTEXT_INVALID", oldStatus: 200, oldCalls: 1, incomingCalls: 0 });
});

test("a rejected nested registration does not invalidate the pending valid registration", async t => {
  const f = fixture(t), outer = host(), nested = host();
  let rejected, pending = true;
  outer.registration.readContext = () => {
    if (pending) {
      pending = false;
      rejected = attempt(f.service, { ...nested.registration, expiresAtMs: NOW });
    }
    return outer.readContext();
  };
  const grant = f.service.register(outer.registration);
  assert.equal(rejected.code, "INVALID_SESSION_CONFIG");
  assert.equal(await use(f.service, grant), 200);
  assert.equal(outer.calls(), 1); assert.equal(nested.calls(), 0);
});
