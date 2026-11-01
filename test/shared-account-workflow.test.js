import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWalletSetup, decodeWalletSetup, inspectWalletFields } from '../src/wallet-setup.js';
import { workspaceFromDraft, encodeWorkspace, decodeWorkspace, workspaceToDraft } from '../src/workspace-format.js';
import { summarizeWorkspace, compareWorkspaceContents } from '../src/workspace-overview.js';
import { A, B, setup, raw } from './helpers/setup-fixtures.js';
import { draft, snapshot } from './helpers/workspace-fixtures.js';
import { archive } from './helpers/history-fixtures.js';

for (const accounts of [[A, A, A], [A, B, A]]) {
  test(`shared-account settings round trip without claiming separate wallets: ${new Set(accounts).size} identities`, () => {
    const original = setup(accounts, [84532, 8453, 84532]);
    assert.deepEqual(decodeWalletSetup(encodeWalletSetup(original)), original);
    const inspected = inspectWalletFields(raw(accounts));
    assert.equal(inspected.configured, 3);
    assert.equal(inspected.distinctAccounts, new Set(accounts).size);
    assert.equal(inspected.readyForManualConnection, true);
    assert.equal(inspected.ownershipVerified, false);
  });
  test(`shared-account workspace preserves three agent-specific histories: ${new Set(accounts).size} identities`, () => {
    const current = draft();
    current.forEach((entry, index) => {
      entry.account = accounts[index];
      entry.history = archive([snapshot(index, String(42 + index), { account: accounts[index] })]);
    });
    const saved = decodeWorkspace(encodeWorkspace(workspaceFromDraft(current)));
    const restored = workspaceToDraft(saved);
    assert.deepEqual(restored, current);
    assert.equal(compareWorkspaceContents(saved, restored).sameContents, true);
    const summary = summarizeWorkspace(restored);
    assert.equal(summary.configured, 3);
    assert.equal(summary.distinctAccounts, new Set(accounts).size);
    assert.equal(summary.totalObservations, 3);
    assert.equal(summary.connectionVerified, false);
    summary.cards.forEach((card, index) => {
      assert.equal(card.historyCount, 1);
      assert.equal(card.groups[0].account, accounts[index]);
      assert.equal(card.groups[0].earliestBlock, String(42 + index));
      assert.equal(card.groups[0].holdings[0].address, current[index].tokenAddress);
    });
  });
}
