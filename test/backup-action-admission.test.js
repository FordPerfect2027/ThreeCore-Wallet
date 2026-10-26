import test from "node:test";
import assert from "node:assert/strict";
import { lifecyclePanel } from "./helpers/secure-lifecycle-panel.js";
import { controllerFixture, encryptedText, fakePrepared, fakeDecoded, PASSWORD } from "./helpers/secure-backup-fixtures.js";
import { manualTime } from "./helpers/secure-lifecycle-time.js";
import { tick } from "./helpers/workspace-fixtures.js";

for (const phase of ["encrypted", "selected", "decrypted"]) {
  for (const action of ["cancel", "invalidate", "dispose"]) {
    test(`backup observer sees ${action} during ${phase} publication`, async t => {
      let fixture, visible;
      fixture = controllerFixture({ onChange(state) {
        visible = state;
        if (state.phase === phase) fixture.controller[action]();
      } });
      t.after(() => fixture.controller.dispose());
      if (phase === "encrypted") await fixture.seal();
      else { await fixture.select(); if (phase === "decrypted") await fixture.unlock(); }
      const expected = { cancel: "cancelled", invalidate: "idle", dispose: "disposed" }[action];
      assert.equal(fixture.controller.state().phase, expected);
      assert.equal(visible.phase, expected, "UI must receive the final restrictive state");
      assert.equal(visible.canDownload, false);
      assert.equal(visible.canDecrypt, false);
      assert.equal(visible.canStage, false);
      assert.equal(visible.summary, null);
    });
  }
}

for (const operation of ["seal", "select"]) {
  for (const stop of ["protect", "invalidate", "pagehide", "hidden"]) {
    test(`${operation} does not restart after ${stop} inside parent protection`, async t => {
      let fixture, armed = false, encrypted = 0, read = 0;
      fixture = lifecyclePanel({ onProtect() {
        if (!armed) return;
        armed = false;
        if (stop === "hidden") {
          fixture.document.hidden = true;
          fixture.document.dispatchEvent(new Event("visibilitychange"));
        } else if (stop === "pagehide") fixture.eventTarget.dispatchEvent(new Event("pagehide"));
        else fixture.panel[stop]();
      }, controllerOptions: {
        encrypt: async () => { encrypted++; return fakePrepared(); },
        readText: async () => { read++; return encryptedText(); },
      } });
      t.after(() => fixture.dispose());
      armed = true;
      await fixture[operation]();
      await tick();
      assert.equal(encrypted, 0, "No cryptography after the stop boundary");
      assert.equal(read, 0, "No file read after the stop boundary");
      assert.equal(fixture.panel.state().phase, stop === "invalidate" ? "idle" : "cancelled");
      assert.equal(fixture.q("password").value, "");
      assert.equal(fixture.q("restore-password").value, "");
      assert.equal(fixture.q("download").disabled, true);
      assert.equal(fixture.q("stage").disabled, true);
      assert.equal(fixture.staged.length, 0);
      assert.equal(fixture.writes.length, 0);
    });
  }
}

test("credential timer removal cannot restart encryption after a stop", async t => {
  const time = manualTime();
  let fixture, hook = null, encrypted = 0, exposed = null;
  fixture = lifecyclePanel({ deadlineOptions: { ...time.options, unschedule(id) {
    time.unschedule(id);
    const action = hook; hook = null; action?.();
  } }, controllerOptions: { encrypt: async () => { encrypted++; return fakePrepared(); } } });
  t.after(() => fixture.dispose());
  fixture.input("password", PASSWORD);
  fixture.input("confirmation", PASSWORD);
  fixture.check(fixture.q("acknowledged"));
  hook = () => {
    exposed = [fixture.q("password").value, fixture.q("confirmation").value];
    fixture.panel.protect();
  };
  fixture.q("encrypt").click();
  await tick();
  assert.deepEqual(exposed, ["", ""], "Clear input fields before external timer cleanup");
  assert.equal(encrypted, 0);
  assert.equal(fixture.panel.state().phase, "cancelled");
});

test("a protection callback cannot recursively start the same encrypt action", async t => {
  let fixture, armed = false, notifications = 0, encrypted = 0;
  fixture = lifecyclePanel({ onProtect() {
    notifications++;
    if (!armed) return;
    armed = false;
    fixture.input("password", PASSWORD);
    fixture.input("confirmation", PASSWORD);
    fixture.check(fixture.q("acknowledged"));
    fixture.q("encrypt").click();
  }, controllerOptions: { encrypt: async () => { encrypted++; return fakePrepared(); } } });
  t.after(() => fixture.dispose());
  armed = true;
  await fixture.seal();
  await tick();
  assert.equal(notifications, 1, "Only the explicit outer action may ask for preparation");
  assert.equal(encrypted, 1);
  assert.equal(fixture.panel.state().phase, "encrypted");
});

