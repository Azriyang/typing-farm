/* ============================================================
   items.ts — 物品注册表与背包操作
   ============================================================ */

import { CFG, CROPS, CROP_ORDER } from './config';
import type { CropId, ItemDef, ItemKind, ItemStack } from './types';
import { isEn, itemNameEn, itemDescEn } from './i18n';

const REG = new Map<string, ItemDef>();

function reg(def: ItemDef): void {
  REG.set(def.id, def);
}

/* ---------------- 注册 ---------------- */

for (const id of CROP_ORDER) {
  const c = CROPS[id];
  const isFlower = c.kind === 'flower';
  reg({
    id: `seed.${id}`,
    kind: 'seed',
    name: `${c.zh}${isFlower ? '花种' : '种子'}`,
    icon: c.emoji,
    max: 99,
    desc: isFlower
      ? `${c.days} 天开花 · 卖不了几个钱，但送礼好感高`
      : `${c.days} 天成熟 · 售价 ${c.price}G`
  });
  reg({
    id: `${isFlower ? 'flower' : 'crop'}.${id}`,
    kind: isFlower ? 'flower' : 'crop',
    name: c.zh,
    icon: c.emoji,
    max: 99,
    desc: isFlower ? `可送人 · 好感比普通礼物多` : `农场出品 · 打 ${c.en}`,
    price: c.price
  });
}

/* ---------------- 鱼 ---------------- */

export interface FishDef {
  id: string;
  zh: string;
  /** 收线时要打的英文 */
  en: string;
  price: number;
  /** 出现权重，越大越常见 */
  weight: number;
  icon: string;
}

export const FISH: FishDef[] = [
  { id: 'carp', zh: '鲤鱼', en: 'carp', price: 30, weight: 30, icon: '🐟' },
  { id: 'bream', zh: '鳊鱼', en: 'bream', price: 45, weight: 25, icon: '🐟' },
  { id: 'trout', zh: '鳟鱼', en: 'trout', price: 70, weight: 18, icon: '🐠' },
  { id: 'perch', zh: '鲈鱼', en: 'perch', price: 95, weight: 12, icon: '🐠' },
  { id: 'catfish', zh: '鲶鱼', en: 'catfish', price: 130, weight: 8, icon: '🐡' },
  { id: 'salmon', zh: '鲑鱼', en: 'salmon', price: 180, weight: 5, icon: '🍣' },
  { id: 'eel', zh: '鳗鱼', en: 'eel', price: 230, weight: 3, icon: '🐍' },
  { id: 'sturgeon', zh: '鲟鱼', en: 'sturgeon', price: 330, weight: 2, icon: '🐟' },
  { id: 'koi', zh: '锦鲤', en: 'koi', price: 520, weight: 1, icon: '🎏' }
];

for (const f of FISH) {
  reg({
    id: `fish.${f.id}`,
    kind: 'fish',
    name: f.zh,
    icon: f.icon,
    max: 99,
    desc: `池塘渔获 · 收线打 ${f.en}`,
    price: f.price
  });
}

/** 按权重随机一条鱼；tier 越高越容易遇到稀有的 */
export function pickFish(tier: number): FishDef {
  const weighted = FISH.map((f) => ({
    f,
    w: tier >= 4 ? f.weight * (f.price >= 180 ? 2.2 : 1) : f.weight
  }));
  const total = weighted.reduce((n, x) => n + x.w, 0);
  let r = Math.random() * total;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return x.f;
  }
  return FISH[0];
}

reg({ id: 'mat.wood', kind: 'material', name: '木材', icon: '🪵', max: 99, desc: '砍树获得，升级工具的材料' });
reg({ id: 'mat.stone', kind: 'material', name: '石材', icon: '🪨', max: 99, desc: '挖岩石获得，升级工具的材料' });
reg({ id: 'mat.fiber', kind: 'material', name: '纤维', icon: '🌿', max: 99, desc: '割草获得' });

/* ---------------- 矿石（矿洞专属） ---------------- */

reg({ id: 'mat.copper', kind: 'material', name: '铜矿', icon: '🟤', max: 99, desc: '矿洞 1~2 层产出 · 升级工具', price: 80 });
reg({ id: 'mat.iron', kind: 'material', name: '铁矿', icon: '⬛', max: 99, desc: '矿洞 3~4 层产出 · 升级工具', price: 200 });
reg({ id: 'mat.gem', kind: 'material', name: '宝石', icon: '💎', max: 99, desc: '矿洞最深处产出 · 顶级材料', price: 600 });

