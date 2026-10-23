import test from "node:test";
import assert from "node:assert/strict";
import { periodRecovery } from "../src/period-recovery.js";
import { periodWindows, periodPlanKey } from "../src/period-plan.js";
import { emptyPeriodDraft, periodDraftKey } from "../src/period-draft.js";
import { createPeriodController } from "../src/period-controller.js";
import { preparePeriodFile } from "../src/period-file.js";
import { checkpoint, plan, context, fileFrom } from "./helpers/period-fixtures.js";

for (const code of ["PERIOD_BLOCK_CHANGED", "IDENTITY_BLOCK_CHANGED", "TRANSFER_BLOCK_CHANGED", "PERIOD_NEW_PLAN_REQUIRED"]) {
  test("reorg recommendation keeps exact original range and demands restart: " + code, () => {
    const before = checkpoint();
    const result = periodRecovery(before, code);
    assert.equal(result.action, "restart");
    assert.equal(periodPlanKey(result.proposedPlan), periodPlanKey(before.plan));
    assert.equal(result.savedSteps, 5);
    assert.equal(result.automaticallyExecuted, false);
    assert.equal(result.changesWalletPermissions, false);
    assert.equal(result.remaining, null);
  });
}

test("event overflow halves the window and preserves range if it still fits", () => {
  const result = periodRecovery(checkpoint(), "TRANSFER_EVENT_LIMIT");
  assert.equal(result.action, "narrow");
  assert.equal(result.proposedPlan.windowSize, 2);
  assert.equal(result.proposedPlan.earlierBlock, "30");
  assert.equal(result.proposedPlan.laterBlock, "42");
  assert.equal(periodWindows(result.proposedPlan).length, 6);
  assert.equal(result.remaining, null);
});

test("narrowing a maximum-size plan explicitly reports the unplanned remainder", () => {
  const selected = plan({ earlierBlock: "0", laterBlock: "24000", windowSize: 2000 });
  const result = periodRecovery(emptyPeriodDraft(selected), "TRANSFER_EVENT_LIMIT");
  assert.equal(result.proposedPlan.windowSize, 1000);
  assert.equal(result.proposedPlan.laterBlock, "12000");
  assert.equal(periodWindows(result.proposedPlan).length, 12);
  assert.deepEqual(result.remaining, { earlierBlock: "12000", laterBlock: "24000" });
  assert.match(result.explanation, /別の計画/);
});

test("one-block overflow cannot be made smaller and offers no automatic remedy", () => {
  const selected = plan({ windowSize: 1 });
  const result = periodRecovery(emptyPeriodDraft(selected), "TRANSFER_EVENT_LIMIT");
  assert.equal(result.action, "inspect");
  assert.equal(result.proposedPlan, null);
  assert.match(result.explanation, /1ブロックより細かい/);
});

for (const code of ["PERIOD_SESSION_CHANGED", "PERIOD_CONTEXT_MISMATCH", "PERIOD_NOT_CONNECTED"]) {
  test("connection failures preserve original account and chain: " + code, () => {
    const before = checkpoint(3);
    const result = periodRecovery(before, code);
    assert.equal(result.action, "reconnect");
    assert.equal(result.proposedPlan, null);
    assert.match(result.explanation, new RegExp(before.plan.context.account));
    assert.match(result.explanation, /8453/);
  });
}

for (const code of ["PERIOD_CANCELLED", "PERIOD_TIMEOUT", "IDENTITY_TIMEOUT", "TRANSFER_TIMEOUT", "TRANSFER_RPC_FAILED", "PERIOD_READ_FAILED"]) {
  test("transient failure suggests only a user-initiated resume: " + code, () => {
    const result = periodRecovery(checkpoint(3), code);
    assert.equal(result.action, "resume");
    assert.equal(result.proposedPlan, null);
    assert.equal(result.savedSteps, 3);
    assert.match(result.explanation, /自動再試行は行いません/);
  });
}

for (const code of ["PERIOD_TOKEN_MISMATCH", "PERIOD_FILE_SCHEMA", "<script>bad()</script>", null]) {
  test("unsupported failure does not invent a repair: " + String(code), () => {
    const result = periodRecovery(checkpoint(1), code);
    assert.equal(result.action, "inspect");
    assert.equal(result.proposedPlan, null);
    assert.equal(JSON.stringify(result).includes("<script>"), false);
  });
}

test("recovery planning is exact above safe-integer block numbers", () => {
  const start = 100000000000000000000000000n;
  const selected = plan({ earlierBlock: start.toString(), laterBlock: (start + 24000n).toString(), windowSize: 2000 });
  const result = periodRecovery(emptyPeriodDraft(selected), "TRANSFER_EVENT_LIMIT");
  assert.equal(result.proposedPlan.laterBlock, (start + 12000n).toString());
  assert.equal(result.remaining.earlierBlock, (start + 12000n).toString());
});

test("suggesting recovery does not alter a checkpoint or its canonical key", () => {
  const before = checkpoint();
  const key = periodDraftKey(before);
  const result = periodRecovery(before, "TRANSFER_EVENT_LIMIT");
  assert.equal(periodDraftKey(before), key);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.proposedPlan), true);
});

test("known reorg disables resume and handoff but allows forensic JSON saving", async () => {
  const controller = createPeriodController({ getContext: () => context(),
    read: async () => { throw { code: "PERIOD_BLOCK_CHANGED" }; } });
  await controller.importFile(fileFrom((await preparePeriodFile(checkpoint())).text));
  controller.apply();
  assert.equal(await controller.start(), false);
  assert.equal(controller.state.requiresNewPlan, true);
  assert.equal(await controller.start(), false);
  assert.equal(controller.state.error, "PERIOD_NEW_PLAN_REQUIRED");
  assert.equal(controller.sendToReconciliation(), false);
  assert.equal(await controller.exportFile("reconciliation", () => assert.fail()), false);
  const files = [];
  assert.equal(await controller.exportFile("draft", value => files.push(value)), true);
  assert.equal(files.length, 1);
  assert.equal(controller.state.requiresNewPlan, true);
});

test("repair plan is reviewed and acknowledged before replacing retained evidence", async () => {
  const controller = createPeriodController({ getContext: () => context(),
    read: async () => { throw { code: "TRANSFER_EVENT_LIMIT" }; } });
  await controller.importFile(fileFrom((await preparePeriodFile(checkpoint(3))).text));
  controller.apply();
  const key = periodDraftKey(controller.state.draft);
  await controller.start();
  assert.equal(controller.prepareRepair(), true);
  assert.equal(controller.state.review.requiresReplacement, true);
  assert.equal(controller.state.review.candidate.plan.windowSize, 2);
  assert.equal(periodDraftKey(controller.state.draft), key);
  assert.equal(controller.apply(), false);
  assert.equal(controller.apply(true), true);
  assert.equal(controller.state.draft.records.length, 0);
});
