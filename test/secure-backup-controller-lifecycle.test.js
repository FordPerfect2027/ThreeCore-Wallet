import test from "node:test";
import assert from "node:assert/strict";
import { controllerFixture, PASSWORD, fakePrepared, fakeDecoded, encryptedText,
  draft, clone, gate, tick } from "./helpers/secure-backup-fixtures.js";
import { manualTime } from "./helpers/secure-lifecycle-time.js";

function timed(options = {}) {
  const time = manualTime();
  const f = controllerFixture({ resultLifetimeMs: 100, lifetimeOptions: time.options, ...options });
  return { ...f, time };
}

for (const action of ["cancel", "invalidate", "dispose"]) {
  for (const phase of ["encrypting", "reading", "decrypting"]) {
    test(action + " during " + phase + " notification prevents dispatch", async () => {
      let f;
      let reads = 0;
      f = controllerFixture({ readText: async () => { reads++; return encryptedText(); },
        onChange(state) { if (state.phase === phase) f.controller[action](); } });
      let result;
      if (phase === "encrypting") result = await f.seal();
      else if (phase === "reading") result = await f.select();
      else { assert.equal(await f.select(), true); result = await f.unlock(); }
      assert.equal(result, false);
      assert.equal(f.calls.length, 0);
      assert.equal(reads, phase === "decrypting" ? 1 : 0);
      assert.equal(f.controller.state().phase,
        action === "cancel" ? "cancelled" : action === "dispose" ? "disposed" : "idle");
      assert.equal(f.staged.length, 0);
    });
  }
}

for (const phase of ["encrypted", "selected", "decrypted"]) {
  test("cancel during " + phase + " notification does not report a usable result", async () => {
    let f;
    f = controllerFixture({ onChange(state) {
      if (state.phase === phase) f.controller.cancel();
    } });
    let result;
    if (phase === "encrypted") result = await f.seal();
    else if (phase === "selected") result = await f.select();
    else { await f.select(); result = await f.unlock(); }
    assert.equal(result, false);
    assert.equal(f.controller.state().phase, "cancelled");
    assert.equal(f.controller.state().encryptedBytes, 0);
  });
}

test("nested selection started by an encryption notification owns state", async () => {
  let f;
  let nested;
  f = controllerFixture({ onChange(state) {
    if (state.phase === "encrypting") nested = f.select();
  } });
  assert.equal(await f.seal(), false);
  assert.equal(await nested, true);
  assert.equal(f.controller.state().phase, "selected");
  assert.equal(f.calls.length, 0);
});

test("nested selection started by a reading notification wins without recursion", async () => {
  let f;
  let once = false;
  let nested;
  f = controllerFixture({ onChange(state) {
    if (state.phase === "reading" && !once) {
      once = true;
      nested = f.controller.selectText(encryptedText());
    }
  } });
  assert.equal(await f.select(), false);
  assert.equal(nested, true);
  assert.equal(f.controller.state().phase, "selected");
});

for (const operation of ["seal", "unlock"]) {
  test(operation + " cannot continue after readDraft cancels", async () => {
    let f;
    let cancelOnRead = false;
    f = controllerFixture({ readDraft() {
      if (cancelOnRead) f.controller.cancel();
      return draft();
    } });
    if (operation === "unlock") await f.select();
    cancelOnRead = true;
    assert.equal(await f[operation](), false);
    assert.equal(f.calls.length, 0);
    assert.equal(f.controller.state().phase, "cancelled");
  });
}

for (const operation of ["seal", "unlock"]) {
  test(operation + " completion cannot override cancellation in draft recheck", async () => {
    let f;
    let reads = 0;
    f = controllerFixture({ readDraft() {
      if (++reads === 2) f.controller.cancel();
      return draft();
    } });
    if (operation === "unlock") await f.select();
    assert.equal(await f[operation](), false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.controller.state().phase, "cancelled");
    assert.equal(f.controller.state().canStage, false);
    assert.equal(f.controller.state().canDownload, false);
  });
}

for (const action of ["offer", "stage", "encryptedText"]) {
  test(action + " rechecks identity after draft callback cancels", async () => {
    let f;
    let armed = false;
    let downloads = 0;
    f = controllerFixture({ readDraft() {
      if (armed) f.controller.cancel();
      return draft();
    } });
    if (action === "stage") { await f.select(); await f.unlock(); }
    else await f.seal();
    armed = true;
    if (action === "offer") assert.equal(f.controller.offer(() => { downloads++; }), false);
    else if (action === "stage") assert.equal(f.controller.stage(), false);
    else assert.throws(() => f.controller.encryptedText(), { code: "SECURE_CANCELLED" });
    assert.equal(downloads, 0);
    assert.equal(f.staged.length, 0);
    assert.equal(f.controller.state().phase, "cancelled");
  });
}