/* ---------------- 动物产物 ---------------- */

reg({ id: 'prod.egg', kind: 'product', name: '鸡蛋', icon: '🥚', max: 99, desc: '鸡的产出 · 心情决定品质', price: 70 });
reg({ id: 'prod.milk', kind: 'product', name: '牛奶', icon: '🥛', max: 99, desc: '牛的产出 · 心情决定品质', price: 160 });
reg({ id: 'prod.wool', kind: 'product', name: '羊毛', icon: '🧶', max: 99, desc: '羊的产出 · 每隔几天剪一次', price: 280 });

/* ---------------- 加工品（加工台产出） ---------------- */

reg({ id: 'craft.cheese', kind: 'product', name: '奶酪', icon: '🧀', max: 99, desc: '牛奶加工而成', price: 420 });
reg({ id: 'craft.butter', kind: 'product', name: '黄油', icon: '🧈', max: 99, desc: '2 份牛奶加工而成', price: 780 });
reg({ id: 'craft.yarn', kind: 'product', name: '毛线', icon: '🪡', max: 99, desc: '羊毛纺成，将来可做衣服', price: 520 });
reg({ id: 'craft.jam', kind: 'product', name: '草莓酱', icon: '🍓', max: 99, desc: '2 份草莓熬成', price: 1900 });
reg({ id: 'craft.ketchup', kind: 'product', name: '番茄酱', icon: '🥫', max: 99, desc: '2 份番茄熬成', price: 880 });

/* ---------------- 料理（灶台产出，可吃可卖） ---------------- */

reg({ id: 'food.soup', kind: 'food', name: '蔬菜汤', icon: '🍲', max: 99, desc: '吃掉回 25 体力', price: 380 });
reg({ id: 'food.friedegg', kind: 'food', name: '煎蛋', icon: '🍳', max: 99, desc: '吃掉回 20 体力', price: 210 });
reg({ id: 'food.mash', kind: 'food', name: '土豆泥', icon: '🥣', max: 99, desc: '吃掉回 25 体力', price: 440 });
reg({ id: 'food.cheesepotato', kind: 'food', name: '奶酪焗土豆', icon: '🧀', max: 99, desc: '吃掉回 40 体力', price: 1070 });
reg({ id: 'food.pasta', kind: 'food', name: '番茄意面', icon: '🍝', max: 99, desc: '吃掉回 45 体力', price: 1850 });
reg({ id: 'food.jamtoast', kind: 'food', name: '草莓酱吐司', icon: '🍞', max: 99, desc: '吃掉回 35 体力', price: 2950 });
reg({ id: 'food.feast', kind: 'food', name: '丰收大餐', icon: '🍱', max: 99, desc: '吃掉回 60 体力', price: 2300 });
reg({ id: 'food.creamsoup', kind: 'food', name: '奶油浓汤', icon: '🍜', max: 99, desc: '吃掉回 50 体力', price: 1630 });

/* ---------------- 查询 ---------------- */

export function getDef(id: string): ItemDef | undefined {
  const def = REG.get(id);
  if (!def) return undefined;
  if (!isEn()) return def;
  // 英文模式下返回一份带英文名的副本：
  // 这样所有 getDef(x).name 的调用点都自动本地化，不用逐个改。
  const cropId = id.startsWith('seed.') || id.startsWith('crop.') || id.startsWith('flower.')
    ? id.slice(id.indexOf('.') + 1)
    : undefined;
  const cropEn = cropId ? CROPS[cropId as CropId]?.en : undefined;
  const name = itemNameEn(id, cropEn) ?? def.name;
  const desc = itemDescEn(id) ?? def.desc;
  return { ...def, name, desc };
}

export function seedItemId(crop: CropId): string {
  return `seed.${crop}`;
}

/** 收获产出的物品 id：花卉用 flower. 前缀，普通作物用 crop. */
export function cropItemId(crop: CropId): string {
  return CROPS[crop]?.kind === 'flower' ? `flower.${crop}` : `crop.${crop}`;
}

export function itemKind(id: string): ItemKind {
  return getDef(id)?.kind ?? 'material';
}

/** 显示名：作物带品质星 */
export function displayName(stack: ItemStack): string {
  const def = getDef(stack.id);
  if (!def) return stack.id;
  return def.name;
}

export function makeStack(id: string, qty: number, quality?: number): ItemStack {
  return { id, kind: itemKind(id), qty, quality };
}

