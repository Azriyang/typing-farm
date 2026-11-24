/* ============================================================
   animals.ts — 动物：定义、创建、游走、心情与产物
   ------------------------------------------------------------
   动物 = 每天必做的小事。喂食 → 次日产出 → 收获，抚摸涨心情。
   心情决定蛋 / 奶的品质，接进「照料质量 → 价值」主轴。
   ============================================================ */

import type { Animal, AnimalKind, Dir, GameState } from './types';
import { TILE, PENS, getScene, sceneOfAnimal, indoorAnimalPos } from './world';

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
  /** 产出方式：daily 每天一次，shear 攒够再剪 */
  yield: 'daily' | 'shear';
}

export const ANIMAL_DEFS: Record<AnimalKind, AnimalDef> = {
  chicken: {
    kind: 'chicken', name: '鸡', icon: '🐔', price: 600,
    productId: 'prod.egg', productName: '鸡蛋', productIcon: '🥚',
    building: 'coop', speed: 26, yield: 'daily'
  },
  cow: {
    kind: 'cow', name: '牛', icon: '🐄', price: 2200,
    productId: 'prod.milk', productName: '牛奶', productIcon: '🥛',
    building: 'barn', speed: 16, yield: 'daily'
  },
  sheep: {
    kind: 'sheep', name: '羊', icon: '🐑', price: 1200,
    productId: 'prod.wool', productName: '羊毛', productIcon: '🧶',
    building: 'barn', speed: 20, yield: 'shear'
  }
};

export const ANIMAL_ORDER: AnimalKind[] = ['chicken', 'cow', 'sheep'];

/** 羊毛每晚的成长量：约 3 天可剪一次 */
const WOOL_PER_NIGHT = 34;

/** 幼崽长大需要的天数 */
export const GROW_DAYS = 4;

/** 各动物怀孕（孵化）天数 */
export const PREGNANCY_DAYS: Record<AnimalKind, number> = {
  chicken: 2,
  cow: 3,
  sheep: 3
};

/** 配种需要的心情门槛 */
export const BREED_HAPPINESS = 70;

/** 每种动物的围栏上限 */
export const PER_KIND_LIMIT = 6;

/** 围栏内的像素活动边界（留边距，避免贴墙）；羊住牛棚，共用牛圈 */
export function penBounds(kind: AnimalKind): { minX: number; maxX: number; minY: number; maxY: number } {
  const p = PENS[kind === 'sheep' ? 'cow' : kind];
  return {
    minX: p.x0 * TILE + 18,
    maxX: (p.x1 + 1) * TILE - 18,
    minY: p.y0 * TILE + 22,
    maxY: (p.y1 + 1) * TILE - 14
  };
}

/** 当前是否有可收的产出（幼崽没有；羊看羊毛，其它看 productReady） */
export function isProductReady(a: Animal): boolean {
  if (!a.adult) return false;
  return a.kind === 'sheep' ? a.wool >= 100 : a.productReady;
}

let animalSeq = 0;

function newId(kind: AnimalKind): string {
  return `a${++animalSeq}_${kind}`;
}

function spawnPos(kind: AnimalKind): { x: number; y: number } {
  const b = penBounds(kind);
  return {
    x: b.minX + Math.random() * (b.maxX - b.minX),
    y: b.minY + Math.random() * (b.maxY - b.minY)
  };
}

export function createAnimal(kind: AnimalKind, name?: string): Animal {
  const { x, y } = spawnPos(kind);
  return {
    id: newId(kind),
    kind,
    name,
    happiness: 60,
    fedToday: false,
    pettedToday: false,
    // 新买的动物带一份「见面礼」，让玩家立刻见到收获动作
    productReady: true,
    // 新来的羊已经长满一身毛
    wool: kind === 'sheep' ? 100 : 0,
    adult: true,
    growDays: 0,
    pregnantDays: 0,
    x, y,
    dir: 'down',
    moving: false,
    wanderT: Math.random() * 2,
    tx: x, ty: y
  };
}

/** 新生的幼崽：不产出，要先长大 */
export function createBaby(kind: AnimalKind, name?: string): Animal {
  const { x, y } = spawnPos(kind);
  return {
    id: newId(kind),
    kind,
    name,
    happiness: 60,
    fedToday: false,
    pettedToday: false,
    productReady: false,
    wool: 0,
    adult: false,
    growDays: GROW_DAYS,
    pregnantDays: 0,
    x, y,
    dir: 'down',
    moving: false,
    wanderT: Math.random() * 2,
    tx: x, ty: y
  };
}

