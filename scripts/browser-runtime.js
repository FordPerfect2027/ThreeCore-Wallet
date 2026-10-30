import { existsSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve, win32 } from "node:path";
import { execFile } from "node:child_process";

/** Test-only discovery: ordinary installed executables, never a user profile. */
export function browserExecutable({ platform = process.platform, environment = process.env,
  exists = existsSync } = {}) {
  if (platform === "linux") return "google-chrome";
  if (platform !== "win32") throw Error("Automated browser tests support Windows and Linux");
  const roots = [environment.ProgramFiles, environment["ProgramFiles(x86)"], environment.LOCALAPPDATA]
    .filter(value => typeof value === "string" && win32.isAbsolute(value));
  for (const suffix of ["Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"]) {
    for (const root of [...new Set(roots)]) {
      const candidate = win32.resolve(root, suffix);
      if (exists(candidate)) return candidate;
    }
  }
  throw Error("Install Chrome or Microsoft Edge in a standard Windows location to run browser tests");
}

export function browserArguments(profile, url) {
  const target = new URL(url);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || !target.port ||
      target.pathname !== "/test/browser/" || target.username || target.password || target.hash ||
      !isAbsolute(profile) || !basename(profile).startsWith("threecore-ui-test-")) throw Error("Expected an isolated local browser test");
  return ["--headless=new", "--disable-gpu", "--disable-extensions", "--disable-background-networking",
    "--enable-logging=stderr", "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=" + resolve(profile), url];
}

function killWindowsTree(pid) {
  return new Promise((resolve, reject) => {
    execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"],
      { windowsHide: true, timeout: 5000 }, error => error ? reject(error) : resolve());
  });
}

/** Stop only the child created by this test run; never match a browser by name. */
export async function stopTestBrowser(child, { platform = process.platform, timeoutMs = 6000,
  killTree = killWindowsTree } = {}) {
  if (!child || child.exitCode !== null || child.signalCode != null) return;
  if (!Number.isSafeInteger(child.pid) || child.pid < 1) return; // Failed spawn has no running child.
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error("Invalid browser shutdown deadline");
  let detach, timer;
  const exited = new Promise((resolve, reject) => {
    const close = () => resolve();
    child.once("close", close);
    detach = () => child.removeListener("close", close);
    timer = setTimeout(() => reject(Error("Test browser did not exit; its temporary profile is preserved")), timeoutMs);
  });
  // Attach a handler before invoking the platform stop operation.
  let stopError;
  const shutdown = (platform === "win32"
    ? Promise.resolve().then(() => killTree(child.pid))
    : Promise.resolve().then(() => { if (!child.kill("SIGKILL") && child.exitCode === null && child.signalCode == null) throw Error("Could not stop test browser"); }))
    .catch(error => { stopError = error; });
  try { await Promise.all([exited, shutdown]); }
  catch (error) { throw stopError ? new AggregateError([error, stopError], error.message) : error; }
  finally { clearTimeout(timer); detach(); }
}

/** A directly-created temporary directory only; reject roots, escapes and links. */
export async function removeTestProfile(profile, root, { realpath = realpathSync, remove = rm } = {}) {
  const expectedRoot = resolve(root), expected = resolve(profile);
  const physicalRoot = realpath(expectedRoot), physical = realpath(expected);
  const comparable = value => process.platform === "win32" ? value.toLowerCase() : value;
  if (comparable(physical) !== comparable(expected) ||
      comparable(dirname(physical)) !== comparable(physicalRoot) ||
      !basename(physical).startsWith("threecore-ui-test-") || basename(physical) === "threecore-ui-test-") {
    throw Error("Unexpected temporary browser profile; nothing removed");
  }
  await remove(physical, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
