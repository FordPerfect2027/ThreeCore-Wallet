import test from "node:test";
import assert from "node:assert/strict";
import { validatePeriodProgress, periodProgressText } from "../src/period-progress.js";
import { collectPeriod } from "../src/period-reader.js";
import { createPeriodController } from "../src/period-controller.js";
import { periodMessage, periodPlanText, periodReportText, periodSummary } from "../src/period-view.js";
import { plan, checkpoint, periodSession, context, code, clone } from "./helpers/period-fixtures.js";

function progress(stage, detail = null, windowIndex = null, checked = 0, checks = 0) {
  return { stage, detail, windowIndex, checked, checks };
}

for (const stage of ["earlier", "later"]) for (const detail of ["block", "code", "native", "metadata", "balance", "canonical", "complete"]) {
  test(`progress uses a human-readable label for ${stage}/${detail}`, () => {
    const value = progress(stage, detail);
    assert.equal(validatePeriodProgress(value).detail, detail);
    assert.match(periodProgressText(value, plan()), /開始時|終了時/);
    assert.match(periodProgressText(value, plan()), /確認しています/);
  });
}

for (const detail of ["range", "token", "outgoing", "incoming", "blocks", "canonical", "complete"]) {
  test("history substep shows its bounded window index: " + detail, () => {
    const value = progress("history", detail, 1, 1, 2);
    assert.match(periodProgressText(value, plan()), /2 \/ 3区間目/);
    if (detail === "blocks") assert.match(periodProgressText(value, plan()), /1 \/ 2/);
  });
}

test("resume and final checks describe anchor counts without claiming time percentage", () => {
  assert.match(periodProgressText(progress("resume-check", null, null, 2, 7), plan()), /保存したブロック情報/);
  assert.match(periodProgressText(progress("final-check", null, null, 5, 7), plan()), /取得後のブロック情報/);
  assert.doesNotMatch(periodProgressText(progress("final-check", null, null, 5, 7), plan()), /%|分|秒/);
  assert.match(periodProgressText(progress("complete"), plan()), /完了/);
  assert.equal(periodProgressText(null, plan()), "");
});

for (const input of [null, {}, progress("bad"), progress("history", "balance"), progress("earlier", "outgoing"),
  progress("complete", "balance"), progress("history", null, -1), progress("history", null, 12),
  progress("earlier", null, 0), progress("history", null, 0, -1, 2), progress("history", null, 0, 3, 2),
  progress("final-check", null, null, 0, 1227), progress("final-check", null, null, "1", 2)]) {
  test("malformed presentation progress is rejected: " + JSON.stringify(input), () => {
    assert.throws(() => validatePeriodProgress(input), code("PERIOD_PROGRESS"));
  });
}

test("progress strips untrusted extra fields rather than echoing them", () => {
  const result = validatePeriodProgress({ ...progress("history", "incoming", 0), secret: "DO_NOT_ECHO" });
  assert.equal(JSON.stringify(result).includes("DO_NOT_ECHO"), false);
  assert.equal(Object.isFrozen(result), true);
});

test("window index must also exist in the selected plan", () => {
  assert.throws(() => periodProgressText(progress("history", "incoming", 3), plan()), code("PERIOD_PROGRESS"));
});

test("collector emits all expected identity and direction stages with correct windows", async () => {
  const values = [];
  await collectPeriod(periodSession().session, plan(), { onProgress: value => values.push(value) });
  for (const part of ["earlier", "later"]) {
    assert.deepEqual(values.filter(value => value.stage === part && value.detail !== null).map(value => value.detail),
      ["block", "code", "native", "metadata", "balance", "canonical", "complete"]);
  }
  for (let index = 0; index < 3; index++) {
    const details = values.filter(value => value.stage === "history" && value.windowIndex === index).map(value => value.detail);
    assert.ok(details.includes("outgoing"));
    assert.ok(details.includes("incoming"));
    assert.ok(details.includes("canonical"));
    assert.equal(details.at(-1), "complete");
  }
  for (const value of values) assert.ok(validatePeriodProgress(value));
});

test("controller ignores malformed progress without replacing the last valid display", async () => {
  let snapshot;
  const controller = createPeriodController({ getContext: () => context(),
    read: async (agent, selected, options) => {
      options.onProgress(progress("history", "incoming", 0));
      const good = controller.state.progress;
      options.onProgress({ stage: "history", checked: "unsafe", checks: 2 });
      snapshot = controller.state.progress;
      assert.equal(snapshot, good);
      throw { code: "PERIOD_CANCELLED" };
    } });
  controller.prepare({ earlierBlock: "30", laterBlock: "42", windowSize: 5 });
  controller.apply();
  await controller.start();
  assert.equal(snapshot.detail, "incoming");
});

test("localized plan text preserves explicit endpoint semantics and full context", () => {
  const result = periodPlanText(plan());
  assert.match(result, /30 の終了時点/);
  assert.match(result, /42 の終了時点/);
  assert.match(result, /31 ～ 42/);
  assert.match(result, /3区間/);
  assert.match(result, /5段階/);
  assert.match(result, new RegExp(context().account));
  assert.match(result, /所要時間の割合ではありません/);
});

test("partial summary does not invent an unobserved endpoint balance", () => {
  const summary = periodSummary(checkpoint(1));
  assert.equal(summary.earlierAmount, "100");
  assert.equal(summary.laterAmount, "未取得");
  assert.equal(summary.residualBaseUnits, null);
  assert.equal(summary.result, "not-collected");
});

test("complete summary uses exact reconciliation result and immutable caveats", () => {
  const summary = periodSummary(checkpoint());
  assert.equal(summary.laterAmount, "107");
  assert.equal(summary.result, "arithmetic-agreement");
  assert.equal(summary.residualBaseUnits, "0");
  assert.equal(summary.independentlyVerified, false);
  assert.equal(summary.importedRecordsAuthenticated, false);
});

test("text report explains unencrypted public account evidence and historical scope", () => {
  const report = periodReportText(checkpoint());
  assert.match(report, /暗号化されていません/);
  assert.match(report, /真正性を保証しません/);
  assert.match(report, /現在の残高・資産価格・利益を表しません/);
  assert.match(report, /5 \/ 5/);
});

test("unknown error codes and messages are never rendered verbatim", () => {
  assert.equal(periodMessage("<script>unsafe()</script>").includes("<script>"), false);
  assert.equal(periodMessage("private /path").includes("/path"), false);
  assert.match(periodMessage("TRANSFER_FUTURE_BLOCK"), /最新ブロックより先/);
});
