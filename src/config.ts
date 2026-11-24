/* ============================================================
   config.ts — 作物、词库、数值
   ============================================================ */

import type { CropDef, CropId, Word } from './types';

export const CROPS: Record<CropId, CropDef> = {
  turnip: {
    id: 'turnip', zh: '萝卜', en: 'turnip',
    days: 3, price: 90, seed: 30,
    leaf: '#5aa84f', fruit: '#f2f0e4', shape: 'root', emoji: '🥬',
    season: 'spring'
  },
  potato: {
    id: 'potato', zh: '土豆', en: 'potato',
    days: 4, price: 145, seed: 48,
    leaf: '#4f9d4a', fruit: '#c99a5b', shape: 'root', emoji: '🥔',
    season: 'spring'
  },
  cabbage: {
    id: 'cabbage', zh: '卷心菜', en: 'cabbage',
    days: 5, price: 225, seed: 76,
    leaf: '#6fae4e', fruit: '#a8d06a', shape: 'round', emoji: '🥬',
    season: 'autumn'
  },
  tomato: {
    id: 'tomato', zh: '番茄', en: 'tomato',
    days: 5, price: 270, seed: 92,
    leaf: '#63a84f', fruit: '#e34b3d', shape: 'round', emoji: '🍅',
    season: 'summer'
  },
  corn: {
    id: 'corn', zh: '玉米', en: 'corn',
    days: 6, price: 350, seed: 120,
    leaf: '#5f9e48', fruit: '#f2c649', shape: 'long', emoji: '🌽',
    season: 'summer'
  },
  pumpkin: {
    id: 'pumpkin', zh: '南瓜', en: 'pumpkin',
    days: 7, price: 500, seed: 170,
    leaf: '#4a8f3e', fruit: '#e8933a', shape: 'gourd', emoji: '🎃',
    season: 'autumn'
  },
  strawberry: {
    id: 'strawberry', zh: '草莓', en: 'strawberry',
    days: 8, price: 640, seed: 220,
    leaf: '#4c9a44', fruit: '#e8456b', shape: 'berry', emoji: '🍓',
    season: 'spring'
  },
  spinach: {
    id: 'spinach', zh: '菠菜', en: 'spinach',
    days: 4, price: 150, seed: 50,
    leaf: '#3f7a44', fruit: '#5aa84f', shape: 'leafy', emoji: '🥗',
    season: 'winter'
  },

  /* ---------------- 新增作物 ---------------- */
  // 春季
  onion: {
    id: 'onion', zh: '洋葱', en: 'onion',
    days: 4, price: 165, seed: 55,
    leaf: '#6a9a4e', fruit: '#d8b0d8', shape: 'root', emoji: '🧅',
    season: 'spring'
  },
  // 夏季
  pepper: {
    id: 'pepper', zh: '辣椒', en: 'pepper',
    days: 4, price: 185, seed: 62,
    leaf: '#4f9a44', fruit: '#d93a2b', shape: 'long', emoji: '🌶️',
    season: 'summer'
  },
  melon: {
    id: 'melon', zh: '西瓜', en: 'melon',
    days: 7, price: 470, seed: 158,
    leaf: '#4a8f3e', fruit: '#5aa84f', shape: 'gourd', emoji: '🍉',
    season: 'summer'
  },
  // 秋季
  eggplant: {
    id: 'eggplant', zh: '茄子', en: 'eggplant',
    days: 5, price: 245, seed: 82,
    leaf: '#4a8a44', fruit: '#6b4a8a', shape: 'long', emoji: '🍆',
    season: 'autumn'
  },
  // 冬季（原本只有菠菜一种，补到 4 种）
  carrot: {
    id: 'carrot', zh: '胡萝卜', en: 'carrot',
    days: 3, price: 115, seed: 38,
    leaf: '#5a9a48', fruit: '#e8823a', shape: 'root', emoji: '🥕',
    season: 'winter'
  },
  radish: {
    id: 'radish', zh: '芜菁', en: 'radish',
    days: 4, price: 160, seed: 52,
    leaf: '#6aa84e', fruit: '#e8e0e8', shape: 'root', emoji: '🥬',
    season: 'winter'
  },
  broccoli: {
    id: 'broccoli', zh: '西兰花', en: 'broccoli',
    days: 6, price: 330, seed: 110,
    leaf: '#3f7a44', fruit: '#4a8a4a', shape: 'leafy', emoji: '🥦',
    season: 'winter'
  }
};

