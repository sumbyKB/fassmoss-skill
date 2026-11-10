// 并发执行池：通用并发 + 带页面复用的并发。

/** 通用并发池：按 limit 个 worker 并行消费 items，结果按原索引返回。 */
export async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * 带页面复用的并发池：每个 worker 只开一个 tab，串行处理自己的队列。
 * 复用同一个 tab 能吃到 SPA 的 JS/HTTP 缓存，实测 1.5s/页；
 * 若每页都 newPage，冷启动要 4.5s+。
 */
export async function poolWithPage(context, items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async (_, wi) => {
    const page = await context.newPage();
    try {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await worker(page, items[i], i, wi);
      }
    } finally {
      await page.close().catch(() => {});
    }
  });
  await Promise.all(runners);
  return out;
}
