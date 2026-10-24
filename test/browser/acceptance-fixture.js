import { mountWalletDemo } from '/examples/wallet-demo.js';
import { ThreeCoreWalletSession } from '/src/wallet-session.js';
import { createRpcSupervisor } from '/src/rpc-supervisor.js';
import { createCheckpointStorage } from '/src/checkpoint-storage.js';

// This module is served ONLY with --ui-test. No extension or external RPC is used.
export const AGENTS = ['DAT', 'EMA', 'CAWELON'];
export const ACCOUNTS = ['11', '22', '33'].map(part => '0x' + part.repeat(20));
export const TOKENS = ['44', '55', '66'].map(part => '0x' + part.repeat(20));
export const UUIDS = [1, 2, 3].map(n => '11111111-2222-4333-8444-' + String(n).padStart(12, '0'));
export const DB_PREFIX = 'threecore-test-acceptance-';
const HASH = '0x' + 'ab'.repeat(32);
export const assert = (ok, message) => { if (!ok) throw Error(message); };
export async function until(predicate, message = 'Acceptance UI did not settle') {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 6000) throw Error(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
export function input(node, value, event = 'input') {
  node.value = value;
  node.dispatchEvent(new Event(event, { bubbles: true }));
}
export function checked(node, value = true) {
  node.checked = value;
  node.dispatchEvent(new Event('change', { bubbles: true }));
}
export function makeAcceptanceFixture(name) {
  assert(new RegExp('^' + DB_PREFIX + '[a-f0-9-]{36}$').test(name), 'Use an isolated test database');
  const eventTarget = new EventTarget();
  const supervisor = createRpcSupervisor();
  const storage = createCheckpointStorage({ indexedDB, name });
  const calls = [], pending = [];
  const conditions = AGENTS.map(() => ({ chain: '0x14a34', delay: false, reject: false }));
  const providers = AGENTS.map((agent, index) => {
    const listeners = new Map();
    return {
      on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeListener(name, fn) { listeners.get(name)?.delete(fn); },
      emit(name, value) { for (const fn of [...listeners.get(name) ?? []]) fn(value); },
      async request(request) {
        calls.push({ agent, method: request.method });
        switch (request.method) {
          case 'eth_requestAccounts': case 'eth_accounts': return [ACCOUNTS[index]];
          case 'eth_chainId': return conditions[index].chain;
          case 'eth_getBlockByNumber':
            if (conditions[index].delay) await new Promise((resolve, reject) => pending.push({ index, resolve, reject }));
            if (conditions[index].reject) throw Object.assign(Error('Synthetic network unavailable'), { code: -32000 });
            return { number: '0x2a', hash: HASH };
          case 'eth_getCode': return request.params[0].toLowerCase() === TOKENS[index] ? '0x6000' : '0x';
          case 'eth_getBalance': return '0x' + (BigInt(index + 1) * 10n ** 18n).toString(16);
          case 'eth_call':
            assert(request.params[0].to.toLowerCase() === TOKENS[index], 'Read crossed token boundary');
            assert(/^0x70a08231[0-9a-f]{64}$/.test(request.params[0].data), 'Only balanceOf is supported here');
            return '0x' + (BigInt(index + 100) * 10n ** 18n).toString(16).padStart(64, '0');
          default: throw Error('Forbidden test provider method: ' + request.method);
        }
      },
    };
  });
  function announce() {
    providers.forEach((provider, index) => eventTarget.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { provider, info: { uuid: UUIDS[index], name: 'Test ' + AGENTS[index], rdns: 'test.threecore' } },
    })));
  }
  eventTarget.addEventListener('eip6963:requestProvider', announce);
  const app = mountWalletDemo({ document, eventTarget, siteOrigin: location.origin,
    getLegacyProvider: () => undefined, checkpointStorage: storage, rpcSupervisor: supervisor,
    createSession: options => new ThreeCoreWalletSession({ ...options,
      readTimeoutMs: 1200, connectTimeoutMs: 1200, permissionTimeoutMs: 1200 }),
  });
  const q = selector => document.querySelector(selector);
  const card = (index, selector) => q('[data-agent="' + AGENTS[index] + '"] ' + selector);
  function configure() {
    AGENTS.forEach((agent, index) => {
      input(card(index, '.provider'), UUIDS[index], 'change');
      input(card(index, '.account'), ACCOUNTS[index]);
      input(card(index, '.chain'), '84532', 'change');
      input(card(index, '.token'), TOKENS[index]);
      input(card(index, '.portfolio-tokens'), TOKENS[index]);
    });
  }
  async function connect(index) {
    assert(!card(index, '.connect').disabled, 'Connect must be available');
    card(index, '.connect').click();
    await until(() => !card(index, '.read').disabled, AGENTS[index] + ' did not connect');
  }
  async function observe(index) {
    card(index, '.portfolio-read').click();
    await until(() => card(index, '.portfolio-status').textContent === '確認が完了しました', AGENTS[index] + ' observation unavailable');
    card(index, '.history-add-current').click();
    assert(card(index, '.history-list').children.length === 1, 'One complete history is expected');
    card(index, '.history-export').click();
  }
  async function checkpoint(action) {
    assert(!q('.checkpoint-' + action).disabled, 'Checkpoint action disabled: ' + action);
    q('.checkpoint-' + action).click();
    await until(() => q('.checkpoint-panel').getAttribute('aria-busy') === 'false');
  }
  async function save() {
    await checkpoint('refresh');
    input(q('.checkpoint-name'), '3トークン・通し確認');
    await checkpoint('save');
    assert(q('.checkpoint-count').textContent.includes('保存済み 1'), 'Checkpoint not saved');
  }
  async function stageSaved() {
    await checkpoint('refresh');
    const options = [...q('.checkpoint-select').options].filter(option => option.value);
    assert(options.length === 1, 'Expected exactly one saved checkpoint');
    input(q('.checkpoint-select'), options[0].value, 'change');
    await checkpoint('inspect');
    await checkpoint('stage');
    q('.workspace-preview').click();
  }
  function applySaved() {
    checked(q('.workspace-confirmed'));
    assert(!q('.workspace-apply').disabled, 'Restore must be reviewed');
    q('.workspace-apply').click();
  }
  function release(index) {
    conditions[index].delay = false;
    for (const job of pending.splice(0).filter(job => {
      if (job.index !== index) { pending.push(job); return false; }
      return true;
    })) job.resolve();
  }
  return { q, card, calls, providers, conditions, configure, connect, observe, save,
    checkpoint, stageSaved, applySaved, release,
    dispose() {
      app.dispose(); storage.close(); supervisor.dispose();
      for (const job of pending.splice(0)) job.resolve();
      eventTarget.removeEventListener('eip6963:requestProvider', announce);
    },
  };
}
export async function deleteAcceptanceDatabase(name) {
  assert(new RegExp('^' + DB_PREFIX + '[a-f0-9-]{36}$').test(name), 'Refuse non-test database deletion');
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Test database cleanup is blocked'));
  });
}
