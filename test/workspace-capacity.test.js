import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceController } from "../src/workspace-controller.js";
import { workspaceFromDraft, encodeWorkspace, decodeWorkspace, workspaceDraftKey } from "../src/workspace-format.js";
import { prepareWorkspaceFile, decodeWorkspaceFile } from "../src/workspace-file.js";
import { describeWorkspaceChanges } from "../src/workspace-review.js";
import { summarizeWorkspace } from "../src/workspace-overview.js";
import { archive, MAX } from "./helpers/history-fixtures.js";
import { draft, snapshot, clone, OPTIONS } from "./helpers/workspace-fixtures.js";

const tokens = Array.from({ length: 32 }, (_, index) => "0x" + (index + 1).toString(16).padStart(40, "0"));

function fullDraft({ rows = 64, offset = 0, holdings = 32 } = {}) {
  return draft().map((card, index) => ({
    ...card,
    tokens: tokens.join("\n"),
    history: archive(Array.from({ length: rows }, (_, row) => snapshot(index, String(row + offset), {
      nativeBalanceBaseUnits: row % 2 ? MAX : "0",
      holdings: tokens.slice(0, holdings).map((address, position) => ({
        address,
        hasCode: position % 2 === 0,
        balanceBaseUnits: position % 2 === 0 ? MAX : null,
        notice: position % 2 === 0 ? null : "TOKEN_CODE_MISSING",
      })),
    }))),
  }));
}

test("all 192 records with 32 token observations survive the complete checksum file round trip", async () => {
  const current = fullDraft();
  const workspace = workspaceFromDraft(current);
  const text = encodeWorkspace(workspace);
  assert.deepEqual(decodeWorkspace(text), workspace);
  const saved = await prepareWorkspaceFile(workspace);
  const restored = await decodeWorkspaceFile(new TextEncoder().encode(saved.text));
  assert.deepEqual(restored.workspace, workspace);
  assert.equal(restored.checksumVerified, true);
  assert.equal(restored.authenticated, false);
  const summary = summarizeWorkspace(current);
  assert.equal(summary.totalObservations, 192);
  assert.ok(summary.cards.every(card => card.remainingCapacity === 0));
  assert.ok(summary.cards.every(card => card.groups[0].unknownTokens === 16));
});

test("merging duplicate full archives does not exceed capacity or discard a row", () => {
  let current = fullDraft();
  const before = workspaceDraftKey(current);
  const controller = createWorkspaceController({ readDraft: () => current,
    writeDraft: value => { current = clone(value); } });
  const text = encodeWorkspace(workspaceFromDraft(current));
  const review = controller.preview(text, OPTIONS);
  assert.deepEqual(review.changes.map(card => card.duplicates), [64, 64, 64]);
  assert.equal(review.changed, false);
  controller.apply(review.id, text, OPTIONS);
  assert.equal(workspaceDraftKey(current), before);
});

test("a single extra record in the third card rejects the entire merge before writing", () => {
  let current = fullDraft({ holdings: 1 });
  const incoming = clone(current);
  incoming[2].history = archive([snapshot(2, "65")]);
  const text = encodeWorkspace(workspaceFromDraft(incoming));
  const before = workspaceDraftKey(current);
  let writes = 0;
  const controller = createWorkspaceController({ readDraft: () => current,
    writeDraft: value => { writes++; current = clone(value); } });
  assert.throws(() => controller.preview(text, OPTIONS), { code: "WORKSPACE_CAPACITY" });
  assert.equal(writes, 0);
  assert.equal(workspaceDraftKey(current), before);
});

test("merge at the exact capacity boundary is accepted without truncation", () => {
  let current = fullDraft({ rows: 63, holdings: 1 });
  const incoming = fullDraft({ rows: 1, offset: 63, holdings: 1 });
  const text = encodeWorkspace(workspaceFromDraft(incoming));
  const controller = createWorkspaceController({ readDraft: () => current,
    writeDraft: value => { current = clone(value); } });
  const review = controller.preview(text, OPTIONS);
  assert.deepEqual(review.changes.map(card => card.afterCount), [64, 64, 64]);
  controller.apply(review.id, text, OPTIONS);
  assert.equal(summarizeWorkspace(current).totalObservations, 192);
});

test("full replacement discloses every removed and added identity", () => {
  const before = fullDraft({ holdings: 1 });
  const after = fullDraft({ offset: 64, holdings: 1 });
  const description = describeWorkspaceChanges(before, after);
  assert.equal((description.match(/追加する過去記録: 64件/g) ?? []).length, 3);
  assert.equal((description.match(/取り除く過去記録: 64件/g) ?? []).length, 3);
  assert.equal((description.match(/ブロックハッシュ:/g) ?? []).length, 384);
  assert.ok(description.includes("block 0"));
  assert.ok(description.includes("block 127"));
});

test("large restore and undo retain exact uint256 values in all three stores", () => {
  let current = draft({ populated: false });
  const original = workspaceDraftKey(current);
  const incoming = encodeWorkspace(workspaceFromDraft(fullDraft()));
  const controller = createWorkspaceController({ readDraft: () => current,
    writeDraft: value => { current = clone(value); } });
  const review = controller.preview(incoming, OPTIONS);
  controller.apply(review.id, incoming, OPTIONS);
  const summary = summarizeWorkspace(current);
  assert.ok(summary.cards.every(card => card.groups[0].nativeBalanceBaseUnits === MAX));
  const undo = controller.undoPreview();
  controller.undoApply(undo.id);
  assert.equal(workspaceDraftKey(current), original);
});

test("maximum token list removal reports each exact contract once", () => {
  const before = fullDraft({ rows: 0 });
  const after = clone(before);
  after[0].tokens = "";
  const description = describeWorkspaceChanges(before, after);
  const dat = description.split("EMA")[0];
  for (const token of tokens) assert.ok(dat.includes(token));
  assert.match(dat, /復元後のトークン一覧: 0件/);
});
