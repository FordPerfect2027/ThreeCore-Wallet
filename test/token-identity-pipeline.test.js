import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createTokenIdentityController } from "../src/token-identity-controller.js";
import { readTokenIdentity } from "../src/token-identity-reader.js";
import { prepareTokenIdentityFile, decodeTokenIdentityFile } from "../src/token-identity-report.js";
import { summarizeIdentityCards } from "../src/identity-overview.js";
import { providerFixture, word, HASH, ACCOUNT, OTHER, deferred, tick } from "./helpers/identity-fixtures.js";

const agents = ["DAT", "EMA", "CAWELON"];
function controllerFor(f, agent, chainId) {
  return createTokenIdentityController({
    getContext: () => ({ agent, chainId, account: ACCOUNT, tokenAddress: f.row.tokenAddress }),
    read: options => readTokenIdentity(f.session, options),
  });
}
const view = (controller, agent) => { const { phase, provenance, observation } = controller.state(); return { agent, phase, provenance, observation }; };

for (const chainId of [8453, 84532]) {
  test("all token files survive real disk roundtrip at " + chainId, async () => {
    const directory = await mkdtemp(join(tmpdir(), "threecore-identity-test-"));
    const fixtures = [];
    const first = [];
    const reopened = [];
    try {
      for (const agent of agents) {
        const f = providerFixture({ agent, chainId });
        fixtures.push(f);
        await f.session.connect();
        const controller = controllerFor(f, agent, chainId);
        first.push(controller);
        assert.equal(await controller.inspect(), true);
        assert.equal(await controller.prepareFile(), true);
        const prepared = controller.state().file;
        const path = join(directory, prepared.filename);
        await writeFile(path, prepared.text, { encoding: "utf8", flag: "wx" });
        const bytes = await readFile(path);
        const decoded = await decodeTokenIdentityFile(bytes);
        assert.equal(decoded.digest, prepared.digest);
        assert.equal(decoded.observation.agent, agent);
        assert.equal(decoded.observation.chainId, chainId);
        assert.equal(decoded.authenticated, false);
        assert.deepEqual(decoded.observation, controller.state().observation);

        // Recreate presentation state to model a page reload. The new
        // controller's read adapter fails if importing tries to call RPC.
        const restored = createTokenIdentityController({
          getContext: () => ({ agent, chainId, account: "" }),
          read: async () => { throw Error("Import must remain offline"); },
        });
        reopened.push(restored);
        assert.equal(await restored.load({ name: prepared.filename, size: bytes.byteLength,
          arrayBuffer: async () => Uint8Array.from(bytes).buffer }), true);
        assert.equal(restored.state().provenance, "imported");
        assert.equal(restored.state().assessment.tokenAmount, "1.234567890123456789");
        assert.equal(restored.state().observation.blockHash, HASH);
      }
      const before = summarizeIdentityCards(first.map((controller, index) => view(controller, agents[index])));
      const after = summarizeIdentityCards(reopened.map((controller, index) => view(controller, agents[index])));
      assert.equal(before.matchedCards, 3);
      assert.equal(after.matchedCards, 3);
      assert.equal(after.importedCards, 3);
      for (const f of fixtures) {
        assert.equal(f.calls.filter(call => call.method === "eth_requestAccounts").length, 1);
        assert.ok(!f.calls.some(call => /send|sign|switch|watchAsset/i.test(call.method)));
      }
    } finally {
      for (const controller of [...first, ...reopened]) controller.dispose();
      for (const f of fixtures) f.session.disconnect();
      // Only the named test-owned mkdtemp directory is removed.
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      assert.ok(basename(directory).startsWith("threecore-identity-test-"));
      await rm(directory, { recursive: true });
    }
  });
}

test("one provider's failure does not stop the other two identities", async () => {
  const fixtures = agents.map(agent => providerFixture({ agent,
    override: args => agent === "EMA" && args.method === "eth_call"
      ? Promise.reject(Error("Synthetic EMA outage")) : undefined }));
  const controllers = fixtures.map((f, index) => controllerFor(f, agents[index], 8453));
  try {
    await Promise.all(fixtures.map(f => f.session.connect()));
    assert.deepEqual(await Promise.all(controllers.map(controller => controller.inspect())), [true, false, true]);
    assert.equal(controllers[0].state().observation.agent, "DAT");
    assert.equal(controllers[1].state().observation, null);
    assert.equal(controllers[2].state().observation.agent, "CAWELON");
    const summary = summarizeIdentityCards(controllers.map((controller, index) => view(controller, agents[index])));
    assert.equal(summary.matchedCards, 2);
  } finally {
    controllers.forEach(controller => controller.dispose());
    fixtures.forEach(f => f.session.disconnect());
  }
});

