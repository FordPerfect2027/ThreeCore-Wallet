import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBrowserFocus, checkBrowserShard, checkBrowserErrorControl } from '../scripts/browser-result.js';
const indices = [7, 42, 281, 308];
function page(changes = {}) {
  const values = { 'suite-status': 'passed', 'tests-count': '4', 'tests-passed': '4', 'tests-failed': '0',
    'unexpected-errors': '0', 'error-kinds': '', 'injected-fault': '', 'shard-index': '0', 'shard-count': '1',
    'registered-count': '320', 'registered-digest': 'a'.repeat(64), 'selected-indices': indices.join(','),
    'suite-filter': 'focus:file-read', 'control-only': 'false',
    'registered-groups': Array.from({length: 320}, (_, i) => indices.includes(i) ? 'file-read' : 'general').join(','), ...changes };
  return '<!doctype html><html><body ' + Object.entries(values).map(([key, value]) => 'data-' + key + '="' + value + '"').join(' ') + '></body></html>';
}
test('focused browser coverage includes every registered group member and never claims full coverage', () => {
  const result = checkBrowserFocus(page(), 'file-read');
  assert.equal(result.passed, 4); assert.equal(result.registered, 320); assert.equal(result.fullCoverage, false);
  assert.throws(() => checkBrowserShard(page(), 0)); assert.throws(() => checkBrowserErrorControl(page(), 'error'));
});
test('focused coverage cannot accept a full-shard or unrelated suite receipt', () => {
  assert.throws(() => checkBrowserFocus(page({'shard-count': '2', 'suite-filter': ''}), 'file-read'));
  assert.throws(() => checkBrowserFocus(page(), 'wallet')); assert.throws(() => checkBrowserFocus(page()));
});
for (const [name, changes] of [
  ['dropped selected case', {'selected-indices': '7,42,281'}],
  ['extra selected case', {'selected-indices': '7,42,43,281,308'}],
  ['repeated selected case', {'selected-indices': '7,42,42,281,308'}],
  ['empty focused group', {'registered-groups': Array(320).fill('general').join(','), 'selected-indices': ''}],
  ['truncated registry', {'registered-groups': 'file-read,general'}],
  ['unknown group', {'registered-groups': Array(320).fill('unknown').join(',')}],
  ['extra claimed result', {'tests-count': '5', 'tests-passed': '5'}],
  ['unexpected browser error', {'unexpected-errors': '1', 'error-kinds': 'error'}],
  ['injected control', {'control-only': 'true'}],
  ['uncompleted case', {'tests-passed': '3'}],
  ['failed case', {'tests-passed': '3', 'tests-failed': '1'}],
  ['incomplete full registry', {'registered-count': '4', 'registered-groups': 'file-read,file-read,file-read,file-read', 'selected-indices': '0,1,2,3'}],
]) test('focused browser receipt rejects ' + name, () => assert.throws(() => checkBrowserFocus(page(changes), 'file-read')));
