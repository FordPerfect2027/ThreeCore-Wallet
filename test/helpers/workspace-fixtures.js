import { observation, archive } from "./history-fixtures.js";
import { workspaceFromDraft, encodeWorkspace } from "../../src/workspace-format.js";
import { prepareWorkspaceFile } from "../../src/workspace-file.js";
import { encodePortfolioReport } from "../../src/portfolio-report.js";
import { encodeWalletSetup, WALLET_SETUP_SCHEMA } from "../../src/wallet-setup.js";
import { rehearsalExample, rehearsalExampleV2 } from "../../src/operation-rehearsal-examples.js";
import { encodeRehearsal } from "../../src/operation-rehearsal.js";
import { encodeRehearsalWorkspace } from "../../src/operation-rehearsal-workspace.js";
import { encodeRehearsalScenarioSet } from "../../src/operation-rehearsal-scenario-set.js";
import { encodeRehearsalSession } from "../../src/operation-rehearsal-session.js";

export const AGENTS = ["DAT", "EMA", "CAWELON"];
export const ACCOUNTS = ["11", "22", "33"].map(pair => "0x" + pair.repeat(20));
export const CONTRACTS = ["44", "55", "66"].map(pair => "0x" + pair.repeat(20));
export const OPTIONS = Object.freeze({ settings: true, histories: true, mode: "merge" });
export const clone = value => JSON.parse(JSON.stringify(value));
export const tick = () => new Promise(resolve => setImmediate(resolve));

export function snapshot(index = 0, block = "42", changes = {}) {
  return observation(block, {
    agent: AGENTS[index],
    account: ACCOUNTS[index],
    holdings: [{ address: CONTRACTS[index], hasCode: true, balanceBaseUnits: "42", notice: null }],
    ...changes,
  });
}

export function draft({ populated = true, block = "42", accounts = true } = {}) {
  return AGENTS.map((agent, index) => ({
    agent,
    account: accounts ? ACCOUNTS[index] : "",
    chainId: 84532,
    tokenAddress: CONTRACTS[index],
    tokens: CONTRACTS[index],
    history: archive(populated ? [snapshot(index, block)] : []),
  }));
}

export function bundle(options) {
  return clone(workspaceFromDraft(draft(options)));
}

export function text(options) {
  return encodeWorkspace(bundle(options));
}

export function fileObject(text, changes = {}) {
  const bytes = new TextEncoder().encode(text);
  return { name: "workspace.json", size: bytes.length,
    arrayBuffer: async () => bytes.buffer, ...changes };
}

export async function savedWorkspaceGuideFixtures() {
  const workspace = bundle();
  return [
    { name: "workspace.json", text: (await prepareWorkspaceFile(workspace)).text, target: "workspace", validation: "validated-original", counts: { configurationReferences: 3, configuredAccountReferences: 3, configuredTokenReferences: 6, portfolioObservationReferences: 3, holdingReferences: 3, unknownHoldingReferences: 0 } },
    { name: "portfolio.json", text: encodePortfolioReport(snapshot()), target: "portfolio", validation: "validated-structure", counts: { portfolioObservationReferences: 1, holdingReferences: 1, unknownHoldingReferences: 0 } },
    { name: "portfolio-history.json", text: archive([snapshot(0), snapshot(1)]), target: "portfolio-history", validation: "validated-structure", counts: { portfolioObservationReferences: 2, holdingReferences: 2, unknownHoldingReferences: 0 } },
    { name: "setup.json", text: encodeWalletSetup({ schema: WALLET_SETUP_SCHEMA, entries: workspace.entries.map(({agent, account, chainId}) => ({agent, account, chainId})) }), target: "setup", validation: "validated-structure", counts: { configurationReferences: 3, configuredAccountReferences: 3 } },
  ];
}

export function savedRehearsalGuideFixtures() {
  const before = rehearsalExampleV2(), rejected = rehearsalExampleV2("EMA", "limit");
  const after = { ...before, policy: { ...before.policy, maxPerOperation: "1" } };
  const workspace = { schema: "threecore.operation-rehearsal-workspace.v1", simulationOnly: true, activeAgent: "DAT", ledgers: [before, rejected] };
  const cases = { schema: "threecore.operation-rehearsal-scenario-set.v1", simulationOnly: true, cases: [{ id: "limit", label: "Synthetic limit comparison", before, after }] };
  return [
    { name: "rehearsal-v1.json", text: encodeRehearsal(rehearsalExample()), target: "rehearsal-record", counts: [1, 2, 0, null] },
    { name: "rehearsal-v2.json", text: encodeRehearsal(rejected), target: "rehearsal-record", counts: [1, 1, 1, null] },
    { name: "rehearsal-workspace.json", text: encodeRehearsalWorkspace(workspace), target: "rehearsal-workspace", counts: [2, 3, 1, null] },
    { name: "rehearsal-cases.json", text: encodeRehearsalScenarioSet(cases), target: "rehearsal-cases", counts: [2, 4, 2, 1] },
    { name: "rehearsal-session.json", text: encodeRehearsalSession({ schema: "threecore.operation-rehearsal-session.v1", simulationOnly: true, workspace, cases }), target: "rehearsal-session", counts: [4, 7, 3, 1] },
  ];
}

export function gate() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function until(predicate) {
  const limit = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > limit) throw Error("Local async action did not settle");
    await tick();
  }
}
