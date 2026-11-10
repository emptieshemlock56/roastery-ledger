// Realistic fake data for practice copies (local dev and staging, never production).
// Builds a catalog with "DEMO-" item codes, then simulates ~60 days of a roastery:
// green deliveries, roasting, blending, packing on two packers, shipping, the odd
// damaged bag or QC sample, and one voided mistake. Stock never goes negative.
// Everything goes through createMovement, so it follows the same rules as real entries.
import { createMovement } from './inventory.js';
import { insertItem } from './routes/items.js';

export const SAMPLE_PREFIX = 'DEMO-';
const SAMPLE_MACHINE_SUFFIX = ' (sample)';
export const SAMPLE_ALLOWED_ENVS = new Set(['dev', 'test', 'staging']);

// Small deterministic random generator, so every load looks the same.
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
  };
}

const GREENS = [
  ['bra', 'Brazil Cerrado Natural', 'Importer A', 1000],
  ['col', 'Colombia Huila Washed', 'Importer A', 800],
  ['eth', 'Ethiopia Yirgacheffe Washed', 'Importer B', 400],
  ['sum', 'Sumatra Mandheling', 'Importer B', 400],
  ['gua', 'Guatemala Huehuetenango', 'Importer A', 500],
  ['ken', 'Kenya Nyeri AA', 'Importer B', 300],
  ['dec', 'Colombia Decaf (Swiss Water)', 'Importer A', 250],
];
const BLENDS = {
  house: ['House Blend', [['bra', 0.4], ['col', 0.4], ['eth', 0.2]]],
  esp: ['Espresso Blend', [['bra', 0.6], ['sum', 0.4]]],
  bkf: ['Breakfast Blend', [['col', 0.5], ['gua', 0.5]]],
};
// [key, name, source (blend key or roasted key), size: '12oz' | '5lb', label key, target stock]
const FINISHED = [
  ['house12', 'House Blend 12 oz Whole Bean', 'b:house', '12oz', 'house', 600],
  ['house5', 'House Blend 5 lb Whole Bean', 'b:house', '5lb', 'house', 60],
  ['esp12', 'Espresso Blend 12 oz Whole Bean', 'b:esp', '12oz', 'esp', 400],
  ['esp5', 'Espresso Blend 5 lb Whole Bean', 'b:esp', '5lb', 'esp', 80],
  ['bkf12', 'Breakfast Blend 12 oz Whole Bean', 'b:bkf', '12oz', 'bkf', 300],
  ['eth12', 'Ethiopia Yirgacheffe 12 oz Whole Bean', 'r:eth', '12oz', 'origin', 200],
  ['ken12', 'Kenya Nyeri AA 12 oz Whole Bean', 'r:ken', '12oz', 'origin', 120],
  ['dec12', 'Colombia Decaf 12 oz Whole Bean', 'r:dec', '12oz', 'decaf', 120],
];
const SIZES = { '12oz': { lb: 0.75, oz: 12, perCase: 12, bag: 'bag12', machine: 'packA' }, '5lb': { lb: 5, oz: 80, perCase: 1, bag: 'bag5', machine: 'packB' } };
const PACKAGING = [
  ['bag12', '12 oz valve bag', 2000, 6000],
  ['bag5', '5 lb valve bag', 300, 800],
  ['lbl_house', 'House Blend label', 1500, 4000],
  ['lbl_esp', 'Espresso Blend label', 1200, 3000],
  ['lbl_bkf', 'Breakfast Blend label', 800, 2500],
  ['lbl_origin', 'Single Origin label', 800, 2500],
  ['lbl_decaf', 'Decaf label', 400, 1500],
  ['case12', 'Shipper case (12 ct)', 200, 600],
];
const YIELD = 1 / 1.19; // ~16% weight lost in roasting

export async function hasSampleData(q) {
  const { rows } = await q.query('SELECT 1 FROM items WHERE code LIKE $1 LIMIT 1', [`${SAMPLE_PREFIX}%`]);
  return rows.length > 0;
}

