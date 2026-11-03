#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { readBoundedLocalBytes } from "./read-bounded-local-file.js";
import { OperationBudgetError, OPERATION_BUDGET_LIMIT, decodeOperationBudget, evaluateOperationBudget } from "../src/operation-budget.js";

export async function inspectOperationBudgetFile(file) {
  const fail = code => { throw new OperationBudgetError(code); };
  if (typeof file !== "string" || !file || file.startsWith("--")) fail("CLI_ARGUMENTS");
  const bytes = await readBoundedLocalBytes(resolve(file), OPERATION_BUDGET_LIMIT,
    { fail, sizeCode: "FILE_TOO_LARGE", changedCode: "FILE_CHANGED" });
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail("INVALID_UTF8"); }
  return { sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length,
    networkRequests: 0, walletRequests: 0, filesModified: 0,
    result: evaluateOperationBudget(decodeOperationBudget(text)) };
}
export async function runOperationBudgetCheck(args, output = process.stdout, errors = process.stderr) {
  try {
    if (!Array.isArray(args) || args.length !== 1) throw new OperationBudgetError("CLI_ARGUMENTS");
    const report = await inspectOperationBudgetFile(args[0]);
    output.write(JSON.stringify(report, null, 2) + "\n");
    return report.result.constraintsSatisfied ? 0 : 2;
  } catch (error) {
    errors.write("Budget check failed: " + (error instanceof OperationBudgetError ? error.code : "FILE_READ_FAILED") + "\n");
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runOperationBudgetCheck(process.argv.slice(2));
