import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createWalletCardController } from "../src/wallet-card-controller.js";

const sessionUrl = new URL("../src/wallet-session.js", import.meta.url).href;
const eventsUrl = new URL("../src/provider-events.js", import.meta.url).href;
const cardUrl = new URL("../src/wallet-card-controller.js", import.meta.url).href;
const scopeUrl = new URL("../src/wallet-read-scope.js", import.meta.url).href;
const fixturesUrl = new URL("./helpers/security-fixtures.js", import.meta.url).href;

// A dropped rejection must fail the child, without contaminating node:test's
// own process or turning an unhandled-rejection listener into a passing result.
function contained(script) {
  const child = spawnSync(process.execPath,
    ["--unhandled-rejections=strict", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      ${script}
      await new Promise(resolve => setImmediate(resolve));
      console.log('contained');
    `], { encoding: "utf8", timeout: 10000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), "contained");
}

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const kind of ["promise", "async-then"]) {
    test(`${agent}: rejected ${kind} access guard is contained and cannot authorize a wallet request`, () => {
      contained(`
        import { ThreeCoreWalletSession } from ${JSON.stringify(sessionUrl)};
        import { providerFixture, A, SITE, HASH } from ${JSON.stringify(fixturesUrl)};
        const f = providerFixture();
        let deny = true, observed = 0;
        const denied = () => ${kind === "promise"
          ? "Promise.reject(Error('synthetic access failure'))"
          : "({ async then() { observed++; throw Error('synthetic access failure'); } })"};
        const wallet = new ThreeCoreWalletSession({ provider: f.provider,
          agent: ${JSON.stringify(agent)}, expectedAccount: A, chainId: 84532,
          siteOrigin: SITE, approvedOrigins: [SITE], isAccessAllowed: () => deny ? denied() : true });
        await assert.rejects(wallet.connect(), { code: 'ACCESS_LOCKED' });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.calls.length, 0);
        assert.equal(wallet.state.connected, false);
        assert.equal(wallet.state.account, null);
        ${kind === "async-then" ? "assert.equal(observed, 1);" : ""}
        deny = false;
        await wallet.connect();
        const before = f.calls.length;
        deny = true;
        await assert.rejects(wallet.getNativeBalance(HASH), { code: 'ACCESS_LOCKED' });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.calls.length, before, 'Revocation must stop before another RPC');
        assert.equal(wallet.state.connected, false);
        assert([...f.listeners.values()].every(set => set.size === 0));
        ${kind === "async-then" ? "assert.equal(observed, 2);" : ""}
        deny = false;
        assert.equal(wallet.state.connected, false, 'Guard recovery is not implicit reconnection');
        await wallet.connect();
        assert.equal(wallet.state.connected, true, 'A later explicit retry remains possible');
        wallet.disconnect();
      `);
    });
  }
}

for (const phase of ["registration", "removal"]) {
  test(`malformed async listener ${phase} is contained and leaves retained callbacks inert`, () => {
    contained(`
      import { observeWalletProvider } from ${JSON.stringify(eventsUrl)};
      const active = new Map(), registered = [], removed = [];
      let deliveries = 0, rpc = 0, observed = 0;
      const malformed = () => ({ async then() {
        observed++; throw Error('synthetic listener failure');
      } });
      const provider = {
        request() { rpc++; throw Error('Unexpected request'); },
        on(name, fn) {
          active.set(name, fn); registered.push([name, fn]);
          return ${JSON.stringify(phase)} === 'registration' && name === 'chainChanged' ? malformed() : this;
        },
        removeListener(name, fn) {
          active.delete(name); removed.push([name, fn]);
          return ${JSON.stringify(phase)} === 'removal' ? malformed() : this;
        },
      };
      const handlers = { accountsChanged() { deliveries++; },
        chainChanged() { deliveries++; }, disconnect() { deliveries++; } };
      if (${JSON.stringify(phase)} === 'registration') {
        assert.throws(() => observeWalletProvider(provider, handlers), { code: 'PROVIDER_EVENT_FAILURE' });
      } else {
        const observer = observeWalletProvider(provider, handlers);
        observer.dispose(); observer.dispose();
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(active.size, 0);
      assert.equal(removed.length, registered.length);
      assert.equal(observed, ${phase === "registration" ? 1 : 3});
      for (const [, fn] of registered) fn(['0x' + '11'.repeat(20)]);
      assert.equal(deliveries, 0);
      assert.equal(rpc, 0);
    `);
  });
}

for (const callback of ["onChange", "isAccessAllowed", "disconnect"]) {
  test(`malformed async card ${callback} result is contained without restoring access`, () => {
    contained(`
      import { createWalletCardController } from ${JSON.stringify(cardUrl)};
      import { providerFixture, A, SITE } from ${JSON.stringify(fixturesUrl)};
      const f = providerFixture();
      let observed = 0;
      const malformed = () => ({ async then() {
        observed++; throw Error('synthetic card callback failure');
      } });
      const options = { agent: 'EMA', siteOrigin: SITE };
      if (${JSON.stringify(callback)} === 'disconnect') {
        options.createSession = () => ({
          state: { connected: true, account: A, chainId: 84532 },
          connect() { return Promise.resolve(); },
          disconnect: malformed,
        });
      } else options[${JSON.stringify(callback)}] = malformed;
      const card = createWalletCardController(options);
      if (${JSON.stringify(callback)} === 'isAccessAllowed') {
        assert.equal(await card.connect({ provider: f.provider, account: A, chainId: 84532 }), false);
      } else if (${JSON.stringify(callback)} === 'disconnect') {
        assert.equal(await card.connect({ provider: f.provider, account: A, chainId: 84532 }), true);
        assert.equal(card.disconnect(), false, 'An asynchronous cleanup is not a success receipt');
      } else card.disconnect();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(observed, 1);
      assert.equal(card.state.phase, 'disconnected');
      assert.equal(card.state.connection, null);
      assert.equal(card.state.result, null);
      assert.equal(f.calls.length, 0);
      card.dispose();
    `);
  });
}

test("card thenable notification retains its synchronous reentry boundary", async () => {
  let card, observed = 0;
  const attempts = [];
  card = createWalletCardController({ agent: "CAWELON", siteOrigin: "https://dex.example",
    onChange() {
      return { then(resolve) {
        observed++;
        attempts.push(card.connect({}), card.readBalances());
        resolve();
      } };
    },
  });
  try {
    card.disconnect();
    assert.equal(observed, 1, "The transition boundary must still own the callback invocation");
    assert.deepEqual(await Promise.all(attempts), [false, false]);
    assert.equal(card.state.phase, "disconnected");
  } finally { card.dispose(); }
});

for (const callback of ["isCurrent", "onSettled"]) {
  test(`malformed async read-scope ${callback} result is contained without starting extra work`, () => {
    contained(`
      import { createWalletReadScope } from ${JSON.stringify(scopeUrl)};
      let observed = 0, operations = 0;
      const malformed = () => ({ async then() {
        observed++; throw Error('synthetic read-scope failure');
      } });
      const scope = createWalletReadScope({ isCurrent: () => true,
        [${JSON.stringify(callback)}]: malformed });
      const reading = scope.invoke(() => { operations++; return Promise.resolve(42); });
      if (${JSON.stringify(callback)} === 'isCurrent') {
        await assert.rejects(reading, { code: 'STALE_VIEW' });
        assert.equal(scope.state().closed, true);
      } else {
        assert.equal(await reading, 42, 'Advisory cleanup does not become authority');
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(observed, 1);
      assert.equal(operations, ${callback === "isCurrent" ? 0 : 1});
      assert.equal(scope.state().pending, 0);
      scope.cancel();
    `);
  });
}
