#!/usr/bin/env node
/**
 * Launch Aerodrome's real public site in a brand-new, credential-free Chromium
 * profile and inspect EIP-1193 requests with a ZERO-FUNDS MOCK WALLET.
 *
 * The temporary browser never loads user extensions, accounts, cookies or
 * sessions. No wallet keys exist. All signing and transaction calls fail.
 * This is NOT an authenticated real-wallet dApp integration test.
 *
 * Windows uses Edge; Linux uses Chrome. No existing profile is reused.
 * Usage: node scripts/run-isolated-aerodrome-probe.js [--mock-wallet [--eip6963-only]]
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProbeOptions } from "./aerodrome-probe-options.js";

const args = process.argv.slice(2);
parseProbeOptions(args);

function resolveBrowser() {
  const candidate = process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : "/usr/bin/google-chrome";
  if (!existsSync(candidate)) throw Error("Isolated Chromium executable not found");
  return candidate;
}
async function freeLocalPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitForIsolatedPort(port, started) {
  const url = "http://127.0.0.1:" + port + "/json/version";
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const data = await response.json();
        if (/Edg\/|Chrome\//.test(String(data.Browser))) return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error("Isolated browser did not open its debugging endpoint");
}

const browserPath = resolveBrowser();
const profileRoot = resolve(tmpdir());
const profile = mkdtempSync(join(profileRoot, "threecore-aerodrome-simulation-"));
let browser;
let browserStartedAt;
try {
  const port = await freeLocalPort();
  browser = spawn(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=" + port,
    "--user-data-dir=" + profile,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  browserStartedAt = Date.now();
  await waitForIsolatedPort(port, browserStartedAt);
  const workDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
  const result = spawnSync(process.execPath, [
    join(workDir, "aerodrome-ui-probe.js"),
    ...args,
  ], {
    env: { ...process.env, THREECORE_ISOLATED_EDGE_CDP_PORT: String(port) },
    windowsHide: true,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
} catch (error) {
  process.stderr.write("Isolated Aerodrome test failed: " + error.message + "\n");
  process.exitCode = 1;
} finally {
  if (browser?.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], {
        stdio: "ignore", windowsHide: true, timeout: 8000,
      });
    } else {
      browser.kill("SIGTERM");
    }
    // Windows Edge releases session cache handles slightly after taskkill.
    await new Promise(resolve => setTimeout(resolve, 1400));
  }
  try {
    const target = resolve(profile);
    if (!target.startsWith(profileRoot + sep) || !target.slice(profileRoot.length + 1).startsWith("threecore-aerodrome-simulation-")) {
      throw Error("Unexpected temporary profile path");
    }
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    process.stderr.write("Temporary browser profile cleanup warning: " + error.message + "\n");
  }
}
