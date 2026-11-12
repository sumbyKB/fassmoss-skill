import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./fastmoss-rpa.mjs', import.meta.url));
const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000 });

test('both CLI argument forms accept valid values', () => {
  for (const args of [['help', '--pages', '2', '--headed', 'false'], ['help', '--pages=2', '--headed=false']]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('invalid counts and booleans fail before browser launch', () => {
  for (const args of [['--concurrency','0'], ['--pages','-1'], ['--pages','abc'], ['--top','1.5'], ['--headed','maybe']]) {
    const result = run(['search', ...args]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /必须为正整数|只接受/);
    assert.doesNotMatch(result.stderr, /playwright|browserType|launchPersistentContext/);
  }
});

test('invalid product ROI requests fail before browser launch', () => {
  for (const args of [['--ids', '123', '--period', '30'], ['--ids', '123', '--keyword', 'earbuds'], ['--ids', '123', '--start', '2026-10-01']]) {
    const result = run(['product-roi', ...args]);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /playwright|browserType|launchPersistentContext/);
    assert.match(result.stderr, /只支持|请指定一项|不支持自定义日期/);
  }
});

test('invalid shop comparison periods and price filters fail before browser launch', () => {
  for (const args of [
    ['shop-trend', '--shop-id', '123', '--days', '60'],
    ['shop-trend', '--shop-id', '123', '--days', '1.5'],
    ['shop-compare', '--category-id2', '123', '--min-price', 'abc'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /1到45|非负金额/);
    assert.doesNotMatch(result.stderr, /playwright|browserType|launchPersistentContext/);
  }
});
