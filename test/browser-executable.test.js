import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { browserExecutable } from "../scripts/browser-executable.js";

test("browser runner keeps the existing CI default", () => {
  assert.equal(browserExecutable({}), "google-chrome");
});
for (const path of ["/usr/bin/chromium", "/opt/test browser/chrome"]) {
  test("browser runner accepts an explicit local executable: " + path, () => {
    assert.equal(browserExecutable({ THREECORE_TEST_BROWSER: path }, "linux"), path);
  });
}
for (const value of ["", "chromium", "./chrome", "--no-sandbox", "https://example.com/chrome",
  " /usr/bin/chromium", "/usr/bin/chromium ", "/usr/bin/chromium\n", "/usr/bin/chrome\0", null, 42]) {
  test("browser runner rejects malformed executable setting: " + JSON.stringify(value), () => {
    assert.throws(() => browserExecutable({ THREECORE_TEST_BROWSER: value }), /absolute local/);
  });
}
test("browser selection does not introduce shell execution or relax browser isolation", async () => {
  const source = await readFile(new URL("../scripts/test-browser-ui.js", import.meta.url), "utf8");
  assert.match(source, /spawn\(executable, args,/);
  assert.match(source, /shell: false/);
  assert.match(source, /--disable-extensions/);
  assert.match(source, /--user-data-dir=/);
  assert.doesNotMatch(source, /--no-sandbox|--disable-web-security/);
});
test("Windows browser runner accepts a fully qualified drive path", () => {
  const path = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  assert.equal(browserExecutable({ THREECORE_TEST_BROWSER: path }, "win32"), path);
});
for (const path of ["\\\\server\\share\\chrome.exe", "\\\\?\\C:\\chrome.exe", "C:chrome.exe", "\\chrome.exe", "/usr/bin/chrome"]) {
  test("Windows browser runner rejects nonlocal or ambiguous path: " + path, () => {
    assert.throws(() => browserExecutable({ THREECORE_TEST_BROWSER: path }, "win32"), /absolute local/);
  });
}
