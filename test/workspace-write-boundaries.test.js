import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceController } from '../src/workspace-controller.js';
import { workspaceDraftKey } from '../src/workspace-format.js';
import { draft, text, clone, OPTIONS, tick } from './helpers/workspace-fixtures.js';

function fixture() {
  let current = draft({ block: '10' });
  let writer = value => { current = clone(value); };
  let reader = () => current;
  let authorize = () => true;
  const writes = [];
  const controller = createWorkspaceController({
    readDraft: () => reader(),
    writeDraft(value) { writes.push(clone(value)); return writer(value); },
    authorizeWrite: () => authorize(),
  });
  return { controller, writes,
    get current() { return clone(current); },
    writer(fn) { writer = fn; }, reader(fn) { reader = fn; }, authorize(fn) { authorize = fn; },
    replace(value) { current = clone(value); },
    prepare(mode = 'restore') {
      if (mode === 'undo') {
        const first = controller.preview(text({ block: '20' }), OPTIONS);
        controller.apply(first.id, text({ block: '20' }), OPTIONS);
        const review = controller.undoPreview();
        return () => controller.undoApply(review.id);
      }
      const review = controller.preview(text({ block: '20' }), OPTIONS);
      return () => controller.apply(review.id, text({ block: '20' }), OPTIONS);
    },
  };
}

for (const mode of ['restore', 'undo']) {
  test(`${mode}: editing a draft during final authorization never overwrites that edit`, () => {
    const f = fixture();
    const apply = f.prepare(mode);
    const priorWrites = f.writes.length;
    const changed = f.current;
    changed[1].account = 'unfinished replacement address';
    f.authorize(() => { f.replace(changed); return true; });
    assert.throws(apply, { code: 'WORKSPACE_STALE' });
    assert.equal(f.writes.length, priorWrites);
    assert.deepEqual(f.current, changed);
    assert.equal(f.controller.state().recoveryRequired, false);
  });

  test(`${mode}: cancellation inside the writer rolls back instead of reporting success`, () => {
    const f = fixture();
    const apply = f.prepare(mode);
    const before = f.current;
    let writes = 0;
    f.writer(value => {
      f.replace(value);
      if (++writes === 1) f.controller.cancel();
    });
    assert.throws(apply, { code: 'WORKSPACE_ROLLED_BACK' });
    assert.equal(writes, 2);
    assert.deepEqual(f.current, before);
    assert.equal(f.controller.state().recoveryRequired, false);
    assert.equal(f.controller.state().pending, false);
  });

  test(`${mode}: cancellation while checking the written state rolls back`, () => {
    const f = fixture();
    const apply = f.prepare(mode);
    const before = f.current;
    let written = false, cancelled = false;
    f.writer(value => { f.replace(value); written = true; });
    f.reader(() => {
      if (written && !cancelled) { cancelled = true; f.controller.cancel(); }
      return f.current;
    });
    assert.throws(apply, { code: 'WORKSPACE_ROLLED_BACK' });
    assert(cancelled);
    assert.deepEqual(f.current, before);
  });

  test(`${mode}: authorization expiring during a write cannot leave the target committed`, () => {
    const f = fixture();
    const apply = f.prepare(mode);
    const before = f.current;
    let valid = true, writes = 0;
    f.authorize(() => valid);
    f.writer(value => { writes++; f.replace(value); valid = false; });
    assert.throws(apply, { code: 'WORKSPACE_ROLLED_BACK' });
    assert.equal(writes, 2, 'Rollback must remain possible after authorization ends');
    assert.deepEqual(f.current, before);
  });

  test(`${mode}: failed rollback retains a detached recovery copy of the pre-operation data`, () => {
    const f = fixture();
    const apply = f.prepare(mode);
    const before = f.current;
    let writes = 0;
    f.writer(value => {
      if (++writes > 1) throw Error('Synthetic unavailable write target');
      f.replace(value); f.controller.cancel();
    });
    assert.throws(apply, { code: 'WORKSPACE_RECOVERY_REQUIRED' });
    assert.deepEqual(JSON.parse(f.controller.recoveryText()).entries, before);
    assert(f.controller.state().recoveryRequired);
    assert.throws(() => f.prepare(), { code: 'WORKSPACE_RECOVERY_REQUIRED' });
  });
}

test('a cancelled second restore preserves the previous successful undo point', () => {
  const f = fixture();
  const original = f.current;
  f.prepare()();
  const middle = f.current;
  const nextText = text({ block: '30' });
  const review = f.controller.preview(nextText, OPTIONS);
  let writes = 0;
  f.writer(value => { f.replace(value); if (++writes === 1) f.controller.cancel(); });
  assert.throws(() => f.controller.apply(review.id, nextText, OPTIONS), { code: 'WORKSPACE_ROLLED_BACK' });
  assert.deepEqual(f.current, middle);
  assert.deepEqual(JSON.parse(f.controller.recoveryText()).entries, original);
  assert(f.controller.state().undoAvailable);
});

test('successful restore and undo still have exactly one write each', () => {
  const f = fixture();
  const beforeKey = workspaceDraftKey(f.current);
  f.prepare()();
  assert.equal(f.writes.length, 1);
  const undo = f.controller.undoPreview();
  f.controller.undoApply(undo.id);
  assert.equal(f.writes.length, 2);
  assert.equal(workspaceDraftKey(f.current), beforeKey);
  assert.equal(f.controller.state().hasUndo, false);
});

test('a cancelled write does not invoke another authorization callback', () => {
  const f = fixture();
  const apply = f.prepare();
  let checks = 0;
  f.authorize(() => { checks++; return true; });
  f.writer(value => { f.replace(value); f.controller.cancel(); });
  assert.throws(apply, { code: 'WORKSPACE_ROLLED_BACK' });
  assert.equal(checks, 1);
});

test('an asynchronous post-write authorization is consumed and cannot commit', async () => {
  const f = fixture();
  const apply = f.prepare();
  const before = f.current;
  let checks = 0;
  f.authorize(() => ++checks === 1 ? true : Promise.reject(Error('Synthetic authorization failure')));
  assert.throws(apply, { code: 'WORKSPACE_ROLLED_BACK' });
  await tick();
  assert.deepEqual(f.current, before);
  assert.equal(f.writes.length, 2);
});
