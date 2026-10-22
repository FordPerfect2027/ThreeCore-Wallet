import { catalogToken } from "../../src/token-catalog.js";
import { ALLOWANCE_TARGET_SCHEMA } from "../../src/allowance-targets.js";
import { ALLOWANCE_OBSERVATION_SCHEMA } from "../../src/allowance-observation.js";
import { prepareAllowanceFile } from "../../src/allowance-file.js";
import { observation, readerSession, providerFixture, word } from "./identity-fixtures.js";
export { ACCOUNT, OTHER, HASH, ORIGIN, clone, code, deferred, tick, word } from "./identity-fixtures.js";

export const S1 = "0x" + "55".repeat(20);
export const S2 = "0x" + "66".repeat(20);
export const S3 = "0x" + "77".repeat(20);
export function targets(agent = "DAT", chainId = 8453, entries) {
  return {
    schema: ALLOWANCE_TARGET_SCHEMA, agent, chainId,
    tokenAddress: catalogToken({ agent, chainId }).address,
    targets: entries ?? [{ address: S1, label: "Exchange A" }, { address: S2, label: "Exchange B" }],
  };
}
export function record(changes = {}, agent = "DAT", chainId = 8453) {
  const plan = changes.targets ?? targets(agent, chainId);
  return {
    schema: ALLOWANCE_OBSERVATION_SCHEMA,
    identity: observation({}, agent, chainId),
    targets: plan,
    rows: plan.targets.map((entry, index) => ({
      spenderAddress: entry.address, label: entry.label,
      hasCode: true, codeError: null, allowanceBaseUnits: String(index * 10), allowanceError: null,
    })),
    readOnly: true, completeDiscovery: false, securityAudit: false,
    ...changes,
  };
}
export function fakeReader(changes = {}, agent = "DAT", chainId = 8453) {
  const f = readerSession(changes, agent, chainId);
  f.session.getTokenAllowance = async (token, spender, hash) => {
    f.calls.push(["allowance", token, spender, hash]);
    return spender === S1 ? 0n : 10n;
  };
  return f;
}
export function realSession(options = {}) {
  const intercept = options.override ?? (() => undefined);
  return providerFixture({ ...options, override: async (args, provider) => {
    const result = await intercept(args, provider);
    if (result !== undefined) return result;
    if (args.method === "eth_call" && args.params[0].data.startsWith("0xdd62ed3e")) {
      const spender = "0x" + args.params[0].data.slice(-40);
      return word(spender === S1 ? 0 : 10);
    }
  } });
}
export async function saved(kind = "observation", payload = record(), changes = {}) {
  const prepared = await prepareAllowanceFile(kind, payload);
  const bytes = new TextEncoder().encode(prepared.text);
  return { name: prepared.filename, size: bytes.length,
    arrayBuffer: async () => bytes.slice().buffer, ...changes };
}
export function nextRecord(before, changes = {}) {
  const copy = structuredClone(before);
  copy.identity.blockNumber = String(BigInt(copy.identity.blockNumber) + 1n);
  copy.identity.blockHash = "0x" + "cd".repeat(32);
  return { ...copy, ...changes };
}
