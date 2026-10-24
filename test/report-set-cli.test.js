import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseSetArgs, inspectSetPath, runSetCheck } from "../scripts/check-report-set.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { sequenceSet, sequenceHistory, demoSetHistory } from "./helpers/report-set-fixtures.js";

async function localFile(input, run) {
  const root = await mkdtemp(join(tmpdir(), "threecore-set-cli-"));
  const path = join(root, "確認セット.json");
  try {
    await writeFile(path, (await prepareReportSetFile(input)).text, "utf8");
    await run(path, root);
  } finally {
    // This exact temporary directory was allocated by this test, never by the user.
    const expected = resolve(tmpdir()) + sep + "threecore-set-cli-";
    assert.ok(resolve(root).startsWith(expected));
    await rm(root, { recursive: true });
  }
}

function capture() {
  const state = { out: "", err: "" };
  return { state, stdout: { write: text => { state.out += text; } },
    stderr: { write: text => { state.err += text; } } };
}

test("CLI recognizes a single JSON path and optional output/strict switches", () => {
  assert.deepEqual(parseSetArgs(["review.json"]), {
    path: "review.json", json: false, requireContinuous: false,
  });
  assert.deepEqual(parseSetArgs(["--json", "C:/test folder/review.JSON", "--require-continuous"]), {
    path: "C:/test folder/review.JSON", json: true, requireContinuous: true,
  });
});

for (const args of [[], ["--json"], ["x.txt"], ["x.json", "y.json"],
  ["x.json", "--json", "--json"], ["x.json", "--require-continuous", "--require-continuous"],
  ["x.json", "--repair"], ["--upload", "x.json"], [42], [null]]) {
  test("CLI rejects unsupported arguments: " + JSON.stringify(args), () => {
    assert.throws(() => parseSetArgs(args), /PERIOD_SET_CLI_ARGUMENTS/);
  });
}

test("CLI diagnostics contain no notes, addresses, raw events or monetary values", async () => {
  const input = sequenceSet();
  await localFile(input, async path => {
    const result = await inspectSetPath(path);
    const text = JSON.stringify(result);
    assert.equal(result.reportCount, 3);
    assert.equal(result.allContinuous, true);
    assert.equal(result.checksumVerified, true);
    assert.equal(result.securityAudit, false);
    assert.equal(result.authenticated, false);
    for (const entry of input.entries) {
      assert.ok(!text.includes(entry.label));
      assert.ok(!text.includes(entry.note));
      for (const slot of entry.report.slots) {
        assert.ok(!text.includes(slot.entry.draft.plan.context.account));
        assert.ok(!text.includes(slot.entry.draft.earlier.balanceBaseUnits));
      }
    }
  });
});

test("CLI text success reports historical limitations and does not alter the file", async () => {
  await localFile(sequenceSet(), async (path, root) => {
    const before = createHash("sha256").update(await readFile(path)).digest("hex");
    const io = capture();
    assert.equal(await runSetCheck([path], io), 0);
    assert.match(io.state.out, /3 reports/);
    assert.match(io.state.out, /Historical evidence only/);
    assert.equal(io.state.err, "");
    assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"), before);
    assert.deepEqual(await readdir(root), ["確認セット.json"]);
  });
});

test("CLI JSON output is machine-readable and strict mode passes continuous evidence", async () => {
  await localFile(sequenceSet(), async path => {
    const io = capture();
    assert.equal(await runSetCheck([path, "--json", "--require-continuous"], io), 0);
    const result = JSON.parse(io.state.out);
    assert.equal(result.allContinuous, true);
    assert.equal(result.eventsCombined, false);
    assert.equal(result.tokenAmountsSummed, false);
    assert.equal(io.state.err, "");
  });
});

test("valid but discontinuous file is readable and strict mode exits with a distinct code", async () => {
  await localFile(sequenceSet(sequenceHistory([0n, 24n])), async path => {
    const ordinary = capture(), strict = capture();
    assert.equal(await runSetCheck([path, "--json"], ordinary), 0);
    assert.equal(JSON.parse(ordinary.state.out).allContinuous, false);
    assert.equal(await runSetCheck([path, "--json", "--require-continuous"], strict), 2);
    assert.equal(strict.state.err, "PERIOD_SET_CLI_NOT_CONTINUOUS\n");
    assert.ok(JSON.parse(strict.state.out).issues.includes("GAPS"));
  });
});

test("corrupted file fails without disclosing the original JSON body", async () => {
  await localFile(sequenceSet(), async path => {
    const value = JSON.parse(await readFile(path, "utf8"));
    value.input.title = "private-name-should-not-appear";
    await writeFile(path, JSON.stringify(value));
    const io = capture();
    assert.equal(await runSetCheck([path, "--json"], io), 1);
    assert.equal(io.state.out, "");
    assert.match(io.state.err, /PERIOD_CHECKSUM/);
    assert.ok(!io.state.err.includes(value.input.title));
    assert.ok(!io.state.err.includes(path));
  });
});

test("missing file and directory named JSON produce safe read failures", async () => {
  await localFile(sequenceSet(), async (_path, root) => {
    await mkdir(join(root, "folder.json"));
    for (const path of [join(root, "absent.json"), join(root, "folder.json")]) {
      const io = capture();
      assert.equal(await runSetCheck([path], io), 1);
      assert.equal(io.state.out, "");
      assert.ok(!io.state.err.includes(root));
    }
  });
});

test("actual node entrypoint returns code two for review-needed evidence", async () => {
  await localFile(sequenceSet(demoSetHistory()), async path => {
    const execution = spawnSync(process.execPath,
      ["scripts/check-report-set.js", path, "--require-continuous", "--json"],
      { cwd: process.cwd(), encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.equal(execution.error, undefined);
    assert.equal(execution.status, 2);
    assert.equal(JSON.parse(execution.stdout).allContinuous, false);
    assert.match(execution.stderr, /PERIOD_SET_CLI_NOT_CONTINUOUS/);
  });
});
