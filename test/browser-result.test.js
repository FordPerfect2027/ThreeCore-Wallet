import test from "node:test";
import assert from "node:assert/strict";
import { MIN_BROWSER_CASES, readBrowserSummary, checkBrowserResult } from "../scripts/browser-result.js";

function page(overrides = {}, nested = "") {
  const values = { "suite-status": "passed", "tests-count": "289", "tests-passed": "289",
    "tests-failed": "0", "unexpected-errors": "0", "error-kinds": "", "injected-fault": "", ...overrides };
  const attributes = Object.entries(values).map(([key, value]) => 'data-' + key + '="' + value + '"').join(" ");
  return '<!doctype html><html><body ' + attributes + '>' + nested + '</body></html>';
}

test("browser result accepts the full completed workspace suite", () => {
  assert.equal(MIN_BROWSER_CASES, 289);
  assert.deepEqual(checkBrowserResult(page()), { total: 289, passed: 289, failed: 0, unexpectedErrors: 0, fault: null });
});

test("browser result supports additional cases without a stale exact count", () => {
  assert.equal(checkBrowserResult(page({ "tests-count": "300", "tests-passed": "300" })).total, 300);
});

test("browser result rejects the old 84-case runner expectation", () => {
  assert.throws(() => checkBrowserResult(page({ "tests-count": "84", "tests-passed": "84" })), /incomplete/);
});

for (const total of ["0", "1", "150", "288"]) {
  test("browser result rejects a filtered or missing workspace suite: " + total, () => {
    assert.throws(() => checkBrowserResult(page({ "tests-count": total, "tests-passed": total })), /incomplete/);
  });
}

for (const key of ["tests-count", "tests-passed", "tests-failed", "unexpected-errors"]) {
  for (const value of ["-1", "1.5", "NaN", "Infinity", " 289", "0289", "1e3", "9007199254740992"]) {
    test("browser result rejects malformed " + key + " = " + value, () => {
      assert.throws(() => checkBrowserResult(page({ [key]: value })), /count/);
    });
  }
}

test("browser result rejects unfinished case totals", () => {
  assert.throws(() => checkBrowserResult(page({ "tests-passed": "288" })), /not completed/);
});

test("browser result rejects a failed case even if status claims passed", () => {
  assert.throws(() => checkBrowserResult(page({ "tests-passed": "288", "tests-failed": "1" })), /cases failed/);
});

test("browser result rejects running status with apparently complete totals", () => {
  assert.throws(() => checkBrowserResult(page({ "suite-status": "running" })), /completion status/);
});

test("browser result rejects a browser error despite all assertions passing", () => {
  assert.throws(() => checkBrowserResult(page({ "unexpected-errors": "1", "error-kinds": "error" })), /browser errors/);
});

for (const fault of ["error", "unhandledrejection"]) {
  const attributes = { "suite-status": "failed", "unexpected-errors": "1", "error-kinds": fault, "injected-fault": fault };
  test("browser error control confirms " + fault + " was detected", () => {
    assert.equal(checkBrowserResult(page(attributes), fault).fault, fault);
  });
  test("browser error control cannot count as a normal pass: " + fault, () => {
    assert.throws(() => checkBrowserResult(page(attributes)), /completion status/);
  });
  test("browser error control rejects extra faults: " + fault, () => {
    assert.throws(() => checkBrowserResult(page({ ...attributes, "unexpected-errors": "2" }), fault), /exactly/);
  });
  test("browser error control rejects suppressed fault: " + fault, () => {
    assert.throws(() => checkBrowserResult(page({ ...attributes, "unexpected-errors": "0" }), fault), /exactly/);
  });
  test("browser error control rejects mismatched identity: " + fault, () => {
    assert.throws(() => checkBrowserResult(page({ ...attributes, "error-kinds": "other" }), fault), /exactly/);
  });
}

test("browser result ignores a passing nested fixture when body is running", () => {
  const nested = '<div data-suite-status="passed" data-tests-count="999" data-tests-passed="999"></div>';
  assert.throws(() => checkBrowserResult(page({ "suite-status": "running" }, nested)), /completion status/);
});

test("browser result rejects prefixed attributes pretending to be summary fields", () => {
  assert.throws(() => checkBrowserResult(page().replace("data-tests-count", "fixture-data-tests-count")), /Missing/);
});

test("browser result rejects duplicate summary attributes", () => {
  assert.throws(() => readBrowserSummary(page().replace('<body ', '<body data-tests-count="999" ')), /ambiguous/);
});

test("browser result requires every summary field on the actual body", () => {
  assert.throws(() => readBrowserSummary(page().replace('data-tests-failed="0"', '')), /Missing/);
});

test("browser result rejects empty missing and oversized output", () => {
  for (const value of [null, "", "<html></html>", "x".repeat(1024 * 1024 + 1)]) {
    assert.throws(() => readBrowserSummary(value));
  }
});

test("browser result validates caller options", () => {
  assert.throws(() => checkBrowserResult(page(), "timeout"), /Unknown/);
  for (const minimum of [0, -1, 1.5, NaN, Infinity, "289"]) {
    assert.throws(() => checkBrowserResult(page(), undefined, minimum), /positive minimum/);
  }
});

test("browser summary and checked result cannot be modified by consumers", () => {
  assert.ok(Object.isFrozen(readBrowserSummary(page())));
  assert.ok(Object.isFrozen(checkBrowserResult(page())));
});
