// Sample data for local development only (APP_ENV=dev). Never runs in staging or production.
// Dev sign-ins (local only):
//   admin@example.test / dev-password-123   (admin)
//   floor@example.test / dev-password-123   (member)
import { hashPassword } from './auth.js';
import { createMovement } from './inventory.js';
import { insertItem } from './routes/items.js';

export const DEV_PASSWORD = 'dev-password-123';

export async function seedDev(db, config) {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM items');
  if (rows[0].n > 0) return;
  console.log('Seeding sample dev data…');

  await db.tx(async (t) => {
    const hash = await hashPassword(DEV_PASSWORD, config);
    const { rows: users } = await t.query(
      `INSERT INTO users (email, name, password_hash, role) VALUES
         ('admin@example.test', 'Dev Admin', $1, 'admin'),
         ('floor@example.test', 'Floor Lead', $1, 'member')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, name`,
      [hash],
    );
    const user = users[0];

    const ids = {};
    const item = async (key, fields) => (ids[key] = await insertItem(t, fields));
    const recipe = async (parent, parts) => {
      for (const [child, qty] of parts) {
        await t.query('INSERT INTO components (parent_item_id, component_item_id, qty_per_unit) VALUES ($1, $2, $3)', [
          ids[parent],
          ids[child],
          qty,
        ]);
      }
    };

    // Green coffee
    await item('g_bra', { code: 'GRN-BRA-CER', name: 'Brazil Cerrado Natural (green)', type: 'green', unit: 'lb', supplier: 'Importer A', reorder_point: 1000 });
    await item('g_col', { code: 'GRN-COL-HUI', name: 'Colombia Huila Washed (green)', type: 'green', unit: 'lb', supplier: 'Importer A', reorder_point: 800 });
    await item('g_eth', { code: 'GRN-ETH-YIR', name: 'Ethiopia Yirgacheffe Washed (green)', type: 'green', unit: 'lb', supplier: 'Importer B', reorder_point: 400 });
    await item('g_sum', { code: 'GRN-SUM-MAN', name: 'Sumatra Mandheling (green)', type: 'green', unit: 'lb', supplier: 'Importer B', reorder_point: 400 });

    // Roasted (about 16% roast loss -> 1.19 lb green per lb roasted)
    await item('r_bra', { code: 'RST-BRA', name: 'Brazil Cerrado (roasted)', type: 'roasted', unit: 'lb' });
    await item('r_col', { code: 'RST-COL', name: 'Colombia Huila (roasted)', type: 'roasted', unit: 'lb' });
    await item('r_eth', { code: 'RST-ETH', name: 'Ethiopia Yirgacheffe (roasted)', type: 'roasted', unit: 'lb' });
    await item('r_sum', { code: 'RST-SUM', name: 'Sumatra Mandheling (roasted)', type: 'roasted', unit: 'lb' });
    await recipe('r_bra', [['g_bra', 1.19]]);
    await recipe('r_col', [['g_col', 1.19]]);
    await recipe('r_eth', [['g_eth', 1.19]]);
    await recipe('r_sum', [['g_sum', 1.19]]);

    // Blends (fractions add up to 1 lb)
    await item('b_house', { code: 'BLD-HOUSE', name: 'House Blend', type: 'blend', unit: 'lb' });
    await item('b_esp', { code: 'BLD-ESP', name: 'Espresso Blend', type: 'blend', unit: 'lb' });
    await recipe('b_house', [['r_bra', 0.4], ['r_col', 0.4], ['r_eth', 0.2]]);
    await recipe('b_esp', [['r_bra', 0.6], ['r_sum', 0.4]]);

    // Packaging materials
    await item('p_bag12', { code: 'PKG-BAG-12OZ', name: '12 oz valve bag', type: 'packaging', unit: 'each', reorder_point: 2000 });
    await item('p_bag5', { code: 'PKG-BAG-5LB', name: '5 lb valve bag', type: 'packaging', unit: 'each', reorder_point: 300 });
    await item('p_lbl_h', { code: 'PKG-LBL-HOUSE', name: 'House Blend label', type: 'packaging', unit: 'each', reorder_point: 2000 });
    await item('p_lbl_e', { code: 'PKG-LBL-ESP', name: 'Espresso Blend label', type: 'packaging', unit: 'each', reorder_point: 2000 });
    await item('p_case12', { code: 'PKG-CASE-12', name: 'Shipper case (12 ct)', type: 'packaging', unit: 'each', reorder_point: 200 });

    // Finished goods
    await item('f_h12', { code: 'FG-HOUSE-12OZ-WB', name: 'House Blend 12 oz Whole Bean', type: 'finished', unit: 'each', pack_size_oz: 12, units_per_case: 12 });
    await item('f_h5', { code: 'FG-HOUSE-5LB-WB', name: 'House Blend 5 lb Whole Bean', type: 'finished', unit: 'each', pack_size_oz: 80, units_per_case: 1 });
    await item('f_e12', { code: 'FG-ESP-12OZ-WB', name: 'Espresso Blend 12 oz Whole Bean', type: 'finished', unit: 'each', pack_size_oz: 12, units_per_case: 12 });
    await recipe('f_h12', [['b_house', 0.75], ['p_bag12', 1], ['p_lbl_h', 1], ['p_case12', 1 / 12]]);
    await recipe('f_h5', [['b_house', 5], ['p_bag5', 1], ['p_lbl_h', 1]]);
    await recipe('f_e12', [['b_esp', 0.75], ['p_bag12', 1], ['p_lbl_e', 1], ['p_case12', 1 / 12]]);

    const { rows: machines } = await t.query(
      `INSERT INTO machines (name, kind) VALUES
         ('Roaster 1', 'roaster'), ('Packer A (12 oz)', 'packer'), ('Packer B (bulk)', 'packer')
       RETURNING id, name`,
    );
    const m = Object.fromEntries(machines.map((r) => [r.name, r.id]));
    const ago = (days) => new Date(Date.now() - days * 86400000);

    await createMovement(t, user, {
      kind: 'receive', occurred_at: ago(6), reference: 'PO-1041',
      lines: [
        { item_id: ids.g_bra, qty: 2640, lot_code: 'BRA-2611' },
        { item_id: ids.g_col, qty: 1540, lot_code: 'COL-2611' },
        { item_id: ids.g_eth, qty: 660, lot_code: 'ETH-2611' },
        { item_id: ids.g_sum, qty: 660, lot_code: 'SUM-2611' },
      ],
    });
    await createMovement(t, user, {
      kind: 'receive', occurred_at: ago(6), reference: 'PO-1042',
      lines: [
        { item_id: ids.p_bag12, qty: 5000 }, { item_id: ids.p_bag5, qty: 500 },
        { item_id: ids.p_lbl_h, qty: 4000 }, { item_id: ids.p_lbl_e, qty: 3000 },
        { item_id: ids.p_case12, qty: 400 },
      ],
    });
    const roast = (day, r, g, greenLbs, roastedLbs, lot) =>
      createMovement(t, user, {
        kind: 'roast', occurred_at: ago(day), machine_id: m['Roaster 1'],
        lines: [
          { item_id: ids[g], qty: -greenLbs, lot_code: lot },
          { item_id: ids[r], qty: roastedLbs, lot_code: `R-${lot}` },
        ],
      });
    await roast(4, 'r_bra', 'g_bra', 600, 506, 'BRA-2611');
    await roast(4, 'r_col', 'g_col', 480, 402, 'COL-2611');
    await roast(3, 'r_eth', 'g_eth', 240, 199, 'ETH-2611');
    await roast(3, 'r_sum', 'g_sum', 240, 203, 'SUM-2611');

    await createMovement(t, user, {
      kind: 'blend', occurred_at: ago(2),
      lines: [
        { item_id: ids.r_bra, qty: -240 }, { item_id: ids.r_col, qty: -240 }, { item_id: ids.r_eth, qty: -120 },
        { item_id: ids.b_house, qty: 600, lot_code: 'H-1' },
      ],
    });
    await createMovement(t, user, {
      kind: 'pack', occurred_at: ago(1), machine_id: m['Packer A (12 oz)'],
      lines: [
        { item_id: ids.b_house, qty: -360 }, { item_id: ids.p_bag12, qty: -480 },
        { item_id: ids.p_lbl_h, qty: -480 }, { item_id: ids.p_case12, qty: -40 },
        { item_id: ids.f_h12, qty: 480, lot_code: 'H-1' },
      ],
    });
  });
}
