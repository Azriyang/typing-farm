/* ============================================================
   world.ts — 地图、地形、碰撞、交互目标
   ============================================================ */

import type { Dir, Player, SceneId } from './types';

export const TILE = 48;
export const MAP_W = 50;
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
  LADDER: 14
} as const;

export type TileId = (typeof T)[keyof typeof T];

/* ---------------- 室内家具 ---------------- */

export type FurnitureKind = 'bed' | 'shelf' | 'table' | 'trough' | 'nest' | 'hay' | 'rug';

export interface Furniture {
  kind: FurnitureKind;
  tx: number;
  ty: number;
  w: number;
  h: number;
  scene: 'house' | 'coop' | 'barn';
}

/** 家具按整个方块绘制（不是逐格拼），坐标是左上角 */
export const FURNITURE: Furniture[] = [
  // 住宅
  { kind: 'bed', tx: 18, ty: 7, w: 2, h: 3, scene: 'house' },
  { kind: 'shelf', tx: 30, ty: 7, w: 2, h: 1, scene: 'house' },
  { kind: 'table', tx: 23, ty: 12, w: 3, h: 2, scene: 'house' },
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
export const FARM_AREAS = [
  { x: 11, y: 9, cols: 6, rows: 4 },
  { x: 17, y: 9, cols: 3, rows: 4 }
] as const;

/** 从第几块起需要购买解锁 */
export const AREA_UNLOCK_COST = [0, 2500];

/** 兼容旧代码：第一块耕地 */
export const FARM = FARM_AREAS[0];

/** 可砍伐的树（动态节点） */
export const TREE_SPOTS: Array<[number, number]> = [
  [20, 3], [21, 3], [20, 4], [26, 5], [27, 6], [2, 11],
  [2, 13], [18, 4], [19, 12], [22, 6], [25, 10], [21, 12]
];

/** 可开采的岩石（动态节点）；原 y8 的四块让位给进镇道路，移到镇西石堆 */
export const ROCK_SPOTS: Array<[number, number]> = [
  [30, 12], [31, 12], [24, 11], [26, 3], [30, 13], [31, 13], [20, 10], [9, 12]
];

/** 鸡舍 / 牛棚（实心，挡路） */
export const BUILDINGS = {
  coop: { x: 3, y: 14, w: 3, h: 2 },
  barn: { x: 11, y: 14, w: 4, h: 2 }
} as const;

/** 小镇建筑（实心，挡路）；kind 用于渲染配色 */
export interface TownBuilding { x: number; y: number; w: number; h: number; kind: 'store' | 'house'; roof: string }
export const TOWN_BUILDINGS: TownBuilding[] = [
  { x: 34, y: 2, w: 4, h: 4, kind: 'store', roof: '#4a8fbe' },
  { x: 39, y: 2, w: 4, h: 4, kind: 'house', roof: '#c9743f' },
  { x: 44, y: 2, w: 4, h: 4, kind: 'house', roof: '#6fae4e' },
  { x: 35, y: 12, w: 4, h: 4, kind: 'house', roof: '#b06a8f' },
  { x: 42, y: 12, w: 4, h: 4, kind: 'house', roof: '#c9a23f' }
];

/** 村民游走 / 玩家可行走的小镇开放区 */
export const TOWN_OPEN = { x0: 33, y0: 6, x1: 47, y1: 11 };

/** 是否落在小镇区域（排除杂草等） */
export function inTownArea(tx: number): boolean {
  return tx >= TOWN_X - 2;
}

/** 围栏活动区（可走入，动物在其中游走） */
export const PENS = {
  chicken: { x0: 3, y0: 16, x1: 8, y1: 19 },
  cow: { x0: 11, y0: 16, x1: 16, y1: 19 }
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

export type ObjectKind = 'bin' | 'order' | 'store';

export interface WorldObject {
  kind: ObjectKind;
  tx: number;
  ty: number;
  label: string;
}

export const OBJECTS: WorldObject[] = [
  { kind: 'bin', tx: 18, ty: 8, label: '出货箱' },
  { kind: 'order', tx: 10, ty: 5, label: '订购箱' },
  { kind: 'store', tx: 35, ty: 5, label: '杂货店' }
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

export const ROOMS: Record<'house' | 'coop' | 'barn', Room> = {
  house: {
    x0: 17, y0: 6, x1: 32, y1: 16,
    floor: T.FLOOR,
    door: { tx: 24, ty: 16 },
    spawn: { tx: 24, ty: 15, dir: 'up' }
  },
  coop: {
    x0: 17, y0: 6, x1: 30, y1: 16,
    floor: T.FLOOR_STONE,
    door: { tx: 23, ty: 16 },
    spawn: { tx: 23, ty: 15, dir: 'up' }
  },
  barn: {
    x0: 15, y0: 5, x1: 34, y1: 17,
    floor: T.FLOOR_STONE,
    door: { tx: 24, ty: 17 },
    spawn: { tx: 24, ty: 16, dir: 'up' }
  }
};

/** 农场里三个建筑的门位置（用于从室内走回农场时定位置） */
export const FARM_DOORS: Record<'house' | 'coop' | 'barn' | 'mine', { tx: number; ty: number }> = {
  house: { tx: 5, ty: 6 },
  coop: { tx: 4, ty: 15 },
  barn: { tx: 12, ty: 15 },
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
  const r = ROOMS[id as 'house' | 'coop' | 'barn'];
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

  // 外圈树墙（纯装饰，不可砍）
  for (let x = 0; x < MAP_W; x++) {
    set(x, 0, T.TREE);
    set(x, MAP_H - 1, T.TREE);
    if (x % 3 === 0) { set(x, 1, T.TREE); set(x, MAP_H - 2, T.TREE); }
  }
  for (let y = 0; y < MAP_H; y++) {
    set(0, y, T.TREE);
    set(MAP_W - 1, y, T.TREE);
    if (y % 3 === 1) { set(1, y, T.TREE); set(MAP_W - 2, y, T.TREE); }
  }

  // 池塘
  const pcx = 23, pcy = 16, prx = 4.2, pry = 2.8;
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

  // 小路（农场）+ 向东延伸的进镇道路
  setRect(4, 7, 15, 1, T.PATH);
  for (let x = 4; x <= 18; x++) set(x, 8, T.PATH);
  set(5, 8, T.PATH);
  for (let x = 18; x <= 47; x++) { set(x, 7, T.PATH); set(x, 8, T.PATH); }

  // 农田（只铺第一块；第二块买地后由 unlockArea 铺上）
  setRect(FARM_AREAS[0].x, FARM_AREAS[0].y, FARM_AREAS[0].cols, FARM_AREAS[0].rows, T.SOIL);

  // 小镇广场（街道南侧的一片空地）
  setRect(38, 9, 7, 3, T.PATH);

  // 花丛（可走过）
  const flowers: Array<[number, number]> = [
    [7, 10], [8, 14], [6, 14], [16, 14], [17, 6], [6, 11], [9, 9],
    [33, 6], [47, 6], [33, 11], [47, 11], [36, 9], [45, 10]
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
  kind: 'plot' | 'object' | 'door' | 'bed' | 'shelf' | 'ladder';
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
  if (t === T.LADDER) return { kind: 'ladder', tx, ty, plotIndex: -1 };
  // 室内家具
  const f = furnitureAt(scene, tx, ty);
  if (f) {
    if (f.kind === 'bed') return { kind: 'bed', tx, ty, plotIndex: -1 };
    if (f.kind === 'shelf') return { kind: 'shelf', tx, ty, plotIndex: -1 };
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