test("independent sessions do not reuse a token response from another provider", async () => {
  const fixtures = agents.map((agent, index) => providerFixture({
    agent, override: args => args.method === "eth_call" && args.params[0].data.startsWith("0x70a08231")
      ? word(BigInt(index + 1)) : undefined,
  }));
  try {
    await Promise.all(fixtures.map(f => f.session.connect()));
    const values = await Promise.all(fixtures.map(f => readTokenIdentity(f.session)));
    assert.deepEqual(values.map(value => value.balanceBaseUnits), ["1", "2", "3"]);
    assert.deepEqual(values.map(value => value.agent), agents);
    fixtures.forEach((f, index) => {
      assert.ok(f.calls.filter(call => call.method === "eth_call").every(call =>
        call.params[0].to === values[index].tokenAddress));
    });
  } finally {
    fixtures.forEach(f => f.session.disconnect());
  }
});

test("a disconnected provider cannot publish a late result into a three-card summary", async () => {
  const gate = deferred();
  const fixtures = agents.map(agent => providerFixture({ agent,
    override: args => agent === "EMA" && args.method === "eth_getCode" ? gate.promise : undefined }));
  const controllers = fixtures.map((f, index) => controllerFor(f, agents[index], 8453));
  try {
    await Promise.all(fixtures.map(f => f.session.connect()));
    const pending = controllers.map(controller => controller.inspect());
    await tick();
    fixtures[1].provider.account = OTHER;
    fixtures[1].provider.emit("accountsChanged", [OTHER]);
    gate.resolve("0x6000");
    assert.deepEqual(await Promise.all(pending), [true, false, true]);
    const summary = summarizeIdentityCards(controllers.map((controller, index) => view(controller, agents[index])));
    assert.equal(summary.matchedCards, 2);
    assert.equal(controllers[1].state().file, null);
  } finally {
    controllers.forEach(controller => controller.dispose());
    fixtures.forEach(f => f.session.disconnect());
  }
});

test("a syntactically valid edited file needs a new digest and remains unauthenticated", async () => {
  const f = providerFixture();
  try {
    await f.session.connect();
    const observed = await readTokenIdentity(f.session);
    const first = await prepareTokenIdentityFile(observed);
    const edited = JSON.parse(first.text);
    edited.observation.balanceBaseUnits = "1";
    await assert.rejects(() => decodeTokenIdentityFile(new TextEncoder().encode(JSON.stringify(edited))),
      error => error.code === "IDENTITY_CHECKSUM");
    const second = await prepareTokenIdentityFile(edited.observation);
    const loaded = await decodeTokenIdentityFile(new TextEncoder().encode(second.text));
    assert.equal(loaded.checksumVerified, true);
    assert.equal(loaded.authenticated, false);
    assert.equal(loaded.observation.balanceBaseUnits, "1");
    assert.notEqual(second.digest, first.digest);
  } finally { f.session.disconnect(); }
});

test("one-unit change survives RPC, assessment, file storage and comparison", async () => {
  let block = 42;
  let amount = 9007199254740993123n;
  const f = providerFixture({ override: args => {
    if (args.method === "eth_getBlockByNumber") return { number: "0x" + block.toString(16), hash: HASH };
    if (args.method === "eth_call" && args.params[0].data.startsWith("0x70a08231")) return word(amount);
  } });
  const controller = controllerFor(f, "DAT", 8453);
  try {
    await f.session.connect();
    assert.equal(await controller.inspect(), true);
    assert.equal(controller.useAsBaseline(), true);
    const before = controller.state().observation;
    block++;
    amount++;
    assert.equal(await controller.inspect(), true);
    assert.equal(controller.compare(), true);
    assert.equal(controller.state().comparison.deltaBaseUnits, "1");
    assert.equal(controller.state().comparison.deltaAmount, "+0.000000000000000001");
    const exported = await prepareTokenIdentityFile(controller.state().observation);
    const imported = await decodeTokenIdentityFile(new TextEncoder().encode(exported.text));
    assert.equal(imported.observation.balanceBaseUnits, "9007199254740993124");
    assert.equal(before.balanceBaseUnits, "9007199254740993123");
  } finally { controller.dispose(); f.session.disconnect(); }
});
