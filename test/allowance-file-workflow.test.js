import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { readAllowanceSnapshot } from "../src/allowance-reader.js";
import { prepareAllowanceFile, readAllowanceFile } from "../src/allowance-file.js";
import { captureAllowanceBundle, prepareAllowanceBundle, readAllowanceBundle } from "../src/allowance-bundle.js";
import { createAllowanceController } from "../src/allowance-controller.js";
import { inspectAllowanceFiles } from "../scripts/check-allowance-file.js";
import { describeAllowanceOverview } from "../src/allowance-overview.js";
import { summarizeAllowances } from "../src/allowance-observation.js";
import { targets, fakeReader, ACCOUNT, S1, S2, nextRecord, record } from "./helpers/allowance-fixtures.js";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function isolated(run) {
  const root = await mkdtemp(join(tmpdir(), "threecore-allowance-flow-"));
  try { await run(root); }
  finally {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert(basename(target).startsWith("threecore-allowance-flow-"));
    await rm(target, { recursive: true, force: true });
  }
}
async function diskFile(path) {
  const size = (await stat(path)).size;
  return {
    name: basename(path), size,
    async arrayBuffer() {
      const bytes = await readFile(path);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}
for (const chainId of [8453, 84532]) {
  test("allowance file workflow: read, preserve three files, reload offline, bundle and compare on chain " + chainId, async () => {
    await isolated(async root => {
      const sourceRecords = [];
      const diskRecords = [];
      const fingerprints = [];
      const individualPaths = [];
      for (const [index, agent] of ["DAT", "EMA", "CAWELON"].entries()) {
        const account = "0x" + String(index + 1).repeat(40);
        const f = fakeReader({ account, blockNumber: String(100 + index) }, agent, chainId);
        const snapshot = await readAllowanceSnapshot(f.session, targets(agent, chainId));
        assert.equal(snapshot.identity.account, account);
        sourceRecords.push(snapshot);
        const prepared = await prepareAllowanceFile("observation", snapshot);
        const path = join(root, prepared.filename);
        await writeFile(path, prepared.text, { flag: "wx" });
        individualPaths.push(path);
        fingerprints.push(hash(await readFile(path)));
        const decoded = await readAllowanceFile(await diskFile(path));
        assert.deepEqual(decoded.payload, snapshot);
        diskRecords.push(decoded.payload);
        const check = await inspectAllowanceFiles({ file: path });
        assert.equal(check.walletRequests, 0);
        assert.equal(check.networkRequests, 0);
        assert.equal(check.filesModified, 0);
        assert.equal(check.assessment.requested, 2);
      }
      const archive = captureAllowanceBundle(diskRecords);
      const prepared = await prepareAllowanceBundle(archive);
      const bundlePath = join(root, prepared.filename);
      await writeFile(bundlePath, prepared.text, { flag: "wx" });
      const bundleHash = hash(await readFile(bundlePath));
      const decoded = await readAllowanceBundle(await diskFile(bundlePath));
      assert.deepEqual(decoded.bundle.records, sourceRecords);
      assert.equal(decoded.bundle.atomicSnapshot, false);
      const cards = [];
      let attemptedProviderReads = 0;
      for (const [index, agent] of ["DAT", "EMA", "CAWELON"].entries()) {
        const controller = createAllowanceController({
          getContext: () => ({ ...targets(agent, chainId), account: sourceRecords[index].identity.account }),
          read: () => { attemptedProviderReads++; throw Error("Offline restore must not read"); },
        });
        assert.equal(await controller.load(await diskFile(individualPaths[index])), true);
        assert.equal(controller.state().provenance, "imported");
        cards.push({ agent, observation: controller.state().observation, provenance: "imported" });
        assert.equal(controller.useAsBaseline(), true);
        const later = nextRecord(sourceRecords[index]);
        later.rows[1].allowanceBaseUnits = "11";
        const after = await prepareAllowanceFile("observation", later);
        const afterPath = join(root, "after-" + agent + ".json");
        await writeFile(afterPath, after.text, { flag: "wx" });
        assert.equal(await controller.load(await diskFile(afterPath)), true);
        assert.equal(controller.compare(), true);
        assert.equal(controller.state().comparison.rows[1].deltaBaseUnits, "1");
        controller.dispose();
      }
      assert.equal(attemptedProviderReads, 0);
      const summary = describeAllowanceOverview(cards);
      assert(summary.includes("記録内の異なるWalletアドレス: 3"));
      assert(summary.includes("保存ファイルの過去記録"));
      for (let i = 0; i < individualPaths.length; i++) {
        assert.equal(hash(await readFile(individualPaths[i])), fingerprints[i]);
      }
      assert.equal(hash(await readFile(bundlePath)), bundleHash);
    });
  });
}
test("allowance file workflow: failed file copy cannot mutate the earlier good record", async () => {
  await isolated(async root => {
    const prepared = await prepareAllowanceFile("observation", record());
    const path = join(root, prepared.filename);
    await writeFile(path, prepared.text, { flag: "wx" });
    const fingerprint = hash(await readFile(path));
    const corrupted = join(root, "corrupted-copy.json");
    await writeFile(corrupted, prepared.text.replace('"allowanceBaseUnits": "10"', '"allowanceBaseUnits": "11"'), { flag: "wx" });
    await assert.rejects(readAllowanceFile(await diskFile(corrupted)));
    assert.equal(hash(await readFile(path)), fingerprint);
    assert.deepEqual((await readAllowanceFile(await diskFile(path))).payload, record());
  });
});
test("allowance file workflow: retries preserve unknown versus zero across disk round trip", async () => {
  await isolated(async root => {
    const f = fakeReader();
    f.session.getTokenAllowance = async (token, spender) => {
      if (spender === S2) throw Error("Synthetic temporary failure");
      return 0n;
    };
    const partial = await readAllowanceSnapshot(f.session, targets());
    const prepared = await prepareAllowanceFile("observation", partial);
    const path = join(root, prepared.filename);
    await writeFile(path, prepared.text, { flag: "wx" });
    const restored = (await readAllowanceFile(await diskFile(path))).payload;
    const summary = summarizeAllowances(restored);
    assert.equal(summary.zeroAmounts, 1);
    assert.equal(summary.unknownAmounts, 1);
    assert.equal(summary.rows[0].spenderAddress, S1);
    assert.equal(summary.rows[1].allowanceBaseUnits, null);
    const controller = createAllowanceController({
      getContext: () => ({ ...targets(), account: ACCOUNT }),
      read: async () => record(),
    });
    await controller.load(await diskFile(path));
    controller.useAsBaseline();
    controller.preview(S1 + " | Exchange A\n" + S2 + " | Exchange B");
    controller.apply();
    await controller.inspect();
    assert.equal(controller.compare(), true);
    assert.equal(controller.state().comparison.rows[1].status, "unknown");
    controller.dispose();
  });
});
test("allowance file workflow: repeated load/save does not multiply observations", async () => {
  const original = captureAllowanceBundle(["DAT", "EMA", "CAWELON"].map(agent => record({}, agent)));
  let bundle = original;
  for (let i = 0; i < 3; i++) {
    const prepared = await prepareAllowanceBundle(bundle);
    const bytes = new TextEncoder().encode(prepared.text);
    bundle = (await readAllowanceBundle({
      name: prepared.filename, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer,
    })).bundle;
    assert.equal(bundle.records.length, 3);
    assert(bundle.records.every(record => record.rows.length === 2));
  }
  assert.deepEqual(bundle, original);
});
