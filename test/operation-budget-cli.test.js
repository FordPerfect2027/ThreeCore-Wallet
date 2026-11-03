import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { operationBudgetExample, encodeOperationBudget, OPERATION_BUDGET_LIMIT } from "../src/operation-budget.js";
import { inspectOperationBudgetFile, runOperationBudgetCheck } from "../scripts/check-operation-budget.js";

async function withFile(run) {
  const dir = await mkdtemp(join(tmpdir(), "threecore-operation-budget-")), file = join(dir, "budget.json");
  try { await writeFile(file, encodeOperationBudget(operationBudgetExample())); await run(file); }
  finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith("threecore-operation-budget-"));
    await rm(dir, { recursive: true });
  }
}
test("CLI preserves its source and separates sufficient, unknown/short and invalid input", () => withFile(async file => {
  let output = "", errors = ""; const out = { write(s) { output += s; } }, err = { write(s) { errors += s; } };
  const before = await readFile(file);
  assert.equal(await runOperationBudgetCheck([file], out, err), 2);
  const report = JSON.parse(output); assert.equal(report.result.native, null);
  assert.equal(report.walletRequests, 0); assert.equal(report.networkRequests, 0); assert.equal(report.filesModified, 0);
  assert.deepEqual(await readFile(file), before);
  const data = structuredClone(operationBudgetExample()); data.fees.operatorFeeBudgetWei = "0";
  await writeFile(file, encodeOperationBudget(data)); output = "";
  assert.equal(await runOperationBudgetCheck([file], out, err), 0); assert.equal(JSON.parse(output).result.authorizesExecution, false);
  await writeFile(file, "bad"); assert.equal(await runOperationBudgetCheck([file], out, err), 1);
  assert.match(errors, /INVALID_JSON/);
}));
test("CLI rejects malformed bytes and file limits without exposing file contents", () => withFile(async file => {
  await writeFile(file, new Uint8Array([255])); await assert.rejects(inspectOperationBudgetFile(file), { code: "INVALID_UTF8" });
  await writeFile(file, " ".repeat(OPERATION_BUDGET_LIMIT + 1)); await assert.rejects(inspectOperationBudgetFile(file), { code: "FILE_TOO_LARGE" });
  let text = ""; const output = { write(s) { text += s; } };
  for (const args of [[], [file, "extra"], ["--unknown"], [null]]) assert.equal(await runOperationBudgetCheck(args, output, output), 1);
  assert.doesNotMatch(text, /threecore-operation-budget-/);
}));
