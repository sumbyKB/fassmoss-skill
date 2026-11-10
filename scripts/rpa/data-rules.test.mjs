import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseAmount, findBrandIndex, BAG_CATEGORY, moduleLoaded } from './data-rules.mjs';

test('partial and failed modules remain incomplete while confirmed empty modules finish', () => {
  assert.equal(moduleLoaded('data', false, 3), false);
  assert.equal(moduleLoaded('blank', true, 3), false);
  assert.equal(moduleLoaded('empty', true, 1), false);
  assert.equal(moduleLoaded('empty', true, 2), true);
  assert.equal(moduleLoaded('data', true, 0), true);
});

test('all supported currency prefixes and Chinese units', () => {
  for (const prefix of ['S$', 'MX$', 'R$', 'RM', 'Rp', '$', '฿', '₫', '₱', '¥', '€', '£']) {
    assert.equal(parseAmount(prefix + '1,200.50'), 1200.5);
  }
  assert.equal(parseAmount('RM2.5万'), 25000);
  assert.equal(parseAmount('$1.2亿'), 120000000);
  for (const value of [null, '', '-', '123invalid', 'Infinity']) assert.equal(parseAmount(value), null);
});

test('brand exact match wins and ambiguous/empty names cannot select another shop', () => {
  const rows = [{ name: '' }, { name: 'ABC Outlet' }, { name: 'ABC' }];
  assert.equal(findBrandIndex(rows, 'ABC', x => x.name), 2);
  assert.throws(() => findBrandIndex(rows, 'AB', x => x.name), /歧义/);
  assert.throws(() => findBrandIndex(rows, 'ZZZ', x => x.name), /未找到/);
});

test('bag categories reject packaging and baggy clothing', () => {
  for (const text of ['包装材料', '收纳箱', 'baggy pants']) {
    assert.equal(BAG_CATEGORY.test(text), false);
  }
  for (const text of ['女士手拎包', 'Handbags', 'Backpack']) assert.equal(BAG_CATEGORY.test(text), true);
});

test('shop analysis reads shops.json consistently across repeated runs', t => {
  const dir = mkdtempSync(join(tmpdir(), 'fastmoss-regression-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'shops.json'), JSON.stringify({meta:{currency:'SGD'},shops:[{shop_name:'ABC',day7_gmv:'S$100',day7_units:'5'}]}));
  writeFileSync(join(dir, 'shops-z-old.json'), JSON.stringify({shops:[]}));
  const script = fileURLToPath(new URL('./analyze-shop.mjs', import.meta.url));
  const run = () => execFileSync(process.execPath,[script,'--dir',dir,'--brand','ABC']);
  run();
  const first = JSON.parse(readFileSync(join(dir,'shop-analysis.json'),'utf8'));
  run();
  const second = JSON.parse(readFileSync(join(dir,'shop-analysis.json'),'utf8'));
  assert.deepEqual(second,first);
  assert.equal(second.topShops[0].day7GmvN,100);
});
