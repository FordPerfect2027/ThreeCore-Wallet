#!/usr/bin/env node
// Disposable Chrome/Edge profile: no extensions, real wallets or external RPC.
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDemoServer } from "../examples/dev-server.js";
import { checkBrowserResult, readBrowserSummary } from "./browser-result.js";
import { installBrowserCompletion } from "./browser-completion.js";
import { browserExecutable, browserArguments, stopTestBrowser, removeTestProfile } from "./browser-runtime.js";

const options = process.argv.slice(2);
if (options.length > 1 || options.some(value => value !== "--verify-error-detection")) throw Error("Unknown browser test option");
const executable = browserExecutable();

async function runBrowserPage(fault) {
  const server = createDemoServer({ uiTest: true });
  const profileRoot = resolve(tmpdir());
  let browser, profile, receipt, result, failure;
  const cleanupFailures = [];
  try {
    profile = await mkdtemp(join(profileRoot, "threecore-ui-test-"));
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    // The growing real-DOM suite includes native storage and file tasks. Keep a
    // finite five-minute deadline rather than the former 90-second CI budget.
    receipt = installBrowserCompletion(server, { timeoutMs: 300_000 });
    const url = `http://127.0.0.1:${server.address().port}/test/browser/?ci-report=${receipt.nonce}` +
      (fault ? "&harness-fault=" + fault : "");
    browser = spawn(executable, browserArguments(profile, url),
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    browser.stderr.setEncoding("utf8");
    browser.stderr.on("data", data => { errors = (errors + data).slice(-12000); });
    browser.on("error", error => receipt.fail(error));
    browser.once("close", code => receipt.fail(Error("Test browser exited before completion: " + code)));
    try { result = await receipt.result; }
    catch (error) { throw Error(error.message + "\nRecent browser diagnostics:\n" + errors); }
  } catch (error) {
    failure = error;
  } finally {
    let stopped = false;
    try { await stopTestBrowser(browser); stopped = true; }
    catch (error) { cleanupFailures.push(error); }
    receipt?.dispose();
    try {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    } catch (error) { cleanupFailures.push(error); }
    if (profile && stopped) {
      try { await removeTestProfile(profile, profileRoot); }
      catch (error) { cleanupFailures.push(error); }
    }
  }
  if (cleanupFailures.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanupFailures],
    "Browser test did not finish cleanly; preserved temporary files must be checked");
  if (failure) throw failure;
  return result;
}

function checkResult(html, fault) {
  try { return checkBrowserResult(html, fault); }
  catch (error) {
    try { process.stderr.write("Browser completion summary: " + JSON.stringify(readBrowserSummary(html)) + "\n"); }
    catch { /* The validator reports malformed completion separately. */ }
    const failures = [...html.matchAll(/<li>(FAIL —[^]*?)<\/li>/g)];
    for (const failure of failures.slice(0, 20)) process.stderr.write(failure[1].slice(0, 700) + "\n");
    if (failures.length > 20) process.stderr.write("Additional failed cases: " + (failures.length - 20) + "\n");
    if (!failures.length) process.stderr.write(html.slice(-14000) + "\n");
    throw error;
  }
}

if (options[0] === "--verify-error-detection") {
  const failures = [];
  for (const fault of ["error", "unhandledrejection"]) {
    try {
      const result = checkResult(await runBrowserPage(fault), fault);
      console.log("Harness correctly rejected synthetic " + fault + " despite " + result.passed + " passing UI cases.");
    } catch (error) { failures.push(error.message); }
  }
  if (failures.length) throw Error(failures.join("\n"));
  console.log("2 browser error-detection controls passed.");
} else {
  const result = checkResult(await runBrowserPage());
  console.log(result.passed + " browser UI tests passed with a synthetic provider and no external RPC.");
}
