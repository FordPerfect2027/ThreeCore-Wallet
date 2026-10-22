import test from "node:test";
import assert from "node:assert/strict";
import { reviewWorkspaceChanges, describeWorkspaceChanges } from "../src/workspace-review.js";
import { previewWorkspace } from "../src/workspace-format.js";
import { describeWorkspacePreview, describeWorkspaceUndo } from "../src/workspace-overview.js";
import { draft, clone, snapshot, text, OPTIONS, CONTRACTS, ACCOUNTS } from "./helpers/workspace-fixtures.js";
import { archive } from "./helpers/history-fixtures.js";

test("detailed workspace review does not invent changes for identical drafts", () => {
  const review = reviewWorkspaceChanges(draft(), draft());
  assert.deepEqual(review.cards.map(card => card.history.unchanged), [1, 1, 1]);
  assert.ok(review.cards.every(card => card.history.added.length === 0 && card.history.removed.length === 0));
  assert.equal(review.authorizesConnection, false);
  assert.equal(review.authorizesTransaction, false);
});

test("detailed review includes exact contract addresses before and after", () => {
  const before = draft();
  const after = clone(before);
  after[0].tokenAddress = CONTRACTS[1];
  after[0].tokens = CONTRACTS.slice(1).join("\n");
  const card = reviewWorkspaceChanges(before, after).cards[0];
  assert.equal(card.singleTokenBefore, CONTRACTS[0]);
  assert.equal(card.singleTokenAfter, CONTRACTS[1]);
  assert.deepEqual(card.tokensAdded, CONTRACTS.slice(1));
  assert.deepEqual(card.tokensRemoved, [CONTRACTS[0]]);
  const description = describeWorkspaceChanges(before, after);
  for (const address of CONTRACTS) assert.ok(description.includes(address));
});

test("contract case and whitespace do not imply a different token", () => {
  const before = draft();
  const after = clone(before);
  const address = "0x" + "ab".repeat(20);
  before[0].tokens = address;
  after[0].tokens = "  " + address.toUpperCase().replace("0X", "0x") + "\r\n";
  const card = reviewWorkspaceChanges(before, after).cards[0];
  assert.equal(card.tokensAdded.length, 0);
  assert.equal(card.tokensRemoved.length, 0);
});

test("list reordering is disclosed without claiming token transfers", () => {
  const before = draft();
  const after = clone(before);
  before[0].tokens = CONTRACTS.join("\n");
  after[0].tokens = [...CONTRACTS].reverse().join("\n");
  const card = reviewWorkspaceChanges(before, after).cards[0];
  assert.equal(card.listOrderChanged, true);
  assert.equal(card.tokensAdded.length, 0);
  assert.match(describeWorkspaceChanges(before, after), /一覧の順序が変わります/);
  assert.match(describeWorkspaceChanges(before, after), /送金・焼却・承認ではありません/);
});

test("removed records retain their full account network origin and block identity", () => {
  const before = draft();
  const after = draft({ populated: false });
  const review = reviewWorkspaceChanges(before, after);
  const record = review.cards[0].history.removed[0];
  assert.equal(record.account, ACCOUNTS[0]);
  assert.equal(record.chainId, 84532);
  assert.equal(record.siteOrigin, "http://localhost:4184");
  assert.equal(record.blockNumber, "42");
  assert.equal(record.blockHash, snapshot().blockHash);
  assert.equal(record.tokenCount, 1);
  assert.equal(review.cards[0].history.added.length, 0);
});

test("same-block corrected observation is shown as removal plus addition", () => {
  const before = draft();
  const after = clone(before);
  after[0].history = archive([snapshot(0, "42", { nativeBalanceBaseUnits: "17" })]);
  const card = reviewWorkspaceChanges(before, after).cards[0];
  assert.equal(card.history.added.length, 1);
  assert.equal(card.history.removed.length, 1);
  assert.equal(card.history.unchanged, 0);
});

test("history additions for a different account are explicitly marked", () => {
  const before = draft({ populated: false });
  const after = draft();
  after[0].account = CONTRACTS[0];
  const card = reviewWorkspaceChanges(before, after).cards[0];
  assert.equal(card.addedOutsideCurrentConfiguration, 1);
  assert.match(describeWorkspaceChanges(before, after), /異なるアドレス・ネットワークの追加記録: 1件/);
});

test("history additions for a different chain are explicitly marked", () => {
  const before = draft({ populated: false });
  const after = draft();
  after[1].chainId = 8453;
  assert.equal(reviewWorkspaceChanges(before, after).cards[1].addedOutsideCurrentConfiguration, 1);
});

test("matching histories are kept as history without claiming a live connection", () => {
  const before = draft({ populated: false });
  const after = draft();
  const card = reviewWorkspaceChanges(before, after).cards[2];
  assert.equal(card.addedOutsideCurrentConfiguration, 0);
  assert.equal(card.history.added.length, 1);
  assert.equal(reviewWorkspaceChanges(before, after).localDataOnly, true);
});

test("review bounds remain exact for block numbers above Number precision", () => {
  const before = draft({ populated: false });
  const after = draft();
  const block = "900719925474099312345";
  after[0].history = archive([snapshot(0, block)]);
  assert.equal(reviewWorkspaceChanges(before, after).cards[0].history.added[0].blockNumber, block);
  assert.ok(describeWorkspaceChanges(before, after).includes("block " + block));
});

test("review freezes nested record identities and detaches from callers", () => {
  const before = draft({ populated: false });
  const after = draft();
  const review = reviewWorkspaceChanges(before, after);
  after[0].history = archive([]);
  assert.equal(review.cards[0].history.added.length, 1);
  assert.ok(Object.isFrozen(review.cards[0].history.added[0]));
  assert.ok(Object.isFrozen(review.cards[0].tokensAfter));
});

test("raw unfinished contract text cannot inject a second review line", () => {
  const before = draft();
  const after = draft();
  before[0].tokenAddress = "wrong\nAPPROVED\u202e";
  const description = describeWorkspaceChanges(before, after);
  assert.ok(description.includes("wrong\\u000aAPPROVED\\u202e"));
  assert.ok(!description.includes("\nAPPROVED"));
});

test("review represents an empty token list and no observation without a fake zero balance", () => {
  const before = draft({ populated: false });
  const after = clone(before);
  after[0].tokens = "";
  after[0].tokenAddress = "";
  const description = describeWorkspaceChanges(before, after);
  assert.match(description, /復元後のトークン一覧: 0件/);
  assert.match(description, /未設定/);
  assert.ok(!description.includes("ETH: 0"));
});

test("preview integrates the detailed review for the selected result only", () => {
  const current = draft({ populated: false });
  current[0].tokens = CONTRACTS[2];
  const preview = previewWorkspace(text(), current, { ...OPTIONS, settings: false });
  const card = reviewWorkspaceChanges(preview.before, preview.after).cards[0];
  assert.deepEqual(card.tokensAfter, [CONTRACTS[2]]);
  assert.equal(card.tokensAdded.length, 0);
  const description = describeWorkspacePreview(preview);
  assert.match(description, /契約アドレスと履歴の変更明細/);
  assert.match(description, /ブロックハッシュ/);
});

test("undo integrates the reverse change details", () => {
  const before = draft();
  const after = draft({ populated: false });
  assert.match(describeWorkspaceUndo({ before, after }), /取り除く過去記録: 1件/);
});

test("review rejects malformed later cards before producing partial details", () => {
  const after = draft();
  after[2].history = after[0].history;
  assert.throws(() => reviewWorkspaceChanges(draft(), after), { code: "WORKSPACE_AGENT" });
});
