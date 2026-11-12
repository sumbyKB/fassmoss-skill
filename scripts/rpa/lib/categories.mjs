// 分类树匹配：把「跑步鞋/耳机/手机壳」这类业务用词映射到 FastMoss 分类 ID（一级/二级/三级）。
import fs from 'node:fs';
import path from 'node:path';
import { SKILL_ROOT } from './config.mjs';

/** 业务用词 → 分类树标准名的同义词映射（大白话 → 平台分类名，用于一/二级） */
export const CATEGORY_ALIASES = {
  '跑步鞋': '运动鞋', '跑鞋': '运动鞋', '运动鞋': '运动鞋',
  '护肤品': '美容护肤', '护肤': '美容护肤', '化妆品': '美妆', '美妆': '美妆',
  '衣服': '女装与女士内衣', '服装': '女装与女士内衣', '女装': '女装与女士内衣',
  '包包': '箱包', '箱包': '箱包', '手袋': '箱包', '包': '箱包',
  '鞋子': '鞋靴', '鞋': '鞋靴', '鞋靴': '鞋靴',
  '手机': '手机与数码', '数码': '手机与数码',
  '家居': '居家日用', '日用': '居家日用', '居家': '居家日用',
  '食品': '食品饮料', '零食': '食品饮料',
  '男装': '男装与男士内衣',
  '玩具': '玩具和爱好',
  '宠物': '宠物用品',
  '母婴': '母婴用品',
  '家电': '家电',
  '家具': '家具',
  '珠宝': '珠宝与衍生品',
  '汽车': '汽车与摩托车',
};

/**
 * 三级分类别名表（大白话 → 一/二/三级 ID）。
 * 完整三级树由 categories 命令采集；以下仅保留已核验名称的无缓存兜底。
 * 需在 FastMoss 页面「商品分类」弹层里选到三级后读 URL 的 `l3_cid`，登记到这里。
 * 新增三级：在页面选中三级 → 看地址栏 `l3_cid=xxxxx` → 加一行。
 */
export const L3_ALIASES = {
  '手机壳':       { l1_cid: '16', l2_cid: '909064', l3_cid: '601925', matched: '保护壳、屏幕保护膜、皮肤' },
  '手机保护壳':   { l1_cid: '16', l2_cid: '909064', l3_cid: '601925', matched: '保护壳、屏幕保护膜、皮肤' },
  '保护壳':       { l1_cid: '16', l2_cid: '909064', l3_cid: '601925', matched: '保护壳、屏幕保护膜、皮肤' },
  '保护壳、屏幕保护膜、皮肤': { l1_cid: '16', l2_cid: '909064', l3_cid: '601925', matched: '保护壳、屏幕保护膜、皮肤' },
};

/** 各商品榜共享分类参数校验；显式ID不被名称静默覆盖。 */
export function resolveCategoryOptions(opts) {
  let categoryId = opts['category-id'] ?? opts.cid ?? null;
  let categoryId2 = opts['category-id2'] ?? null;
  let categoryId3 = opts['category-id3'] ?? opts['l3-cid'] ?? null;
  for (const value of [categoryId, categoryId2, categoryId3]) {
    if (value !== null && !/^\d+$/.test(String(value))) throw new Error('分类ID必须为数字字符串');
  }
  const file = opts['categories-file'] || path.join(SKILL_ROOT, 'outputs', 'categories.json');
  const tree = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const resolved = opts.category ? resolveCategoryId(opts.category, file) : null;
  const merge = (current, expected) => {
    if (current != null && expected != null && String(current) !== String(expected)) throw new Error('分类名称或父子分类ID冲突');
    return current ?? expected ?? null;
  };
  if (resolved) {
    categoryId = merge(categoryId, resolved.l1_cid);
    categoryId2 = merge(categoryId2, resolved.l2_cid ?? resolved.l2_code);
    categoryId3 = merge(categoryId3, resolved.l3_cid);
  }
  if (categoryId3) {
    const leaf = (tree.l3_categories || []).find(c => String(c.code) === String(categoryId3))
      || Object.values(L3_ALIASES).find(c => String(c.l3_cid) === String(categoryId3));
    if (leaf) {
      categoryId2 = merge(categoryId2, leaf.parent_code ?? leaf.l2_cid);
      categoryId = merge(categoryId, leaf.l1_code ?? leaf.l1_cid);
    }
    if (!categoryId2) throw new Error('三级分类需要对应二级ID；请更新分类树或提供 --category-id2');
  }
  if (categoryId2) {
    const parent = (tree.l2_categories || []).find(c => String(c.code) === String(categoryId2));
    if (parent) categoryId = merge(categoryId, parent.parent_code);
    if (!categoryId) throw new Error('分类需要对应一级ID；请更新分类树或提供 --category-id');
  }
  return { categoryId, categoryId2, categoryId3, matched: resolved?.matched ?? null };
}

