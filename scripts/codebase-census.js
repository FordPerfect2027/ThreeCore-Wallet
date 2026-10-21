#!/usr/bin/env node
/**
 * Reproducible ThreeCore source census for the 20,000-line development goal.
 *
 * This is a line-counting instrument, NOT an assessment of software quality.
 * Counts only Git-tracked files, excluding vendored/generated artifacts and
 * lockfiles. Separates executable/test/tool files from configuration files,
 * and reports blank/comment-only lines separately.
 *
 * No internet access, wallet access, repository modification or deployment.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve, sep, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GOAL_LINES = 20000;
export const PROJECTS = Object.freeze(["DAT", "EMA-Draft", "CAWELON-Draft", "ThreeCore-Wallet"]);
const SOURCE_EXT = new Set([".sol", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html", ".css"]);
const CONFIG_EXT = new Set([".json", ".yml", ".yaml"]);
const EXCLUDED_DIRS = new Set([
  ".git", "node_modules", "artifacts", "cache", "coverage", "dist",
  "vendor", "generated", "out", "build", "typechain-types", "docs",
]);
const MAX_FILE_BYTES = 1024 * 1024;

export function classifyTrackedPath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath ||
      relativePath.includes("\0") || isAbsolute(relativePath) ||
      win32.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath) ||
      relativePath.replace(/\\/g, "/").split("/").includes("..")) return null;
  const parts = relativePath.replace(/\\/g, "/").split("/");
  if (parts.some((part) => EXCLUDED_DIRS.has(part) || part.startsWith("." ) && part !== ".github")) {
    return null;
  }
  const name = parts.at(-1);
  if (name === "package-lock.json" || name === "pnpm-lock.yaml" ||
      name === "yarn.lock" || name.endsWith(".min.js") ||
      name.endsWith(".map")) return null;

  const ext = extname(name).toLowerCase();
  if (CONFIG_EXT.has(ext)) return "configuration";
  if (!SOURCE_EXT.has(ext)) return null;
  if (parts.includes("test") || parts.includes("tests") || parts.includes("__tests__") ||
      name.endsWith(".test.js") || name.endsWith(".test.ts") ||
      name.endsWith(".test.mjs") || name.endsWith(".spec.ts")) return "tests";
  if (parts.includes("scripts")) return "tools";
  return "implementation";
}

export function countSourceLines(content) {
  if (typeof content !== "string") throw new TypeError("Source must be text");
  if (content.length === 0) return Object.freeze({ physical: 0, active: 0, blank: 0, comment: 0 });
  const lines = content.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "" && lines.length > 1) lines.pop();
  let empty = 0;
  let comment = 0;
  let active = 0;
  let insideBlockComment = false;
  for (const original of lines) {
    const text = original.trim();
    if (!text) { empty++; continue; }
    if (insideBlockComment) {
      comment++;
      if (text.includes("*/") || text.includes("-->")) insideBlockComment = false;
      continue;
    }
    if (text.startsWith("//") || text.startsWith("#") ||
        text.startsWith("<!--") || text.startsWith("/*") ||
        text.startsWith("*") || text.startsWith("*/") || text.startsWith("-->")) {
      comment++;
      if ((text.startsWith("/*") && !text.includes("*/")) ||
          (text.startsWith("<!--") && !text.includes("-->"))) {
        insideBlockComment = true;
      }
      continue;
    }
    active++;
  }
  return Object.freeze({ physical: lines.length, active, blank: empty, comment });
}

export function summariseTrackedFiles(repoRoot, files) {
  if (typeof repoRoot !== "string" || !Array.isArray(files)) {
    throw new TypeError("Repository root and Git-tracked file list are required");
  }
  const root = resolve(repoRoot);
  const categories = {
    implementation: { files: 0, physical: 0, active: 0 },
    tests: { files: 0, physical: 0, active: 0 },
    tools: { files: 0, physical: 0, active: 0 },
    configuration: { files: 0, physical: 0, active: 0 },
  };
  let blank = 0;
  let comment = 0;
  const skipped = [];
  for (const file of files) {
    const category = classifyTrackedPath(file);
    if (!category) continue;
    const target = resolve(root, file);
    if (!target.startsWith(root + sep)) {
      throw new Error("Refusing to read a path outside the repository");
    }
    let info;
    try {
      if (statSync(target).size > MAX_FILE_BYTES) {
        skipped.push(file);
        continue;
      }
      info = countSourceLines(readFileSync(target, "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") throw new Error("Tracked file missing: " + file);
      throw err;
    }
    const bucket = categories[category];
    bucket.files++;
    bucket.physical += info.physical;
    bucket.active += info.active;
    blank += info.blank;
    comment += info.comment;
  }
  const totalPhysicalLines = Object.values(categories).reduce((sum, item) => sum + item.physical, 0);
  const activeImplementationAndTests = categories.implementation.active +
    categories.tests.active + categories.tools.active;
  return {
    categories, totalPhysicalLines, activeImplementationAndTests,
    blankLines: blank, commentOnlyLines: comment,
    configurationPhysicalLines: categories.configuration.physical,
    skippedLargeFiles: skipped,
  };
}

export function censusRepositories(parent, names = PROJECTS) {
  return Object.fromEntries(names.map((name) => {
    if (!PROJECTS.includes(name)) throw new Error("Unknown ThreeCore repository");
    const repoPath = resolve(parent, name);
    const gitOutput = execFileSync("git", ["-C", repoPath, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 5 * 1024 * 1024,
    });
    const files = gitOutput.split("\0").filter(Boolean);
    return [name, summariseTrackedFiles(repoPath, files)];
  }));
}

function buildReport(repoData) {
  const physicalLines = Object.values(repoData)
    .reduce((sum, item) => sum + item.totalPhysicalLines, 0);
  const activeImplementationAndTests = Object.values(repoData)
    .reduce((sum, item) => sum + item.activeImplementationAndTests, 0);
  return {
    goalPhysicalLines: GOAL_LINES,
    physicalLines,
    remainingPhysicalLines: Math.max(0, GOAL_LINES - physicalLines),
    activeImplementationAndTests,
    meaning: "Physical lines contain blank/comment/config; quality and completion are not measured by LOC.",
    repos: repoData,
  };
}
export { buildReport };

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const parent = resolve(here, "..", "..");
    const report = buildReport(censusRepositories(parent));
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (error) {
    process.stderr.write("ThreeCore source census failed: " + error.message + "\n");
    process.exitCode = 1;
  }
}
