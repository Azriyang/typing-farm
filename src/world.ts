/* ============================================================
   world.ts — 地图、地形、碰撞、交互目标
   ============================================================ */

import type { Dir, Player, SceneId } from './types';

export const TILE = 48;
export const MAP_W = 70;
export const MAP_H = 22;
export const VIEW_W = 960;
export const VIEW_H = 600;

/** 小镇从这一列开始（左侧是农场） */
export const TOWN_X = 33;

export const T = {
  GRASS: 0,
  PATH: 1,
  WATER: 2,
  SOIL: 3,
  WALL: 4,
  ROOF: 5,
  DOOR: 6,
  TREE: 7,
  FLOWER: 8,
  /* ---- 室内 ---- */
  /** 木地板 */
  FLOOR: 9,
  /** 石地板（棚舍） */
  FLOOR_STONE: 10,
  /** 室内墙 */
  WALL_IN: 11,
  /** 矿洞岩壁 */
  MINE_WALL: 12,
  /** 矿洞地面 */
  MINE_FLOOR: 13,
  /** 梯子（上下楼） */
  LADDER: 14,
  /** 茂密的边界灌木带：连续实体，不是一丛丛的树 */
  HEDGE: 15
} as const;

export type TileId = (typeof T)[keyof typeof T];

/* ---------------- 室内家具 ---------------- */

export type FurnitureKind = 'bed' | 'shelf' | 'table' | 'trough' | 'nest' | 'hay' | 'rug' | 'bench' | 'stove' | 'chest'
  | 'counter' | 'barrel' | 'forge' | 'anvil' | 'blackboard';

export interface Furniture {
  kind: FurnitureKind;
  tx: number;
  ty: number;
  w: number;
  h: number;
  scene: IndoorScene;
}

/** 家具按整个方块绘制（不是逐格拼），坐标是左上角 */
export const FURNITURE: Furniture[] = [
  // 住宅
  { kind: 'bed', tx: 18, ty: 7, w: 2, h: 3, scene: 'house' },
  { kind: 'shelf', tx: 30, ty: 7, w: 2, h: 1, scene: 'house' },
  { kind: 'table', tx: 21, ty: 10, w: 3, h: 2, scene: 'house' },
  { kind: 'bench', tx: 27, ty: 12, w: 2, h: 1, scene: 'house' },
  { kind: 'stove', tx: 30, ty: 13, w: 2, h: 1, scene: 'house' },
  { kind: 'chest', tx: 18, ty: 14, w: 2, h: 1, scene: 'house' },

  // 酒馆：长吧台 + 酒桶 + 几张桌
  { kind: 'counter', tx: 20, ty: 8, w: 6, h: 1, scene: 'tavern' },
  { kind: 'barrel', tx: 18, ty: 7, w: 1, h: 1, scene: 'tavern' },
  { kind: 'barrel', tx: 19, ty: 7, w: 1, h: 1, scene: 'tavern' },
  { kind: 'table', tx: 22, ty: 12, w: 2, h: 1, scene: 'tavern' },
  { kind: 'table', tx: 27, ty: 12, w: 2, h: 1, scene: 'tavern' },
  { kind: 'stove', tx: 28, ty: 7, w: 2, h: 1, scene: 'tavern' },

  // 铁匠铺：炉子 + 铁砧 + 水桶
  { kind: 'forge', tx: 19, ty: 8, w: 2, h: 1, scene: 'smith' },
  { kind: 'anvil', tx: 24, ty: 8, w: 1, h: 1, scene: 'smith' },
  { kind: 'barrel', tx: 28, ty: 12, w: 1, h: 1, scene: 'smith' },
  { kind: 'table', tx: 20, ty: 12, w: 2, h: 1, scene: 'smith' },

  // 诊所：两张病床 + 药柜
  { kind: 'bed', tx: 18, ty: 8, w: 2, h: 2, scene: 'clinic' },
  { kind: 'bed', tx: 27, ty: 8, w: 2, h: 2, scene: 'clinic' },
  { kind: 'shelf', tx: 23, ty: 7, w: 2, h: 1, scene: 'clinic' },
  { kind: 'table', tx: 22, ty: 12, w: 2, h: 1, scene: 'clinic' },

  // 学堂：黑板 + 课桌 + 书架
  { kind: 'blackboard', tx: 19, ty: 7, w: 7, h: 1, scene: 'school' },
  { kind: 'table', tx: 19, ty: 11, w: 2, h: 1, scene: 'school' },
  { kind: 'table', tx: 23, ty: 11, w: 2, h: 1, scene: 'school' },
  { kind: 'table', tx: 27, ty: 11, w: 2, h: 1, scene: 'school' },
  { kind: 'shelf', tx: 29, ty: 7, w: 2, h: 1, scene: 'school' },
  { kind: 'rug', tx: 21, ty: 10, w: 4, h: 3, scene: 'house' },
  // 鸡舍
  { kind: 'nest', tx: 19, ty: 7, w: 3, h: 1, scene: 'coop' },
  { kind: 'trough', tx: 19, ty: 11, w: 4, h: 1, scene: 'coop' },
  { kind: 'hay', tx: 28, ty: 12, w: 1, h: 2, scene: 'coop' },
  // 牛棚
  { kind: 'trough', tx: 17, ty: 7, w: 6, h: 1, scene: 'barn' },
  { kind: 'trough', tx: 27, ty: 7, w: 6, h: 1, scene: 'barn' },
  { kind: 'hay', tx: 16, ty: 13, w: 3, h: 2, scene: 'barn' },
  { kind: 'hay', tx: 31, ty: 14, w: 2, h: 1, scene: 'barn' },
  { kind: 'rug', tx: 22, ty: 10, w: 9, h: 4, scene: 'barn' }
];

