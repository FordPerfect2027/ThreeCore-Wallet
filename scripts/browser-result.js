// Publication includes history, checkpoint, identity and allowance workflows.
// Keep a lower bound so accidentally running a filtered suite cannot pass CI.
export const MIN_BROWSER_CASES = 289;
const MAX_HTML_LENGTH = 1024 * 1024;
const ATTRIBUTES = ["suite-status", "tests-count", "tests-passed", "tests-failed",
  "unexpected-errors", "error-kinds", "injected-fault"];

/** Read Chrome's serialized body summary, never a fixture's nested attributes. */
function readAttributes(html, attributes) {
  if (typeof html !== "string" || !html.length || html.length > MAX_HTML_LENGTH) {
    throw Error("Missing or oversized browser output");
  }
  const body = html.match(/<body\b[^>]*>/i)?.[0];
  if (!body) throw Error("Browser output has no body summary");
  const summary = {};
  for (const key of attributes) {
    const pattern = new RegExp('\\sdata-' + key + '="([^"<>]*)"', "g");
    const matches = [...body.matchAll(pattern)];
    if (matches.length !== 1) throw Error("Missing or ambiguous browser summary: " + key);
    summary[key] = matches[0][1];
  }
  return Object.freeze(summary);
}

export function readBrowserSummary(html) { return readAttributes(html, ATTRIBUTES); }

function count(summary, key) {
  const value = summary[key];
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw Error("Invalid browser count: " + key);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw Error("Unsafe browser count: " + key);
  return number;
}

/** Check completion, totals and intentional error controls independently. */
export function checkBrowserResult(html, fault, minimumCases = MIN_BROWSER_CASES) {
  if (fault !== undefined && !["error", "unhandledrejection"].includes(fault)) {
    throw Error("Unknown injected browser fault");
  }
  if (!Number.isSafeInteger(minimumCases) || minimumCases < 1) {
    throw Error("A positive minimum browser case count is required");
  }
  const summary = readBrowserSummary(html);
  const total = count(summary, "tests-count");
  const passed = count(summary, "tests-passed");
  const failed = count(summary, "tests-failed");
  const errors = count(summary, "unexpected-errors");
  if (total < minimumCases) throw Error("Browser suite is incomplete or filtered");
  if (passed + failed !== total) throw Error("Browser suite has not completed all cases");
  if (failed !== 0 || passed !== total) throw Error("Browser test cases failed");
  if (summary["suite-status"] !== (fault ? "failed" : "passed")) {
    throw Error("Unexpected browser completion status");
  }
  if (errors !== (fault ? 1 : 0) || summary["error-kinds"] !== (fault ?? "") ||
      summary["injected-fault"] !== (fault ?? "")) {
    throw Error(fault ? "Harness did not reject exactly the injected fault" : "Unexpected browser errors");
  }
  return Object.freeze({ total, passed, failed, unexpectedErrors: errors, fault: fault ?? null });
}

const SHARD_ATTRIBUTES = ["shard-index", "shard-count", "registered-count", "registered-digest", "selected-indices", "suite-filter"];

/** A half-suite is accepted only with its exact share of the full registry. */
export function checkBrowserShard(html, index, fault) {
  if (index !== 0 && index !== 1) throw Error("Unknown browser shard");
  const summary = readAttributes(html, SHARD_ATTRIBUTES);
  const registered = count(summary, "registered-count");
  if (registered < MIN_BROWSER_CASES || registered > 10000 || summary["shard-count"] !== "2" ||
      summary["shard-index"] !== String(index) || summary["suite-filter"] !== "" ||
      !/^[0-9a-f]{64}$/.test(summary["registered-digest"])) throw Error("Invalid full browser shard registry");
  const indices = Array.from({ length: registered }, (_, i) => i).filter(i => i % 2 === index);
  if (summary["selected-indices"] !== indices.join(",")) throw Error("Missing or overlapping browser shard cases");
  const result = checkBrowserResult(html, fault, indices.length);
  if (result.total !== indices.length) throw Error("Browser shard totals do not match its case indices");
  return Object.freeze({ ...result, index, registered, digest: summary["registered-digest"] });
}

/** Both fresh profiles must report the same registry and every case exactly once. */
export function checkBrowserShards(pages) {
  if (!Array.isArray(pages) || pages.length !== 2) throw Error("Both browser shards are required");
  const parts = pages.map((html, index) => checkBrowserShard(html, index));
  if (parts[0].registered !== parts[1].registered || parts[0].digest !== parts[1].digest)
    throw Error("Browser registry changed between shards");
  const total = parts.reduce((sum, part) => sum + part.total, 0);
  if (total !== parts[0].registered) throw Error("Incomplete combined browser suite");
  return Object.freeze({ total, passed: total, failed: 0, unexpectedErrors: 0, fault: null });
}
