import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { operationBudgetExample, encodeOperationBudget } from "../src/operation-budget.js";
import { SHARED_BUDGET_SCHEMA, encodeSharedOperationBudget } from "../src/shared-operation-budget.js";
import { runSharedBudgetCheck } from "../scripts/check-shared-operation-budget.js";
test("offline checker binds source hashes, detects cumulative insufficiency and preserves source files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "threecore-shared-budget-"));
  try {
    const budgets = ["DAT", "EMA", "CAWELON"].map(agent => { const b = structuredClone(operationBudgetExample());
      b.agent = agent; b.fees.operatorFeeBudgetWei = "0"; b.native.balanceWei = "3060000000000000"; return b; });
    const files = budgets.map(b => join(dir, b.agent + ".json")), texts = budgets.map(encodeOperationBudget);
    for (let i = 0; i < files.length; i++) await writeFile(files[i], texts[i]);
    let output = "", errors = ""; const out = { write(s) { output += s; } }, err = { write(s) { errors += s; } };
    assert.equal(await runSharedBudgetCheck(["--same-account", ...files], out, err), 2);
    const separate = JSON.parse(output); assert.equal(separate.result.individuallySatisfied, true);
    assert.equal(separate.result.native.shortfall, "60000000000000"); assert.equal(separate.sources.length, 3);
    assert.equal(separate.networkRequests, 0); assert.equal(separate.walletRequests, 0); assert.equal(separate.filesModified, 0);
    for (let i = 0; i < files.length; i++) assert.equal(await readFile(files[i], "utf8"), texts[i]);
    const saved = join(dir, "shared.json"); await writeFile(saved, encodeSharedOperationBudget({ schema: SHARED_BUDGET_SCHEMA, simulationOnly: true, sameAccount: true, budgets }));
    output = ""; assert.equal(await runSharedBudgetCheck(["--saved", saved], out, err), 2);
    assert.deepEqual(JSON.parse(output).result, separate.result);
    budgets.forEach(b => { b.native.balanceWei = "10000000000000000"; });
    await writeFile(saved, encodeSharedOperationBudget({ schema: SHARED_BUDGET_SCHEMA, simulationOnly: true, sameAccount: true, budgets }));
    assert.equal(await runSharedBudgetCheck(["--saved", saved], out, err), 0);
    for (const args of [files, ["--same-account", files[0]], ["--saved"], ["--saved", "--invalid"]])
      assert.equal(await runSharedBudgetCheck(args, out, err), 1);
    await writeFile(saved, new Uint8Array([255])); assert.equal(await runSharedBudgetCheck(["--saved", saved], out, err), 1);
    assert.match(errors, /INVALID_UTF8/); assert.doesNotMatch(errors, /threecore-shared-budget-/);
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith("threecore-shared-budget-"));
    await rm(dir, { recursive: true });
  }
});
