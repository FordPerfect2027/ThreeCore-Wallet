import test from 'node:test';
import assert from 'node:assert/strict';
import { startPermittedAccountRead } from '../src/wallet-session.js';
import { createRpcSupervisor } from '../src/rpc-supervisor.js';
import { mountPermittedAccountPanel } from '../examples/wallet-setup-panel.js';
import { Element } from './helpers/panel-dom.js';
import { A, B, SITE, fakeClock } from './helpers/security-fixtures.js';
import { deferred } from './helpers/rpc-supervisor-fixtures.js';
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(override = () => undefined) {
  const clock = fakeClock(), supervisor = createRpcSupervisor(clock.options), calls = [], listeners = new Map();
  const provider = {
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name, value) { for (const fn of [...listeners.get(name) ?? []]) fn(value); },
    request(args) {
      calls.push(args.method);
      const result = override(args);
      if (result !== undefined) return result;
      if (args.method === 'eth_chainId') return '0x2105';
      if (args.method === 'eth_accounts') return [A];
      throw Error('Unexpected capability');
    },
  };
  return { provider, supervisor, calls, clock, listeners,
    read: (options = {}) => startPermittedAccountRead({ provider, supervisor, siteOrigin: SITE, isCurrent: () => true, ...options }),
    close: () => supervisor.dispose() };
}

test('permitted account: reads stable existing permission without a permission prompt or balance query', async t => {
  const f = fixture(); t.after(f.close);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(await f.read().promise, { account: A, chainId: 8453, permittedAccountCount: 1 });
  assert.deepEqual(f.calls, ['eth_chainId', 'eth_accounts', 'eth_chainId', 'eth_accounts']);
  assert.equal([...f.listeners.values()].every(set => set.size === 0), true);
});

test('permitted account: no permission remains empty instead of opening a permission request', async t => {
  const f = fixture(({method}) => method === 'eth_accounts' ? [] : undefined); t.after(f.close);
  await assert.rejects(f.read().promise, { code: 'NO_ACCOUNTS' });
  assert.deepEqual(f.calls, ['eth_chainId', 'eth_accounts']);
});

test('permitted account: a silent account replacement between reads is rejected', async t => {
  let n = 0;
  const f = fixture(({method}) => method === 'eth_accounts' ? [++n === 1 ? A : B] : undefined); t.after(f.close);
  await assert.rejects(f.read().promise, { code: 'SESSION_CHANGED' });
});

test('permitted account: a silent network replacement between reads is rejected', async t => {
  let n = 0;
  const f = fixture(({method}) => method === 'eth_chainId' ? (++n === 1 ? '0x2105' : '0x14a34') : undefined); t.after(f.close);
  await assert.rejects(f.read().promise, { code: 'SESSION_CHANGED' });
});

test('permitted account: unsupported network is rejected before reading an account', async t => {
  const f = fixture(({method}) => method === 'eth_chainId' ? '0x1' : undefined); t.after(f.close);
  await assert.rejects(f.read().promise, { code: 'UNSUPPORTED_CHAIN' });
  assert.deepEqual(f.calls, ['eth_chainId']);
});

test('permitted account: provider account getters are rejected without invocation', async t => {
  let reads = 0;
  const accounts = new Array(1); Object.defineProperty(accounts, '0', { get() { reads++; return A; } });
  const f = fixture(({method}) => method === 'eth_accounts' ? accounts : undefined); t.after(f.close);
  await assert.rejects(f.read().promise);
  assert.equal(reads, 0);
});

test('permitted account: a stopped access gate makes no provider requests', async t => {
  const f = fixture(); t.after(f.close);
  await assert.rejects(f.read({ isCurrent: () => false }).promise, { code: 'ACCESS_LOCKED' });
  assert.deepEqual(f.calls, []);
});

test('permitted account: cancel keeps outstanding capacity charged and ignores a late result', async t => {
  const pending = deferred();
  const f = fixture(({method}) => method === 'eth_accounts' ? pending.promise : undefined); t.after(f.close);
  const op = f.read(); const rejected = assert.rejects(op.promise, { code: 'SESSION_CHANGED' });
  await tick(); op.cancel(); await rejected;
  assert.equal(f.supervisor.state().pending, 1);
  assert.equal(f.supervisor.state().abandoned, 1);
  pending.resolve([A]); await tick();
  assert.deepEqual(f.calls, ['eth_chainId', 'eth_accounts']);
  assert.equal(f.supervisor.state().pending, 0);
});

