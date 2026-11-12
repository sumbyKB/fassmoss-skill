import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { analyzeShopDetail } from './analyze-shop-detail.mjs';
import { COMMAND_NAMES, HANDLERS, main } from './fastmoss-rpa.mjs';
import { activeContexts } from './lib/browser.mjs';

test('every command finishes or fails before its browser contexts close', async () => {
  assert.ok(COMMAND_NAMES.length >= 15);
  for (const command of COMMAND_NAMES) {
    const original = HANDLERS[command];
    for (const fail of [false, true]) {
      const events = [];
      let release;
      const pending = new Promise(resolve => { release = resolve; });
      const context = { close: async () => { events.push('closed'); activeContexts.delete(context); } };
      HANDLERS[command] = async () => {
        activeContexts.add(context);
        await pending;
        events.push('finished');
        if (fail) throw new Error('expected command failure');
        return 42;
      };
      try {
        const task = main([command]);
        await Promise.resolve();
        assert.deepEqual(events, [], command);
        release();
        if (fail) await assert.rejects(task, /expected command failure/);
        else assert.equal(await task, 42);
        assert.deepEqual(events, ['finished', 'closed'], command);
      } finally { release(); HANDLERS[command] = original; activeContexts.delete(context); }
    }
  }
});

test('every command module requires an explicit headed opt-in', () => {
  const dir = new URL('./commands/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  let calls = 0;
  for (const f of files) {
    const source = readFileSync(new URL('./commands/' + f, import.meta.url), 'utf8');
    const matches = [...source.matchAll(/await openBrowser\(\{([^}]+)\}\)/g)];
    calls += matches.length;
    for (const [, args] of matches) assert.match(args, /headed: opts\.headed === true \|\| opts\.headed === 'true'/, f);
  }
  assert.ok(calls >= 10, `openBrowser 调用数不足：${calls}`);
  const launcher = readFileSync(new URL('./run-background.mjs', import.meta.url), 'utf8');
  assert.match(launcher, /COMMAND_NAMES/);
  assert.match(launcher, /'--headed', 'false'/);
});

test('shop detail report uses input currency and preserves missing data', () => {
  const { report, summary } = analyzeShopDetail({ meta: { currency: 'USD' }, detail: { products: [] } });
  assert.match(report, /价格带\(USD\)/);
  assert.match(report, /未采集到商品明细/);
  assert.equal(summary.totalGmv, '—');
  assert.doesNotMatch(report, /近28天无动销商品/);
});
