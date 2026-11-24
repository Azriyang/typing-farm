/* ============================================================
   requests.ts — 每日委托
   ------------------------------------------------------------
   作用：把四条生产链串起来。

     委托「交 3 个奶酪」 → 你必须用加工台
     委托「交 1 份丰收大餐」 → 你必须走完种地→加工→烹饪

   规则：
   - 每天刷新 2~3 条，有效期 2 天
   - 需求随天数递进（前期只要作物，后期要加工品和料理）
   - 报酬比直接卖高（1.6~2.2 倍），外加好感
   ============================================================ */

import { getDef } from './items';
import { VILLAGER_ORDER } from './villagers';

export type RequestTier = 'early' | 'mid' | 'late';

export interface Request {
  id: string;
  /** 谁发布的 */
  giver: string;
  /** 要什么 */
  itemId: string;
  qty: number;
  /** 提交后的报酬 */
  reward: number;
  /** 提交后加的好感 */
  friendship: number;
  /** 发布日（第几天） */
  day: number;
  /** 过期日（含当天可交） */
  expireDay: number;
}

/** 各阶段的候选物品池 */
const EARLY_POOL = [
  'crop.turnip', 'crop.potato', 'crop.onion', 'crop.carrot',
  'prod.egg', 'prod.milk', 'mat.wood', 'mat.stone', 'mat.fiber'
];

const MID_POOL = [
  'crop.tomato', 'crop.corn', 'crop.cabbage', 'crop.spinach',
  'crop.pepper', 'crop.eggplant', 'prod.wool',
  'craft.cheese', 'craft.yarn', 'craft.ketchup',
  'flower.tulip', 'flower.lily', 'flower.daisy', 'flower.camellia'
];

const LATE_POOL = [
  'crop.strawberry', 'crop.pumpkin', 'crop.melon', 'crop.broccoli',
  'craft.butter', 'craft.jam', 'mat.copper', 'mat.iron', 'mat.gem',
  'food.cheesepotato', 'food.pasta', 'food.jamtoast', 'food.feast', 'food.creamsoup'
];

/** 按天数决定该用哪个池子 */
export function tierOfDay(day: number): RequestTier {
  if (day <= 6) return 'early';
  if (day <= 14) return 'mid';
  return 'late';
}

function poolOf(tier: RequestTier): string[] {
  if (tier === 'early') return EARLY_POOL;
  if (tier === 'mid') return MID_POOL;
  return LATE_POOL;
}

/** 该物品一次委托要几个：便宜的多要，贵的少要 */
function qtyFor(itemId: string, tier: RequestTier): number {
  const price = getDef(itemId)?.price ?? 50;
  if (price <= 60) return tier === 'early' ? 4 : 5;
  if (price <= 150) return 3;
  if (price <= 400) return 2 + (tier === 'late' ? 1 : 0);
  if (price <= 1200) return 2;
  return 1;
}

let seq = 0;

function makeRequest(day: number, tier: RequestTier): Request {
  const pool = poolOf(tier);
  const itemId = pool[Math.floor(Math.random() * pool.length)];
  const qty = qtyFor(itemId, tier);
  const price = getDef(itemId)?.price ?? 50;

  // 报酬：原料总价 × 1.6~2.1，外加固定跑腿费
  const mult = 1.6 + Math.random() * 0.5;
  const reward = Math.round(price * qty * mult + 40);

  // 好感：越麻烦给得越多
  const base = tier === 'early' ? 8 : tier === 'mid' ? 12 : 16;
  const friendship = base + Math.round(qty * 0.8);

  const giver = VILLAGER_ORDER[Math.floor(Math.random() * VILLAGER_ORDER.length)];

  return {
    id: 'req' + (++seq) + '_' + day,
    giver,
    itemId,
    qty,
    reward,
    friendship,
    day,
    expireDay: day + 1   // 今天和明天都能交
  };
}

/**
 * 刷新某一天的委托。
 * 保留未过期的旧委托，再补足到 2~3 条。
 */
export function rollRequests(existing: Request[], day: number): Request[] {
  const alive = existing.filter((r) => r.expireDay >= day);
  const tier = tierOfDay(day);
  const want = 2 + Math.floor(Math.random() * 2);   // 2~3 条

  // 同一个物品不要重复
  const used = new Set(alive.map((r) => r.itemId));
  const out = [...alive];
  let guard = 0;
  while (out.length < want && guard++ < 30) {
    const r = makeRequest(day, tier);
    if (used.has(r.itemId)) continue;
    used.add(r.itemId);
    out.push(r);
  }
  return out;
}

/** 委托的过期提示文案 */
export function expiryText(r: Request, day: number): string {
  const left = r.expireDay - day;
  if (left <= 0) return '最后一天';
  return `还有 ${left + 1} 天`;
}