export function furnitureAt(scene: SceneId, tx: number, ty: number): Furniture | null {
  for (const f of FURNITURE) {
    if (f.scene !== scene) continue;
    if (tx >= f.tx && tx < f.tx + f.w && ty >= f.ty && ty < f.ty + f.h) return f;
  }
  return null;
}

/** 哪种动物住哪个棚 */
export function sceneOfAnimal(kind: string): 'coop' | 'barn' {
  return kind === 'chicken' ? 'coop' : 'barn';
}

/**
 * 动物在室内的位置：按序号排在房间中部的空地上。
 * 室内场地小，不做游走，固定站位更整齐。
 */
export function indoorAnimalPos(scene: 'coop' | 'barn', index: number): { x: number; y: number } {
  const r = ROOMS[scene];
  const cols = 4;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const startX = r.x0 + 3;
  const startY = r.y0 + 4;
  return {
    x: (startX + col * 3) * 48 + 24,
    y: (startY + row * 3) * 48 + 24
  };
}

/** 耕地区域：第 0 块初始就有，第 1 块要花钱买 */
/**
 * 农场耕地：四块，从中央向两侧扩。
 * 参考牧场物语——整片地一开始就看得见，但工具和体力只够开垦一小角。
 */
export const FARM_AREAS = [
  { x: 5, y: 9, cols: 14, rows: 5 },    // 70 格（初始免费）
  { x: 21, y: 9, cols: 11, rows: 5 },   // 55 格（2500G）
  { x: 5, y: 15, cols: 14, rows: 2 },   // 28 格（8000G）
  { x: 21, y: 15, cols: 11, rows: 2 }   // 22 格（16000G）
] as const;

/** 从第几块起需要购买解锁 */
export const AREA_UNLOCK_COST = [0, 2500, 8000, 16000];

/** 兼容旧代码：第一块耕地 */
export const FARM = FARM_AREAS[0];

/**
 * 四种木材来源的分布。
 * 刻意按"离农场由近到远"排：树桩和灌木在近处（开局就能砍），
 * 大树放在外围（要走远、费体力，但一趟拉满）。
 */
/** 大树：4 下才倒，5~8 木材 */
export const BIG_TREE_SPOTS: Array<[number, number]> = [
  [12, 4], [19, 3], [26, 4], [29, 6], [19, 20]
];

/** 小树：2 下，2~3 木材 */
export const SAPLING_SPOTS: Array<[number, number]> = [
  [16, 6], [22, 6], [27, 6], [11, 4], [30, 8]
];

/** 灌木：1 下就倒，1 木材，但两天就长回来 */
export const SHRUB_SPOTS: Array<[number, number]> = [
  [14, 6], [17, 6], [24, 6], [9, 6], [20, 4], [28, 5]
];

/** 老树桩：一次性，挖掉永久消失 */
export const STUMP_SPOTS: Array<[number, number]> = [
  [2, 4], [2, 12], [31, 14]
];

