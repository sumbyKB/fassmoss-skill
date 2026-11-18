import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserLaunchOptions } from './lib/runtime.mjs';
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

test('collection uses the project Chrome window', () => {
  assert.equal(browserLaunchOptions().headless, false);
  assert.equal(browserLaunchOptions().channel, 'chrome');
});

test('shop detail report uses input currency and preserves missing data', () => {
  const { report, summary } = analyzeShopDetail({ meta: { currency: 'USD' }, detail: { products: [] } });
  assert.match(report, /价格带\(USD\)/);
  assert.match(report, /未采集到商品明细/);
  assert.equal(summary.totalGmv, '—');
  assert.doesNotMatch(report, /近28天无动销商品/);
});
