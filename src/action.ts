/* ============================================================
   action.ts — 把「面朝的格子 + 手持物」解析成一个具体动作
   game 与 render 共用，保证提示和实际行为永远一致
   ============================================================ */

import { CROPS } from './config';
import { targetAt, T, tileAt, plotAreaOf, areaUnlocked, isIndoor } from './world';
import { TOOLS } from './tools';
import type { GameState, ResNode, ToolId } from './types';

export type ActionKind =
  | 'till' | 'plant' | 'water' | 'harvest'
  | 'chop' | 'mine' | 'cut' | 'fish'
  | 'door' | 'bin' | 'order' | 'locked' | 'sleep' | 'dex' | 'ladder' | 'craft';

export interface ActionInfo {
  kind: ActionKind;
  label: string;
  tx: number;
  ty: number;
  /** 需要的工具；null = 徒手或种子 */
  tool: ToolId | null;
  plotIndex: number;
  nodeKey: string | null;
  /** 该动作是否需要一个种子 */
  needsSeed: boolean;
}

export function nodeAt(state: GameState, tx: number, ty: number): ResNode | null {
  for (const n of state.nodes) {
    if (n.tx === tx && n.ty === ty && n.hp > 0) return n;
  }
  return null;
}

/** 当前手持的引用 */
export function heldRef(state: GameState): GameState['hotbar'][number] {
  return state.hotbar[state.equipSlot] ?? null;
}

/** 当前手持的工具（手持种子时返回 null） */
export function heldTool(state: GameState): ToolId | null {
  const ref = heldRef(state);
  return ref && ref.type === 'tool' ? ref.id : null;
}

/** 手持的种子物品 id */
export function heldSeedId(state: GameState): string | null {
  const ref = heldRef(state);
  return ref && ref.type === 'seed' ? ref.id : null;
}

/** 快捷栏里是否放了某工具 */
export function hotbarHasTool(state: GameState, tool: ToolId): boolean {
  return state.hotbar.some((r) => r != null && r.type === 'tool' && r.id === tool);
}

export function hotbarSlotOfTool(state: GameState, tool: ToolId): number {
  return state.hotbar.findIndex((r) => r != null && r.type === 'tool' && r.id === tool);
}

export function resolveTarget(state: GameState, tx: number, ty: number): ActionInfo | null {
  const base = (kind: ActionKind, label: string, tool: ToolId | null, extra?: Partial<ActionInfo>): ActionInfo => ({
    kind, label, tool, tx, ty, plotIndex: -1, nodeKey: null, needsSeed: false, ...extra
  });

  // 1) 资源节点优先（杂草可能长在地块上）
  const node = nodeAt(state, tx, ty);
  if (node) {
    if (node.kind === 'tree') return base('chop', '砍树', 'axe', { nodeKey: node.key });
    if (node.kind === 'rock') return base('mine', '挖石', 'pick', { nodeKey: node.key });
    if (node.kind === 'oreCopper' || node.kind === 'oreIron' || node.kind === 'oreGem') {
      return base('mine', '挖矿', 'pick', { nodeKey: node.key });
    }
    return base('cut', '割草', 'sickle', { nodeKey: node.key });
  }

  // 2) 水面：钓鱼
  if (tileAt(tx, ty) === T.WATER) {
    return base('fish', TOOLS.rod.actionLabel, 'rod');
  }

  // 3) 门与物件
  const t = targetAt(tx, ty);
  if (!t) return null;
  if (t.kind === 'door') return base('door', isIndoor() ? '出门' : '进屋', null);
  if (t.kind === 'ladder') return base('ladder', '上下楼', null);
  if (t.kind === 'bed') return base('sleep', '睡觉', null);
  if (t.kind === 'shelf') return base('dex', '图鉴', null);
  if (t.kind === 'bench') return base('craft', '加工', null);
  if (t.kind === 'object' && t.object) {
    if (t.object.kind === 'bin') return base('bin', '出货', null);
    if (t.object.kind === 'store') return base('order', '杂货店', null);
    return base('order', '订购', null);
  }

  // 3) 地块
  if (t.kind !== 'plot' || t.plotIndex < 0) return null;
  // 未解锁的耕地区域
  if (!areaUnlocked(plotAreaOf(t.plotIndex), state.farmUnlocked)) {
    return base('locked', '这块地还没开垦', null, { plotIndex: t.plotIndex });
  }
  const plot = state.plots[t.plotIndex];
  if (!plot.tilled) {
    return base('till', TOOLS.hoe.actionLabel, 'hoe', { plotIndex: t.plotIndex });
  }
  if (!plot.crop) {
    return base('plant', '播种', null, { plotIndex: t.plotIndex, needsSeed: true });
  }
  if (plot.stage >= CROPS[plot.crop].days) {
    return base('harvest', '收获', null, { plotIndex: t.plotIndex });
  }
  if (!plot.watered) {
    return base('water', TOOLS.can.actionLabel, 'can', { plotIndex: t.plotIndex });
  }
  return null;
}
