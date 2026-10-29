import { REHEARSAL_SCHEMA, validateRehearsal } from "./operation-rehearsal.js";

/** Fictional units, accounts and destinations. These are not production policy defaults. */
export function rehearsalExample(agent = "DAT", scenario = "profit") {
  const index = ["DAT", "EMA", "CAWELON"].indexOf(agent);
  if (index < 0 || !["profit", "loss", "recovery", "limit", "pending", "deposit"].includes(scenario))
    throw new Error("Unknown rehearsal example");
  const identity = { agent, chainId: 84532, account: "0x" + String(index + 1).repeat(40) };
  const policy = { origin: "https://training.example", spender: "0x" + "5".repeat(40),
    maxPerOperation: "100000000", maxOutstanding: "200000000", reserveFloor: "200000000",
    lossLimit: "250000000", buybackBps: 1000, paused: false };
  const open = (id, principal = "100000000") => ({ id: "open-" + id, kind: "open", ...identity,
    operationId: id, origin: policy.origin, spender: policy.spender, principal, fee: "1000000" });
  const settle = (id, grossReturn) => ({ id: "settle-" + id, kind: "settle", ...identity,
    operationId: id, grossReturn, fee: "1000000" });
  let events = [open("one"), settle("one", "130000000")];
  if (scenario === "loss") events = [open("one"), settle("one", "60000000")];
  if (scenario === "recovery") events = [open("one"), settle("one", "60000000"),
    open("two"), settle("two", "160000000")];
  if (scenario === "limit") events = [open("one", "150000000")];
  if (scenario === "pending") events = [open("one")];
  if (scenario === "deposit") events = [{ id: "capital", kind: "deposit", ...identity, amount: "500000000" }];
  return validateRehearsal({ schema: REHEARSAL_SCHEMA, simulationOnly: true, ...identity,
    asset: { address: "0x" + "4".repeat(40), symbol: "SIM", decimals: 6 },
    openingBalance: "1000000000", policy, events });
}
