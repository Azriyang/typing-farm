/* ============================================================
   i18n.ts — 双语言支持
   ------------------------------------------------------------
   两种模式：
     zh（默认）— 中文界面 + 打字时看中文词义（学习向）
     en         — English UI，打字是纯键盘练习（母语向）

   设计取舍：
     没有引入 key/资源的间接层。中文就写在原来的位置，
     用 t('中文', 'English') 成对给出。好处是读代码时两种语言都在眼前，
     坏处是没有统一的 key 列表——但这个项目里字符串是就地生成的，
     强行抽 key 反而会让几十处模板字符串变得难读。
   ============================================================ */

import { storage } from './platform';

export type Lang = 'zh' | 'en';

const LANG_KEY = 'typing-farm-lang-v1';

function detectLang(): Lang {
  // 显式选过就用存的
  try {
    const saved = storage.get(LANG_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* 忽略 */
  }
  // 否则跟浏览器语言走：中文环境默认中文，其他默认英文
  try {
    const nav = typeof navigator !== 'undefined' ? navigator.language : 'zh';
    return /^zh/i.test(nav) ? 'zh' : 'en';
  } catch {
    return 'zh';
  }
}

let lang: Lang = detectLang();

export function getLang(): Lang {
  return lang;
}

export function isEn(): boolean {
  return lang === 'en';
}

export function setLang(next: Lang): void {
  lang = next;
  try {
    storage.set(LANG_KEY, next);
  } catch {
    /* 忽略 */
  }
}

/** 成对给出两种语言，按当前语言取一个 */
export function t(zh: string, en: string): string {
  return lang === 'en' ? en : zh;
}

/** 带占位符替换：tr('第 {n} 天', 'Day {n}', { n: 3 }) */
export function tr(zh: string, en: string, vars: Record<string, string | number>): string {
  let s = lang === 'en' ? en : zh;
  for (const [k, v] of Object.entries(vars)) {
    s = s.split('{' + k + '}').join(String(v));
  }
  return s;
}

/* ---------------- 名字词典 ---------------- */

/**
 * 物品英文名（按 id）。
 * 种子 / 作物 / 花卉不在这里——它们从 CROPS 的 en 字段推导，
 * 见 itemNameEn()。
 */
const ITEM_EN: Record<string, string> = {
  'mat.wood': 'Wood',
  'mat.stone': 'Stone',
  'mat.fiber': 'Fiber',
  'mat.copper': 'Copper Ore',
  'mat.iron': 'Iron Ore',
  'mat.gem': 'Gem',
  'prod.egg': 'Egg',
  'prod.milk': 'Milk',
  'prod.wool': 'Wool',
  'craft.cheese': 'Cheese',
  'craft.butter': 'Butter',
  'craft.yarn': 'Yarn',
  'craft.jam': 'Strawberry Jam',
  'craft.ketchup': 'Ketchup',
  'food.soup': 'Vegetable Soup',
  'food.friedegg': 'Fried Egg',
  'food.mash': 'Mashed Potato',
  'food.cheesepotato': 'Cheese Potato',
  'food.pasta': 'Tomato Pasta',
  'food.jamtoast': 'Jam Toast',
  'food.feast': 'Harvest Feast',
  'food.creamsoup': 'Cream Soup'
};

/** 物品英文说明（可缺省） */
const ITEM_DESC_EN: Record<string, string> = {
  'mat.wood': 'From chopping trees. Used to upgrade tools.',
  'mat.stone': 'From breaking rocks. Used to upgrade tools.',
  'mat.fiber': 'From cutting weeds.',
  'mat.copper': 'Mined ore. Needed for high-tier tools.',
  'mat.iron': 'Mined ore. Needed for high-tier tools.',
  'mat.gem': 'Rare ore from deep floors.',
  'prod.egg': 'Laid by hens. Quality follows their mood.',
  'prod.milk': 'From cows. Quality follows their mood.',
  'prod.wool': 'Sheared from sheep every few days.',
  'craft.cheese': 'Made from milk.',
  'craft.butter': 'Made from 2 milk.',
  'craft.yarn': 'Spun from wool.',
  'craft.jam': 'Made from 2 strawberries.',
  'craft.ketchup': 'Made from 2 tomatoes.',
  'food.soup': 'Eat to restore 25 stamina.',
  'food.friedegg': 'Eat to restore 20 stamina.',
  'food.mash': 'Eat to restore 25 stamina.',
  'food.cheesepotato': 'Eat to restore 40 stamina.',
  'food.pasta': 'Eat to restore 45 stamina.',
  'food.jamtoast': 'Eat to restore 35 stamina.',
  'food.feast': 'Eat to restore 60 stamina.',
  'food.creamsoup': 'Eat to restore 50 stamina.'
};

/** 工具英文名（键是 ToolId） */
const TOOL_EN: Record<string, string> = {
  hoe: 'Hoe',
  can: 'Watering Can',
  axe: 'Axe',
  pick: 'Pickaxe',
  sickle: 'Sickle',
  rod: 'Fishing Rod'
};

/** 工具动作名 */
const ACTION_EN: Record<string, string> = {
  开垦: 'Till',
  浇水: 'Water',
  砍树: 'Chop',
  挖石: 'Mine',
  割草: 'Cut',
  钓鱼: 'Fish'
};

/** 资源节点名 */
const NODE_EN: Record<string, string> = {
  tree: 'Big Tree',
  sapling: 'Sapling',
  shrub: 'Shrub',
  stump: 'Old Stump',
  rock: 'Rock',
  weed: 'Weeds',
  oreCopper: 'Copper Vein',
  oreIron: 'Iron Vein',
  oreGem: 'Gem Vein'
};

/** 工具等级名 */
const TIER_EN: Record<string, string> = {
  铜: 'Copper',
  银: 'Silver',
  金: 'Gold',
  秘银: 'Mithril'
};

/** 动物英文名（键是 AnimalKind） */
const ANIMAL_EN: Record<string, string> = {
  chicken: 'Chicken',
  cow: 'Cow',
  sheep: 'Sheep'
};

/** 畜产品名 */
const PRODUCT_EN: Record<string, string> = {
  鸡蛋: 'Egg',
  牛奶: 'Milk',
  羊毛: 'Wool'
};

export function actionNameEn(zh: string): string | undefined {
  return ACTION_EN[zh];
}

export function nodeNameEn(kind: string): string | undefined {
  return NODE_EN[kind];
}

export function tierNameEn(zh: string): string | undefined {
  return TIER_EN[zh];
}

export function productNameEn(zh: string): string | undefined {
  return PRODUCT_EN[zh];
}

/** 鱼的英文名——本来就是英文单词，首字母大写即可 */
function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

/**
 * 按物品 id 取英文名。
 * 种子 / 作物 / 花卉由作物定义的 en 字段拼出来。
 */
export function itemNameEn(id: string, cropEn?: string): string | undefined {
  if (ITEM_EN[id]) return ITEM_EN[id];
  if (cropEn) {
    const base = titleCase(cropEn);
    if (id.startsWith('seed.')) return base + ' Seeds';
    return base;
  }
  return undefined;
}

export function itemDescEn(id: string): string | undefined {
  return ITEM_DESC_EN[id];
}

export function toolNameEn(id: string): string | undefined {
  return TOOL_EN[id];
}

export function animalNameEn(kind: string): string | undefined {
  return ANIMAL_EN[kind];
}

/** 鱼名（英文单词转标题大小写） */
export function fishNameEn(en: string): string {
  return titleCase(en);
}
/* ---------------- 静态 DOM 本地化 ---------------- */

/**
 * 把 index.html 里带 data-en 的元素换成英文。
 * 中文原文留在元素里，切回中文时从 data-zh 还原。
 * 只在启动和切换语言时各跑一次，不影响每帧性能。
 */
export function applyStaticI18n(): void {
  if (typeof document === 'undefined') return;
  const en = lang === 'en';
  document.documentElement.lang = en ? 'en' : 'zh-CN';

  document.querySelectorAll<HTMLElement>('[data-en]').forEach((el) => {
    // 第一次遇到时把中文原文存下来
    if (el.dataset.zh === undefined) el.dataset.zh = el.innerHTML;
    el.innerHTML = en ? (el.dataset.en ?? el.innerHTML) : (el.dataset.zh ?? el.innerHTML);
  });

  // 带 title 的按钮也换掉提示
  document.querySelectorAll<HTMLElement>('[data-en-title]').forEach((el) => {
    if (el.dataset.zhTitle === undefined) el.dataset.zhTitle = el.title;
    el.title = en ? (el.dataset.enTitle ?? el.title) : (el.dataset.zhTitle ?? el.title);
  });

  const btn = document.getElementById('btn-lang');
  if (btn) {
    btn.textContent = en ? '中文' : 'EN';
    btn.title = en ? '切到中文' : 'Switch to English';
  }
}