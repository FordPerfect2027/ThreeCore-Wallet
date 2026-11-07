import { posix, win32 } from "node:path";

/** Explicit local test binary only; never interpret shell commands or flags. */
export function browserExecutable(env = process.env, platform = process.platform) {
  const value = env.THREECORE_TEST_BROWSER;
  if (value === undefined) return "google-chrome";
  if (typeof value !== "string" || !value || value.trim() !== value ||
      /[\x00-\x1f\x7f]/.test(value) || !(platform === "win32"
        ? /^[a-z]:[\\/]/i.test(value) && win32.isAbsolute(value)
        : posix.isAbsolute(value))) {
    throw Error("THREECORE_TEST_BROWSER must be an absolute local browser executable path");
  }
  return value;
}