/**
 * 分类名 → 分类 ID 自动匹配。
 * 顺序：三级别名（L3_ALIASES）→ categories.json 的一级 → 二级 → 模糊。
 * 返回 { l1_cid, matched, level, l2_code?, l3_cid?, l2_cid? } 或 null。
 */
export function resolveCategoryId(name, categoriesFile) {
  if (!name || !String(name).trim()) return null;
  const raw = String(name).trim();

  // 0. 三级别名（不依赖 categories.json，最优先）
  if (Object.hasOwn(L3_ALIASES, raw)) {
    const h = L3_ALIASES[raw];
    return { l1_cid: h.l1_cid, l2_cid: h.l2_cid, l2_code: h.l2_cid, l3_cid: h.l3_cid, matched: h.matched, level: 3 };
  }

  try {
    const file = categoriesFile || path.join(SKILL_ROOT, 'outputs', 'categories.json');
    if (!fs.existsSync(file)) return null;
    const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
    const l1 = cat.l1_categories || [];
    const l2 = cat.l2_categories || [];
    const l3 = cat.l3_categories || [];
    let kw = raw;
    // 精确平台名称优先于业务别名，避免「跑步鞋」被扩大为整个运动鞋类。
    const exact = [...l3, ...l2, ...l1].some(c => c.name === raw);
    if (!exact && Object.hasOwn(CATEGORY_ALIASES, kw)) kw = CATEGORY_ALIASES[kw];
    // 1. 三级精确匹配（categories.json 的 l3_categories，如「保护壳、屏幕保护膜、皮肤」）
    const l3Hit = l3.find((c) => c.name === kw);
    if (l3Hit) return { l1_cid: l3Hit.l1_code || l3Hit.l1_cid || null, l2_cid: l3Hit.parent_code, l2_code: l3Hit.parent_code, l3_cid: l3Hit.code, matched: l3Hit.name, level: 3 };
    // 2. 精确匹配一级分类名
    const l1Hit = l1.find((c) => c.name === kw);
    if (l1Hit) return { l1_cid: l1Hit.code, matched: l1Hit.name, level: 1 };
    // 3. 精确匹配二级分类名（返回其父级 l1_cid + 二级 code）
    const l2Hit = l2.find((c) => c.name === kw);
    if (l2Hit) return { l1_cid: l2Hit.parent_code, matched: l2Hit.name, level: 2, l2_name: l2Hit.name, l2_code: l2Hit.code };
    // 多个候选时不猜测，防止把细分类静默扩大到父类。
    const candidates = [
      ...l1.map(c => ({ l1_cid: c.code, matched: c.name, level: 1 })),
      ...l2.map(c => ({ l1_cid: c.parent_code, l2_code: c.code, matched: c.name, level: 2 })),
      ...l3.map(c => ({ l1_cid: c.l1_code || c.l1_cid, l2_cid: c.parent_code, l2_code: c.parent_code, l3_cid: c.code, matched: c.name, level: 3 })),
    ].filter(c => c.matched && (c.matched.includes(kw) || kw.includes(c.matched)));
    if (candidates.length === 1) return { ...candidates[0], fuzzy: true };
    return null;
  } catch (e) {
    return null;
  }
}
