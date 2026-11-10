// 全局配置：路径常量、FastMoss 站点与币种映射。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 技能根目录（scripts/rpa/lib → 技能根） */
export const SKILL_ROOT = path.resolve(__dirname, '../../..');

/** FastMoss 站点基础 URL */
export const BASE = 'https://www.fastmoss.com/zh';
/** 浏览器登录态持久化目录 */
export const PROFILE_DIR = path.join(SKILL_ROOT, '.browser-profile');

/**
 * 国家站点映射：`--country` 的值 → 页面右上角国家切换按钮的显示文本 + 该站币种。
 * 国家切换是「点右上角国家按钮 → 弹层里点国家名」，选择结果持久化到登录态（profile），
 * URL 上不带 country 参数，所以每次抓取前都要显式切换一次（幂等）。
 * 币种：美国/英/德/法/西/意 = USD；泰国 = THB；印尼 = IDR；越南 = VND；马来 = MYR；日本 = JPY；新加坡 = SGD；菲律宾 = PHP；墨西哥 = MXN；巴西 = BRL。
 */
export const COUNTRIES = {
  '美国':       { label: '美国',       currency: 'USD' },
  'us':         { label: '美国',       currency: 'USD' },
  'usa':        { label: '美国',       currency: 'USD' },
  'united states': { label: '美国',    currency: 'USD' },
  '泰国':       { label: '泰国',       currency: 'THB' },
  'th':         { label: '泰国',       currency: 'THB' },
  'thailand':   { label: '泰国',       currency: 'THB' },
  '印尼':       { label: '印尼',       currency: 'IDR' },
  '印度尼西亚': { label: '印尼',       currency: 'IDR' },
  'indonesia':  { label: '印尼',       currency: 'IDR' },
  '越南':       { label: '越南',       currency: 'VND' },
  'vietnam':    { label: '越南',       currency: 'VND' },
  '马来西亚':   { label: '马来西亚',   currency: 'MYR' },
  'malaysia':   { label: '马来西亚',   currency: 'MYR' },
  '菲律宾':     { label: '菲律宾',     currency: 'PHP' },
  'philippines':{ label: '菲律宾',     currency: 'PHP' },
  '日本':       { label: '日本',       currency: 'JPY' },
  'japan':      { label: '日本',       currency: 'JPY' },
  '新加坡':     { label: '新加坡',     currency: 'SGD' },
  'singapore':  { label: '新加坡',     currency: 'SGD' },
  '英国':       { label: '英国',       currency: 'USD' },
  'uk':         { label: '英国',       currency: 'USD' },
  '德国':       { label: '德国',       currency: 'USD' },
  'germany':    { label: '德国',       currency: 'USD' },
  '法国':       { label: '法国',       currency: 'USD' },
  'france':     { label: '法国',       currency: 'USD' },
  '西班牙':     { label: '西班牙',     currency: 'USD' },
  'spain':      { label: '西班牙',     currency: 'USD' },
  '意大利':     { label: '意大利',     currency: 'USD' },
  'italy':      { label: '意大利',     currency: 'USD' },
  '墨西哥':     { label: '墨西哥',     currency: 'MXN' },
  'mexico':     { label: '墨西哥',     currency: 'MXN' },
  '巴西':       { label: '巴西',       currency: 'BRL' },
  'brazil':     { label: '巴西',       currency: 'BRL' },
};

/** 去重后的国家按钮显示文本，供 switchCountry 等识别右上角国家按钮 */
export const COUNTRY_LABELS = [...new Set(Object.values(COUNTRIES).map((c) => c.label))];

/** 国家按钮显示文本 → URL region 参数（商品榜等需要 region 时用） */
export const REGION_BY_LABEL = {
  '美国': 'US', '泰国': 'TH', '印尼': 'ID', '越南': 'VN', '马来西亚': 'MY', '菲律宾': 'PH',
  '日本': 'JP', '新加坡': 'SG', '英国': 'GB', '德国': 'DE', '法国': 'FR', '西班牙': 'ES',
  '意大利': 'IT', '墨西哥': 'MX', '巴西': 'BR',
};

/** 解析 --country：接受中文名或英文名/ISO 代码，返回 {label, currency} */
export function resolveCountry(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  if (COUNTRIES[key]) return COUNTRIES[key];
  // 兜底：中文名直接查
  for (const [k, v] of Object.entries(COUNTRIES)) {
    if (k === String(raw).trim()) return v;
  }
  throw new Error(
    `未知国家「${raw}」。支持：美国(us)、泰国(th)、印尼、越南、马来西亚、菲律宾、日本、新加坡、英国、德国、法国、西班牙、意大利、墨西哥、巴西。`
  );
}
