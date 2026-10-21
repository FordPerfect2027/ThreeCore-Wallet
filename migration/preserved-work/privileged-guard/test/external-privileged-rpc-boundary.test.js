import test from "node:test";
import assert from "node:assert/strict";
import { summarizeAerodromeProbe } from "../src/external-dapp-report.js";
import { SYNTHETIC_ACCOUNT } from "../src/aerodrome-mock-wallet.js";

function record(discovery = "legacy-and-eip6963") {
  const snapshot = () => ({
    url: "https://aerodrome.finance/connect",
    simulationActive: true,
    discovery,
    hasLegacyProvider: discovery === "legacy-and-eip6963",
    buttons: [{ text: "Browser Wallet" }],
    methods: [], rejections: [], accounts: [],
  });
  return {
    discovery, before: snapshot(), afterConnect: snapshot(),
    afterSignIn: {
      ...snapshot(),
      methods: ["wallet_requestPermissions", "eth_requestAccounts", "personal_sign"],
      rejections: [{ method: "personal_sign", code: 4001 }],
      accounts: [SYNTHETIC_ACCOUNT],
    },
    connectClicked: true, signInClicked: true,
  };
}

test("rejected personal_sign alone remains a synthetic-only sign-in boundary", () => {
  const result = summarizeAerodromeProbe(record());
  assert.equal(result.signatureBoundaryReached, true);
  assert.equal(result.privilegedRpcRequested, false);
  assert.deepEqual(result.privilegedRpcMethods, []);
  assert.equal(result.completedSignIn, false);
  assert.equal(result.realWalletUsed, false);
});

test("read-only RPC methods do not become false privileged warnings", () => {
  const r = record();
  r.before.methods = ["eth_chainId", "eth_call", "eth_getBalance", "wallet_getPermissions"];
  const result = summarizeAerodromeProbe(r);
  assert.equal(result.signatureBoundaryReached, true);
  assert.equal(result.privilegedRpcRequested, false);
});

for (const method of [
  "eth_sendTransaction", "eth_sendRawTransaction", "eth_sendUserOperation",
  "eth_signTransaction", "eth_sign",
  "eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4",
  "wallet_sendCalls", "wallet_sendTransaction", "wallet_prepareCalls", "wallet_grantPermissions",
  "wallet_revokePermissions", "wallet_switchEthereumChain", "wallet_addEthereumChain",
  "wallet_watchAsset",
]) {
  test("a " + method + " request blocks a clean synthetic proof, even if refused", () => {
    const r = record();
    r.afterSignIn.methods.push(method);
    r.afterSignIn.rejections.push({ method, code: 4001 });
    const result = summarizeAerodromeProbe(r);
    assert.equal(result.privilegedRpcRequested, true);
    assert.deepEqual(result.privilegedRpcMethods, [method]);
    assert.equal(result.signatureBoundaryReached, false);
    assert.equal(result.diagnosticCompleted, false);
    assert.equal(result.outcome, "privileged-rpc-request-observed");
  });
}

test("an earlier-phase method remains visible after the final snapshot omits it", () => {
  const r = record();
  r.afterConnect.methods = ["eth_sendTransaction"];
  const result = summarizeAerodromeProbe(r);
  assert.deepEqual(result.privilegedRpcMethods, ["eth_sendTransaction"]);
  assert.equal(result.diagnosticCompleted, false);
});

test("an RPC trace cannot hide a privileged request missing from method lists", () => {
  const r = record();
  r.before.trace = [{ kind: "rpc", method: "wallet_sendCalls" }];
  const result = summarizeAerodromeProbe(r);
  assert.deepEqual(result.privilegedRpcMethods, ["wallet_sendCalls"]);
  assert.equal(result.diagnosticCompleted, false);
});

test("ignore unrelated trace events and deduplicate repeated privileged methods", () => {
  const r = record();
  r.before.methods = ["eth_sendTransaction", "eth_sendTransaction"];
  r.afterSignIn.trace = [
    { kind: "announcement", method: "eth_sign" },
    { kind: "rpc", method: "eth_sendTransaction" },
  ];
  assert.deepEqual(summarizeAerodromeProbe(r).privilegedRpcMethods, ["eth_sendTransaction"]);
});

test("one refusal cannot cover two personal_sign requests", () => {
  const r = record();
  r.afterSignIn.methods.push("personal_sign");
  const result = summarizeAerodromeProbe(r);
  assert.equal(result.signatureRejected, false);
  assert.equal(result.diagnosticCompleted, false);
});

test("two refusals account for exactly two personal_sign requests", () => {
  const r = record();
  r.afterSignIn.methods.push("personal_sign");
  r.afterSignIn.rejections.push({ method: "personal_sign", code: 4001 });
  assert.equal(summarizeAerodromeProbe(r).signatureBoundaryReached, true);
});

test("in discovery-only mode a privileged RPC attempt blocks the diagnostic", () => {
  const r = record("eip6963-only");
  delete r.afterSignIn;
  r.before.methods = ["eth_sendTransaction"];
  const result = summarizeAerodromeProbe(r);
  assert.equal(result.diagnosticCompleted, false);
  assert.equal(result.outcome, "privileged-rpc-request-observed");
});

test("non-array method/rejection data fails closed without crashing", () => {
  const r = record();
  r.afterSignIn.methods = { invalid: true };
  r.afterSignIn.rejections = null;
  assert.equal(summarizeAerodromeProbe(r).diagnosticCompleted, false);
});
