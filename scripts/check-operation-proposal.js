#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedLocalBytes } from "./read-bounded-local-file.js";
import { BUDGET_EVIDENCE_LIMIT } from "../src/operation-budget-evidence.js";
import { OperationProposalError, PROPOSAL_FILE_LIMIT, decodeOperationProposal, decodeProposalReviewPolicy, inspectOperationProposal } from "../src/operation-proposal.js";
import { PROPOSAL_REVIEW_FILE_LIMIT, inspectOperationProposalReviewFile } from "../src/operation-proposal-file.js";

export async function runOperationProposalCheck(args, output = process.stdout, errors = process.stderr) {
  const fail = code => { throw new OperationProposalError(code); };
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") {
      output.write("Usage: node scripts/check-operation-proposal.js proposal.json review-policy.json budget-evidence.json\n       node scripts/check-operation-proposal.js --verify-saved review.json\nOffline comparison only. Saved results are checked at their recorded time, not the current time. No signatures, transactions, wallet calls or network requests.\n");
      return 0;
    }
    if (Array.isArray(args) && args.length === 2 && args[0] === "--verify-saved" && typeof args[1] === "string" && args[1] && !args[1].startsWith("--")) {
      const bytes = await readBoundedLocalBytes(resolve(args[1]), PROPOSAL_REVIEW_FILE_LIMIT, { fail, sizeCode: "FILE_TOO_LARGE", changedCode: "FILE_CHANGED" });
      let text; try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail("INVALID_UTF8"); }
      const result = await inspectOperationProposalReviewFile(text);
      output.write(JSON.stringify({ networkRequests: 0, walletRequests: 0, filesModified: 0, savedResultReproduced: true, result }, null, 2) + "\n");
      return result.recordedResult.checksSatisfied ? 0 : 2;
    }
    if (!Array.isArray(args) || args.length !== 3 || args.some(value => typeof value !== "string" || !value || value.startsWith("--"))) fail("CLI_ARGUMENTS");
    const inputs = [];
    for (let index = 0; index < args.length; index++) {
      const bytes = await readBoundedLocalBytes(resolve(args[index]), index === 2 ? BUDGET_EVIDENCE_LIMIT : PROPOSAL_FILE_LIMIT,
        { fail, sizeCode: "FILE_TOO_LARGE", changedCode: "FILE_CHANGED" });
      try { inputs.push(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { fail("INVALID_UTF8"); }
    }
    const result = await inspectOperationProposal(decodeOperationProposal(inputs[0]), decodeProposalReviewPolicy(inputs[1]), inputs[2]);
    output.write(JSON.stringify({ networkRequests: 0, walletRequests: 0, filesModified: 0, result }, null, 2) + "\n");
    return result.checksSatisfied ? 0 : 2;
  } catch (error) {
    errors.write("Proposal review failed: " + (error instanceof OperationProposalError ? error.code : "SOURCE_VALIDATION_OR_READ_FAILED") + "\n");
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runOperationProposalCheck(process.argv.slice(2));
