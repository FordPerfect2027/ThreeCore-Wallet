import test from "node:test";
import assert from "node:assert/strict";
import { createSecurityLock, LOCK_IDLE_CHOICES } from "../src/security-lock.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { A, SITE, fakeClock, providerFixture, deferred } from "./helpers/security-fixtures.js";

function fixture(options = {}) {
  const clock = fakeClock(), states = [], stops = [];
  const lock = createSecurityLock({ ...clock.options, onLock: state => stops.push(state),
    onChange: state => states.push(state), ...options });
  return { clock, lock, states, stops, close: () => lock.dispose() };
}

test("a fresh gate allows only a subsequent explicit connection", () => {
  const f = fixture();
  assert.equal(f.lock.check(), true);
  assert.equal(f.lock.state().canSign, false);
  assert.equal(f.lock.state().canSendTransactions, false);
  assert.equal(f.stops.length, 0);
  assert.equal(f.states.length, 0);
  assert.equal(f.clock.timers().length, 1);
  f.close();
});

test("manual lock closes before cleanup callbacks run", () => {
  const observed = [];
  const clock = fakeClock();
  const lock = createSecurityLock({ ...clock.options, onLock: () => observed.push(lock.check()) });
  assert.equal(lock.lock(), true);
  assert.deepEqual(observed, [false]);
  assert.equal(lock.state().reason, "manual");
  assert.equal(lock.state().canRead, false);
  assert.equal(clock.timers().length, 0);
  lock.dispose();
});

test("repeated lock is idempotent and does not repeat cleanup", () => {
  const f = fixture();
  f.lock.lock(); const version = f.lock.state().version;
  assert.equal(f.lock.lock("hidden"), false);
  assert.equal(f.lock.state().version, version);
  assert.equal(f.stops.length, 1);
  assert.equal(f.lock.state().reason, "manual");
  f.close();
});

test("unlock changes the generation but never reconnects a session", () => {
  const f = fixture(); const old = f.lock.ticket();
  f.lock.lock(); assert.equal(f.lock.unlock(), true);
  assert.equal(f.lock.check(), true);
  assert.equal(f.lock.valid(old), false);
  assert.equal(f.stops.length, 1);
  assert.equal(f.lock.unlock(), false);
  f.close();
});

for (const idleMs of LOCK_IDLE_CHOICES) {
  test("idle boundary is exact for " + idleMs + " milliseconds", () => {
    const f = fixture({ idleMs });
    f.clock.advance(idleMs - 1); assert.equal(f.lock.check(), true);
    f.clock.advance(1); assert.equal(f.lock.check(), false);
    assert.equal(f.lock.state().reason, "idle");
    assert.equal(f.stops.length, 1);
    f.close();
  });
}

test("an action after OS sleep cannot keep an expired connection alive", () => {
  const f = fixture();
  f.clock.advance(900_000, false);
  assert.equal(f.lock.activity(), false);
  assert.equal(f.lock.state().reason, "idle");
  f.close();
});

test("valid activity restarts the timer and invalidates obsolete timer callbacks", () => {
  const f = fixture(); const oldTimer = f.clock.timers()[0];
  f.clock.advance(200_000, false); assert.equal(f.lock.activity(), true);
  f.clock.advance(100_000, false); f.clock.invokeOld(oldTimer);
  assert.equal(f.lock.check(), true);
  f.clock.advance(200_000); assert.equal(f.lock.state().reason, "idle");
  f.close();
});

test("early timer firing reschedules the remaining deadline", () => {
  const f = fixture();
  const timer = f.clock.timers()[0]; f.clock.advance(10, false); f.clock.invokeOld(timer);
  assert.equal(f.lock.check(), true);
  f.clock.advance(299_990); assert.equal(f.lock.check(), false);
  f.close();
});

test("configuration change does not count as user activity or unlock", () => {
  const f = fixture();
  f.clock.advance(120_000, false);
  assert.equal(f.lock.configure(60_000), true);
  assert.equal(f.lock.state().reason, "idle");
  f.lock.configure(900_000);
  assert.equal(f.lock.check(), false);
  f.close();
});

test("lengthening the timeout cannot rescue an already expired connection", () => {
  const f = fixture({ idleMs: 60_000 });
  f.clock.advance(70_000, false); f.lock.configure(900_000);
  assert.equal(f.lock.check(), false);
  f.close();
});

for (const invalid of [0, -1, Infinity, NaN, "60000", 30_000]) {
  test("invalid idle policy cannot turn off protection: " + invalid, () => {
    const f = fixture();
    assert.equal(f.lock.configure(invalid), false);
    assert.equal(f.lock.state().idleMs, 300_000);
    f.close();
  });
}

for (const broken of [-1, NaN, Infinity]) {
  test("clock anomalies fail closed: " + broken, () => {
    const f = fixture();
    f.clock.set(broken); assert.equal(f.lock.check(), false);
    assert.equal(f.lock.state().reason, "clock");
    assert.equal(f.lock.unlock(), false);
    f.close();
  });
}

test("clock regression after activity fails closed", () => {
  const f = fixture(); f.clock.advance(100); f.lock.activity(); f.clock.set(50);
  assert.equal(f.lock.check(), false);
  assert.equal(f.lock.state().reason, "clock");
  f.close();
});

test("a throwing clock fails closed after construction", () => {
  const clock = fakeClock(); let throwNow = false;
  const lock = createSecurityLock({ ...clock.options, now() {
    if (throwNow) throw Error(); return 0;
  } });
  throwNow = true; assert.equal(lock.check(), false);
  assert.equal(lock.state().reason, "clock"); lock.dispose();
});

