#!/usr/bin/env node
// Disposable Chrome/Edge profile: no extensions, real wallets or external RPC.
import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDemoServer } from "../examples/dev-server.js";
import { checkBrowserShard, checkBrowserShards, checkBrowserErrorControl, checkBrowserFocus, readBrowserSummary } from "./browser-result.js";
import { installBrowserCompletion } from "./browser-completion.js";
import { browserExecutable, browserArguments, stopTestBrowser, removeTestProfile } from "./browser-runtime.js";
import { checkBrowserModuleRoutes } from "./browser-module-preflight.js";

const options = process.argv.slice(2);
if (options.length > 1 || options.some(value => !["--verify-error-detection", "--focus=file-read"].includes(value))) throw Error("Unknown browser test option");
const focus = options[0] === "--focus=file-read" ? "file-read" : undefined;
// A parse failure in a statically imported test module prevents the browser
// harness from reporting anything. Fail before launching its five-minute run.
const testRoot = new URL("../test/browser/", import.meta.url);
for (const entry of readdirSync(testRoot, { withFileTypes: true }).filter(item => item.isFile() && item.name.endsWith(".js"))) {
  const checked = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(entry.name, testRoot))],
    { encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 65536 });
  if (checked.status !== 0) throw Error("Browser test syntax failed: " + entry.name + "\n" + (checked.stderr || checked.error?.message || "Check did not complete"));
}
const executable = browserExecutable();

async function runBrowserPage(index, fault) {
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
    if (index === 0) {
      const checked = await checkBrowserModuleRoutes(`http://127.0.0.1:${server.address().port}/`);
      console.log("Browser module preflight passed: " + checked.modules + " local modules.");
    }
    // Two sequential fresh profiles bound resource use without dropping cases.
    // Each half retains the finite five-minute deadline.
    receipt = installBrowserCompletion(server, { timeoutMs: 300_000 });
    const url = `http://127.0.0.1:${server.address().port}/test/browser/?ci-report=${receipt.nonce}` +
      (focus ? "&focus=" + focus : "&shard-count=2&shard-index=" + index) +
      (fault ? "&harness-control=1&harness-fault=" + fault : "");
    browser = spawn(executable, browserArguments(profile, url),
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    browser.stderr.setEncoding("utf8");
    browser.stderr.on("data", data => { errors = (errors + data).slice(-12000); });
    browser.on("error", error => receipt.fail(error));
    browser.once("close", code => receipt.fail(Error("Test browser exited before completion: " + code)));
    try {
      result = await receipt.result;
      const checked = checkResult(result, index, fault);
      console.log((focus ? "Focused browser " + focus : "Browser shard " + (index + 1) + "/2") + " completion received: " + checked.passed + " passing cases; isolated cleanup pending.");
    }
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
    "Browser test did not finish cleanly; check isolated profile: " + (profile ?? "not created"));
  if (failure) throw failure;
  return result;
}

function checkResult(html, index, fault) {
  try { return focus ? checkBrowserFocus(html, focus) : fault ? checkBrowserErrorControl(html, fault) : checkBrowserShard(html, index); }
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
      const result = checkResult(await runBrowserPage(0, fault), 0, fault);
      console.log("Harness correctly rejected synthetic " + fault + " despite " + result.passed + " passing UI cases.");
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "Browser error-detection controls did not all pass");
  console.log("2 browser error-detection controls passed.");
} else if (focus) {
  const started = performance.now();
  const result = checkResult(await runBrowserPage(0), 0);
  console.log(result.passed + " focused browser UI tests passed (" + focus + ") in " + Math.round(performance.now() - started) + " ms; full browser coverage was not run.");
} else {
  const pages = [];
  for (const index of [0, 1]) {
    const html = await runBrowserPage(index);
    const part = checkResult(html, index);
    pages.push(html);
    console.log("Browser shard " + (index + 1) + "/2: " + part.passed + " cases passed.");
  }
  const result = checkBrowserShards(pages);
  console.log(result.passed + " browser UI tests passed with a synthetic provider and no external RPC.");
}
