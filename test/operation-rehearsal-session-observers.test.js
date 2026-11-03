import test from "node:test";
import assert from "node:assert/strict";
import { createRehearsalSession } from "../src/operation-rehearsal-session.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
const target = () => {
  const session = createRehearsalSession("EMA");
  session.workspace.reset(rehearsalExampleV2("EMA"));
  const document = session.snapshot();
  session.dispose();
  return document;
};

test("current-review inquiry accepts only this session's pending capability and retires on edits",()=>{
  const session=createRehearsalSession(),other=createRehearsalSession();
  try{assert.equal(session.isCurrentReview(null),false);const review=session.preview(target());
    assert.equal(session.isCurrentReview(review),true);assert.equal(session.isCurrentReview({...review}),false);
    assert.equal(other.isCurrentReview(review),false);session.workspace.select("CAWELON");assert.equal(session.isCurrentReview(review),false);
    const next=session.preview(target());session.commit(next);assert.equal(session.isCurrentReview(next),false);
    const last=session.preview(target());session.dispose();assert.equal(session.isCurrentReview(last),false);
  }finally{session.dispose();other.dispose();}
});

for (const failure of ["throw", "reject", "then-getter", "then-reject", "async-then"]) {
  test(`session observer ${failure} cannot suppress restoration or healthy views`, async () => {
    const session = createRehearsalSession(), document = target(), seen = [];
    session.subscribe(() => {
      if (failure === "throw") throw Error("Synthetic view failure");
      if (failure === "reject") return Promise.reject(Error("Synthetic view failure"));
      if (failure === "then-getter") return { get then() { throw Error("Synthetic view failure"); } };
      if (failure === "then-reject") return { then(_resolve, reject) { reject(Error("Synthetic view failure")); } };
      return { async then() { throw Error("Synthetic view failure"); } };
    });
    session.subscribe(() => seen.push(session.snapshot()));
    assert.deepEqual(session.commit(session.preview(document)), document);
    await tick();
    assert.deepEqual(seen, [document]);
    session.dispose();
  });
}

for (const entry of ["cancel", "workspace", "cases", "commit"]) {
  test(`${entry} notification bounds a continually mutating observer`, () => {
    const session = createRehearsalSession();
    let calls = 0;
    session.subscribe(() => { if (++calls <= 10) session.cancel(); });
    if (entry === "cancel") session.cancel();
    if (entry === "workspace") session.workspace.select("EMA");
    if (entry === "cases") session.cases.cancel();
    if (entry === "commit") session.commit(session.preview(target()));
    assert.equal(calls, 2);
    session.cancel();
    assert.equal(calls, 4);
    session.dispose();
  });
}

test("removed observers are skipped during an in-flight notification", () => {
  const session = createRehearsalSession();
  let calls = 0, remove;
  session.subscribe(() => remove());
  remove = session.subscribe(() => calls++);
  session.cancel();
  assert.equal(calls, 0);
  session.dispose();
});

test("disposal inside a view preserves the commit receipt and stops remaining views", () => {
  const session = createRehearsalSession(), document = target();
  let calls = 0;
  session.subscribe(() => session.dispose());
  session.subscribe(() => calls++);
  assert.deepEqual(session.commit(session.preview(document)), document);
  assert.equal(calls, 0);
  assert.throws(() => session.snapshot(), { code: "SESSION_DISPOSED" });
});

test("later view mutations cannot rewrite the result of a successful commit", () => {
  const session = createRehearsalSession(), document = target(), seen = [];
  let changed = false;
  session.subscribe(() => {
    if (!changed) { changed = true; session.workspace.select("CAWELON"); }
  });
  session.subscribe(() => seen.push(session.workspace.state().activeAgent));
  const restored = session.commit(session.preview(document));
  assert.deepEqual(restored, document);
  assert.equal(Object.isFrozen(restored), true);
  assert.equal(session.workspace.state().activeAgent, "CAWELON");
  assert.deepEqual(seen, ["CAWELON"]);
  session.dispose();
});

test("new subscriptions do not fire eagerly and removed subscriptions release capacity", () => {
  const session = createRehearsalSession(), removers = [];
  let calls = 0;
  for (let index = 0; index < 64; index++) removers.push(session.subscribe(() => calls++));
  assert.equal(calls, 0);
  assert.throws(() => session.subscribe(() => {}), { code: "SESSION_LISTENER_LIMIT" });
  removers[0]();
  const remove = session.subscribe(() => calls++);
  session.cancel();
  assert.equal(calls, 64);
  remove(); session.dispose();
  assert.throws(() => session.subscribe(() => {}), { code: "SESSION_DISPOSED" });
});

test("duplicate subscriptions consume one slot and notify once", () => {
  const session = createRehearsalSession();
  let calls = 0;
  const listener = () => calls++;
  for (let index = 0; index < 100; index++) session.subscribe(listener);
  session.cancel();
  assert.equal(calls, 1);
  session.dispose();
});