test('permitted account: a provider event terminates a pending read', async t => {
  const pending = deferred();
  const f = fixture(({method}) => method === 'eth_accounts' ? pending.promise : undefined); t.after(f.close);
  const op = f.read(); const rejected = assert.rejects(op.promise, { code: 'SESSION_CHANGED' });
  await tick(); f.provider.emit('accountsChanged', [B]); await rejected;
  pending.resolve([A]); await tick();
  assert.deepEqual(f.calls, ['eth_chainId', 'eth_accounts']);
});

test('permitted account: deadline ends waiting without starting further reads', async t => {
  const pending = deferred();
  const f = fixture(({method}) => method === 'eth_accounts' ? pending.promise : undefined); t.after(f.close);
  const op = f.read({ timeoutMs: 20 }); const rejected = assert.rejects(op.promise, { code: 'READ_TIMEOUT' });
  await tick(); f.clock.advance(20); await rejected;
  pending.resolve([A]); await tick();
  assert.deepEqual(f.calls, ['eth_chainId', 'eth_accounts']);
});

function panelFixture(t, override) {
  const f = fixture(override), parent = new Element('div'), applied = [];
  const context = { provider: f.provider, account: B, chainId: 8453 };
  let allowed = true;
  const panel = mountPermittedAccountPanel({ document: { createElement: tag => new Element(tag) }, parent,
    siteOrigin: SITE, supervisor: f.supervisor, canRead: () => allowed, readContext: () => ({ ...context }),
    applyAccount(result, check) { check(); applied.push(result); context.account = result.account; } });
  t.after(() => { panel.dispose(); f.close(); });
  return { ...f, panel, context, applied, q: name => parent.find('account-probe-' + name),
    stop() { allowed = false; panel.invalidate(); } };
}

test('permitted account panel: preview changes nothing and confirmation rereads before applying', async t => {
  const f = panelFixture(t);
  assert.equal(f.calls.length, 0);
  f.q('read').click(); await tick();
  assert.equal(f.context.account, B); assert.equal(f.applied.length, 0);
  assert.equal(f.q('apply').disabled, false);
  f.q('apply').click(); await tick();
  assert.equal(f.context.account, A); assert.equal(f.applied.length, 1);
  assert.equal(f.calls.length, 8);
  assert.ok(f.calls.every(method => ['eth_accounts','eth_chainId'].includes(method)));
});

test('permitted account panel: a wallet change after preview cannot replace the configured account', async t => {
  let address = A;
  const f = panelFixture(t, ({method}) => method === 'eth_accounts' ? [address] : undefined);
  f.q('read').click(); await tick(); address = B;
  f.q('apply').click(); await tick();
  assert.equal(f.applied.length, 0); assert.equal(f.context.account, B);
  assert.match(f.q('status').textContent, /対象が変わりました/);
});

test('permitted account panel: an unnotified form edit invalidates confirmation', async t => {
  const f = panelFixture(t);
  f.q('read').click(); await tick(); f.context.account = '';
  const before = f.calls.length;
  f.q('apply').click(); await tick();
  assert.equal(f.calls.length, before); assert.equal(f.applied.length, 0);
});

test('permitted account panel: chain mismatch cannot be applied', async t => {
  const f = panelFixture(t); f.context.chainId = 84532;
  f.q('read').click(); await tick();
  assert.equal(f.q('apply').disabled, true); assert.equal(f.applied.length, 0);
});

test('permitted account panel: protection stop discards the pending preview and late response', async t => {
  const pending = deferred();
  const f = panelFixture(t, ({method}) => method === 'eth_accounts' ? pending.promise : undefined);
  f.q('read').click(); await tick(); f.stop(); pending.resolve([A]); await tick();
  assert.equal(f.q('details').textContent, ''); assert.equal(f.q('apply').disabled, true);
  assert.equal(f.applied.length, 0);
});

test('permitted account panel: provider diagnostics never become displayed text', async t => {
  const f = panelFixture(t, () => { throw Error('private diagnostic payload'); });
  f.q('read').click(); await tick();
  assert.doesNotMatch(f.q('status').textContent, /private diagnostic payload/);
  assert.equal(f.applied.length, 0);
});
