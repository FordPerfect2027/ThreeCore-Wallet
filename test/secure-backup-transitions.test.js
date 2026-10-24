import test from "node:test";
import assert from "node:assert/strict";
import { controllerFixture, PASSWORD, encryptedText, fileObject } from "./helpers/secure-backup-fixtures.js";

/** Reproducible user-event sequences exercise cross-workflow state boundaries. */
function generator(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x100000000;
  };
}

for (let seed = 1; seed <= 32; seed++) {
  test("encrypted workflow security invariants across mixed events, seed " + seed, async () => {
    const f = controllerFixture();
    const random = generator(seed);
    const downloads = [];
    let explicitStages = 0;
    let explicitDownloads = 0;
    for (let step = 0; step < 32; step++) {
      const event = Math.floor(random() * 9);
      switch (event) {
        case 0:
          await f.seal();
          break;
        case 1:
          await f.select();
          break;
        case 2:
          await f.unlock();
          break;
        case 3:
          explicitStages++;
          f.controller.stage();
          break;
        case 4:
          explicitDownloads++;
          f.controller.offer(prepared => downloads.push(prepared));
          break;
        case 5:
          f.controller.cancel();
          break;
        case 6:
          f.controller.invalidate();
          break;
        case 7:
          await f.controller.select(fileObject("malformed input"));
          break;
        case 8:
          await f.controller.seal(PASSWORD, "different");
          break;
      }
      const state = f.controller.state();
      assert.equal(state.canDownload, state.phase === "encrypted", "download phase: " + step);
      assert.equal(state.canDecrypt, state.phase === "selected", "decrypt phase: " + step);
      assert.equal(state.canStage, state.phase === "decrypted", "stage phase: " + step);
      assert.equal(state.diskSaved, false, "disk save is never assumed");
      assert(f.staged.length <= explicitStages, "no implicit restore handoff");
      assert(downloads.length <= explicitDownloads, "no implicit download");
      assert(!JSON.stringify(state).includes(PASSWORD), "no credentials in state");
      assert(!JSON.stringify(state).includes("0x111111"), "no accounts in status");
      if (["idle", "error", "cancelled"].includes(state.phase)) {
        assert.equal(state.summary, null);
        assert.equal(state.encryptedBytes, 0);
      }
    }
    for (const prepared of downloads) assert.equal(prepared.text, encryptedText());
    f.controller.dispose();
    assert.equal(f.controller.state().phase, "disposed");
  });
}

test("all candidate states clear on invalidation, including download-offered state", async () => {
  for (const prepare of [
    async f => {},
    async f => f.seal(),
    async f => { await f.seal(); f.controller.offer(() => {}); },
    async f => f.select(),
    async f => { await f.select(); await f.unlock(); },
    async f => { await f.select(); await f.unlock(); f.controller.stage(); },
    async f => f.controller.select(fileObject("invalid")),
  ]) {
    const f = controllerFixture();
    await prepare(f);
    f.controller.invalidate();
    const state = f.controller.state();
    assert.equal(state.phase, "idle");
    assert.equal(state.canDownload, false);
    assert.equal(state.canDecrypt, false);
    assert.equal(state.canStage, false);
    assert.equal(state.summary, null);
    assert.equal(state.downloadOffered, false);
    assert.equal(state.errorCode, null);
    assert.equal(state.encryptedBytes, 0);
  }
});