/** 兼容旧代码：所有树的坐标 */
export const TREE_SPOTS: Array<[number, number]> = [
  ...BIG_TREE_SPOTS, ...SAPLING_SPOTS, ...SHRUB_SPOTS, ...STUMP_SPOTS
];

/** 可开采的岩石（动态节点）；原 y8 的四块让位给进镇道路，移到镇西石堆 */
export const ROCK_SPOTS: Array<[number, number]> = [
  [19, 6], [20, 6], [30, 3], [31, 4], [19, 17], [20, 17], [26, 3], [2, 8]
];

/** 鸡舍 / 牛棚（实心，挡路） */
export const BUILDINGS = {
  coop: { x: 3, y: 18, w: 3, h: 2 },
  barn: { x: 8, y: 18, w: 4, h: 2 }
} as const;

/** 小镇建筑（实心，挡路）；kind 用于渲染配色与交互 */
export type TownBuildingKind = 'store' | 'house' | 'tavern' | 'smith' | 'clinic' | 'school' | 'tower';

export interface TownBuilding {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: TownBuildingKind;
  roof: string;
  /** 门在建筑内的相对位置（tile）；有 door 表示能进去 */
  door?: { dx: number; dy: number };
}

/** 北侧一条街 + 南侧民宅，中间是主街与广场。刻意错落：高度、宽度、退进都不齐 */
export const TOWN_BUILDINGS: TownBuilding[] = [
  // ── 广场北侧一圈：底边统一压在 y6，直接贴着广场北沿（y7）──
  { x: 34, y: 3, w: 4, h: 4, kind: 'store',  roof: '#4a8fbe', door: { dx: 1, dy: 3 } },
  { x: 39, y: 3, w: 3, h: 4, kind: 'tavern', roof: '#c9563f', door: { dx: 1, dy: 3 } },
  { x: 44, y: 3, w: 4, h: 4, kind: 'smith',  roof: '#8a8a8a', door: { dx: 1, dy: 3 } },
  { x: 49, y: 3, w: 5, h: 4, kind: 'school', roof: '#a9743f', door: { dx: 2, dy: 3 } },
  { x: 56, y: 3, w: 3, h: 4, kind: 'clinic', roof: '#e8e2d4', door: { dx: 1, dy: 3 } },
  { x: 60, y: 2, w: 3, h: 6, kind: 'tower',  roof: '#6b6b6b' },                          // 钟楼在广场东北角，不挡路

  // ── 南区民宅：朝向各不相同（东 / 北 / 西）──
  { x: 35, y: 10, w: 3, h: 3, kind: 'house', roof: '#c9743f' },
  { x: 35, y: 14, w: 3, h: 3, kind: 'house', roof: '#6fae4e' },
  { x: 39, y: 14, w: 3, h: 3, kind: 'house', roof: '#b06a8f' },
  { x: 48, y: 14, w: 3, h: 3, kind: 'house', roof: '#c9a23f' },   // 紧贴广场南沿
  { x: 52, y: 14, w: 4, h: 3, kind: 'house', roof: '#7a8fb0' },
  { x: 57, y: 14, w: 3, h: 3, kind: 'house', roof: '#9a7a5a' }
];

/** 广场（路网枢纽）：主街从西撞进来，东街从东沿出去 */
export const TOWN_PLAZA = { x: 46, y: 7, w: 9, h: 7 };

/** 广场喷泉（地标，挡路） */
export const TOWN_FOUNTAIN = { x: 49, y: 9, w: 3, h: 3 };

/** 水井（南巷西侧，装饰 + 可打水） */
export const TOWN_WELL = { x: 39, y: 10, w: 2, h: 2 };

/** 小菜园（南巷东侧，镇民自己种的） */
export const TOWN_GARDEN = { x: 44, y: 15, w: 3, h: 2 };

/** 东侧树林范围（镇子自然的东边界） */
export const TOWN_FOREST = { x: 63, y: 2, w: 5, h: 16 };

/** 南巷：从主街末段插到南区 */
export const TOWN_ALLEY = { x: 43, y0: 9, y1: 17 };

/** 村民游走 / 玩家可行走的小镇开放区 */
export const TOWN_OPEN = { x0: 33, y0: 6, x1: 67, y1: 13 };

/** 是否落在小镇区域（排除杂草等） */
export function inTownArea(tx: number): boolean {
  return tx >= TOWN_X - 2;
}

