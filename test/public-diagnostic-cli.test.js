import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parsePublicDiagnosticArgs } from "../scripts/public-diagnostic-options.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const preload = new URL("./helpers/public-diagnostic-cli-fixture.mjs", import.meta.url).href;
const wallet = "0x" + "1".repeat(40);
const programs = [
  ["base", "probe-base.js"], ["holdings", "inspect-aerodrome.js"],
  ["pools", "inspect-aerodrome-pools.js"], ["liquidity", "liquidity-progress.js"],
];
function run(script, args = [], scenario = "no-network") {
  const result = spawnSync(process.execPath, ["--import", preload, "scripts/" + script, ...args], {
    cwd: root, encoding: "utf8", timeout: 10000,
    env: { ...process.env, THREECORE_TEST_RPC_CASE: scenario },
  });
  assert.equal(result.error, undefined); return result;
}
test("option parsing keeps supported invocations and rejects extra or ambiguous arguments", () => {
  assert.deepEqual(parsePublicDiagnosticArgs("base", []).options, { network: "sepolia", contractAddress: undefined });
  assert.equal(parsePublicDiagnosticArgs("base", ["mainnet", wallet]).options.contractAddress, wallet);
  assert.equal(parsePublicDiagnosticArgs("holdings", [wallet]).options.publicWalletAddress, wallet);
  assert.equal(parsePublicDiagnosticArgs("liquidity", ["--json"]).options.json, true);
  for (const [kind, args] of [
    ["base", ["mainnet", wallet, "extra"]], ["base", ["toString"]], ["base", ["--help", "mainnet"]],
    ["holdings", ["--json"]], ["holdings", [wallet, wallet]],
    ["pools", ["mainnet"]], ["liquidity", ["--json", "--json"]],
    ["liquidity", ["--json", "--help"]],
  ]) assert.equal(parsePublicDiagnosticArgs(kind, args).ok, false);
});
for (const [kind, script] of programs) {
  test(script + ": help exits successfully without RPC", () => {
    const r = run(script, ["--help"]);
    assert.equal(r.status, 0); assert.match(r.stdout, /Usage:/); assert.equal(r.stderr, "");
  });
  test(script + ": invalid usage exits 2 without RPC or echoing the argument", () => {
    const r = run(script, ["PRIVATE_INPUT_DETAIL"]);
    assert.equal(r.status, 2); assert.equal(r.stdout, ""); assert.match(r.stderr, /Usage:/);
    assert.doesNotMatch(r.stderr, /UNEXPECTED_NETWORK_CALL|PRIVATE_INPUT_DETAIL/);
  });
  test(script + ": transport failure exits 1 with no successful JSON or private error text", () => {
    const r = run(script, [], "transport-failure");
    assert.equal(r.status, 1); assert.equal(r.stdout, ""); assert.match(r.stderr, /RPC_TRANSPORT/);
    assert.doesNotMatch(r.stderr, /PRIVATE_PROVIDER_DETAIL/);
  });
}
test("Base and holdings CLI JSON preserves exact observations and read-only flags", () => {
  const base = run("probe-base.js", ["mainnet", wallet], "success");
  assert.equal(base.status, 0); assert.equal(base.stderr, "");
  const b = JSON.parse(base.stdout); assert.equal(b.contractCodeBlockNumber, "4660");
  assert.equal(b.walletConnected, false);
  const holdings = run("inspect-aerodrome.js", [wallet], "success");
  assert.equal(holdings.status, 0); assert.equal(holdings.stderr, "");
  const h = JSON.parse(holdings.stdout);
  assert.equal(h.blockHash, "0x" + "ab".repeat(32));
  assert.equal(h.canonicalBlockRechecked, true);
  assert.equal(h.tokenReadings.DAT.balanceBaseUnits, "100"); assert.equal(h.tradePerformed, false);
});
test("pool CLI output feeds the stricter liquidity assessment without inventing unknown reserves", () => {
  const pools = run("inspect-aerodrome-pools.js", [], "funded");
  assert.equal(pools.status, 0);
  const p = JSON.parse(pools.stdout);
  assert.equal(p.pools.DAT.volatile.usdcReserveBaseUnits, "100000000");
  assert.equal(p.pools.EMA.volatile.usdcReserveBaseUnits, null);
  const json = run("liquidity-progress.js", ["--json"], "funded");
  assert.equal(json.status, 0); assert.equal(json.stderr, "");
  const q = JSON.parse(json.stdout);
  assert.equal(q.observedBlockHash, p.checkedBlockHash);
  assert.equal(q.canonicalBlockRechecked, true);
  assert.equal(q.pools.DAT.progressPercent, "2.00"); assert.equal(q.verifiedPools, 1);
  assert.equal(q.pools.EMA.observedUsdc, null); assert.equal(q.aggregateObservedUsdc, null);
  const human = run("liquidity-progress.js", [], "funded");
  assert.equal(human.status, 0);
  assert.match(human.stdout, /DAT: 100.000000 USDC/);
  assert.match(human.stdout, /Canonical block hash rechecked: 0xabab/);
  assert.match(human.stdout, /EMA: UNVERIFIED/);
  assert.match(human.stdout, /Observed aggregate: UNVERIFIED/);
});
