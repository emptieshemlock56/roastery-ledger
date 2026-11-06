// What each kind of movement is allowed to do. Pure functions, easy to test.

export const ITEM_TYPES = ['green', 'roasted', 'blend', 'packaging', 'finished', 'other'];
export const KINDS = ['receive', 'roast', 'blend', 'pack', 'ship', 'adjust'];

// `adds`: item types a positive line (stock in) may use. `removes`: item types a
// negative line (stock out) may use. null = that direction isn't allowed at all.
export const RULES = {
  receive: { adds: ITEM_TYPES, removes: null },
  roast: { adds: ['roasted', 'blend'], removes: ['green', 'blend'] },
  blend: { adds: ['blend'], removes: ['green', 'roasted', 'blend'] },
  pack: { adds: ['finished'], removes: ['roasted', 'blend', 'green', 'packaging', 'other'] },
  ship: { adds: null, removes: ITEM_TYPES },
  adjust: { adds: ITEM_TYPES, removes: ITEM_TYPES },
};

// Kinds that turn inputs into outputs and therefore need both.
export const PRODUCTION_KINDS = ['roast', 'blend', 'pack'];

/**
 * @param {{kind: string, lines: {item_id: string, qty: number}[]}} movement
 * @param {Map<string, {name: string, type: string, active: boolean}>} itemsById
 * @returns {string[]} human-readable problems; empty means valid
 */
export function validateMovement({ kind, lines }, itemsById) {
  const rule = RULES[kind];
  if (!rule) return [`Unknown movement type "${kind}"`];
  if (!Array.isArray(lines) || lines.length === 0) return ['Add at least one line'];

  const errors = [];
  lines.forEach((line, i) => {
    const n = i + 1;
    const item = itemsById.get(line.item_id);
    if (!item) return errors.push(`Line ${n}: pick an item`);
    if (!Number.isFinite(line.qty) || line.qty === 0) return errors.push(`Line ${n}: quantity must be a non-zero number`);
    if (!item.active && kind !== 'adjust') return errors.push(`Line ${n}: ${item.name} is inactive`);

    const adding = line.qty > 0;
    const allowed = adding ? rule.adds : rule.removes;
    if (!allowed) {
      errors.push(`Line ${n}: a ${kind} can't ${adding ? 'add' : 'remove'} stock`);
    } else if (!allowed.includes(item.type)) {
      errors.push(`Line ${n}: ${item.name} (${item.type}) can't be ${adding ? 'produced' : 'used'} in a ${kind}`);
    }
  });

  if (PRODUCTION_KINDS.includes(kind) && errors.length === 0) {
    if (!lines.some((l) => l.qty > 0)) errors.push(`A ${kind} needs at least one output`);
    if (!lines.some((l) => l.qty < 0)) errors.push(`A ${kind} needs at least one input`);
  }
  return errors;
}
