import { makeAcceptanceFixture, deleteAcceptanceDatabase, DB_PREFIX, AGENTS, ACCOUNTS,
  TOKENS, UUIDS, assert, until, input } from '/test/browser/acceptance-fixture.js';

async function isolated(run, options) {
  const name = DB_PREFIX + crypto.randomUUID();
  let current;
  function open() { current?.dispose(); current = makeAcceptanceFixture(name, options); return current; }
  try { await run(open); }
  finally { current?.dispose(); await deleteAcceptanceDatabase(name); }
}
const permissions = f => f.calls.filter(call => call.method === 'eth_requestAccounts').length;
async function complete(f) {
  f.configure();
  for (let index = 0; index < 3; index++) { await f.connect(index); await f.observe(index); }
}
function expectHistory(f) {
  AGENTS.forEach((agent, index) => {
    assert(f.card(index, '.account').value === f.accounts[index], agent + ' restored account mismatch');
    assert(f.card(index, '.token').value === TOKENS[index], agent + ' restored token mismatch');
    assert(f.card(index, '.chain').value === '84532', agent + ' restored network mismatch');
    assert(f.card(index, '.history-list').children.length === 1, agent + ' history was lost or duplicated');
  });
}
export function registerAcceptanceUITests(test) {
  test('acceptance: one shared wallet saves and restores three separate token histories without restoring permission', async () => {
    await isolated(async open => {
      let f = open(); await complete(f); expectHistory(f);
      const histories = AGENTS.map((_, index) => f.card(index, '.history-json').value);
      histories.forEach((text, index) => {
        const snapshot = JSON.parse(text).reports[0].snapshot;
        assert(snapshot.agent === AGENTS[index] && snapshot.account === ACCOUNTS[0], 'Wrong agent/account');
        assert(snapshot.holdings[0].address === TOKENS[index], 'Token records mixed');
        assert(snapshot.holdings[0].balanceBaseUnits === String(BigInt(index + 100) * 10n ** 18n), 'Wrong per-token balance');
      });
      await f.save();
      f = open(); assert(f.calls.length === 0, 'Reopen contacted wallet');
      await f.stageSaved(); assert(f.calls.length === 0, 'Preview contacted wallet');
      f.applySaved(); expectHistory(f);
      AGENTS.forEach((_, index) => assert(f.card(index, '.read').disabled, 'Restore granted permission'));
      assert(f.calls.length === 0, 'Restore contacted wallet');
      for (let index = 0; index < 3; index++) {
        f.card(index, '.history-export').click();
        assert(f.card(index, '.history-json').value === histories[index], 'History changed across restore');
        input(f.card(index, '.provider'), UUIDS[0], 'change');
        await f.connect(index); await f.observe(index);
      }
      expectHistory(f); assert(permissions(f) === 3, 'Missing explicit reconnections');
    }, { sharedProvider: true, accounts: [ACCOUNTS[0], ACCOUNTS[0], ACCOUNTS[0]] });
  });
  test('acceptance: a shared provider account change invalidates every card and discards a delayed read', async () => {
    await isolated(async open => {
      const f = open(); await complete(f);
      const before = f.calls.length;
      f.conditions[0].delay = true;
      f.card(0, '.portfolio-read').click();
      await until(() => f.calls.slice(before).some(call => call.method === 'eth_getBlockByNumber'));
      f.conditions[0].account = ACCOUNTS[1];
      f.providers[0].emit('accountsChanged', [ACCOUNTS[1]]);
      AGENTS.forEach((_, index) => {
        assert(f.card(index, '.read').disabled, 'Shared provider change left a card connected');
        assert(f.card(index, '.portfolio-details').textContent === '', 'Old live result remained');
      });
      const stopped = f.calls.length; f.release(0);
      await until(() => !f.card(0, '.portfolio-read').disabled);
      assert(f.calls.length === stopped, 'Late response triggered another read');
      expectHistory(f);
      input(f.card(0, '.account'), ACCOUNTS[1]);
      await f.connect(0);
      assert(!f.card(0, '.read').disabled, 'Explicit second-account connection failed');
      assert(f.card(1, '.read').disabled && f.card(2, '.read').disabled, 'Other cards reconnected implicitly');
      f.conditions[0].chain = '0x2105'; f.providers[0].emit('chainChanged', '0x2105');
      assert(f.card(0, '.read').disabled, 'Network change left second account connected');
      AGENTS.forEach((_, index) => assert(f.card(index, '.history-list').children.length === 1, 'Saved history lost'));
    }, { sharedProvider: true, accounts: [ACCOUNTS[0], ACCOUNTS[0], ACCOUNTS[0]] });
  });
  test('acceptance: three independent providers connect, read, save and restore through the full app', async () => {
    await isolated(async open => {
      let f = open();
      assert(f.calls.length === 0, 'Mount or discovery requested accounts');
      await complete(f);
      expectHistory(f);
      assert(permissions(f) === 3, 'Expected one explicit permission request per wallet');
      await f.save();
      const histories = AGENTS.map((_, index) => f.card(index, '.history-list').textContent);
      f = open(); // New app, sessions, storage adapter and provider objects.
      assert(f.calls.length === 0, 'Reopening auto-connected');
      assert(f.card(0, '.account').value === '', 'Reopening silently applied settings');
      await f.stageSaved();
      assert(f.calls.length === 0, 'Loading or reviewing a checkpoint contacted a wallet');
      assert(f.card(0, '.account').value === '', 'Preview applied before confirmation');
      f.applySaved();
      expectHistory(f);
      AGENTS.forEach((_, index) => {
        assert(f.card(index, '.read').disabled, 'Restore reconnected a wallet');
        assert(f.card(index, '.history-list').textContent === histories[index], 'Observation content changed');
      });
      assert(f.calls.length === 0, 'Restore requested wallet access');
      // Provider identities are deliberately selected afresh; stored files carry no permission.
      for (let index = 0; index < 3; index++) {
        input(f.card(index, '.provider'), UUIDS[index], 'change');
        await f.connect(index); await f.observe(index);
      }
      expectHistory(f); // Same block/observation deduplicates.
      assert(permissions(f) === 3, 'Explicit reconnection not performed for each wallet');
    });
  });
  test('acceptance: a failed read preserves histories and requires a fresh successful observation', async () => {
    await isolated(async open => {
      const f = open(); await complete(f);
      f.conditions[0].reject = true;
      f.card(0, '.portfolio-read').click();
      await until(() => !f.card(0, '.portfolio-read').disabled);
      assert(f.card(0, '.portfolio-export').disabled, 'Failed read became exportable');
      f.card(0, '.history-add-current').click();
      expectHistory(f);
      f.conditions[0].reject = false;
      await f.observe(0);
      assert(permissions(f) === 3, 'Read recovery unexpectedly requested permission');
    });
  });
  for (let index = 0; index < 3; index++) {
    test(`acceptance: ${AGENTS[index]} account change clears only its live results and preserves saved history`, async () => {
      await isolated(async open => {
        const f = open(); await complete(f);
        f.providers[index].emit('accountsChanged', ['0x' + '99'.repeat(20)]);
        assert(f.card(index, '.read').disabled, 'Changed wallet remained usable');
        assert(f.card(index, '.portfolio-details').textContent === '', 'Old live observation remained visible');
        expectHistory(f);
        for (let other = 0; other < 3; other++) if (other !== index) {
          assert(!f.card(other, '.read').disabled, 'Unchanged wallet was disconnected');
        }
      });
    });
    test(`acceptance: ${AGENTS[index]} wrong chain cannot connect or save a new observation`, async () => {
      await isolated(async open => {
        const f = open(); f.configure(); f.conditions[index].chain = '0x2105';
        f.card(index, '.connect').click();
        await until(() => !f.card(index, '.connect').disabled);
        assert(f.card(index, '.read').disabled, 'Wrong-chain wallet connected');
        f.card(index, '.history-add-current').click();
        assert(f.card(index, '.history-list').children.length === 0, 'Wrong-chain result saveable');
        assert(f.calls.every(call => !['eth_call', 'eth_getBalance'].includes(call.method)), 'Read on wrong chain');
      });
    });
    test(`acceptance: ${AGENTS[index]} stop while RPC is delayed never revives results or starts the next subread`, async () => {
      await isolated(async open => {
        const f = open(); await complete(f);
        f.conditions[index].delay = true;
        const callsBefore = f.calls.length;
        f.card(index, '.portfolio-read').click();
        await until(() => f.calls.slice(callsBefore).some(call => call.method === 'eth_getBlockByNumber'));
        f.q('.security-stop').click();
        await until(() => !f.card(index, '.portfolio-read').disabled);
        const callsStopped = f.calls.length;
        f.release(index);
        await new Promise(resolve => setTimeout(resolve, 30));
        assert(f.calls.length === callsStopped, 'Subread continued after stop');
        assert(f.card(index, '.portfolio-details').textContent === '', 'Late result returned');
        expectHistory(f);
        AGENTS.forEach((_, i) => assert(f.card(i, '.read').disabled, 'Global stop missed a wallet'));
        f.q('.security-resume').click();
        assert(f.calls.length === callsStopped, 'Resume auto-connected');
      });
    });
  }
}
