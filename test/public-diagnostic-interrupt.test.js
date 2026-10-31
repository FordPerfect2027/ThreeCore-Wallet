import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const preload = new URL("./helpers/public-diagnostic-cli-fixture.mjs", import.meta.url).href;
for (const script of ["probe-base.js", "inspect-aerodrome.js", "inspect-aerodrome-pools.js", "liquidity-progress.js"]) {
  for (const [scenario, exitCode] of [["interrupt-fetch", 130], ["interrupt-body", 130], ["terminate-fetch", 143]]) {
    test(`${script}: ${scenario} cancels the active read without partial output or later calls`, () => {
      const result = spawnSync(process.execPath, ["--import", preload, "scripts/" + script], {
        cwd: root, encoding: "utf8", timeout: 5000,
        env: { ...process.env, THREECORE_TEST_RPC_CASE: scenario },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, exitCode);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /CLI_INTERRUPTED/);
      assert.doesNotMatch(result.stderr, /UNEXPECTED|UNREMOVED|PRIVATE/);
    });
  }
}