/** 这只动物现在能不能参与配种 */
export function canBreed(a: Animal): boolean {
  return a.adult && a.pregnantDays <= 0 && a.happiness >= BREED_HAPPINESS && a.fedToday;
}

/** 找一只能和 a 配种的同类（排除自己） */
export function breedPartner(state: GameState, a: Animal): Animal | null {
  for (const b of state.animals) {
    if (b.id === a.id) continue;
    if (b.kind !== a.kind) continue;
    if (!canBreed(b)) continue;
    return b;
  }
  return null;
}

/** 同种数量（含幼崽） */
export function countOfKind(state: GameState, kind: AnimalKind): number {
  return state.animals.filter((a) => a.kind === kind).length;
}

/** 这只动物此刻在围栏里的状态文案 */
export function animalStageText(a: Animal): string | null {
  if (!a.adult) return `幼崽 · 还要 ${Math.max(1, a.growDays)} 天长大`;
  if (a.pregnantDays > 0) return `怀孕中 · 还要 ${a.pregnantDays} 天`;
  return null;
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

/**
 * 场景感知的「面前最近的动物」。
 * 农场用自由坐标，室内用排布位置。
 */
export function animalNearInScene(state: GameState, px: number, py: number, dir: Dir): Animal | null {
  const s = getScene();
  if (s === 'farm') return animalNear(state, px, py, dir);
  // 只有鸡舍和牛棚里有动物；住宅/矿洞/小镇店铺都没有
  if (s !== 'coop' && s !== 'barn') return null;

  const [dvx, dvy] = DIR_VEC[dir];
  const fx = px + dvx * 34;
  const fy = py + dvy * 34;
  const dwellers = state.animals.filter((a) => sceneOfAnimal(a.kind) === s);

  let best: Animal | null = null;
  let bestD = 56;
  dwellers.forEach((a, i) => {
    const pos = indoorAnimalPos(s, i);
    const d = Math.hypot(pos.x - fx, pos.y - fy);
    if (d < bestD) { bestD = d; best = a; }
  });
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

/**
 * 睡觉时结算动物。
 * - 成年且喂了 → 次日有产物；羊攒羊毛
 * - 幼崽 → 成长倒计时，不产出
 * - 怀孕 → 倒计时，归零时生一只幼崽（围栏满了就不生）
 */
export function settleAnimalsOvernight(state: GameState): void {
  const newborns: Animal[] = [];

  for (const a of state.animals) {
    // 1) 产出（幼崽没有）
    if (a.adult) {
      if (a.kind === 'sheep') {
        a.productReady = false;
        if (a.fedToday) a.wool = Math.min(100, a.wool + WOOL_PER_NIGHT);
      } else {
        a.productReady = a.fedToday;
      }
    } else {
      a.productReady = false;
    }

    // 2) 心情
    if (a.fedToday) {
      a.happiness = Math.min(100, a.happiness + 3);
    } else {
      a.happiness = Math.max(0, a.happiness - 15);
    }

    // 3) 幼崽成长
    if (!a.adult && a.growDays > 0) {
      a.growDays--;
      if (a.growDays <= 0) {
        a.adult = true;
        a.growDays = 0;
        // 长大后给一份产出，让玩家立刻有反馈
        a.productReady = true;
        if (a.kind === 'sheep') a.wool = 100;
      }
    }

    // 4) 怀孕倒计时
    if (a.pregnantDays > 0) {
      a.pregnantDays--;
      if (a.pregnantDays <= 0) {
        // 围栏没满才生
        if (countOfKind(state, a.kind) + newborns.filter((n) => n.kind === a.kind).length < PER_KIND_LIMIT) {
          const baby = createBaby(a.kind, `${ANIMAL_DEFS[a.kind].name}${countOfKind(state, a.kind) + 1}`);
          baby.x = a.x + (Math.random() - 0.5) * 24;
          baby.y = a.y + 10;
          baby.tx = baby.x;
          baby.ty = baby.y;
          baby.happiness = Math.min(100, a.happiness);
          newborns.push(baby);
        }
      }
    }

    a.fedToday = false;
    a.pettedToday = false;
  }

  for (const b of newborns) state.animals.push(b);
}