for (const operation of ["seal", "select", "unlock"]) {
  for (const stop of ["protect", "invalidate", "dispose"]) {
    test(`${operation} refuses dispatch after ${stop} in credential cleanup`, async t => {
      const time = manualTime();
      let fixture, armed = false, calls = 0, exposed;
      fixture = lifecyclePanel({ deadlineOptions: { ...time.options, unschedule(id) {
        time.unschedule(id);
        if (!armed) return;
        armed = false;
        exposed = ["password", "confirmation", "restore-password"].map(name => fixture.q(name).value);
        fixture.panel[stop]();
      } }, controllerOptions: {
        encrypt: async () => { calls++; return fakePrepared(); },
        decrypt: async () => { calls++; return fakeDecoded(); },
        readText: async () => { calls++; return encryptedText(); },
      } });
      t.after(() => fixture.dispose());
      if (operation === "unlock") await fixture.select();
      const before = calls;
      const file = fixture.q("file"), decrypt = fixture.q("decrypt"), encrypt = fixture.q("encrypt");
      fixture.input("password", PASSWORD);
      fixture.input("confirmation", PASSWORD);
      fixture.input("restore-password", PASSWORD);
      fixture.check(fixture.q("acknowledged"));
      armed = true;
      if (operation === "select") {
        file.files = [{ name: "synthetic.json", size: 10 }];
        file.dispatchEvent(new Event("change"));
      } else (operation === "seal" ? encrypt : decrypt).click();
      await tick();
      assert.deepEqual(exposed, ["", "", ""]);
      assert.equal(calls, before);
      assert.equal(fixture.panel.state().phase,
        { protect: "cancelled", invalidate: "idle", dispose: "disposed" }[stop]);
      assert.equal(fixture.staged.length, 0);
      assert.equal(fixture.downloads.length, 0);
      if (stop === "dispose") assert.equal(fixture.parent.children.length, 0);
      else {
        await fixture.seal();
        assert.equal(fixture.panel.state().phase, "encrypted", "A fresh explicit action still works");
        assert.equal(calls, before + 1);
      }
    });
  }
}

for (const operation of ["seal", "select"]) {
  test(`${operation} is rejected when the document is already hidden`, async t => {
    const f = lifecyclePanel();
    t.after(() => f.dispose());
    f.document.hidden = true;
    await f[operation]();
    assert.equal(f.panel.state().phase, "cancelled");
    assert.equal(f.runner.state().started, 0);
    assert.equal(f.q("password").value, "");
    assert.equal(f.q("decrypt").disabled, true);
    f.document.hidden = false;
    f.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(f.panel.state().phase, "cancelled", "Visibility does not resume work");
    await f[operation]();
    assert.equal(f.panel.state().phase, operation === "seal" ? "encrypted" : "selected");
  });
}

for (const action of ["protect", "invalidate", "dispose"]) {
  test(`${action} clears password fields before its timer callback`, t => {
    const time = manualTime();
    let f, armed = false, observed;
    f = lifecyclePanel({ deadlineOptions: { ...time.options, unschedule(id) {
      time.unschedule(id);
      if (armed) {
        armed = false;
        observed = [f.q("password").value, f.q("confirmation").value, f.q("restore-password").value];
      }
    } } });
    t.after(() => f.dispose());
    f.input("password", PASSWORD);
    f.input("confirmation", PASSWORD);
    f.input("restore-password", PASSWORD);
    armed = true;
    f.panel[action]();
    assert.deepEqual(observed, ["", "", ""]);
    assert.equal(time.pending, 0);
  });
}

test("parent disposal during protection cannot recursively dispose the panel", t => {
  let f, notifications = 0;
  f = lifecyclePanel({ onProtect() { notifications++; f.panel.dispose(); } });
  t.after(() => f.dispose());
  f.input("password", PASSWORD);
  f.panel.dispose();
  assert.equal(notifications, 1);
  assert.equal(f.panel.state().phase, "disposed");
  assert.equal(f.parent.children.length, 0);
  assert.equal(f.time.pending, 0);
});

test("a stop observer that repeats cancellation cannot create a notification loop", async t => {
  let f, calls = 0, visible;
  f = controllerFixture({ onChange(state) {
    calls++;
    visible = state;
    if (state.phase === "encrypted" || state.phase === "cancelled") f.controller.cancel();
  } });
  t.after(() => f.controller.dispose());
  assert.equal(await f.seal(), false);
  assert.equal(visible.phase, "cancelled");
  assert.equal(visible.canDownload, false);
  assert.equal(calls, 3);
  await tick();
  assert.equal(calls, 3, "No queued infinite notification chain");
});
