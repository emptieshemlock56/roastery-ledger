import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateMovement } from '../src/rules.js';

const items = new Map([
  ['green', { name: 'Brazil green', type: 'green', active: true }],
  ['roasted', { name: 'Brazil roasted', type: 'roasted', active: true }],
  ['blend', { name: 'House', type: 'blend', active: true }],
  ['bag', { name: '12oz bag', type: 'packaging', active: true }],
  ['fg', { name: 'House 12oz', type: 'finished', active: true }],
  ['old', { name: 'Old bag', type: 'packaging', active: false }],
]);
const ok = (m) => assert.deepEqual(validateMovement(m, items), []);
const fails = (m, re) => {
  const errors = validateMovement(m, items);
  assert.ok(errors.some((e) => re.test(e)), `expected ${re} in ${JSON.stringify(errors)}`);
};

test('receive only adds stock', () => {
  ok({ kind: 'receive', lines: [{ item_id: 'green', qty: 100 }] });
  fails({ kind: 'receive', lines: [{ item_id: 'green', qty: -5 }] }, /can't remove/);
});

test('roast turns green into roasted', () => {
  ok({ kind: 'roast', lines: [{ item_id: 'green', qty: -100 }, { item_id: 'roasted', qty: 84 }] });
  fails({ kind: 'roast', lines: [{ item_id: 'bag', qty: -1 }, { item_id: 'roasted', qty: 1 }] }, /can't be used in a roast/);
  fails({ kind: 'roast', lines: [{ item_id: 'roasted', qty: 84 }] }, /needs at least one input/);
});

test('pack produces finished goods from coffee and packaging', () => {
  ok({ kind: 'pack', lines: [{ item_id: 'blend', qty: -9 }, { item_id: 'bag', qty: -12 }, { item_id: 'fg', qty: 12 }] });
  fails({ kind: 'pack', lines: [{ item_id: 'blend', qty: -9 }, { item_id: 'roasted', qty: 9 }] }, /can't be produced in a pack/);
});

test('ship only removes stock', () => {
  ok({ kind: 'ship', lines: [{ item_id: 'fg', qty: -24 }] });
  fails({ kind: 'ship', lines: [{ item_id: 'fg', qty: 1 }] }, /can't add/);
});

test('rejects bad lines', () => {
  fails({ kind: 'adjust', lines: [] }, /at least one line/);
  fails({ kind: 'adjust', lines: [{ item_id: 'nope', qty: 1 }] }, /pick an item/);
  fails({ kind: 'adjust', lines: [{ item_id: 'green', qty: 0 }] }, /non-zero/);
  fails({ kind: 'receive', lines: [{ item_id: 'old', qty: 1 }] }, /inactive/);
  fails({ kind: 'teleport', lines: [] }, /Unknown movement type/);
});

test('adjust may touch inactive items (to zero them out)', () => {
  ok({ kind: 'adjust', lines: [{ item_id: 'old', qty: -3 }] });
});
