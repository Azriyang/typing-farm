/* ============================================================
   tools.ts — 工具定义、等级、升级配方、资源节点
   ============================================================ */

import type { ToolId } from './types';
import type { WordCategory } from './words';

export type ToolTarget = 'soil' | 'crop' | 'tree' | 'rock' | 'weed' | 'water';

export interface ToolDef {
  id: ToolId;
  name: string;
  icon: string;
  target: ToolTarget;
  /** 0 表示初始拥有 */
  price: number;
  stamina: number;
  time: number;
  /** 打哪一类词 */
  wordCat: WordCategory;
  /** 基础难度档（0~6），收割/钓鱼另有按价值计算的档位 */
  band: number;
  /** 一次操作要连打几遍（斧头三连砍） */
  repeat: number;
  /** 时限额外系数（越小越紧） */
  timeScale: number;
  actionLabel: string;
  /** 图鉴里展示的代表词 */
  flavor: string;
}

export const TOOLS: Record<ToolId, ToolDef> = {
  hoe: {
    id: 'hoe', name: '锄头', icon: '🔨', target: 'soil', price: 0,
    stamina: 4, time: 10, wordCat: 'farm', band: 1, repeat: 1, timeScale: 1,
    actionLabel: '开垦', flavor: 'furrow'
  },
  can: {
    id: 'can', name: '水壶', icon: '🚿', target: 'crop', price: 0,
    stamina: 2, time: 10, wordCat: 'farm', band: 0, repeat: 1, timeScale: 1,
    actionLabel: '浇水', flavor: 'sprinkle'
  },
  axe: {
    id: 'axe', name: '斧头', icon: '🪓', target: 'tree', price: 400,
    stamina: 6, time: 20, wordCat: 'chop', band: 3, repeat: 3, timeScale: 0.9,
    actionLabel: '砍树', flavor: 'cleave'
  },
  pick: {
    id: 'pick', name: '镐', icon: '⛏️', target: 'rock', price: 500,
    stamina: 7, time: 25, wordCat: 'mine', band: 4, repeat: 1, timeScale: 0.8,
    actionLabel: '挖石', flavor: 'excavate'
  },
  sickle: {
    id: 'sickle', name: '镰刀', icon: '🌾', target: 'weed', price: 200,
    stamina: 2, time: 5, wordCat: 'cut', band: 0, repeat: 3, timeScale: 0.7,
    actionLabel: '割草', flavor: 'swath'
  },
  rod: {
    id: 'rod', name: '钓竿', icon: '🎣', target: 'water', price: 350,
    stamina: 5, time: 30, wordCat: 'fish', band: 1, repeat: 1, timeScale: 1,
    actionLabel: '钓鱼', flavor: 'bobber'
  }
};

export const TOOL_ORDER: ToolId[] = ['hoe', 'can', 'axe', 'pick', 'sickle', 'rod'];

/** 咬钩后的反应窗口（毫秒），等级越高越宽容 */
export function biteWindow(tier: number): number {
  return 1200 + (tier - 1) * 250;
}

/** 等待咬钩的随机时长范围（毫秒） */
export const BITE_DELAY: [number, number] = [900, 3600];

/* ---------------- 等级 ---------------- */

export interface TierInfo {
  tier: number;
  name: string;
  cost: number;
  wood: number;
  stone: number;
  stamina: number;
  time: number;
  tolerance: number;
  desc: string;
}

export const TIERS: TierInfo[] = [
  { tier: 1, name: '铜', cost: 0, wood: 0, stone: 0, stamina: 1.0, time: 1.0, tolerance: 0, desc: '朴素但顺手' },
  { tier: 2, name: '银', cost: 600, wood: 8, stone: 0, stamina: 0.9, time: 1.0, tolerance: 1, desc: '打错一次不算失误' },
  { tier: 3, name: '金', cost: 1800, wood: 0, stone: 20, stamina: 0.85, time: 1.25, tolerance: 1, desc: '时限 +25%' },
  { tier: 4, name: '秘银', cost: 4200, wood: 30, stone: 30, stamina: 0.8, time: 1.25, tolerance: 2, desc: '容错 2 次 + 专属能力' }
];

export function tierInfo(tier: number): TierInfo {
  return TIERS[Math.max(0, Math.min(TIERS.length - 1, tier - 1))];
}

/* ---------------- 耐久 ---------------- */

/** 各等级的耐久上限：升级顺带更耐用 */
const TIER_DURABILITY = [100, 140, 180, 240];

export function toolMaxDurability(tier: number): number {
  return TIER_DURABILITY[Math.max(0, Math.min(TIER_DURABILITY.length - 1, tier - 1))];
}

/** 一次劳作消耗的耐久（秘银更省） */
export function wearPerUse(tier: number): number {
  return tier >= 4 ? 0.5 : 1;
}

/**
 * 修理费用：等级越高越贵。
 * 刻意只要金币、不要材料——否则「修工具要石材 → 石材要镐挖 → 镐也坏了」会死锁。
 */
export function repairCost(tier: number): number {
  return tier * 60;
}

/** 耐久低于这个比例就提示「快坏了」 */
export const DURABILITY_WARN = 0.2;

export function durabilityRatio(durability: number, tier: number): number {
  const max = toolMaxDurability(tier);
  return max <= 0 ? 0 : Math.max(0, Math.min(1, durability / max));
}

/** 斧头/镐这类"敲石头"的升级偏石材 */
export function upgradeMaterial(tool: ToolId, tier: number): { wood: number; stone: number; cost: number } {
  const t = tierInfo(tier);
  if (tool === 'axe' || tool === 'pick') {
    if (tier === 2) return { wood: 0, stone: 10, cost: t.cost };
    if (tier === 3) return { wood: 0, stone: 24, cost: t.cost };
  }
  return { wood: t.wood, stone: t.stone, cost: t.cost };
}

/** 秘银专属：一次处理的最大目标数 */
export function multiTarget(tool: ToolId, tier: number): number {
  if (tier < 4) return 1;
  if (tool === 'hoe') return 3;
  if (tool === 'can') return 2;
  return 1;
}

/** 一次操作造成的打击数 = 连打词数 */
export function hitCount(tool: ToolId): number {
  if (tool === 'axe') return 3;
  if (tool === 'sickle') return 3;
  return 1;
}

/** 秘银级掉落翻倍 */
export function dropMultiplier(tool: ToolId, tier: number): number {
  return tier >= 4 && (tool === 'pick' || tool === 'axe') ? 2 : 1;
}

/** 该工具一次操作的连打词数 */
export function repeatCount(tool: ToolId): number {
  return TOOLS[tool].repeat;
}

/* ---------------- 资源节点 ---------------- */

export interface NodeDef {
  kind: 'tree' | 'rock' | 'weed';
  name: string;
  hp: number;
  drop: string;
  dropMin: number;
  dropMax: number;
  regrow: number;
  tool: ToolId;
}

export const NODE_DEFS: Record<'tree' | 'rock' | 'weed', NodeDef> = {
  tree: { kind: 'tree', name: '树', hp: 3, drop: 'mat.wood', dropMin: 2, dropMax: 4, regrow: 3, tool: 'axe' },
  rock: { kind: 'rock', name: '岩石', hp: 2, drop: 'mat.stone', dropMin: 2, dropMax: 3, regrow: 5, tool: 'pick' },
  weed: { kind: 'weed', name: '杂草', hp: 1, drop: 'mat.fiber', dropMin: 1, dropMax: 2, regrow: 0, tool: 'sickle' }
};
