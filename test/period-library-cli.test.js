import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseLibraryArgs, inspectLibraryPath, runLibraryCheck } from "../scripts/check-period-library.js";
import { preparePeriodLibraryFile } from "../src/period-library-file.js";
import { library, entry, sampleLibrary, checkpoint, ACCOUNT } from "./helpers/period-library-fixtures.js";

async function fixture(document, callback) {
  const directory = await mkdtemp(join(tmpdir(), "threecore-period-library-"));
  const path = join(directory, "backup.json");
  const prepared = await preparePeriodLibraryFile(document);
  await writeFile(path, prepared.text, "utf8");
  try { await callback({ path, directory, text: prepared.text }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
function output() {
  let out = "", err = "";
  return { stdout: { write(text) { out += text; } }, stderr: { write(text) { err += text; } },
    get out() { return out; }, get err() { return err; } };
}

test("CLI parses a quoted local JSON path and supported flags", () => {
  assert.deepEqual(parseLibraryArgs(["C:/My files/控え.JSON", "--json", "--require-complete"]), {
    path: "C:/My files/控え.JSON", json: true, requireComplete: true,
  });
  assert.equal(parseLibraryArgs(["--json", "backup.json"]).json, true);
});

for (const args of [[], ["--json"], ["a.txt"], ["a.json", "b.json"], ["--upload", "a.json"],
  ["a.json", "--json", "--json"], ["a.json", "--require-complete", "--require-complete"], [null]]) {
  test("CLI refuses ambiguous or unsupported arguments: " + JSON.stringify(args), () => {
    assert.throws(() => parseLibraryArgs(args), /PERIOD_LIBRARY_CLI_ARGUMENTS/);
  });
}

test("offline inspection reports counts without public addresses or user labels", () =>
  fixture(sampleLibrary(), async ({ path, text }) => {
    const result = await inspectLibraryPath(path);
    assert.equal(result.entries, 4);
    assert.equal(result.agents.find(row => row.agent === "CAWELON").blocked, 1);
    assert.equal(result.authenticated, false);
    assert.equal(result.liveChainRechecked, false);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(ACCOUNT));
    assert.ok(!serialized.includes("DAT 途中"));
    assert.ok(!serialized.includes("balanceBaseUnits"));
    assert.equal(await readFile(path, "utf8"), text);
  }));

test("machine output is parseable JSON and leaves backup bytes unchanged", () =>
  fixture(sampleLibrary(), async ({ path, text }) => {
    const sink = output();
    assert.equal(await runLibraryCheck([path, "--json"], sink), 0);
    assert.equal(JSON.parse(sink.out).entries, 4);
    assert.equal(sink.err, "");
    assert.equal(await readFile(path, "utf8"), text);
  }));

test("normal output explains historical checksum limitations", () =>
  fixture(sampleLibrary(), async ({ path }) => {
    const sink = output();
    assert.equal(await runLibraryCheck([path], sink), 0);
    assert.match(sink.out, /DAT: 2 partial/);
    assert.match(sink.out, /CAWELON: 0 partial, 0 collected, 1 require a new plan/);
    assert.match(sink.out, /not certified/);
  }));

test("partial or blocked records return exit 2 when a complete collection is required", () =>
  fixture(sampleLibrary(), async ({ path }) => {
    const sink = output();
    assert.equal(await runLibraryCheck([path, "--require-complete"], sink), 2);
    assert.match(sink.err, /PERIOD_LIBRARY_CLI_INCOMPLETE/);
    assert.match(sink.out, /Saved period entries: 4/);
  }));

test("empty collection is not a successful complete acquisition", () =>
  fixture(library(), async ({ path }) => {
    const sink = output();
    assert.equal(await runLibraryCheck([path, "--require-complete"], sink), 2);
    assert.equal((await inspectLibraryPath(path)).allEntriesCollected, false);
  }));

test("a complete unblocked collection passes the optional completeness gate", () =>
  fixture(library([entry(1, { draft: checkpoint(5) })]), async ({ path }) => {
    const sink = output();
    assert.equal(await runLibraryCheck([path, "--require-complete", "--json"], sink), 0);
    assert.equal(JSON.parse(sink.out).allEntriesCollected, true);
  }));

test("archived partial entries are still counted by the completeness gate", () =>
  fixture(library([entry(1, { draft: checkpoint(5) }), entry(2, { archived: true })]), async ({ path }) => {
    const sink = output();
    assert.equal(await runLibraryCheck([path, "--require-complete"], sink), 2);
  }));

test("CLI rejects a damaged digest with a stable error code", () =>
  fixture(sampleLibrary(), async ({ path, text }) => {
    const altered = JSON.parse(text);
    altered.digest = "0".repeat(64);
    await writeFile(path, JSON.stringify(altered));
    const sink = output();
    assert.equal(await runLibraryCheck([path], sink), 1);
    assert.match(sink.err, /^PERIOD_CHECKSUM/);
    assert.equal(sink.out, "");
  }));

test("invalid UTF-8 or non-JSON files never create an inspection report", () =>
  fixture(library(), async ({ path }) => {
    for (const bytes of [Buffer.from([0xff]), Buffer.from("{")]) {
      await writeFile(path, bytes);
      const sink = output();
      assert.equal(await runLibraryCheck([path], sink), 1);
      assert.equal(sink.out, "");
    }
  }));

test("missing input path is sanitized rather than printed with OS details", async () => {
  const sink = output();
  assert.equal(await runLibraryCheck(["C:/does-not-exist/private-name.json"], sink), 1);
  assert.ok(!sink.err.includes("private-name"));
  assert.ok(!sink.err.includes("ENOENT"));
  assert.match(sink.err, /READ_FAILED/);
});

test("directory input fails without recursive traversal", () =>
  fixture(library(), async ({ path, directory }) => {
    const disguised = join(directory, "directory.json");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(disguised);
    const sink = output();
    assert.equal(await runLibraryCheck([disguised], sink), 1);
    assert.equal((await stat(path)).isFile(), true);
  }));

test("the actual Node command exits successfully without modifying the collection", () =>
  fixture(sampleLibrary(), async ({ path, text }) => {
    const result = spawnSync(process.execPath, ["scripts/check-period-library.js", path, "--json"], {
      encoding: "utf8", timeout: 15000, windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).entries, 4);
    assert.equal(result.stderr, "");
    assert.equal(await readFile(path, "utf8"), text);
  }));