/** Loads the sample catalog and `days` of history. Returns counts. Caller runs it in a transaction. */
export async function loadSampleData(q, user, { days = 60, seed = 2611, now = new Date() } = {}) {
  const r = rng(seed);
  const ids = {};
  const meta = {};
  const stock = new Map(); // item id -> on hand (only sample items)
  const lots = new Map(); // item id -> latest lot code
  const counts = { items: 0, machines: 0, movements: 0, voided: 0 };
  const code = (s) => `${SAMPLE_PREFIX}${s}`;

  const item = async (key, fields) => {
    ids[key] = await insertItem(q, { ...fields, code: code(fields.code), notes: 'Sample data' });
    meta[key] = fields;
    stock.set(ids[key], 0);
    counts.items++;
  };
  const recipe = async (parent, parts) => {
    for (const [child, qty] of parts) {
      await q.query('INSERT INTO components (parent_item_id, component_item_id, qty_per_unit) VALUES ($1, $2, $3)', [ids[parent], ids[child], qty]);
    }
  };

  // ---- catalog ---------------------------------------------------------------
  for (const [k, name, supplier, reorder] of GREENS) {
    await item(`g_${k}`, { code: `GRN-${k.toUpperCase()}`, name: `${name} (green)`, type: 'green', unit: 'lb', supplier, reorder_point: reorder });
  }
  for (const [k, name] of GREENS) {
    await item(`r_${k}`, { code: `RST-${k.toUpperCase()}`, name: `${name} (roasted)`, type: 'roasted', unit: 'lb', reorder_point: 100 });
    await recipe(`r_${k}`, [[`g_${k}`, 1.19]]);
  }
  for (const [k, [name, parts]] of Object.entries(BLENDS)) {
    await item(`b_${k}`, { code: `BLD-${k.toUpperCase()}`, name, type: 'blend', unit: 'lb', reorder_point: 150 });
    await recipe(`b_${k}`, parts.map(([g, f]) => [`r_${g}`, f]));
  }
  for (const [k, name, reorder] of PACKAGING) {
    await item(`p_${k}`, { code: `PKG-${k.toUpperCase().replace('_', '-')}`, name, type: 'packaging', unit: 'each', supplier: 'Packaging Co', reorder_point: reorder });
  }
  for (const [k, name, source, size, label, target] of FINISHED) {
    const s = SIZES[size];
    await item(`f_${k}`, {
      code: `FG-${k.toUpperCase()}`, name, type: 'finished', unit: 'each',
      pack_size_oz: s.oz, units_per_case: s.perCase, reorder_point: Math.round(target / 3),
    });
    const coffee = source.startsWith('b:') ? `b_${source.slice(2)}` : `r_${source.slice(2)}`;
    const parts = [[coffee, s.lb], [`p_${s.bag}`, 1], [`p_lbl_${label}`, 1]];
    if (s.perCase > 1) parts.push(['p_case12', 1 / s.perCase]);
    await recipe(`f_${k}`, parts);
  }

  const machine = {};
  for (const [k, name, kind] of [
    ['roast1', 'Roaster 1 (60 kg)', 'roaster'],
    ['roast2', 'Roaster 2 (15 kg)', 'roaster'],
    ['packA', 'Packer A (12 oz)', 'packer'],
    ['packB', 'Packer B (bulk)', 'packer'],
  ]) {
    const { rows } = await q.query(
      'INSERT INTO machines (name, kind, notes) VALUES ($1, $2, $3) RETURNING id',
      [name + SAMPLE_MACHINE_SUFFIX, kind, 'Sample data'],
    );
    machine[k] = rows[0].id;
    counts.machines++;
  }

  // ---- history ---------------------------------------------------------------
  const at = (dayIndex, hour) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - (days - dayIndex));
    d.setUTCHours(hour, r.int(0, 59), 0, 0);
    return d;
  };
  const have = (key) => stock.get(ids[key]) ?? 0;
  const move = async (input) => {
    const res = await createMovement(q, user, input);
    for (const l of input.lines) stock.set(l.item_id, (stock.get(l.item_id) ?? 0) + l.qty);
    counts.movements++;
    return res;
  };
  const line = (key, qty, lot) => ({ item_id: ids[key], qty: Math.round(qty * 100) / 100, lot_code: lot ?? lots.get(ids[key]) ?? null });

  let po = 2100;
  let so = 5400;
  let lotSeq = 1;
  const receiveGreens = async (day, keys, big) => {
    const lines = keys.map((k) => {
      const lot = `${k.toUpperCase()}-${String(lotSeq++).padStart(3, '0')}`;
      lots.set(ids[`g_${k}`], lot);
      const bags = big ? r.int(12, 40) : r.int(6, 18); // 60 kg (132 lb) bags
      return line(`g_${k}`, bags * 132, lot);
    });
    await move({ kind: 'receive', occurred_at: at(day, 15), reference: `PO-${po++}`, notes: 'Green coffee delivery', lines });
  };
  const receivePackaging = async (day, keys) => {
    const lines = keys.map((k) => line(`p_${k}`, PACKAGING.find((p) => p[0] === k)[3]));
    await move({ kind: 'receive', occurred_at: at(day, 14), reference: `PO-${po++}`, notes: 'Packaging delivery', lines });
  };

  // Day 0: opening stock.
  await receiveGreens(0, GREENS.map((g) => g[0]), true);
  await receivePackaging(0, PACKAGING.map((p) => p[0]));

  const roastTarget = (k) => (['bra', 'col'].includes(k) ? 500 : 220);
  const blendTarget = 350;
  let voidedOne = false;

  for (let day = 1; day <= days; day++) {
    const weekday = at(day, 12).getUTCDay(); // 0 = Sunday
    if (weekday === 0 || weekday === 6) continue;

    // Deliveries: greens every other Tuesday, packaging when low.
    if (weekday === 2 && day % 14 < 7) {
      const low = GREENS.map((g) => g[0]).filter((k) => have(`g_${k}`) < meta[`g_${k}`].reorder_point * 1.5);
      if (low.length) await receiveGreens(day, low, false);
    }
    const lowPkg = PACKAGING.filter(([k, , reorder]) => have(`p_${k}`) < reorder).map((p) => p[0]);
    if (lowPkg.length) await receivePackaging(day, lowPkg);

    // Roasting: 2-4 batches, the roasted coffees furthest below target first.
    const needs = GREENS.map((g) => g[0])
      .map((k) => ({ k, gap: roastTarget(k) - have(`r_${k}`) }))
      .filter((n) => n.gap > 0)
      .sort((a, b) => b.gap - a.gap);
    for (const { k } of needs.slice(0, r.int(2, 4))) {
      const big = ['bra', 'col', 'sum'].includes(k);
      const green = Math.min(big ? r.int(220, 290) : r.int(60, 120), have(`g_${k}`));
      if (green < 40) continue;
      const out = green * YIELD * (0.98 + r.next() * 0.04);
      const lot = `R${String(day).padStart(2, '0')}-${k.toUpperCase()}`;
      lots.set(ids[`r_${k}`], lot);
      await move({
        kind: 'roast', occurred_at: at(day, r.int(6, 11)), machine_id: big ? machine.roast1 : machine.roast2,
        reference: `Batch ${lot}`,
        lines: [line(`g_${k}`, -green), line(`r_${k}`, out, lot)],
      });
    }

    // Blending (Mon/Wed/Fri), when the blend is low and components are on hand.
    if ([1, 3, 5].includes(weekday)) {
      for (const [k, [, parts]] of Object.entries(BLENDS)) {
        if (have(`b_${k}`) > blendTarget * 0.6) continue;
        const possible = Math.min(...parts.map(([g, f]) => have(`r_${g}`) / f));
        const lbs = Math.floor(Math.min(r.int(200, 400), possible) / 10) * 10;
        if (lbs < 100) continue;
        const lot = `B${String(day).padStart(2, '0')}-${k.toUpperCase()}`;
        lots.set(ids[`b_${k}`], lot);
        await move({
          kind: 'blend', occurred_at: at(day, 12),
          lines: [...parts.map(([g, f]) => line(`r_${g}`, -lbs * f)), line(`b_${k}`, lbs, lot)],
        });
      }
    }

    // Packing: products furthest below target, limited by coffee and packaging on hand.
    const toPack = FINISHED.map((f) => ({ f, gap: f[5] - have(`f_${f[0]}`) }))
      .filter((p) => p.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, r.int(1, 3));
    for (const { f: [k, , source, size, label], gap } of toPack) {
      const s = SIZES[size];
      const coffee = source.startsWith('b:') ? `b_${source.slice(2)}` : `r_${source.slice(2)}`;
      let units = Math.min(
        gap + r.int(0, s.perCase * 6),
        Math.floor(have(coffee) / s.lb),
        have(`p_${s.bag}`),
        have(`p_lbl_${label}`),
        s.perCase > 1 ? have('p_case12') * s.perCase : Infinity,
      );
      units = Math.floor(units / s.perCase) * s.perCase; // full cases only
      if (units < s.perCase * 2) continue;
      const lines = [line(coffee, -units * s.lb), line(`p_${s.bag}`, -units), line(`p_lbl_${label}`, -units)];
      if (s.perCase > 1) lines.push(line('p_case12', -units / s.perCase));
      lines.push(line(`f_${k}`, units, lots.get(ids[coffee]) ?? null));
      lots.set(ids[`f_${k}`], lots.get(ids[coffee]) ?? null);
      await move({ kind: 'pack', occurred_at: at(day, r.int(12, 15)), machine_id: machine[s.machine], lines });
    }

    // Shipping: 1-4 customer orders of a few cases each.
    for (let o = r.int(1, 4); o > 0; o--) {
      const lines = [];
      for (const [k, , , size] of FINISHED) {
        if (!r.chance(0.35)) continue;
        const per = SIZES[size].perCase;
        const qty = Math.min(r.int(1, size === '5lb' ? 4 : 5) * per, Math.floor(have(`f_${k}`) / per) * per);
        if (qty > 0) lines.push(line(`f_${k}`, -qty));
      }
      if (!lines.length) continue;
      await move({ kind: 'ship', occurred_at: at(day, r.int(14, 17)), reference: `SO-${so++}`, lines });

      // Once: an order entered twice by mistake, then voided.
      if (!voidedOne && day > days / 2) {
        voidedOne = true;
        const dup = await move({ kind: 'ship', occurred_at: at(day, 17), reference: `SO-${so - 1}`, notes: 'Entered twice', lines });
        await q.query('UPDATE movements SET voided_at = $2, voided_by = $3, void_reason = $4 WHERE id = $1', [
          dup.id,
          at(day, 17),
          user.id,
          'Duplicate of the order above',
        ]);
        for (const l of lines) stock.set(l.item_id, stock.get(l.item_id) - l.qty);
        counts.voided++;
      }
    }

    // Now and then: a damaged bag or a QC sample.
    if (r.chance(0.12)) {
      const f = r.pick(FINISHED.filter(([key]) => have(`f_${key}`) >= 2));
      const k = f?.[0];
      if (k) await move({ kind: 'adjust', occurred_at: at(day, 16), notes: 'Damaged in warehouse', lines: [line(`f_${k}`, -r.int(1, 2))] });
    }
    if (r.chance(0.2)) {
      const k = r.pick(GREENS.map((g) => g[0]).filter((key) => have(`r_${key}`) >= 2));
      if (k) await move({ kind: 'adjust', occurred_at: at(day, 10), notes: 'QC cupping sample', lines: [line(`r_${k}`, -0.5)] });
    }
  }
  return counts;
}

