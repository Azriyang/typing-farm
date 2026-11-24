/* ============================================================
   cook.ts — 烹饪 / 料理
   ------------------------------------------------------------
   链条第三层：

     作物 / 动物产物 → [加工台] → 加工品 → [灶台] → 料理

   料理有两种用途：
   - 卖钱（比原料贵 50%+）
   - **吃掉回体力**（这是它和加工品的本质区别）
   ============================================================ */

import { getDef } from './items';

export interface CookRecipe {
  id: string;
  /** 料理物品 id */
  out: string;
  input: Array<{ id: string; qty: number }>;
  /** 吃掉恢复多少体力 */
  stamina: number;
  /** 分档，用于面板分组 */
  tier: 'basic' | 'nice' | 'deluxe';
}

export const COOK_RECIPES: CookRecipe[] = [
  /* ---- 家常（原料就在手边） ---- */
  {
    id: 'soup', out: 'food.soup',
    input: [{ id: 'crop.turnip', qty: 1 }, { id: 'crop.onion', qty: 1 }],
    stamina: 25, tier: 'basic'
  },
  {
    id: 'friedegg', out: 'food.friedegg',
    input: [{ id: 'prod.egg', qty: 2 }],
    stamina: 20, tier: 'basic'
  },
  {
    id: 'mash', out: 'food.mash',
    input: [{ id: 'crop.potato', qty: 2 }],
    stamina: 25, tier: 'basic'
  },

  /* ---- 像样的一餐（用上加工品） ---- */
  {
    id: 'cheesepotato', out: 'food.cheesepotato',
    input: [{ id: 'craft.cheese', qty: 1 }, { id: 'crop.potato', qty: 2 }],
    stamina: 40, tier: 'nice'
  },
  {
    id: 'pasta', out: 'food.pasta',
    input: [{ id: 'craft.ketchup', qty: 1 }, { id: 'crop.corn', qty: 1 }],
    stamina: 45, tier: 'nice'
  },
  {
    id: 'jamtoast', out: 'food.jamtoast',
    input: [{ id: 'craft.jam', qty: 1 }, { id: 'prod.egg', qty: 1 }],
    stamina: 35, tier: 'nice'
  },

  /* ---- 大餐（多种高级食材） ---- */
  {
    id: 'feast', out: 'food.feast',
    input: [{ id: 'craft.cheese', qty: 1 }, { id: 'crop.pumpkin', qty: 1 }, { id: 'crop.corn', qty: 1 }],
    stamina: 60, tier: 'deluxe'
  },
  {
    id: 'creamsoup', out: 'food.creamsoup',
    input: [{ id: 'craft.butter', qty: 1 }, { id: 'prod.milk', qty: 1 }, { id: 'crop.potato', qty: 1 }],
    stamina: 50, tier: 'deluxe'
  }
];

export const TIER_LABEL: Record<CookRecipe['tier'], string> = {
  basic: '🍳 家常',
  nice: '🍲 像样的一餐',
  deluxe: '🍱 大餐'
};

export function cookRecipeById(id: string): CookRecipe | null {
  return COOK_RECIPES.find((r) => r.id === id) ?? null;
}

/** 料理是不是食物（吃了回体力） */
export function isFood(itemId: string): boolean {
  return itemId.startsWith('food.');
}

/** 吃掉这份料理回多少体力；非食物返回 0 */
export function foodStamina(itemId: string): number {
  const r = COOK_RECIPES.find((x) => x.out === itemId);
  return r ? r.stamina : 0;
}

export function cookInputText(recipe: CookRecipe): string {
  return recipe.input
    .map((i) => `${getDef(i.id)?.name ?? i.id}×${i.qty}`)
    .join(' + ');
}

export function cookOutName(recipe: CookRecipe): string {
  return getDef(recipe.out)?.name ?? recipe.out;
}

/** 料理的原料总价（用于算增值） */
export function inputValue(recipe: CookRecipe): number {
  return recipe.input.reduce((sum, i) => sum + (getDef(i.id)?.price ?? 0) * i.qty, 0);
}