#!/usr/bin/env node
// CI browser test: a disposable Chrome profile, no extensions or real wallets.
// Linux only; manual browser reproduction is available with demo -- --ui-test.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDemoServer } from "../examples/dev-server.js";
import { checkBrowserResult } from "./browser-result.js";
import { installBrowserCompletion } from "./browser-completion.js";

if (process.platform !== "linux") throw Error("Run the automated browser suite on Linux; use the local UI test page on other platforms");
const options = process.argv.slice(2);
if (options.length > 1 || options.some(value => value !== "--verify-error-detection")) throw Error("Unknown browser test option");

async function runBrowserPage(fault) {
  const server = createDemoServer({ uiTest: true });
  const profileRoot = resolve(tmpdir());
  let browser, profile, receipt, exited;
  try {
    profile = await mkdtemp(join(profileRoot, "threecore-ui-test-"));
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    receipt = installBrowserCompletion(server);
    const url = `http://127.0.0.1:${server.address().port}/test/browser/?ci-report=${receipt.nonce}` +
      (fault ? "&harness-fault=" + fault : "");
    const args = [
      "--headless=new", "--disable-gpu", "--disable-extensions", "--disable-background-networking",
      "--enable-logging=stderr",
      "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + profile,
      url,
    ];
    browser = spawn("google-chrome", args, { stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    browser.stderr.setEncoding("utf8");
    browser.stderr.on("data", data => { errors = (errors + data).slice(-12000); });
    browser.on("error", error => receipt.fail(error));
    exited = new Promise(resolve => browser.once("close", code => {
      receipt.fail(Error("Browser exited before completion: " + code + "\n" + errors));
      resolve();
    }));
    try { return await receipt.result; }
    catch (error) { throw Error(error.message + "\nRecent browser diagnostics:\n" + errors); }
  } finally {
    if (browser && browser.exitCode === null) browser.kill("SIGKILL");
    if (exited) await exited;
    receipt?.dispose();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (profile) {
      const target = resolve(profile);
      if (!target.startsWith(profileRoot + sep)) throw Error("Unexpected temporary-profile path");
      await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
}

function checkResult(html, fault) {
  try { return checkBrowserResult(html, fault); }
  catch (error) {
    process.stderr.write(html.slice(-14000) + "\n");
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





