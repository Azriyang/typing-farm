/* ============================================================
   world.ts — 地图、地形、碰撞、交互目标
   ============================================================ */

import type { Dir, Player } from './types';

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
  FLOWER: 8
} as const;

export type TileId = (typeof T)[keyof typeof T];

/** 农场耕地范围（6 列 × 4 行） */
export const FARM = { x: 11, y: 9, cols: 6, rows: 4 };

/** 可砍伐的树（动态节点） */
export const TREE_SPOTS: Array<[number, number]> = [
  [20, 3], [21, 3], [20, 4], [26, 5], [27, 6], [2, 11],
  [2, 13], [18, 4], [19, 12], [22, 6], [25, 10], [18, 10]
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

/* ---------------- 地图生成 ---------------- */

export function buildMap(): void {
  terrain.fill(T.GRASS);
  dynamicBlocked.clear();

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

  // 小路（农场）+ 向东延伸的进镇道路
  setRect(4, 7, 15, 1, T.PATH);
  for (let x = 4; x <= 18; x++) set(x, 8, T.PATH);
  set(5, 8, T.PATH);
  for (let x = 18; x <= 47; x++) { set(x, 7, T.PATH); set(x, 8, T.PATH); }

  // 农田
  setRect(FARM.x, FARM.y, FARM.cols, FARM.rows, T.SOIL);

  // 小镇广场（街道南侧的一片空地）
  setRect(38, 9, 7, 3, T.PATH);

  // 花丛（可走过）
  const flowers: Array<[number, number]> = [
    [7, 10], [8, 14], [6, 14], [16, 14], [17, 6], [6, 11], [9, 9],
    [33, 6], [47, 6], [33, 11], [47, 11], [36, 9], [45, 10]
  ];
  for (const [x, y] of flowers) if (tileAt(x, y) === T.GRASS) set(x, y, T.FLOWER);
}

/* ---------------- 碰撞 ---------------- */

const BLOCKED: Record<number, boolean> = {
  [T.WATER]: true,
  [T.WALL]: true,
  [T.ROOF]: true,
  [T.DOOR]: true,
  [T.TREE]: true
};

export function setNodeBlock(tx: number, ty: number, blocked: boolean): void {
  if (blocked) dynamicBlocked.add(idx(tx, ty));
  else dynamicBlocked.delete(idx(tx, ty));
}

export function isBlockedTile(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return true;
  if (BLOCKED[tileAt(x, y)]) return true;
  if (dynamicBlocked.has(idx(x, y))) return true;
  for (const o of OBJECTS) if (o.tx === x && o.ty === y) return true;
  for (const b of Object.values(BUILDINGS)) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return true;
  }
  for (const b of TOWN_BUILDINGS) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return true;
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

export function isFarmTile(tx: number, ty: number): boolean {
  return (
    tx >= FARM.x && tx < FARM.x + FARM.cols &&
    ty >= FARM.y && ty < FARM.y + FARM.rows
  );
}

export function plotIndexOf(tx: number, ty: number): number {
  if (!isFarmTile(tx, ty)) return -1;
  return (ty - FARM.y) * FARM.cols + (tx - FARM.x);
}

export function plotTileOf(index: number): { tx: number; ty: number } {
  return {
    tx: FARM.x + (index % FARM.cols),
    ty: FARM.y + Math.floor(index / FARM.cols)
  };
}

export const PLOT_COUNT = FARM.cols * FARM.rows;

/* ---------------- 交互目标 ---------------- */

export interface Target {
  kind: 'plot' | 'object' | 'door';
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
  for (const o of OBJECTS) {
    if (o.tx === tx && o.ty === ty) {
      return { kind: 'object', tx, ty, plotIndex: -1, object: o };
    }
  }
  const pi = plotIndexOf(tx, ty);
  if (pi >= 0) return { kind: 'plot', tx, ty, plotIndex: pi };
  return null;
}

/** 该格子是否可以长杂草 / 放节点 */
export function isOpenGround(tx: number, ty: number): boolean {
  const t = tileAt(tx, ty);
  if (t !== T.GRASS && t !== T.FLOWER) return false;
  for (const o of OBJECTS) if (o.tx === tx && o.ty === ty) return false;
  if (dynamicBlocked.has(idx(tx, ty))) return false;
  return true;
}
