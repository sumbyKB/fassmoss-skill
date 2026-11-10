// 分类树匹配：把「跑步鞋/耳机」这类业务用词映射到 FastMoss 分类 ID。
import fs from 'node:fs';
import path from 'node:path';
import { SKILL_ROOT } from './config.mjs';

/** 业务用词 → 分类树标准名的同义词映射（大白话 → 平台分类名） */
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
 * 分类名 → 分类 ID 自动匹配：读 categories.json（categories 命令产出），
 * 把「跑步鞋/护肤品/衣服」这类大白话分类名匹配到一级或二级分类的 ID。
 * 返回 { l1_cid, matched, level, l2_code? } 或 null（没匹配到，回退抓全量后过滤）。
 */
export function resolveCategoryId(name, categoriesFile) {
  if (!name) return null;
  try {
    const file = categoriesFile || path.join(SKILL_ROOT, 'outputs', 'categories.json');
    if (!fs.existsSync(file)) return null;
    const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
    const l1 = cat.l1_categories || [];
    const l2 = cat.l2_categories || [];
    let kw = String(name).trim();
    // 0. 同义词归一：把业务用词映射到平台标准分类名
    if (CATEGORY_ALIASES[kw]) kw = CATEGORY_ALIASES[kw];
    // 1. 精确匹配一级分类名
    const l1Hit = l1.find((c) => c.name === kw);
    if (l1Hit) return { l1_cid: l1Hit.code, matched: l1Hit.name, level: 1 };
    // 2. 精确匹配二级分类名（返回其父级 l1_cid + 二级 code）
    const l2Hit = l2.find((c) => c.name === kw);
    if (l2Hit) return { l1_cid: l2Hit.parent_code, matched: l2Hit.name, level: 2, l2_name: l2Hit.name, l2_code: l2Hit.code };
    // 3. 模糊匹配（包含关系）：优先一级，其次二级
    const l1Fuzzy = l1.find((c) => c.name.includes(kw) || kw.includes(c.name));
    if (l1Fuzzy) return { l1_cid: l1Fuzzy.code, matched: l1Fuzzy.name, level: 1, fuzzy: true };
    const l2Fuzzy = l2.find((c) => c.name.includes(kw) || kw.includes(c.name));
    if (l2Fuzzy) return { l1_cid: l2Fuzzy.parent_code, matched: l2Fuzzy.name, level: 2, l2_name: l2Fuzzy.name, l2_code: l2Fuzzy.code, fuzzy: true };
    return null;
  } catch (e) {
    return null;
  }
}
