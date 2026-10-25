import { fixture, PASSWORD, sample, until } from "/test/browser/secure-lifecycle-fixture.js";
import { createSecureBackupRunner } from "/src/secure-backup-runner.js";
import { createSecureDeadline } from "/src/secure-deadline.js";
import { manualTime } from "/test/helpers/secure-lifecycle-time.js";
const assert = (value, message) => { if (!value) throw Error(message); };

export function registerSecureLifecycleUITests(test) {
  test("backup timer: autofill on a faulted timer is cleared at explicit use", async () => {
    const f = fixture({ timerResult: id => Promise.resolve(id) });
    try {
      // Model autofill without input events, then a second attempt after failure.
      for (let attempt = 0; attempt < 2; attempt++) {
        f.q("password").value = PASSWORD;
        f.q("confirmation").value = PASSWORD;
        f.check(f.q("acknowledged"));
        assert(!f.q("encrypt").disabled, "Explicit use must reach its credential gate");
        f.q("encrypt").click();
        await until(() => !f.q("file").disabled);
        assert(f.q("password").value === "" && f.q("confirmation").value === "", "Autofill credentials cleared");
        assert(f.runner.state().started === 0, "No native crypto started");
      }
      await until(() => f.time.pending === 0);
      assert(f.writes.length === 0 && f.downloads.length === 0, "No write or download");
    } finally { f.dispose(); }
  });

  test("backup timer: failed registration clears credentials on every subsequent input", async () => {
    const f = fixture({ timerResult: id => Promise.resolve(id) });
    try {
      f.input("password", PASSWORD);
      assert(f.q("password").value === "", "Initial input must be cleared on timer failure");
      f.input("confirmation", PASSWORD);
      assert(f.q("confirmation").value === "", "Faulted deadline must clear subsequent input too");
      f.input("restore-password", PASSWORD);
      assert(f.q("restore-password").value === "", "Restore credential must also be cleared");
      f.check(f.q("acknowledged"));
      f.q("encrypt").click();
      await until(() => f.time.pending === 0);
      assert(f.runner.state().started === 0, "Faulted timer must never start crypto");
      assert(f.q("status").textContent.includes("時間管理を開始できない"), "Actionable error is shown");
      assert(f.writes.length === 0 && f.downloads.length === 0, "No write or download");
    } finally { f.dispose(); }
  });

  test("backup timer: asynchronous registration rejects selected native File", async () => {
    const f = fixture({ timerResult: id => Promise.resolve(id) });
    try {
      await f.select();
      assert(f.q("status").textContent.includes("時間管理を開始できない"), "Timer error replaces ready state");
      assert(f.q("decrypt").disabled && f.q("stage").disabled, "No restore access is granted");
      assert(f.q("detail").textContent === "", "No retained candidate summary");
      await until(() => f.time.pending === 0);
      for (const id of f.time.allIds()) f.time.fire(id, { stale: true });
      assert(f.q("decrypt").disabled, "Late timer cannot restore access");
      assert(f.w("json").value === "", "No plaintext handoff");
      assert(f.writes.length === 0 && f.downloads.length === 0, "No write or download");
    } finally { f.dispose(); }
  });

  for (const action of ["protect", "invalidate", "dispose"]) {
    test(`backup cleanup: ${action} inside timer removal cannot hand off plaintext`, async () => {
      let armed = false, reached = false;
      const f = fixture({ onUnschedule() {
        if (!armed) return;
        armed = false; reached = true;
        f.panel[action]();
      } });
      try {
        await f.unlock();
        const input = f.w("json"), stage = f.q("stage");
        assert(!stage.disabled, "Authenticated candidate must be ready");
        armed = true;
        stage.click();
        assert(reached, "Cleanup interruption must be reached");
        assert(input.value === "", "Stopped plaintext reached the workspace input");
        assert(f.writes.length === 0, "Stop must not restore stored data");
        assert(f.downloads.length === 0, "Stop must not offer a file");
        if (action !== "dispose") {
          assert(f.q("stage").disabled, "Old candidate must be unavailable");
          assert(f.q("detail").textContent === "", "Old candidate summary must be cleared");
          await f.unlock();
          f.q("stage").click();
          assert(f.w("json").value.length > 0, "Fresh explicit restoration still works");
        }
      } finally { f.dispose(); }
    });
  }

  test("backup lifecycle: production screen exposes crypto operation status", make => {
    const f = make();
    assert(document.querySelector(".secure-operation-panel"), "protection status integrated");
    assert(document.querySelector(".secure-operation-status").getAttribute("role") === "status", "accessible status");
    assert(f.calls.length === 0, "no provider invocation");
  });

  test("backup lifecycle: native File decrypts and explicitly restores three separate accounts", async () => {
    const f = fixture();
    try {
      await f.unlock();
      assert(!f.q("stage").disabled, "candidate decrypted");
      assert(f.writes.length === 0, "not applied by decryption");
      assert(f.q("restore-password").value === "", "password field cleared");
      f.q("stage").click();
      f.w("preview").click();
      f.check(f.w("confirmed"));
      f.w("apply").click();
      assert(f.writes.length === 1, "one explicit write");
      assert(new Set(f.current.map(row => row.account)).size === 3, "separate accounts retained");
      assert(f.current.map(row => row.agent).join() === "DAT,EMA,CAWELON", "all agents retained");
    } finally { f.dispose(); }
  });

  test("backup lifecycle: expired credentials never start native work", async () => {
    const f = fixture();
    try {
      f.input("password", PASSWORD);
      f.input("confirmation", PASSWORD);
      f.check(f.q("acknowledged"));
      f.time.advance(100);
      f.q("encrypt").click();
      await Promise.resolve();
      assert(f.runner.state().started === 0, "no crypto start");
      assert(f.q("password").value === "", "first password cleared");
      assert(f.q("confirmation").value === "", "confirmation cleared");
      assert(f.downloads.length === 0, "no download");
    } finally { f.dispose(); }
  });

  test("backup lifecycle: expired selected ciphertext cannot start decrypt", async () => {
    const f = fixture();
    try {
      await f.select();
      f.time.advance(100);
      f.input("restore-password", PASSWORD);
      f.q("decrypt").click();
      await Promise.resolve();
      assert(f.runner.state().started === 0, "expired file refused");
      assert(f.q("stage").disabled, "no stage capability");
    } finally { f.dispose(); }
  });

  test("backup lifecycle: expiration before handoff discards authenticated plaintext", async () => {
    const f = fixture();
    try {
      await f.unlock();
      f.time.advance(100);
      f.q("stage").click();
      assert(f.w("json").value === "", "plaintext did not reach parent");
      assert(f.q("stage").disabled, "expired handoff disabled");
      assert(f.q("detail").textContent === "", "old summary cleared");
      assert(f.writes.length === 0, "no writes");
    } finally { f.dispose(); }
  });

  for (const action of ["preview", "apply"]) {
    test("backup lifecycle: delayed timer cannot authorize expired workspace " + action, async () => {
      const f = fixture();
      try {
        await f.unlock();
        f.q("stage").click();
        if (action === "apply") {
          f.w("preview").click();
          f.check(f.w("confirmed"));
          assert(!f.w("apply").disabled, "review was ready");
        }
        f.time.advance(100);
        f.w(action).click();
        assert(f.w("json").value === "", "plaintext cleared at action time");
        assert(f.w("detail").textContent === "", "review cleared");
        assert(f.writes.length === 0, "no restored data");
        assert(f.w("apply").disabled, "apply denied");
      } finally { f.dispose(); }
    });
  }

  for (const edit of ["password", "json", "options"]) {
    test("backup lifecycle: " + edit + " edits cannot extend staged plaintext lifetime", async () => {
      const f = fixture();
      try {
        await f.unlock();
        f.q("stage").click();
        f.time.advance(90);
        if (edit === "password") f.input("password", PASSWORD);
        if (edit === "json") {
          f.w("json").value += " ";
          f.w("json").dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (edit === "options") f.check(f.w("histories"), false);
        f.time.advance(10);
        f.w("preview").click();
        assert(f.w("json").value === "", "original deadline preserved");
        assert(f.writes.length === 0, "nothing applied");
      } finally { f.dispose(); }
    });
  }

  for (const event of ["pagehide", "pageshow"]) {
    test("backup lifecycle: " + event + " clears native DOM credential and plaintext fields", async () => {
      const f = fixture();
      try {
        await f.unlock();
        f.q("stage").click();
        f.input("password", PASSWORD);
        window.dispatchEvent(new PageTransitionEvent(event, { persisted: true }));
        assert(f.q("password").value === "", "credential removed");
        assert(f.w("json").value === "", "plaintext removed");
        assert(f.w("apply").disabled, "old review unavailable");
      } finally { f.dispose(); }
    });
  }

  test("backup lifecycle: operation status changes while native work drains", async () => {
    const f = fixture();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    try {
      const work = f.runner.run(() => pending);
      await until(() => f.host.querySelector(".secure-operation-status").textContent.includes("実行しています"));
      f.runner.cancel();
      await work.catch(() => {});
      await until(() => f.host.querySelector(".secure-operation-status").textContent.includes("終了するのを待っています"));
      assert(f.runner.busy(), "native slot held");
      release("synthetic late result");
      await until(() => f.host.querySelector(".secure-operation-status").textContent.includes("待機はありません"));
      assert(!f.host.textContent.includes("synthetic late result"), "payload not rendered");
    } finally { release(); f.dispose(); }
  });

  test("backup lifecycle: native AbortSignal closes access before completion", async () => {
    const runner = createSecureBackupRunner();
    const abort = new AbortController();
    let release;
    let guard;
    const work = runner.run(check => { guard = check; return new Promise(resolve => { release = resolve; }); }, { signal: abort.signal });
    await until(() => !!release);
    abort.abort();
    const result = await work.catch(error => error.code);
    assert(result === "SECURE_CANCELLED", "cancelled code");
    assert(!guard(), "guard closed");
    assert(runner.busy(), "capacity retained");
    release("late");
    await until(() => !runner.busy());
    assert(runner.state().completed === 0, "not counted as success");
    runner.dispose();
  });

  test("backup lifecycle: clock rollback rejects a real browser runner result", async () => {
    const time = manualTime();
    const runner = createSecureBackupRunner({ ...time.options });
    let release;
    const work = runner.run(() => new Promise(resolve => { release = resolve; }));
    await until(() => !!release);
    time.advance(-1);
    release("private");
    assert(await work.catch(error => error.code) === "SECURE_CLOCK", "rollback rejected");
    assert(runner.state().clockFault, "fault latched");
    runner.dispose();
  });

  test("backup lifecycle: browser timer closes an ordinary deadline", async () => {
    let expired = false;
    const deadline = createSecureDeadline({ timeoutMs: 10, onExpire() { expired = true; } });
    assert(deadline.arm(), "armed");
    await until(() => expired);
    assert(!deadline.check(), "closed");
    deadline.dispose();
  });

  test("backup lifecycle: disposed view ignores retained stage button", async () => {
    const f = fixture();
    await f.unlock();
    const button = f.q("stage");
    f.dispose();
    button.click();
    assert(!f.host.isConnected, "host removed");
    assert(f.writes.length === 0, "no late write");
  });
}