/** 围栏活动区（可走入，动物在其中游走） */
export const PENS = {
  chicken: { x0: 2, y0: 18, x1: 7, y1: 20 },
  cow: { x0: 8, y0: 18, x1: 16, y1: 20 }
} as const;

/** 是否落在畜栏 / 棚舍区域（用于排除杂草生成等） */
export function inAnimalArea(tx: number, ty: number): boolean {
  for (const p of Object.values(PENS)) {
    if (tx >= p.x0 && tx <= p.x1 && ty >= p.y0 && ty <= p.y1) return true;
  }
  for (const b of Object.values(BUILDINGS)) {
    if (tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h) return true;
  }
  return false;
}

export type ObjectKind = 'bin' | 'order' | 'store' | 'board';

export interface WorldObject {
  kind: ObjectKind;
  tx: number;
  ty: number;
  label: string;
}

export const OBJECTS: WorldObject[] = [
  { kind: 'bin', tx: 18, ty: 8, label: '出货箱' },
  { kind: 'order', tx: 10, ty: 5, label: '订购箱' },
  { kind: 'store', tx: 35, ty: 5, label: '杂货店' },
  { kind: 'board', tx: 46, ty: 10, label: '委托板' }
];

const terrain = new Uint8Array(MAP_W * MAP_H);
/** 动态阻挡（树 / 岩石等节点） */
const dynamicBlocked = new Set<number>();

function idx(x: number, y: number): number {
  return y * MAP_W + x;
}

export function tileAt(x: number, y: number): TileId {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return T.TREE;
  return terrain[idx(x, y)] as TileId;
}

function set(x: number, y: number, t: TileId): void {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
  terrain[idx(x, y)] = t;
}

function setRect(x0: number, y0: number, w: number, h: number, t: TileId): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) set(x, y, t);
  }
}

/* ---------------- 场景 ---------------- */

/** 室内房间布局：地板范围 + 门位置（门在底边，用于出入） */
export interface Room {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  floor: TileId;
  door: { tx: number; ty: number };
  /** 进入后站的位置（门内侧一格） */
  spawn: { tx: number; ty: number; dir: Dir };
}

/* ---------------- 室内 ---------------- */

/** 可进入的室内场景 */
export type IndoorScene = 'house' | 'coop' | 'barn' | 'tavern' | 'smith' | 'clinic' | 'school';

/** 小镇店铺场景（进店时店主会出现在柜台后） */
export const SHOP_SCENES: IndoorScene[] = ['tavern', 'smith', 'clinic', 'school'];

export function isShopScene(id: string): boolean {
  return (SHOP_SCENES as string[]).includes(id);
}

export const ROOMS: Record<IndoorScene, Room> = {
  house: {
    x0: 17, y0: 6, x1: 32, y1: 15,
    floor: T.FLOOR,
    door: { tx: 24, ty: 16 },
    spawn: { tx: 24, ty: 15, dir: 'up' }
  },
  coop: {
    x0: 17, y0: 6, x1: 30, y1: 15,
    floor: T.FLOOR_STONE,
    door: { tx: 23, ty: 16 },
    spawn: { tx: 23, ty: 15, dir: 'up' }
  },
  barn: {
    x0: 15, y0: 5, x1: 34, y1: 16,
    floor: T.FLOOR_STONE,
    door: { tx: 24, ty: 17 },
    spawn: { tx: 24, ty: 16, dir: 'up' }
  },
  tavern: {
    x0: 16, y0: 6, x1: 31, y1: 15,
    floor: T.FLOOR,
    door: { tx: 23, ty: 16 },
    spawn: { tx: 23, ty: 15, dir: 'up' }
  },
  smith: {
    x0: 17, y0: 6, x1: 30, y1: 14,
    floor: T.FLOOR_STONE,
    door: { tx: 23, ty: 15 },
    spawn: { tx: 23, ty: 14, dir: 'up' }
  },
  clinic: {
    x0: 17, y0: 6, x1: 30, y1: 14,
    floor: T.FLOOR_STONE,
    door: { tx: 23, ty: 15 },
    spawn: { tx: 23, ty: 14, dir: 'up' }
  },
  school: {
    x0: 16, y0: 6, x1: 31, y1: 15,
    floor: T.FLOOR,
    door: { tx: 23, ty: 16 },
    spawn: { tx: 23, ty: 15, dir: 'up' }
  }
};

