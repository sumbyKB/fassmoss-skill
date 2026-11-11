// 接口响应跟踪：持续监听页面自然发出的接口响应（接口有 MSG_SAFE_0001 签名，不能直接 fetch）。
// 各命令抓接口数据统一从这里复用。

/** 持续跟踪单个接口的响应，返回读取/重置/清理方法 */
export function makeTracker(page, urlPart) {
  let latest = null;
  const onRes = async (res) => { if (res.url().includes(urlPart)) { try { latest = await res.text(); } catch (e) { /* 导航清理，忽略 */ } } };
  page.on('response', onRes);
  return {
    get: () => latest,
    reset: () => { latest = null; },
    dispose: () => page.off('response', onRes),
  };
}

/** 持续跟踪多个接口，按 key 读取。urlParts 为 { key: url片段 }。 */
export function makeMultiTracker(page, urlParts) {
  const captured = {};
  const onRes = async (res) => {
    for (const [key, part] of Object.entries(urlParts)) {
      if (captured[key]) continue;
      if (res.url().includes(part)) { try { captured[key] = await res.text(); } catch (e) { /* 导航清理 */ } }
    }
  };
  page.on('response', onRes);
  return {
    get: (k) => captured[k],
    has: (k) => !!captured[k],
    dispose: () => page.off('response', onRes),
  };
}

/** 等 tracker 拿到满足条件的响应（condition 返回 true 即停） */
export async function waitTracked(tracker, condition, { timeout = 15000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const v = tracker.get();
    if (v && condition(v)) return v;
    await new Promise((r) => setTimeout(r, interval));
  }
  return null;
}