test("failing download cannot erase a newly selected encrypted file", async () => {
  const f = controllerFixture();
  await f.seal();
  let selected;
  assert.equal(f.controller.offer(() => {
    selected = f.controller.selectText(encryptedText());
    throw Error("old download failed");
  }), false);
  assert.equal(selected, true);
  assert.equal(f.controller.state().phase, "selected");
  assert.equal(f.controller.state().errorCode, null);
});

test("failing stage callback cannot erase a newer selected file", async () => {
  let f;
  f = controllerFixture({ onStage() {
    f.controller.selectText(encryptedText());
    throw Error("old stage failed");
  } });
  await f.select();
  await f.unlock();
  assert.equal(f.controller.stage(), false);
  assert.equal(f.controller.state().phase, "selected");
  assert.equal(f.controller.state().errorCode, null);
});

test("recursive download offer is rejected without creating a second download", async () => {
  const f = controllerFixture();
  await f.seal();
  let downloads = 0;
  let nested;
  assert.equal(f.controller.offer(() => {
    downloads++;
    nested = f.controller.offer(() => { downloads++; });
  }), true);
  assert.equal(nested, false);
  assert.equal(downloads, 1);
  assert.equal(f.controller.state().downloadOffered, true);
});

test("download adapter false is failure rather than an offered receipt", async () => {
  const f = controllerFixture();
  await f.seal();
  assert.equal(f.controller.offer(() => false), false);
  assert.equal(f.controller.state().downloadOffered, false);
  assert.equal(f.controller.state().errorCode, "SECURE_DOWNLOAD");
});

test("async stage failure is consumed without reporting staged data", async () => {
  const f = controllerFixture({ onStage: async () => { throw Error("synthetic private error"); } });
  await f.select();
  await f.unlock();
  assert.equal(f.controller.stage(), false);
  await tick();
  assert.equal(f.controller.state().errorCode, "SECURE_STAGE");
  assert.equal(f.controller.state().canStage, false);
});

test("async view failures cannot create unhandled rejections", async () => {
  const f = controllerFixture({ onChange: async () => { throw Error("failed observer"); } });
  assert.equal(await f.seal(), true);
  await tick();
  assert.equal(f.controller.state().canDownload, true);
  f.controller.dispose();
});

for (const method of ["seal", "select", "unlock"]) {
  test(method + " late failure does not alter a newer selection", async () => {
    const pending = gate();
    const options = method === "seal" ? { encrypt: () => pending.promise } :
      method === "select" ? { readText: () => pending.promise } : { decrypt: () => pending.promise };
    const f = controllerFixture(options);
    if (method === "unlock") f.controller.selectText(encryptedText());
    const work = f[method]();
    await tick();
    f.controller.selectText(encryptedText());
    pending.reject(Error("stale failure"));
    assert.equal(await work, false);
    await tick();
    assert.equal(f.controller.state().phase, "selected");
    assert.equal(f.controller.state().errorCode, null);
  });
}

for (const phase of ["encrypted", "selected", "decrypted"]) {
  test(phase + " candidate expires on state read without timer delivery", async () => {
    const f = timed();
    if (phase === "encrypted") await f.seal();
    else { await f.select(); if (phase === "decrypted") await f.unlock(); }
    f.time.advance(100);
    const state = f.controller.state();
    assert.equal(state.phase, "error");
    assert.equal(state.errorCode, "SECURE_EXPIRED");
    assert.equal(state.canDownload || state.canDecrypt || state.canStage, false);
    assert.equal(state.encryptedBytes, 0);
    assert.equal(state.summary, null);
    assert.equal(f.time.pending, 0);
  });
}

for (const action of ["offer", "encryptedText", "unlock", "stage"]) {
  test(action + " checks absolute candidate lifetime at use", async () => {
    const f = timed();
    if (["offer", "encryptedText"].includes(action)) await f.seal();
    else { await f.select(); if (action === "stage") await f.unlock(); }
    f.time.advance(100);
    let downloads = 0;
    if (action === "offer") assert.equal(f.controller.offer(() => { downloads++; }), false);
    if (action === "encryptedText") assert.throws(() => f.controller.encryptedText(), { code: "SECURE_EXPIRED" });
    if (action === "unlock") assert.equal(await f.unlock(), false);
    if (action === "stage") assert.equal(f.controller.stage(), false);
    assert.equal(downloads, 0);
    assert.equal(f.staged.length, 0);
    assert.equal(f.controller.state().canStage, false);
    assert.equal(f.controller.state().canDownload, false);
  });
}

test("a decrypted candidate has its own full lifetime after slow decryption", async () => {
  const f = timed();
  await f.select();
  f.time.advance(90);
  await f.unlock();
  f.time.advance(90);
  assert.equal(f.controller.stage(), true);
  assert.equal(f.staged.length, 1);
});

test("repeated reads and downloaded offers do not renew a candidate", async () => {
  const f = timed();
  await f.seal();
  for (let i = 0; i < 9; i++) {
    f.time.advance(10);
    assert.equal(f.controller.state().canDownload, true);
    assert.equal(f.controller.encryptedText(), encryptedText());
    assert.equal(f.controller.offer(() => {}), true);
  }
  f.time.advance(10);
  assert.equal(f.controller.offer(() => assert.fail()), false);
  assert.equal(f.controller.state().canDownload, false);
});