/** 农场里三个建筑的门位置（用于从室内走回农场时定位置） */
export const FARM_DOORS: Record<'house' | 'coop' | 'barn' | 'mine', { tx: number; ty: number }> = {
  house: { tx: 5, ty: 6 },
  coop: { tx: 4, ty: 19 },
  barn: { tx: 9, ty: 19 },
  mine: { tx: 13, ty: 3 }
};

/* ---------------- 矿洞 ---------------- */

/** 矿洞总层数 */
export const MINE_FLOORS = 5;

/** 当前所在矿洞层（1 起；不在矿洞里时为 0） */
let mineFloor = 0;
export function getMineFloor(): number {
  return mineFloor;
}
export function setMineFloor(n: number): void {
  mineFloor = n;
}

/** 矿洞房间范围（每层相同布局） */
export const MINE_ROOM = {
  x0: 17, y0: 5, x1: 32, y1: 17,
  /** 上行梯子（回上一层 / 回农场） */
  up: { tx: 19, ty: 7 },
  /** 下行梯子（下一层；最深层没有） */
  down: { tx: 30, ty: 15 },
  /** 进入时的落点 */
  spawn: { tx: 19, ty: 8, dir: 'down' as Dir }
};

/** 某层的矿脉配置：种类 + 数量 */
export function mineOrePlan(floor: number): Array<{ kind: 'oreCopper' | 'oreIron' | 'oreGem'; count: number }> {
  if (floor <= 2) return [{ kind: 'oreCopper', count: 4 }];
  if (floor <= 4) return [{ kind: 'oreCopper', count: 2 }, { kind: 'oreIron', count: 3 }];
  return [{ kind: 'oreIron', count: 3 }, { kind: 'oreGem', count: 2 }];
}

/** 从室内出来时站在门外哪里 */
export function farmExitSpot(id: 'house' | 'coop' | 'barn' | 'mine'): { tx: number; ty: number; dir: Dir } {
  const d = FARM_DOORS[id];
  return { tx: d.tx, ty: d.ty + 1, dir: 'down' };
}

let scene: SceneId = 'farm';
export function getScene(): SceneId {
  return scene;
}
export function isIndoor(s: SceneId = scene): boolean {
  return s !== 'farm';
}

/* ---------------- 地图生成 ---------------- */

/** 构建指定场景（会重填 terrain） */
export function buildScene(id: SceneId): void {
  scene = id;
  dynamicBlocked.clear();
  if (id === 'farm') { buildFarmTerrain(); return; }

  if (id === 'mine') { buildMineTerrain(); return; }

  // 室内：整张图先填墙，再挖出房间地板
  terrain.fill(T.WALL_IN);
  const r = ROOMS[id as IndoorScene];
  setRect(r.x0, r.y0, r.x1 - r.x0 + 1, r.y1 - r.y0 + 1, r.floor);
  // 门
  set(r.door.tx, r.door.ty, T.DOOR);
}

function buildMineTerrain(): void {
  const r = MINE_ROOM;
  terrain.fill(T.MINE_WALL);
  setRect(r.x0, r.y0, r.x1 - r.x0 + 1, r.y1 - r.y0 + 1, T.MINE_FLOOR);
  set(r.up.tx, r.up.ty, T.LADDER);
  if (mineFloor < MINE_FLOORS) set(r.down.tx, r.down.ty, T.LADDER);
}

