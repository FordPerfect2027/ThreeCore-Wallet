import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GOAL_LINES, PROJECTS, classifyTrackedPath, countSourceLines,
  summariseTrackedFiles, buildReport,
} from "../scripts/codebase-census.js";

test("goal applies only to ThreeCore's own repositories", () => {
  assert.equal(GOAL_LINES, 20000);
  assert.deepEqual(PROJECTS, ["DAT", "EMA-Draft", "CAWELON-Draft", "ThreeCore-Wallet"]);
  assert.ok(Object.isFrozen(PROJECTS));
});

test("classifies contract and application code separately from tests and tools", () => {
  assert.equal(classifyTrackedPath("contracts/DATCore.sol"), "implementation");
  assert.equal(classifyTrackedPath("src/onchain-identity.js"), "implementation");
  assert.equal(classifyTrackedPath("website/index.html"), "implementation");
  assert.equal(classifyTrackedPath("test/DATCore.ts"), "tests");
  assert.equal(classifyTrackedPath("test/transfer-history.test.mjs"), "tests");
  assert.equal(classifyTrackedPath("scripts/deploy-base-sepolia.ts"), "tools");
  assert.equal(classifyTrackedPath("package.json"), "configuration");
  assert.equal(classifyTrackedPath(".github/workflows/ci.yml"), "configuration");
});

test("ignores lockfiles, compiled output, node_modules and non-code documents", () => {
  for (const file of [
    "README.md", "LICENSE", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "node_modules/token/index.js", "artifacts/DATCore.sol/DATCore.json",
    "cache/build.json", "generated/abi.js", "coverage/coverage.json",
    "bundle.min.js", "dist/index.js", ".git/config", ".env", "docs/notes.md",
    "docs/validation-evidence.json",
  ]) {
    assert.equal(classifyTrackedPath(file), null, file);
  }
});

test("rejects out-of-tree and absolute paths", () => {
  assert.equal(classifyTrackedPath("../secrets.js"), null);
  assert.equal(classifyTrackedPath("src/../../private.js"), null);
  assert.equal(classifyTrackedPath(""), null);
  assert.equal(classifyTrackedPath(null), null);
  assert.equal(classifyTrackedPath("C:\\secret\\file.js"), null);
  assert.equal(classifyTrackedPath("C:/secret/file.js"), null);
  assert.equal(classifyTrackedPath("C:secret.js"), null);
  assert.equal(classifyTrackedPath("\\\\server\\share\\file.js"), null);
  assert.equal(classifyTrackedPath("/secret/file.js"), null);
});

test("counts comment-only, blank, physical and active lines separately", () => {
  const result = countSourceLines([
    "// comment",
    "const value = 1;",
    "",
    "/* start",
    " * continued",
    " */",
    "const two = 2;",
    "",
  ].join("\n"));
  assert.deepEqual(result, {
    physical: 7, active: 2, blank: 1, comment: 4,
  });
  assert.ok(Object.isFrozen(result));
});

test("an ending newline does not invent an extra physical line", () => {
  assert.equal(countSourceLines("a\n").physical, 1);
  assert.equal(countSourceLines("a\nb\n").physical, 2);
  assert.equal(countSourceLines("a\r\nb\r\n").physical, 2);
});

test("HTML comment-only lines and source lines are not conflated", () => {
  assert.deepEqual(countSourceLines("<!-- start\n explanation\n-->\n<div>live</div>"), {
    physical: 4, active: 1, blank: 0, comment: 3,
  });
});

test("summaries only include known tracked implementation, test and config files", () => {
  const root = mkdtempSync(join(tmpdir(), "threecore-census-"));
  try {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "test"));
    writeFileSync(join(root, "src", "code.js"), "// hi\nfunction a() {}\n\n", "utf8");
    writeFileSync(join(root, "test", "code.test.js"), "test('a', () => {});\n", "utf8");
    writeFileSync(join(root, "package.json"), "{\n}\n", "utf8");
    writeFileSync(join(root, "README.md"), "not source", "utf8");
    const result = summariseTrackedFiles(root, [
      "src/code.js", "test/code.test.js", "package.json", "README.md",
    ]);
    assert.equal(result.totalPhysicalLines, 6);
    assert.equal(result.activeImplementationAndTests, 2);
    assert.equal(result.blankLines, 1);
    assert.equal(result.commentOnlyLines, 1);
    assert.equal(result.categories.configuration.physical, 2);
    assert.equal(result.categories.implementation.files, 1);
    assert.equal(result.categories.tests.files, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing Git-tracked source files fail instead of inflating progress", () => {
  const root = mkdtempSync(join(tmpdir(), "threecore-missing-"));
  try {
    assert.throws(() => summariseTrackedFiles(root, ["src/missing.js"]), /Tracked file missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports remaining physical lines without treating them as feature completion", () => {
  const perRepo = {
    DAT: { totalPhysicalLines: 3000, activeImplementationAndTests: 2100 },
    EMA: { totalPhysicalLines: 2000, activeImplementationAndTests: 1500 },
    CAWELON: { totalPhysicalLines: 2000, activeImplementationAndTests: 1500 },
  };
  const report = buildReport(perRepo);
  assert.equal(report.goalPhysicalLines, 20000);
  assert.equal(report.physicalLines, 7000);
  assert.equal(report.remainingPhysicalLines, 13000);
  assert.equal(report.activeImplementationAndTests, 5100);
  assert.match(report.meaning, /quality and completion are not measured/);
});

test("code line counter rejects non-string input", () => {
  assert.throws(() => countSourceLines(null), TypeError);
});

test("source census rejects invalid summarization inputs", () => {
  assert.throws(() => summariseTrackedFiles(null, []), TypeError);
  assert.throws(() => summariseTrackedFiles(".", null), TypeError);
});
