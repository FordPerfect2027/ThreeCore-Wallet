#!/usr/bin/env node
// CI browser test: a disposable Chrome profile, no extensions or real wallets.
// Linux only; manual browser reproduction is available with demo -- --ui-test.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDemoServer } from "../examples/dev-server.js";

if (process.platform !== "linux") throw Error("Run the automated browser suite on Linux; use the local UI test page on other platforms");
const options = process.argv.slice(2);
if (options.length > 1 || options.some(value => value !== "--verify-error-detection")) throw Error("Unknown browser test option");

async function runBrowserPage(fault) {
  const server = createDemoServer({ uiTest: true });
  const profileRoot = resolve(tmpdir());
  let browser, profile;
  try {
    profile = await mkdtemp(join(profileRoot, "threecore-ui-test-"));
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}/test/browser/` +
      (fault ? "?harness-fault=" + fault : "");
    const args = [
      "--headless=new", "--disable-gpu", "--disable-extensions", "--disable-background-networking",
      "--enable-logging=stderr",
      "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + profile,
      "--dump-dom", "--virtual-time-budget=240000", url,
    ];
    const html = await new Promise((resolve, reject) => {
      browser = spawn("google-chrome", args, { stdio: ["ignore", "pipe", "pipe"] });
      let output = "", errors = "";
      const timer = setTimeout(() => {
        browser.kill("SIGKILL");
        reject(Error("Browser suite timed out; recent diagnostics:\n" + errors));
      }, 45000);
      browser.stdout.setEncoding("utf8");
      browser.stderr.setEncoding("utf8");
      browser.stdout.on("data", data => {
        output += data;
        if (output.length > 1024 * 1024) { browser.kill("SIGKILL"); reject(Error("Unexpected browser output size")); }
      });
      browser.stderr.on("data", data => { errors = (errors + data).slice(-12000); });
      browser.on("error", error => { clearTimeout(timer); reject(error); });
      browser.on("close", code => {
        clearTimeout(timer);
        if (code !== 0) reject(Error("Browser failed: " + errors));
        else resolve(output);
      });
    });
    return html;
  } finally {
    if (browser && browser.exitCode === null) browser.kill("SIGKILL");
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
  // Only the actual body summary counts; fixture text cannot assert success.
  const body = html.match(/<body\b[^>]*>/i)?.[0] ?? "";
  const expected = {
    "suite-status": fault ? "failed" : "passed", "tests-count": "84",
    "tests-passed": "84", "tests-failed": "0",
    "unexpected-errors": fault ? "1" : "0", "error-kinds": fault ?? "", "injected-fault": fault ?? "",
  };
  if (Object.entries(expected).some(([key, value]) => !body.includes(`data-${key}="${value}"`))) {
    process.stderr.write(html.slice(-14000) + "\n");
    throw Error(fault ? "Harness did not reject the injected " + fault : "Browser tests failed or did not finish");
  }
}

if (options[0] === "--verify-error-detection") {
  const failures = [];
  for (const fault of ["error", "unhandledrejection"]) {
    try {
      checkResult(await runBrowserPage(fault), fault);
      console.log("Harness correctly rejected synthetic " + fault + " despite 84 passing UI cases.");
    } catch (error) { failures.push(error.message); }
  }
  if (failures.length) throw Error(failures.join("\n"));
  console.log("2 browser error-detection controls passed.");
} else {
  checkResult(await runBrowserPage());
  console.log("84 browser UI tests passed with a synthetic provider and no external RPC.");
}