/**
 * Removes the sample catalog and every entry that only touches sample items.
 * Practice entries mixing sample and real items are kept, and those items are deactivated instead.
 */
export async function removeSampleData(q) {
  const like = `${SAMPLE_PREFIX}%`;
  const del = await q.query(
    `DELETE FROM movements m
      WHERE NOT EXISTS (
        SELECT 1 FROM movement_lines l JOIN items i ON i.id = l.item_id
         WHERE l.movement_id = m.id AND i.code NOT LIKE $1)
        AND EXISTS (SELECT 1 FROM movement_lines l WHERE l.movement_id = m.id)`,
    [like],
  );
  await q.query(
    `DELETE FROM components WHERE parent_item_id IN (SELECT id FROM items WHERE code LIKE $1)
        OR component_item_id IN (SELECT id FROM items WHERE code LIKE $1)`,
    [like],
  );
  const items = await q.query(
    `DELETE FROM items i WHERE code LIKE $1 AND NOT EXISTS (SELECT 1 FROM movement_lines l WHERE l.item_id = i.id) RETURNING id`,
    [like],
  );
  const kept = await q.query('UPDATE items SET active = FALSE WHERE code LIKE $1 RETURNING id', [like]);
  const machines = await q.query(
    `DELETE FROM machines mc WHERE name LIKE $1 AND NOT EXISTS (SELECT 1 FROM movements m WHERE m.machine_id = mc.id) RETURNING id`,
    [`%${SAMPLE_MACHINE_SUFFIX}`],
  );
  return { movements: del.rowCount, items: items.rowCount, items_deactivated: kept.rowCount, machines: machines.rowCount };
}
