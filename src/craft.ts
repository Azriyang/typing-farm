/* ============================================================
   craft.ts — 产物加工体系
   ------------------------------------------------------------
   加工是「烹饪」的前置：把原料变成食材，链条才够长。

     作物 / 动物产物 → [加工台] → 加工品（既是卖出品，也是将来的料理食材）

   设计原则：
   - 必须花时间（几小时），不是免费增值
   - 一次只能加工一样（单槽位），避免玩家挂机批量
   - 加工品继承原料品质
   ============================================================ */

import { getDef, itemKind } from './items';
import type { CraftingJob } from './types';

export type { CraftingJob };

export interface CraftRecipe {
  id: string;
  /** 产物物品 id */
  out: string;
  /** 原料：物品 id + 数量 */
  input: Array<{ id: string; qty: number }>;
  /** 需要多少分钟游戏时间 */
  minutes: number;
  /** 分类，用于面板分组 */
  group: 'dairy' | 'textile' | 'preserve';
}

export const CRAFT_RECIPES: CraftRecipe[] = [
  {
    id: 'cheese',
    out: 'craft.cheese',
    input: [{ id: 'prod.milk', qty: 1 }],
    minutes: 240,
    group: 'dairy'
  },
  {
    id: 'butter',
    out: 'craft.butter',
    input: [{ id: 'prod.milk', qty: 2 }],
    minutes: 300,
    group: 'dairy'
  },
  {
    id: 'yarn',
    out: 'craft.yarn',
    input: [{ id: 'prod.wool', qty: 1 }],
    minutes: 360,
    group: 'textile'
  },
  {
    id: 'jam',
    out: 'craft.jam',
    input: [{ id: 'crop.strawberry', qty: 2 }],
    minutes: 300,
    group: 'preserve'
  },
  {
    id: 'ketchup',
    out: 'craft.ketchup',
    input: [{ id: 'crop.tomato', qty: 2 }],
    minutes: 180,
    group: 'preserve'
  }
];

export const GROUP_LABEL: Record<CraftRecipe['group'], string> = {
  dairy: '🥛 乳制品',
  textile: '🧶 纺织品',
  preserve: '🍯 保存食品'
};

export function recipeById(id: string): CraftRecipe | null {
  return CRAFT_RECIPES.find((r) => r.id === id) ?? null;
}

/**
 * 把「完成时刻」换算成绝对分钟：day * 1440 + time。
 * 这样跨天时不用特殊处理。
 */
export function absoluteMinutes(day: number, time: number): number {
  return day * 1440 + time;
}

export function isDone(job: CraftingJob, day: number, time: number): boolean {
  return absoluteMinutes(day, time) >= job.doneAt;
}

/** 剩余分钟 */
export function remainingMinutes(job: CraftingJob, day: number, time: number): number {
  return Math.max(0, job.doneAt - absoluteMinutes(day, time));
}

/** 人类可读的剩余时间 */
export function remainingText(job: CraftingJob, day: number, time: number): string {
  const m = remainingMinutes(job, day, time);
  if (m <= 0) return '已完成';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `还要 ${mm} 分钟`;
  return mm > 0 ? `还要 ${h} 小时 ${mm} 分` : `还要 ${h} 小时`;
}

/** 这个物品能不能加工 */
export function canCraftItem(itemId: string): boolean {
  return itemKind(itemId) === 'product' || itemKind(itemId) === 'crop' || itemKind(itemId) === 'flower';
}

/** 配方的产物名 */
export function outName(recipe: CraftRecipe): string {
  return getDef(recipe.out)?.name ?? recipe.out;
}

/** 配方原料的可读描述，如「牛奶×1」 */
export function inputText(recipe: CraftRecipe): string {
  return recipe.input
    .map((i) => `${getDef(i.id)?.name ?? i.id}×${i.qty}`)
    .join(' + ');
}