function buildFarmTerrain(): void {
  terrain.fill(T.GRASS);

  /** 确定性噪声：同一坐标永远同一值，保证底图可重绘 */
  const noise = (x: number, y: number): number => {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    n = (n ^ (n >>> 13)) | 0;
    n = Math.imul(n, 1274126177) | 0;
    n = (n ^ (n >>> 16)) >>> 0;
    return n / 4294967296;
  };

  // 外圈树墙：**两圈全部填满**。
  // 之前第二圈用噪声散开（约 58%），结果看起来是一丛丛带缝的灌木，
  // 一眼就能看到缝。边界要"茂密到一看就走不过去"，所以不留洞。
  for (let x = 0; x < MAP_W; x++) {
    set(x, 0, T.HEDGE);
    set(x, 1, T.HEDGE);
    set(x, MAP_H - 1, T.HEDGE);
    // 倒数第二行：畜栏那一段留出地面。
    // 畜舍门在 y=19，玩家要站在 y=20 才能面对门；这一行如果也种满灌木，
    // 鸡舍和牛棚就永远进不去了（曾经就是这样被挡死的）。畜栏也用到这一行。
    const penStrip = x >= PENS.chicken.x0 && x <= PENS.cow.x1;
    if (!penStrip) set(x, MAP_H - 2, T.HEDGE);
  }
  for (let y = 0; y < MAP_H; y++) {
    set(0, y, T.HEDGE);
    set(1, y, T.HEDGE);
    set(MAP_W - 1, y, T.HEDGE);
    set(MAP_W - 2, y, T.HEDGE);
  }
  // 零散的树（农场外围）：密度压到很低，只当点缀，避免看起来像"有洞"
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      if (x >= TOWN_X - 2) continue;             // 小镇区域留空
      if (noise(x * 3, y * 5) > 0.975) set(x, y, T.TREE);
    }
  }

  // 农场与小镇的分界树篱：只留主街一个口，其余**全部填满**
  for (let y = 2; y < MAP_H - 1; y++) {
    if (y === 7 || y === 8) continue;
    set(32, y, T.HEDGE);
  }

  // 池塘
  const pcx = 26, pcy = 19, prx = 3.6, pry = 1.9;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const dx = (x - pcx) / prx;
      const dy = (y - pcy) / pry;
      if (dx * dx + dy * dy <= 1) set(x, y, T.WATER);
    }
  }

  // 小屋 6x5
  setRect(3, 2, 6, 3, T.ROOF);
  setRect(3, 5, 6, 2, T.WALL);
  set(5, 6, T.DOOR);

  // 鸡舍 / 牛棚 / 矿洞的门（让玩家能从外面走进去）
  set(FARM_DOORS.coop.tx, FARM_DOORS.coop.ty, T.DOOR);
  set(FARM_DOORS.barn.tx, FARM_DOORS.barn.ty, T.DOOR);
  set(FARM_DOORS.mine.tx, FARM_DOORS.mine.ty, T.DOOR);

  // 小路（农场）+ 向东延伸的进镇主街
  setRect(4, 7, 15, 1, T.PATH);
  for (let x = 4; x <= 18; x++) set(x, 8, T.PATH);
  set(5, 8, T.PATH);
  for (let x = 18; x < MAP_W; x++) { set(x, 7, T.PATH); set(x, 8, T.PATH); }

  // 农田（只铺第一块；第二块买地后由 unlockArea 铺上）
  setRect(FARM_AREAS[0].x, FARM_AREAS[0].y, FARM_AREAS[0].cols, FARM_AREAS[0].rows, T.SOIL);

  // 小镇南边的河：横贯全镇，小渔在这儿钓鱼
  for (let x = 33; x < MAP_W - 1; x++) {
    set(x, 19, T.WATER);
    set(x, 20, T.WATER);
  }
  // 河岸（可走的石滩）
  for (let x = 33; x < MAP_W - 1; x++) {
    if (tileAt(x, 18) === T.GRASS) set(x, 18, T.PATH);
  }

  // 小镇路网：主街 → 广场 → 东街，南巷插到民宅区
  setRect(33, 8, 13, 1, T.PATH);                  // 主街 x33-45
  setRect(TOWN_PLAZA.x, TOWN_PLAZA.y, TOWN_PLAZA.w, TOWN_PLAZA.h, T.PATH);  // 广场
  setRect(55, 8, 8, 1, T.PATH);                   // 东街 x55-62（x63 起是树林）
  for (let y = TOWN_ALLEY.y0; y <= TOWN_ALLEY.y1; y++) {
    if (tileAt(TOWN_ALLEY.x, y) === T.GRASS) set(TOWN_ALLEY.x, y, T.PATH);
  }

  // 东侧树林：镇子的自然东边界，填满（留一道稀疏的内缘做过渡）
  for (let y = TOWN_FOREST.y; y < TOWN_FOREST.y + TOWN_FOREST.h; y++) {
    for (let x = TOWN_FOREST.x; x < TOWN_FOREST.x + TOWN_FOREST.w; x++) {
      // 最内侧一列用噪声留点缺口，看起来像林子边缘而不是一堵墙
      const inner = x === TOWN_FOREST.x;
      if (inner && noise(x * 7, y * 11) < 0.35) continue;
      set(x, y, T.TREE);
    }
  }

  // 小菜园：镇民自己种的那块（踩实的土）
  setRect(TOWN_GARDEN.x, TOWN_GARDEN.y, TOWN_GARDEN.w, TOWN_GARDEN.h, T.SOIL);

  // 花丛（可走过）
  const flowers: Array<[number, number]> = [
    [7, 10], [8, 14], [6, 14], [16, 14], [17, 6], [6, 11], [9, 9],
    [33, 6], [63, 6], [33, 12], [64, 12], [36, 12], [58, 9], [45, 12]
  ];
  for (const [x, y] of flowers) if (tileAt(x, y) === T.GRASS) set(x, y, T.FLOWER);
}

