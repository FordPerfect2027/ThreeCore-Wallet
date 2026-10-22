// Publication includes history, checkpoint, identity and allowance workflows.
// Keep a lower bound so accidentally running a filtered suite cannot pass CI.
export const MIN_BROWSER_CASES = 289;
const MAX_HTML_LENGTH = 1024 * 1024;
const ATTRIBUTES = ["suite-status", "tests-count", "tests-passed", "tests-failed",
  "unexpected-errors", "error-kinds", "injected-fault"];

/** Read Chrome's serialized body summary, never a fixture's nested attributes. */
export function readBrowserSummary(html) {
  if (typeof html !== "string" || !html.length || html.length > MAX_HTML_LENGTH) {
    throw Error("Missing or oversized browser output");
  }
  const body = html.match(/<body\b[^>]*>/i)?.[0];
  if (!body) throw Error("Browser output has no body summary");
  const summary = {};
  for (const key of ATTRIBUTES) {
    const pattern = new RegExp('\\sdata-' + key + '="([^"<>]*)"', "g");
    const matches = [...body.matchAll(pattern)];
    if (matches.length !== 1) throw Error("Missing or ambiguous browser summary: " + key);
    summary[key] = matches[0][1];
  }
  return Object.freeze(summary);
}

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
