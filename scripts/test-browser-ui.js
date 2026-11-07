#!/usr/bin/env node
// CI browser test: a disposable Chrome profile, no extensions or real wallets.
// Linux/Windows; each run owns an isolated profile and ephemeral loopback server.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDemoServer } from "../examples/dev-server.js";
import { checkBrowserResult } from "./browser-result.js";
import { installBrowserCompletion } from "./browser-completion.js";
import { browserExecutable } from "./browser-executable.js";

if (!["linux", "win32"].includes(process.platform)) throw Error("Automated browser tests support Linux and Windows");
if (process.platform === "win32" && !process.env.THREECORE_TEST_BROWSER) {
  throw Error("Windows browser tests require an explicit THREECORE_TEST_BROWSER executable path");
}
const options = process.argv.slice(2);
const executable = browserExecutable();
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
    // Windows native crypto/IndexedDB is slower on the target PC. This is the
    // whole-suite receipt deadline, not any product or per-case timeout.
    receipt = installBrowserCompletion(server, { timeoutMs: process.platform === "win32" ? 600000 : 90000 });
    server.on("request", (request, response) => {
      response.once("finish", () => {
        if (response.statusCode >= 400) {
          // This server serves synthetic fixtures only; never attach to the user's server.
          process.stderr.write("Browser fixture HTTP " + response.statusCode + " " +
            JSON.stringify(String(request.url).slice(0, 240)) + "\n");
        }
      });
    });
    const url = `http://127.0.0.1:${server.address().port}/test/browser/?ci-report=${receipt.nonce}` +
      (fault ? "&harness-fault=" + fault : "");
    const args = [
      "--headless=new", "--disable-gpu", "--disable-extensions", "--disable-background-networking",
      "--enable-logging=stderr",
      "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + profile,
      url,
    ];
    browser = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"], shell: false });
    let errors = "";
    browser.stderr.setEncoding("utf8");
    let diagnosticLine = "";
    browser.stderr.on("data", data => {
      errors = (errors + data).slice(-12000);
      diagnosticLine = (diagnosticLine + data).slice(-24000);
      const lines = diagnosticLine.split("\n");
      diagnosticLine = lines.pop();
      for (const line of lines) {
        if (/Starting synthetic UI case:|PASS —|FAIL —/.test(line)) {
          process.stderr.write(line.slice(0, 1200) + "\n");
        }
      }
    });
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