/** 兼容旧调用：建农场 */
export function buildMap(): void {
  buildScene('farm');
}

/* ---------------- 碰撞 ---------------- */

const BLOCKED: Record<number, boolean> = {
  [T.WATER]: true,
  [T.WALL]: true,
  [T.ROOF]: true,
  [T.DOOR]: true,
  [T.TREE]: true,
  [T.HEDGE]: true,
  [T.WALL_IN]: true,
  [T.MINE_WALL]: true,
  [T.LADDER]: true
};

export function setNodeBlock(tx: number, ty: number, blocked: boolean): void {
  if (blocked) dynamicBlocked.add(idx(tx, ty));
  else dynamicBlocked.delete(idx(tx, ty));
}

export function isBlockedTile(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return true;
  if (BLOCKED[tileAt(x, y)]) return true;
  if (dynamicBlocked.has(idx(x, y))) return true;
  // 室内家具阻挡（地毯可走）
  const f = furnitureAt(scene, x, y);
  if (f && f.kind !== 'rug') return true;
  // 农场物件与建筑只在农场场景生效
  if (scene === 'farm') {
    for (const o of OBJECTS) if (o.tx === x && o.ty === y) return true;
    for (const b of Object.values(BUILDINGS)) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return true;
    }
    for (const b of TOWN_BUILDINGS) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return true;
    }
    if (x >= TOWN_FOUNTAIN.x && x < TOWN_FOUNTAIN.x + TOWN_FOUNTAIN.w
      && y >= TOWN_FOUNTAIN.y && y < TOWN_FOUNTAIN.y + TOWN_FOUNTAIN.h) return true;
  }
  return false;
}

