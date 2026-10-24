import test from 'node:test';
import assert from 'node:assert/strict';
import { cardFixture, agents } from './helpers/access-lifecycle.js';

for (const agent of agents) {
  for (const stop of ['disconnect', 'clearResult']) {
    test(`${agent}: a stop during result rendering reaches the displayed view (${stop})`, async t => {
      let visible;
      const f = cardFixture(t, { agent, onChange(state, card) {
        visible = state;
        if (state.result) card[stop]();
      } });
      assert.equal(await f.connect(), true);
      assert.equal(await f.card.readBalances(), false);
      assert.equal(visible.result, null, 'The observer must not retain the cancelled result');
      assert.equal(visible.phase, f.card.state.phase);
      assert.equal(visible.connection?.connected ?? false, stop !== 'disconnect');
    });
  }
  test(`${agent}: stop during connect rendering reaches the disconnected view`, async t => {
    let visible;
    const f = cardFixture(t, { agent, onChange(state, card) {
      visible = state;
      if (state.phase === 'connected') card.disconnect();
    } });
    assert.equal(await f.connect(), false);
    assert.equal(visible.phase, 'disconnected');
    assert.equal(visible.connection, null);
  });
}