/** 同一物品同一品质才算同堆 */
export function sameStack(a: ItemStack, b: Pick<ItemStack, 'id' | 'quality'>): boolean {
  return a.id === b.id && (a.quality ?? 0) === (b.quality ?? 0);
}

/* ---------------- 背包操作 ---------------- */

export type Bag = (ItemStack | null)[];

export function emptyBag(size: number): Bag {
  return new Array<ItemStack | null>(size).fill(null);
}

export function bagIsFull(bag: Bag): boolean {
  return bag.every((s) => s !== null);
}

export function usedSlots(bag: Bag): number {
  return bag.reduce((n, s) => n + (s ? 1 : 0), 0);
}

/**
 * 加入物品，返回未放下的数量。
 * 先尝试合并到同物品同品质的堆，再占用空格。
 */
export function addToBag(bag: Bag, stack: ItemStack): number {
  const def = getDef(stack.id);
  const max = def?.max ?? 99;
  let left = stack.qty;

  // 1) 合并
  for (const slot of bag) {
    if (left <= 0) break;
    if (!slot) continue;
    if (!sameStack(slot, stack)) continue;
    const room = max - slot.qty;
    if (room <= 0) continue;
    const move = Math.min(room, left);
    slot.qty += move;
    left -= move;
  }

  // 2) 新槽
  for (let i = 0; i < bag.length && left > 0; i++) {
    if (bag[i]) continue;
    const move = Math.min(max, left);
    const next: ItemStack = { id: stack.id, kind: stack.kind, qty: move };
    if (stack.quality != null) next.quality = stack.quality;
    bag[i] = next;
    left -= move;
  }

  return left;
}

/** 是否有空间容纳（不实际放入） */
export function canFit(bag: Bag, stack: ItemStack): boolean {
  const def = getDef(stack.id);
  const max = def?.max ?? 99;
  let room = 0;
  for (const slot of bag) {
    if (!slot) {
      room += max;
    } else if (sameStack(slot, stack)) {
      room += Math.max(0, max - slot.qty);
    }
    if (room >= stack.qty) return true;
  }
  return room >= stack.qty;
}

/** 统计某物品数量（可按品质过滤） */
export function countInBag(bag: Bag, id: string, quality?: number): number {
  let n = 0;
  for (const slot of bag) {
    if (!slot) continue;
    if (slot.id !== id) continue;
    if (quality != null && (slot.quality ?? 0) !== quality) continue;
    n += slot.qty;
  }
  return n;
}

/** 扣除物品，返回实际扣除数量 */
export function removeFromBag(bag: Bag, id: string, qty: number, quality?: number): number {
  let left = qty;
  for (let i = 0; i < bag.length && left > 0; i++) {
    const slot = bag[i];
    if (!slot || slot.id !== id) continue;
    if (quality != null && (slot.quality ?? 0) !== quality) continue;
    const take = Math.min(slot.qty, left);
    slot.qty -= take;
    left -= take;
    if (slot.qty <= 0) bag[i] = null;
  }
  return qty - left;
}

/** 整理：按 物品 id 排序并合并 */
export function sortBag(bag: Bag): void {  const flat: ItemStack[] = [];
  for (const s of bag) if (s) flat.push(s);
  const merged = new Map<string, ItemStack>();
  for (const s of flat) {
    const k = `${s.id}#${s.quality ?? 0}`;
    const m = merged.get(k);
    if (m) m.qty += s.qty;
    else merged.set(k, { ...s });
  }
  const list = [...merged.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });
  bag.fill(null);
  let i = 0;
  for (const s of list) {
    const def = getDef(s.id);
    const max = def?.max ?? 99;
    let q = s.qty;
    while (q > 0 && i < bag.length) {
      const put = Math.min(max, q);
      bag[i++] = { ...s, qty: put };
      q -= put;
    }
  }
}

/* ---------------- 售价 ---------------- */

/** 单件售价：按品质倍率计算，素材/种子不卖 */
export function sellPrice(stack: ItemStack): number {
  const def = getDef(stack.id);
  if (!def || !def.price) return 0;
  const q = Math.max(1, Math.min(5, stack.quality ?? 1));
  return Math.round(def.price * CFG.QUALITY_MULT[q - 1]);
}

export function isSellable(stack: ItemStack): boolean {
  const def = getDef(stack.id);
  return !!def && (def.price ?? 0) > 0;
}