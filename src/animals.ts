/* ============================================================
   animals.ts — 动物：定义、创建、游走、心情与产物
   ------------------------------------------------------------
   动物 = 每天必做的小事。喂食 → 次日产出 → 收获，抚摸涨心情。
   心情决定蛋 / 奶的品质，接进「照料质量 → 价值」主轴。
   ============================================================ */

import type { Animal, AnimalKind, Dir, GameState } from './types';
import { TILE, PENS } from './world';

export interface AnimalDef {
  kind: AnimalKind;
  name: string;
  icon: string;
  price: number;
  productId: string;
  productName: string;
  productIcon: string;
  building: 'coop' | 'barn';
  /** 游走速度 px/s */
  speed: number;
}

export const ANIMAL_DEFS: Record<AnimalKind, AnimalDef> = {
  chicken: {
    kind: 'chicken', name: '鸡', icon: '🐔', price: 600,
    productId: 'prod.egg', productName: '鸡蛋', productIcon: '🥚',
    building: 'coop', speed: 26
  },
  cow: {
    kind: 'cow', name: '牛', icon: '🐄', price: 2200,
    productId: 'prod.milk', productName: '牛奶', productIcon: '🥛',
    building: 'barn', speed: 16
  }
};

export const ANIMAL_ORDER: AnimalKind[] = ['chicken', 'cow'];

/** 围栏内的像素活动边界（留边距，避免贴墙） */
export function penBounds(kind: AnimalKind): { minX: number; maxX: number; minY: number; maxY: number } {
  const p = PENS[kind];
  return {
    minX: p.x0 * TILE + 18,
    maxX: (p.x1 + 1) * TILE - 18,
    minY: p.y0 * TILE + 22,
    maxY: (p.y1 + 1) * TILE - 14
  };
}

let animalSeq = 0;

export function createAnimal(kind: AnimalKind): Animal {
  const b = penBounds(kind);
  const x = b.minX + Math.random() * (b.maxX - b.minX);
  const y = b.minY + Math.random() * (b.maxY - b.minY);
  return {
    id: `a${++animalSeq}_${kind}`,
    kind,
    happiness: 60,
    fedToday: false,
    pettedToday: false,
    // 新买的动物带一份「见面礼」，让玩家立刻见到收获动作
    productReady: true,
    x, y,
    dir: 'down',
    moving: false,
    wanderT: Math.random() * 2,
    tx: x, ty: y
  };
}

/** 每帧更新动物游走（有界随机漫步） */
export function updateAnimals(state: GameState, dt: number): void {
  for (const a of state.animals) {
    const def = ANIMAL_DEFS[a.kind];
    const b = penBounds(a.kind);
    a.wanderT -= dt;

    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const dist = Math.hypot(dx, dy);

    if (a.wanderT <= 0 || dist < 3) {
      if (Math.random() < 0.3) {
        a.tx = a.x; a.ty = a.y; // 原地歇一会儿
      } else {
        a.tx = b.minX + Math.random() * (b.maxX - b.minX);
        a.ty = b.minY + Math.random() * (b.maxY - b.minY);
      }
      a.wanderT = 1.5 + Math.random() * 3.5;
    }

    if (dist > 2) {
      a.x += (dx / dist) * def.speed * dt;
      a.y += (dy / dist) * def.speed * dt;
      a.moving = true;
      a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    } else {
      a.moving = false;
    }

    a.x = Math.max(b.minX, Math.min(b.maxX, a.x));
    a.y = Math.max(b.minY, Math.min(b.maxY, a.y));
  }
}

const DIR_VEC: Record<Dir, [number, number]> = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]
};

/** 找到玩家面朝方向附近最近的动物（用于交互） */
export function animalNear(state: GameState, px: number, py: number, dir: Dir): Animal | null {
  const [dvx, dvy] = DIR_VEC[dir];
  const fx = px + dvx * 34;
  const fy = py + dvy * 34;
  let best: Animal | null = null;
  let bestD = 52;
  for (const a of state.animals) {
    const d = Math.hypot(a.x - fx, a.y - fy);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

export function animalById(state: GameState, id: string): Animal | null {
  for (const a of state.animals) if (a.id === id) return a;
  return null;
}

/** 心情 → 基础品质（1~5）。照料得越好，蛋 / 奶越值钱。 */
export function happinessQuality(h: number): number {
  return Math.max(1, Math.min(5, 1 + Math.floor(h / 25)));
}

/** 睡觉时结算：喂了 → 明天有产物；没喂 → 掉心情。 */
export function settleAnimalsOvernight(state: GameState): void {
  for (const a of state.animals) {
    a.productReady = a.fedToday;
    if (a.fedToday) {
      a.happiness = Math.min(100, a.happiness + 3);
    } else {
      a.happiness = Math.max(0, a.happiness - 15);
    }
    a.fedToday = false;
    a.pettedToday = false;
  }
}
