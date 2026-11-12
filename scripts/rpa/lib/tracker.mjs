// 接口响应跟踪：持续监听页面自然发出的接口响应（接口有 MSG_SAFE_0001 签名，不能直接 fetch）。
// 各命令抓接口数据统一从这里复用。

/** 按请求发出时的代次隔离响应；params 只匹配本次任务的商品/页码/周期。 */
export function makeTracker(page, urlPart, params = {}) {
  const requests = new WeakMap();
  let generation = 0;
  let sequence = 0;
  let committed = 0;
  let latest = null;
  let latestUrl = null;
  let disposed = false;
  const matches = (address) => {
    const url = new URL(address);
    const path = urlPart.replace(/\?$/, '');
    return url.pathname === path && Object.entries(params).every(([key, value]) => url.searchParams.get(key) === String(value));
  };
  const onRequest = (request) => {
    if (!disposed && matches(request.url())) requests.set(request, { generation, sequence: ++sequence });
  };
  const onResponse = async (response) => {
    const ticket = requests.get(response.request());
    if (!ticket || disposed || ticket.generation !== generation || !response.ok()) return;
    try {
      const body = await response.text();
      if (disposed || ticket.generation !== generation || ticket.sequence < committed) return;
      latest = body;
      latestUrl = response.url();
      committed = ticket.sequence;
    } catch { /* 导航取消的响应不属于可用数据 */ }
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  return {
    get: () => latest,
    url: () => latestUrl,
    reset: (nextParams = params) => { generation++; params = nextParams; latest = null; latestUrl = null; committed = 0; },
    dispose: () => { disposed = true; generation++; page.off('request', onRequest); page.off('response', onResponse); },
  };
}

/** 持续跟踪多个接口，按 key 读取。urlParts 为 { key: url片段 }。 */
export function makeMultiTracker(page, urlParts) {
  const trackers = Object.fromEntries(Object.entries(urlParts).map(([key, part]) => [key, makeTracker(page, part)]));
  return {
    get: (key) => trackers[key]?.get(),
    has: (key) => !!trackers[key]?.get(),
    dispose: () => Object.values(trackers).forEach(tracker => tracker.dispose()),
  };
}

/** 等 tracker 拿到满足条件的响应（condition 返回 true 即停） */
export async function waitTracked(tracker, condition, { timeout = 15000, interval = 200, check } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check) await check();
    const v = tracker.get();
    if (v && condition(v)) return v;
    await new Promise((r) => setTimeout(r, interval));
  }
  return null;
}
