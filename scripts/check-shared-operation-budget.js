#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { readBoundedLocalBytes } from "./read-bounded-local-file.js";
import { inspectOperationBudgetFile } from "./check-operation-budget.js";
import { OperationBudgetError } from "../src/operation-budget.js";
import { SHARED_BUDGET_SCHEMA, SHARED_BUDGET_LIMIT, decodeSharedOperationBudget, evaluateSharedOperationBudget } from "../src/shared-operation-budget.js";

export async function runSharedBudgetCheck(args, output = process.stdout, errors = process.stderr) {
  const fail = code => { throw new OperationBudgetError(code); };
  try {
    if (!Array.isArray(args)) fail("CLI_ARGUMENTS");
    let input, sources;
    if (args[0] === "--same-account" && [3, 4].includes(args.length)) {
      const reports = [];
      for (const file of args.slice(1)) reports.push(await inspectOperationBudgetFile(file));
      input = { schema: SHARED_BUDGET_SCHEMA, simulationOnly: true, sameAccount: true, budgets: reports.map(r => r.result.input) };
      sources = reports.map(r => ({ byteLength: r.byteLength, sha256: r.sha256, agent: r.result.input.agent }));
    } else if (args[0] === "--saved" && args.length === 2 && typeof args[1] === "string" && args[1] && !args[1].startsWith("--")) {
      const bytes = await readBoundedLocalBytes(resolve(args[1]), SHARED_BUDGET_LIMIT,
        { fail, sizeCode: "FILE_TOO_LARGE", changedCode: "FILE_CHANGED" });
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail("INVALID_UTF8"); }
      input = decodeSharedOperationBudget(text);
      sources = [{ byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }];
    } else fail("CLI_ARGUMENTS");
    const result = evaluateSharedOperationBudget(input);
    output.write(JSON.stringify({ sources, networkRequests: 0, walletRequests: 0, filesModified: 0, result }, null, 2) + "\n");
    return result.constraintsSatisfied ? 0 : 2;
  } catch (error) {
    errors.write("Shared budget check failed: " + (error instanceof OperationBudgetError ? error.code : "FILE_READ_FAILED") + "\n");
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runSharedBudgetCheck(process.argv.slice(2));