/** 以脚部为中心的碰撞盒 */
export function canStand(px: number, py: number): boolean {
  const hw = 12, hh = 9;
  const pts: Array<[number, number]> = [
    [px - hw, py - hh],
    [px + hw - 1, py - hh],
    [px - hw, py + 2],
    [px + hw - 1, py + 2]
  ];
  for (const [x, y] of pts) {
    if (isBlockedTile(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
  }
  return true;
}

/* ---------------- 耕地 ---------------- */

/** 每个区域的地块数 */
export function areaSize(k: number): number {
  const a = FARM_AREAS[k];
  return a ? a.cols * a.rows : 0;
}

/** 全局地块索引 → 所属区域 */
export function plotAreaOf(index: number): number {
  let i = index;
  for (let k = 0; k < FARM_AREAS.length; k++) {
    const n = areaSize(k);
    if (i < n) return k;
    i -= n;
  }
  return 0;
}

/** 该区域是否已解锁（farmUnlocked = 已解锁的区域数） */
export function areaUnlocked(k: number, farmUnlocked: number): boolean {
  return k < farmUnlocked;
}

export function isFarmTile(tx: number, ty: number): boolean {
  // 耕地只存在于农场场景
  if (scene !== 'farm') return false;
  for (const a of FARM_AREAS) {
    if (tx >= a.x && tx < a.x + a.cols && ty >= a.y && ty < a.y + a.rows) return true;
  }
  return false;
}

export function plotIndexOf(tx: number, ty: number): number {
  let offset = 0;
  for (const a of FARM_AREAS) {
    if (tx >= a.x && tx < a.x + a.cols && ty >= a.y && ty < a.y + a.rows) {
      return offset + (ty - a.y) * a.cols + (tx - a.x);
    }
    offset += a.cols * a.rows;
  }
  return -1;
}

export function plotTileOf(index: number): { tx: number; ty: number } {
  let i = index;
  for (const a of FARM_AREAS) {
    const n = a.cols * a.rows;
    if (i < n) {
      return { tx: a.x + (i % a.cols), ty: a.y + Math.floor(i / a.cols) };
    }
    i -= n;
  }
  const a = FARM_AREAS[0];
  return { tx: a.x, ty: a.y };
}

export const PLOT_COUNT = FARM_AREAS.reduce((n, a) => n + a.cols * a.rows, 0);

/** 把某块耕地铺成泥土（买地解锁时调用） */
export function unlockArea(k: number): void {
  const a = FARM_AREAS[k];
  if (!a) return;
  setRect(a.x, a.y, a.cols, a.rows, T.SOIL);
}

/* ---------------- 交互目标 ---------------- */

export interface Target {
  kind: 'plot' | 'object' | 'door' | 'shopdoor' | 'bed' | 'shelf' | 'ladder' | 'bench' | 'stove' | 'chest' | 'service';
  /** 服务类型（service 时有效） */
  service?: string;
  /** 小镇店铺类型（shopdoor 时有效） */
  shop?: TownBuildingKind;
  tx: number;
  ty: number;
  plotIndex: number;
  object?: WorldObject;
}

const DIR_VEC: Record<Dir, [number, number]> = {
  down: [0, 1],
  up: [0, -1],
  left: [-1, 0],
  right: [1, 0]
};

/** 玩家当前面朝的格子 */
export function facingTile(p: Player): { tx: number; ty: number } {
  const [dx, dy] = DIR_VEC[p.dir];
  const tx = Math.floor(p.x / TILE);
  const ty = Math.floor((p.y - 6) / TILE);
  return { tx: tx + dx, ty: ty + dy };
}

export function targetAt(tx: number, ty: number): Target | null {
  const t = tileAt(tx, ty);
  if (t === T.DOOR) return { kind: 'door', tx, ty, plotIndex: -1 };
  // 小镇建筑的门（不是 tile，靠建筑坐标判定）
  for (const b of TOWN_BUILDINGS) {
    if (b.door && tx === b.x + b.door.dx && ty === b.y + b.door.dy) {
      return { kind: 'shopdoor', tx, ty, plotIndex: -1, shop: b.kind };
    }
  }
  if (t === T.LADDER) return { kind: 'ladder', tx, ty, plotIndex: -1 };
  // 室内家具
  const f = furnitureAt(scene, tx, ty);
  if (f) {
    // 病床：诊所属「看病」，住宅属「睡觉」
    if (f.kind === 'bed') {
      if (scene === 'clinic') return { kind: 'service', tx, ty, plotIndex: -1, service: 'clinic' };
      return { kind: 'bed', tx, ty, plotIndex: -1 };
    }
    if (f.kind === 'shelf') return { kind: 'shelf', tx, ty, plotIndex: -1 };
    if (f.kind === 'bench') return { kind: 'bench', tx, ty, plotIndex: -1 };
    if (f.kind === 'stove') return { kind: 'stove', tx, ty, plotIndex: -1 };
    if (f.kind === 'chest') return { kind: 'chest', tx, ty, plotIndex: -1 };
    // 小镇店铺的服务点
    if (f.kind === 'counter') return { kind: 'service', tx, ty, plotIndex: -1, service: 'tavern' };
    if (f.kind === 'anvil') return { kind: 'service', tx, ty, plotIndex: -1, service: 'smith' };
    if (f.kind === 'blackboard') return { kind: 'service', tx, ty, plotIndex: -1, service: 'school' };
  }
  // 农场专属：物件与耕地
  if (scene === 'farm') {
    for (const o of OBJECTS) {
      if (o.tx === tx && o.ty === ty) {
        return { kind: 'object', tx, ty, plotIndex: -1, object: o };
      }
    }
    const pi = plotIndexOf(tx, ty);
    if (pi >= 0) return { kind: 'plot', tx, ty, plotIndex: pi };
  }
  return null;
}

/** 该格子是否可以长杂草 / 放节点 */
export function isOpenGround(tx: number, ty: number): boolean {
  const t = tileAt(tx, ty);
  if (t !== T.GRASS && t !== T.FLOWER) return false;
  // 耕地（含尚未解锁的那块）不长杂草
  if (isFarmTile(tx, ty)) return false;
  for (const o of OBJECTS) if (o.tx === tx && o.ty === ty) return false;
  if (dynamicBlocked.has(idx(tx, ty))) return false;
  return true;
}
