// 命令行参数解析与日志输出。

/** 时间戳日志：`[HH:MM:SS] message` */
export const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

/**
 * 解析命令行参数为 opts 对象。第一个位置参数为命令名（cmd），
 * 其余 `--key value` / `--key=value` 转为字段，位置参数收集到 opts._。
 * 对 pages/concurrency/detail-concurrency/top 做正整数校验，headed 做布尔校验。
 */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { cmd };
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split(/=(.*)/s);
      if (inline !== undefined) { opts[k] = inline; continue; }
      const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
      opts[k] = v;
    } else {
      positional.push(a);
    }
  }
  if (positional.length) opts._ = positional;
  for (const key of ['pages', 'concurrency', 'detail-concurrency', 'top']) {
    if (opts[key] !== undefined && (!/^\d+$/.test(String(opts[key])) || Number(opts[key]) < 1 || !Number.isSafeInteger(Number(opts[key])))) {
      throw new Error('--' + key + ' 必须为正整数');
    }
  }
  if (opts.headed !== undefined && ![true, 'true', 'false'].includes(opts.headed)) throw new Error('--headed 只接受 true 或 false');
  return opts;
}
