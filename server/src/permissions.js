// What a role can be allowed to change. Everyone can view everything; these are
// only the WRITE abilities. The first six match the movement kinds in rules.js.
export const PERMISSIONS = [
  { key: 'receive', group: 'Record entries', label: 'Receive deliveries', help: 'Green coffee, packaging and other purchases coming in.' },
  { key: 'roast', group: 'Record entries', label: 'Roast', help: 'Green coffee in, roasted coffee out.' },
  { key: 'blend', group: 'Record entries', label: 'Blend', help: 'Combine coffees into a blend.' },
  { key: 'pack', group: 'Record entries', label: 'Pack', help: 'Packing runs and finished goods.' },
  { key: 'ship', group: 'Record entries', label: 'Ship', help: 'Product leaving the building.' },
  { key: 'adjust', group: 'Record entries', label: 'Adjust and stock counts', help: 'Corrections, write-offs and physical counts.' },
  { key: 'void', group: 'Fix mistakes', label: 'Void entries', help: 'Cross out a mistaken entry. Only works on kinds of entry the person can also record.' },
  { key: 'catalog', group: 'Catalog', label: 'Edit items, recipes and machines', help: 'Changes recipes and names that everyone relies on.' },
  { key: 'import', group: 'Catalog', label: 'Import from a spreadsheet', help: 'Bulk-create or update items and set stock counts.' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
const LABELS = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label]));
export const permissionLabel = (key) => LABELS[key] ?? key;

/** Returns a clean, de-duplicated list in catalog order, or throws a message for the first bad key. */
export function cleanPermissions(list) {
  if (!Array.isArray(list)) throw new Error('permissions must be a list');
  const bad = list.find((k) => !PERMISSION_KEYS.includes(k));
  if (bad !== undefined) throw new Error(`Unknown permission "${bad}"`);
  return PERMISSION_KEYS.filter((k) => list.includes(k));
}
