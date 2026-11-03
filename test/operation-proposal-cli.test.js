import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { runOperationProposalCheck } from "../scripts/check-operation-proposal.js";
import { encodeOperationProposal, encodeProposalReviewPolicy, PROPOSAL_FILE_LIMIT } from "../src/operation-proposal.js";
import { proposalFixture } from "./helpers/proposal-fixtures.js";
import { prepareOperationProposalReview } from "../src/operation-proposal-file.js";
async function fixture(run) {
  const root = await realpath(tmpdir()), dir = await mkdtemp(join(root, "threecore-proposal-review-"));
  try {
    const f = await proposalFixture({ nowSeconds: Math.floor(Date.now() / 1000) });
    const files = ["proposal.json", "policy.json", "evidence.json"].map(name => join(dir, name));
    for (const [i, content] of [encodeOperationProposal(f.proposal), encodeProposalReviewPolicy(f.policy), f.evidenceText].entries()) await writeFile(files[i], content);
    await run(files, f);
  } finally {
    assert.equal(dirname(resolve(dir)), root); assert(basename(dir).startsWith("threecore-proposal-review-")); assert.equal(await realpath(dir), resolve(dir));
    await rm(dir, { recursive: true });
  }
}
async function run(args) { let output = "", errors = ""; const code = await runOperationProposalCheck(args, { write(s) { output += s; } }, { write(s) { errors += s; } }); return { code, output, errors }; }
test("CLI reports acceptable comparisons, mismatches and invalid input separately without modifying original files", () => fixture(async (files, f) => {
  const before = await Promise.all(files.map(file => readFile(file))); let r = await run(files);
  assert.equal(r.code, 0); const report = JSON.parse(r.output); assert.equal(report.result.authorizesExecution, false);
  assert.equal(report.networkRequests, 0); assert.equal(report.walletRequests, 0); assert.equal(report.filesModified, 0);
  assert.deepEqual(await Promise.all(files.map(file => readFile(file))), before);
  f.policy.maxTokenSpendUnits = "0"; await writeFile(files[1], encodeProposalReviewPolicy(f.policy));
  r = await run(files); assert.equal(r.code, 2); assert(JSON.parse(r.output).result.reasons.includes("TOKEN_SPEND_LIMIT"));
  await writeFile(files[0], '{"private-marker":"do-not-print"}'); r = await run(files); assert.equal(r.code, 1); assert.equal(r.output, ""); assert.doesNotMatch(r.errors, /do-not-print/);
}));
test("CLI bounds bytes, rejects invalid UTF-8 and validates argument shape before opening files", () => fixture(async files => {
  for (const value of [Buffer.from([255]), " ".repeat(PROPOSAL_FILE_LIMIT + 1)]) { await writeFile(files[0], value); const r = await run(files); assert.equal(r.code, 1); assert.equal(r.output, ""); }
  for (const args of [[], [null, "b", "c"], ["--unknown", "b", "c"], ["one"], [...files, "extra"]]) assert.equal((await run(args)).code, 1);
  const help = await run(["--help"]); assert.equal(help.code, 0); assert.match(help.output, /Offline comparison only/);
}));

test("CLI saved review replays its original time and rejects a modified verdict without modifying the archive", () => fixture(async (files,f) => {
  const sources={proposalFile:await readFile(files[0],"utf8"),policyFile:await readFile(files[1],"utf8"),budgetEvidenceFile:await readFile(files[2],"utf8")};
  const target=join(dirname(files[0]),"saved.json");
  for(const nowSeconds of [f.nowSeconds,f.nowSeconds+700]){
    const saved=await prepareOperationProposalReview(sources,{nowSeconds});await writeFile(target,saved.text);
    const r=await run(["--verify-saved",target]);assert.equal(r.code,nowSeconds===f.nowSeconds?0:2);
    const report=JSON.parse(r.output);assert.equal(report.savedResultReproduced,true);assert.equal(report.result.timestampAuthenticated,false);
    assert.equal(report.result.recordedResult.evaluatedAtSeconds,nowSeconds);assert.equal(await readFile(target,"utf8"),saved.text);
    const tampered=JSON.parse(saved.text);tampered.result.checksSatisfied=!tampered.result.checksSatisfied;await writeFile(target,JSON.stringify(tampered));
    const rejected=await run(["--verify-saved",target]);assert.equal(rejected.code,1);assert.match(rejected.errors,/RECORDED_REVIEW_MISMATCH/);
  }
  for(const value of [Buffer.from([255]),"{}"]){await writeFile(target,value);assert.equal((await run(["--verify-saved",target])).code,1);}
}));