for (const action of ["offer", "stage", "encryptedText"]) {
  test(action + " detects expiration during draft revalidation", async () => {
    const time = manualTime();
    let expire = false;
    const f = controllerFixture({ resultLifetimeMs: 100, lifetimeOptions: time.options,
      readDraft() { if (expire) time.advance(100); return draft(); } });
    if (action === "stage") { await f.select(); await f.unlock(); }
    else await f.seal();
    expire = true;
    if (action === "offer") assert.equal(f.controller.offer(() => assert.fail()), false);
    if (action === "stage") assert.equal(f.controller.stage(), false);
    if (action === "encryptedText") assert.throws(() => f.controller.encryptedText(), { code: "SECURE_EXPIRED" });
    assert.equal(f.staged.length, 0);
    assert.equal(f.controller.state().errorCode, "SECURE_EXPIRED");
  });
}

test("clock failure destroys decrypted candidate and forbids later publication", async () => {
  const f = timed();
  await f.select();
  await f.unlock();
  f.time.set(NaN);
  assert.equal(f.controller.stage(), false);
  assert.equal(f.controller.state().errorCode, "SECURE_CLOCK");
  f.time.set(500);
  assert.equal(await f.seal(), false);
  assert.equal(f.controller.state().canDownload, false);
  assert.equal(f.controller.state().errorCode, "SECURE_CLOCK");
});

test("timer setup failure never leaves a ready candidate", async () => {
  const f = controllerFixture({ lifetimeOptions: { schedule() { throw Error("timer failed"); } } });
  assert.equal(await f.seal(), false);
  assert.equal(f.controller.state().canDownload, false);
  assert.equal(f.controller.state().encryptedBytes, 0);
  assert.equal(f.controller.state().errorCode, "SECURE_TIMER");
});

test("old candidate timer cannot erase the next selected file", async () => {
  const f = timed();
  await f.seal();
  const [old] = f.time.ids();
  f.time.advance(50);
  await f.select();
  f.time.advance(50);
  f.time.fire(old, { stale: true });
  assert.equal(f.controller.state().phase, "selected");
  f.time.advance(50);
  assert.equal(f.controller.state().phase, "error");
});

test("backend result mutation cannot alter prepared ciphertext or download metadata", async () => {
  const result = { ...fakePrepared(), filename: "secret.exe", mimeType: "text/html", byteLength: -1 };
  const f = controllerFixture({ encrypt: async () => result });
  assert.equal(await f.seal(), true);
  result.text = "mutated after validation";
  let offered;
  assert.equal(f.controller.offer(value => { offered = value; }), true);
  assert.equal(offered.text, encryptedText());
  assert.equal(offered.filename, "ThreeCore-workspace-encrypted.json");
  assert.equal(offered.mimeType, "application/json;charset=utf-8");
  assert.equal(offered.byteLength, new TextEncoder().encode(encryptedText()).length);
  assert(Object.isFrozen(offered));
});

for (const operation of ["seal", "unlock"]) {
  test(operation + " rejects accessor result text without invoking it", async () => {
    let invoked = 0;
    const result = { get text() { invoked++; return operation === "seal" ? encryptedText() : fakeDecoded().text; } };
    const f = controllerFixture(operation === "seal" ? { encrypt: async () => result } : { decrypt: async () => result });
    if (operation === "unlock") await f.select();
    assert.equal(await f[operation](), false);
    assert.equal(invoked, 0);
    assert.equal(f.controller.state().errorCode, "SECURE_CONTENT");
    assert.equal(f.staged.length, 0);
  });
}

test("inherited result text is not trusted as backend output", async () => {
  const result = Object.create({ text: encryptedText() });
  const f = controllerFixture({ encrypt: async () => result });
  assert.equal(await f.seal(), false);
  assert.equal(f.controller.state().errorCode, "SECURE_CONTENT");
});

test("proxy descriptor cancellation cannot publish old output", async () => {
  let f;
  const result = new Proxy(fakePrepared(), { getOwnPropertyDescriptor(target, key) {
    f.controller.cancel();
    return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  f = controllerFixture({ encrypt: async () => result });
  assert.equal(await f.seal(), false);
  assert.equal(f.controller.state().phase, "cancelled");
});

test("expiry notifications contain only safe state", async () => {
  const f = timed();
  await f.select();
  await f.unlock();
  f.time.advance(100);
  f.time.flush();
  const text = JSON.stringify(f.notifications);
  for (const forbidden of [PASSWORD, "ciphertext", "0x111111", "nativeBalanceBaseUnits"]) {
    assert(!text.includes(forbidden));
  }
  assert.equal(f.notifications.at(-1).errorCode, "SECURE_EXPIRED");
});