test("cleanup and observer exceptions cannot reopen the read gate", () => {
  const f = fixture({ onLock() { throw Error(); }, onChange() { throw Error(); } });
  assert.equal(f.lock.lock(), true);
  assert.equal(f.lock.check(), false);
  f.close();
});

test("disposal locks once and prevents all later reuse", () => {
  const f = fixture(); const oldTimer = f.clock.timers()[0];
  f.lock.dispose(); const version = f.lock.state().version;
  f.lock.dispose(); f.clock.invokeOld(oldTimer);
  assert.equal(f.lock.unlock(), false);
  assert.equal(f.lock.activity(), false);
  assert.equal(f.lock.configure(60_000), false);
  assert.equal(f.lock.check(), false);
  assert.equal(f.lock.ticket(), null);
  assert.equal(f.lock.state().version, version);
  assert.equal(f.stops.length, 1);
  assert.equal(f.clock.timers().length, 0);
});

test("stale tickets stay invalid through multiple lock and unlock cycles", () => {
  const f = fixture();
  const tickets = [f.lock.ticket()];
  for (let i = 0; i < 10; i++) {
    f.lock.lock(); f.lock.unlock();
    assert.ok(tickets.every(ticket => !f.lock.valid(ticket)));
    tickets.push(f.lock.ticket());
    assert.equal(f.lock.valid(tickets.at(-1)), true);
  }
  assert.equal(f.lock.valid(null), false);
  assert.equal(f.lock.valid("10"), false);
  f.close();
});

test("locked session cannot trigger even a chain read or account prompt", async () => {
  const f = fixture(); f.lock.lock();
  const wallet = providerFixture(undefined, { isAccessAllowed: f.lock.check });
  await assert.rejects(wallet.wallet.connect(), { code: "ACCESS_LOCKED" });
  assert.equal(wallet.calls.length, 0);
  f.close();
});

test("unlock requires explicit connection; read methods do not reconnect", async () => {
  const f = fixture(); const wallet = providerFixture(undefined, { isAccessAllowed: f.lock.check });
  await wallet.wallet.connect(); f.lock.lock();
  await assert.rejects(wallet.wallet.getNativeBalance(), { code: "ACCESS_LOCKED" });
  f.lock.unlock(); const start = wallet.calls.length;
  await assert.rejects(wallet.wallet.getNativeBalance(), { code: "NOT_CONNECTED" });
  assert.equal(wallet.calls.length, start);
  await wallet.wallet.connect(); assert.equal(await wallet.wallet.getNativeBalance(), 1n);
  wallet.wallet.disconnect(); f.close();
});

test("guard failure itself refuses access", async () => {
  const f = providerFixture(undefined, { isAccessAllowed() { throw Error("guard failure"); } });
  await assert.rejects(f.wallet.connect(), { code: "ACCESS_LOCKED" });
  assert.equal(f.calls.length, 0);
});

test("a lock closes all three independent token sessions", async () => {
  const sessions = [];
  const f = fixture({ onLock() { for (const session of sessions) session.disconnect(); } });
  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    const item = providerFixture(undefined, { agent, isAccessAllowed: f.lock.check });
    sessions.push(item.wallet); await item.wallet.connect();
  }
  f.lock.lock();
  assert.ok(sessions.every(session => !session.state.connected));
  f.lock.unlock();
  assert.ok(sessions.every(session => !session.state.connected));
  f.close();
});

test("pending permission cannot be revived by locking then resuming", async () => {
  const gate = deferred(); const f = fixture();
  const wallet = providerFixture(({ method }) => method === "eth_requestAccounts" ? gate.promise : undefined,
    { isAccessAllowed: f.lock.check });
  const pending = wallet.wallet.connect();
  while (!wallet.calls.some(row => row.method === "eth_requestAccounts")) await new Promise(r => setTimeout(r, 0));
  f.lock.lock(); wallet.wallet.disconnect(); f.lock.unlock();
  await assert.rejects(pending, { code: "SESSION_CANCELLED" });
  await assert.rejects(wallet.wallet.connect(), { code: "PERMISSION_PENDING" });
  gate.resolve([A]); await new Promise(r => setTimeout(r, 0));
  assert.equal(wallet.wallet.state.connected, false);
  await wallet.wallet.connect(); wallet.wallet.disconnect(); f.close();
});

test("pending read cannot publish after a manual lock", async () => {
  const gate = deferred(); let wallet;
  const f = fixture({ onLock() { wallet?.disconnect(); } });
  const item = providerFixture(({ method }) => method === "eth_getBalance" ? gate.promise : undefined,
    { isAccessAllowed: f.lock.check }); wallet = item.wallet;
  await wallet.connect(); const read = wallet.getNativeBalance();
  while (!item.calls.some(row => row.method === "eth_getBalance")) await new Promise(r => setTimeout(r, 0));
  f.lock.lock(); await assert.rejects(read, { code: "ACCESS_LOCKED" });
  gate.resolve("0x99"); f.lock.unlock();
  assert.equal(wallet.state.connected, false); f.close();
});

test("controller enforces access lock even for an injected test session", async () => {
  let calls = 0;
  const controller = createWalletCardController({ agent: "DAT", siteOrigin: SITE,
    isAccessAllowed: () => false, createSession() { calls++; throw Error(); } });
  assert.equal(await controller.connect({ provider: {}, account: A, chainId: 84532 }), false);
  assert.equal(await controller.readBalances(), false);
  assert.equal(calls, 0);
  assert.match(controller.state.error, /停止/);
  controller.dispose();
});