/** 商店与图鉴顺序：按季节分组，同季按生长期从短到长 */
export const CROP_ORDER: CropId[] = [
  // 春
  'turnip', 'onion', 'potato', 'strawberry',
  // 夏
  'pepper', 'tomato', 'corn', 'melon',
  // 秋
  'cabbage', 'eggplant', 'pumpkin',
  // 冬
  'carrot', 'spinach', 'radish', 'broccoli'
];

/* ---------------- 词库 ---------------- */

export const WORDS = {
  till: [
    { text: 'hoe', zh: '锄地' },
    { text: 'till', zh: '翻耕' },
    { text: 'plow', zh: '犁地' },
    { text: 'dig', zh: '挖土' },
    { text: 'spade', zh: '铲土' },
    { text: 'furrow', zh: '开沟' },
    { text: 'break', zh: '破土' },
    { text: 'loosen', zh: '松土' }
  ] as Word[],

  water: [
    { text: 'water', zh: '浇水' },
    { text: 'irrigate', zh: '灌溉' },
    { text: 'sprinkle', zh: '洒水' },
    { text: 'drench', zh: '浇透' },
    { text: 'splash', zh: '泼水' },
    { text: 'moisten', zh: '润湿' },
    { text: 'soak', zh: '浸透' }
  ] as Word[],

  harvest: [
    { text: 'harvest', zh: '收获' },
    { text: 'gather', zh: '采集' },
    { text: 'reap', zh: '收割' },
    { text: 'pick', zh: '采摘' },
    { text: 'pluck', zh: '摘取' },
    { text: 'collect', zh: '收拢' }
  ] as Word[]
};

/* ---------------- 数值 ---------------- */

export const CFG = {
  /** 一天开始时间（分钟） */
  DAY_START: 6 * 60,
  /** 22:00 之后劳作，体力消耗翻倍 */
  NIGHT_FROM: 22 * 60,
  /** 体力上限 */
  STAMINA_MAX: 100,
  /** 初始金币 */
  START_COINS: 150,
  /** 初始种子 */
  START_SEEDS: { turnip: 6 } as Partial<Record<CropId, number>>,

  /** 单次农活的体力 / 时间消耗 */
  COST: {
    till: { stamina: 4, time: 10 },
    plant: { stamina: 3, time: 10 },
    water: { stamina: 2, time: 10 },
    harvest: { stamina: 5, time: 15 }
  },

  /** 品质 → 售价倍率，索引 = 星级 - 1 */
  QUALITY_MULT: [0.7, 0.85, 1.0, 1.25, 1.55, 1.9],

  /** 连击里程碑：达到时回复体力 */
  COMBO_HEAL_AT: [5, 10, 20, 40],
  COMBO_HEAL: 2,

  /** 打字时限：基础 + 每字符 */
  TIME_BASE: 1250,
  TIME_PER_CHAR: 430,

  /** 工具：名称 / 升级价 / 体力倍率 / 时限倍率 / 容错次数 */
  TOOLS: [
    { name: '铜制工具', cost: 0, stamina: 1.0, time: 1.0, tolerance: 0, desc: '朴素但顺手' },
    { name: '银制工具', cost: 600, stamina: 0.9, time: 1.0, tolerance: 1, desc: '打错一次不算失误' },
    { name: '金制工具', cost: 1600, stamina: 0.8, time: 1.3, tolerance: 1, desc: '时限 +30%' },
    { name: '秘银工具', cost: 3600, stamina: 0.7, time: 1.6, tolerance: 2, desc: '时限 +60%，容错 2 次' }
  ],

  /** 晕倒时的医药费比例 */
  FAINT_FEE_RATE: 0.2,

  /** 雨天概率 */
  RAIN_CHANCE: 0.25,

  SAVE_KEY: 'typing-farm-save-v1'
};

export const STAR = ['☆', '★'];

export function stars(q: number): string {
  const n = Math.max(0, Math.min(5, Math.round(q)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}
