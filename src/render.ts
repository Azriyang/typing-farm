/* ============================================================
   render.ts — Canvas 像素渲染
   ============================================================ */

import { CROPS } from './config';
import {
  TILE, MAP_W, MAP_H, VIEW_W, VIEW_H, T, tileAt, OBJECTS,
  plotTileOf, facingTile, BUILDINGS, PENS, TOWN_BUILDINGS,
  areaUnlocked, plotAreaOf, getScene, FURNITURE, ROOMS, sceneOfAnimal, indoorAnimalPos,
  FARM_DOORS, TOWN_FOUNTAIN, TOWN_WELL
} from './world';
import type { TownBuildingKind, IndoorScene, TownBuilding } from './world';
import { isWoodKind } from './types';
import type { Weather } from './types';
import { resolveTarget, heldTool, hotbarHasTool } from './action';
import { animalNearInScene, ANIMAL_DEFS, isProductReady } from './animals';
import { villagerNear, VILLAGER_DEFS } from './villagers';
import { TOOLS } from './tools';
import { PALETTES } from './seasons';
import type { Palette } from './seasons';
import { MAT, CHAR, shift, softShadow } from './palette';
import type { GameState, Plot, Dir, CropId, ResNode, Animal, Season, Villager } from './types';

type Ctx = CanvasRenderingContext2D;

let ctx: Ctx;
let base: HTMLCanvasElement;
let dpr = 1;

let camX = 0;
let camY = 0;

/** 当前季节色板；换季时重绘底图 */
let pal: Palette = PALETTES.spring;

/* ---------------- 粒子 ---------------- */

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; color: string; size: number; gravity: number;
}

interface FloatText {
  x: number; y: number; text: string; color: string; life: number; max: number; size: number;
}

const particles: Particle[] = [];
const floats: FloatText[] = [];

export function burst(x: number, y: number, color: string, n = 10, power = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (30 + Math.random() * 90) * power;
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 40 * power,
      life: 0.5 + Math.random() * 0.5,
      max: 1,
      color,
      size: 1 + Math.random() * 2.5,
      gravity: 220
    });
  }
}

export function floatText(x: number, y: number, text: string, color = '#fff6d8', size = 14) {
  floats.push({ x, y, text, color, life: 1.2, max: 1.2, size });
}

/* ---------------- 颜色工具 ---------------- */

function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

/* ---------------- 初始化 ---------------- */

export function initRenderer(cv: HTMLCanvasElement, dprValue: number) {
  dpr = Math.min(2, Math.max(1, dprValue));
  cv.width = VIEW_W * dpr;
  cv.height = VIEW_H * dpr;
  const c = cv.getContext('2d', { alpha: false });
  if (!c) throw new Error('canvas 2d unavailable');
  ctx = c;
  ctx.imageSmoothingEnabled = false;

  base = document.createElement('canvas');
  base.width = MAP_W * TILE;
  base.height = MAP_H * TILE;
  const bc = base.getContext('2d');
  if (!bc) throw new Error('canvas 2d unavailable');
  bc.imageSmoothingEnabled = false;
  drawBaseTerrain(bc);
}

/** 切换季节色板并重绘静态底图（换季 / 读档时调用） */
export function applySeason(season: Season): void {
  pal = PALETTES[season];
  if (!base) return;
  const bc = base.getContext('2d');
  if (!bc) return;
  bc.imageSmoothingEnabled = false;
  bc.clearRect(0, 0, base.width, base.height);
  drawBaseTerrain(bc);
}

/* ---------------- 底图（静态地形） ---------------- */

function drawBaseTerrain(c: Ctx) {
  const scene = getScene();
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      drawTile(c, tx, ty, tileAt(tx, ty));
    }
  }
  if (scene === 'farm') {
    drawHouse(c);
    drawPens(c);
    drawCoop(c);
    drawBarn(c);
    drawTownBuildings(c);
  } else {
    drawIndoorWalls(c, scene);
    drawIndoorLighting(c, scene);
    drawFurniture(c, scene);
  }
}

function drawTile(c: Ctx, tx: number, ty: number, t: number) {
  const x = tx * TILE, y = ty * TILE;
  const r = hash(tx, ty);

  switch (t) {
    case T.GRASS:
    case T.FLOWER: {
      c.fillStyle = pal.grass;
      c.fillRect(x, y, TILE, TILE);

      // 大尺度色块：让整片草地不是均匀一色（按 3×3 格为单位）
      const patch = hash(Math.floor(tx / 3) * 31, Math.floor(ty / 3) * 47);
      if (patch > 0.72) {
        c.fillStyle = 'rgba(28,58,20,.13)';
        c.fillRect(x, y, TILE, TILE);
      } else if (patch < 0.22) {
        c.fillStyle = 'rgba(200,215,140,.10)';
        c.fillRect(x, y, TILE, TILE);
      }
      // 更细的一层：单格明暗微差，破掉网格感
      const micro = hash(tx * 13, ty * 7);
      if (micro > 0.85) {
        c.fillStyle = 'rgba(20,45,15,.07)';
        c.fillRect(x, y, TILE, TILE);
      }

      // 草叶：暗底 + 亮顶，营造细密纹理
      for (let i = 0; i < 9; i++) {
        const rr = hash(tx * 7 + i, ty * 13 + i * 3);
        const px = Math.floor(x + 3 + rr * (TILE - 8));
        const py = Math.floor(y + 5 + hash(tx + i * 5, ty + i) * (TILE - 14));
        const hh = 3 + Math.floor(hash(tx + i, ty * 2 + i) * 3);
        c.fillStyle = pal.grassDark;
        c.fillRect(px, py, 2, hh);
        c.fillStyle = pal.grassHi;
        c.fillRect(px, py, 2, 2);
      }

      // 零星深色小坑，制造起伏
      for (let i = 0; i < 2; i++) {
        const rr = hash(tx * 17 + i * 3, ty * 29 + i);
        c.fillStyle = pal.grassDark;
        c.fillRect(
          Math.floor(x + 8 + rr * (TILE - 18)),
          Math.floor(y + 10 + hash(tx * 3, ty + i) * (TILE - 20)),
          3, 2
        );
      }

      if (t === T.FLOWER && pal.bloom) {
        const cols = ['#f2d45c', '#f08fb0', '#fffdf7', '#e88f6a'];
        for (let i = 0; i < 3; i++) {
          const rr = hash(tx * 31 + i, ty * 17 + i);
          const px = Math.floor(x + 9 + rr * (TILE - 20));
          const py = Math.floor(y + 11 + hash(tx + i * 9, ty * 3 + i) * (TILE - 24));
          // 花茎
          c.fillStyle = pal.flowerStem;
          c.fillRect(px + 1, py + 3, 1, 4);
          // 花瓣（环状四点 + 花心）
          c.fillStyle = cols[Math.floor(rr * cols.length)];
          c.fillRect(px, py, 3, 3);
          c.fillRect(px - 1, py + 1, 1, 1);
          c.fillRect(px + 3, py + 1, 1, 1);
          c.fillRect(px + 1, py - 1, 1, 1);
          c.fillStyle = '#fff8d8';
          c.fillRect(px + 1, py + 1, 1, 1);
        }
      }
      break;
    }
    case T.PATH: {
      c.fillStyle = MAT.path.base;
      c.fillRect(x, y, TILE, TILE);
      // 碎石颗粒（亮/暗交错）
      for (let i = 0; i < 10; i++) {
        const rr = hash(tx * 11 + i, ty * 23 + i * 5);
        const px = Math.floor(x + 3 + rr * (TILE - 9));
        const py = Math.floor(y + 3 + hash(tx + i, ty * 7 + i) * (TILE - 9));
        c.fillStyle = i % 2 === 0 ? MAT.path.mid : MAT.path.hi;
        c.fillRect(px, py, 3, 2);
      }
      // 接缝的暗线，让路面有砖块感
      c.fillStyle = MAT.path.line;
      c.globalAlpha = 0.18;
      c.fillRect(x, y + TILE - 1, TILE, 1);
      c.globalAlpha = 1;
      break;
    }
    case T.WATER: {
      c.fillStyle = MAT.water.base;
      c.fillRect(x, y, TILE, TILE);
      // 深水底纹
      c.fillStyle = MAT.water.mid;
      c.globalAlpha = 0.35;
      c.fillRect(x + 4 + r * 10, y + 26 + r * 10, 20, 4);
      c.globalAlpha = 1;
      // 波纹高光
      c.fillStyle = MAT.water.hi;
      c.fillRect(x + 5 + r * 12, y + 11 + r * 18, 16, 2);
      c.fillRect(x + 24, y + 31 + r * 6, 12, 2);
      // 岸沿
      c.fillStyle = 'rgba(255,255,255,.22)';
      c.fillRect(x, y, TILE, 2);
      break;
    }
    case T.SOIL: {
      c.fillStyle = MAT.soil.base;
      c.fillRect(x, y, TILE, TILE);
      // 垄沟：三道横向暗槽，上下各带一条高光，形成"犁过"的立体感
      for (let i = 0; i < 3; i++) {
        const gy = Math.floor(y + 9 + i * 13);
        c.fillStyle = MAT.soil.dark;
        c.fillRect(x + 4, gy, TILE - 8, 3);
        c.fillStyle = MAT.soil.hi;
        c.fillRect(x + 4, gy - 1, TILE - 8, 1);
      }
      // 土粒
      for (let i = 0; i < 6; i++) {
        const rr = hash(tx * 3 + i, ty * 19 + i);
        c.fillStyle = i % 2 ? MAT.soil.mid : MAT.soil.hi;
        c.fillRect(
          Math.floor(x + 4 + rr * (TILE - 10)),
          Math.floor(y + 4 + hash(tx + i * 2, ty + i) * (TILE - 10)),
          3, 2
        );
      }
      break;
    }
    case T.WALL:
    case T.ROOF:
      // 由 drawHouse / drawCoop / drawBarn 统一绘制
      c.fillStyle = pal.grass;
      c.fillRect(x, y, TILE, TILE);
      break;
    case T.TREE: {
      c.fillStyle = pal.grass;
      c.fillRect(x, y, TILE, TILE);
      drawThicket(c, x + TILE / 2, y + TILE - 6, tx * 31 + ty * 7, 0.92 + r * 0.16);
      break;
    }
    /* ---------------- 室内 ---------------- */
    case T.FLOOR: {
      // 木地板：横向长板 + 板缝
      c.fillStyle = '#c9a06a';
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = '#b98d5c';
      for (let i = 0; i < 3; i++) c.fillRect(x, y + 15 + i * 16, TILE, 2);
      c.fillStyle = '#d8b481';
      for (let i = 0; i < 3; i++) c.fillRect(x, y + 13 + i * 16, TILE, 1);
      // 随机板端竖缝
      const seam = Math.floor(hash(tx, ty) * 3) * 16 + 4;
      c.fillStyle = '#b98d5c';
      c.fillRect(x + seam, y, 2, TILE);
      c.fillStyle = 'rgba(255,255,255,.06)';
      c.fillRect(x, y, TILE, 1);
      break;
    }
    case T.FLOOR_STONE: {
      // 石地板：方砖 + 缝
      c.fillStyle = '#a9a49b';
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = '#b8b3aa';
      c.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      c.fillStyle = '#8f8a82';
      c.fillRect(x, y, TILE, 2);
      c.fillRect(x, y, 2, TILE);
      const r2 = hash(tx * 5, ty * 7);
      c.fillStyle = '#c4bfb6';
      c.fillRect(x + 6 + r2 * 20, y + 8 + r2 * 18, 10, 6);
      break;
    }
    case T.WALL_IN: {
      // 室内墙：暗色木墙 + 顶部亮边
      c.fillStyle = '#5a4636';
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = '#6b5544';
      c.fillRect(x, y, TILE, TILE - 4);
      c.fillStyle = 'rgba(0,0,0,.18)';
      c.fillRect(x, y + TILE - 6, TILE, 6);
      // 砖缝
      c.fillStyle = 'rgba(0,0,0,.14)';
      const off = (ty % 2) * 24;
      c.fillRect(x + ((tx * 24 + off) % TILE), y, 2, TILE);
      break;
    }
    case T.DOOR: {
      if (getScene() === 'mine') {
        // 矿洞出口：向上的洞口
        c.fillStyle = '#2b2220';
        c.fillRect(x, y, TILE, TILE);
        c.fillStyle = '#4a3a34';
        c.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
        c.fillStyle = '#141010';
        c.beginPath();
        c.ellipse(x + TILE / 2, y + TILE / 2, 12, 14, 0, 0, Math.PI * 2);
        c.fill();
      } else if (getScene() === 'farm') {
        // 农场上的门：house 的门会被 drawHouse 覆盖，这里给 coop/barn/矿洞画门
        c.fillStyle = pal.grass;
        c.fillRect(x, y, TILE, TILE);
        // 矿洞入口画成石拱
        if (tx === FARM_DOORS.mine.tx && ty === FARM_DOORS.mine.ty) {
          c.fillStyle = '#6b6058';
          c.beginPath();
          c.moveTo(x + 2, y + TILE);
          c.lineTo(x + 2, y + 20);
          c.quadraticCurveTo(x + TILE / 2, y - 4, x + TILE - 2, y + 20);
          c.lineTo(x + TILE - 2, y + TILE);
          c.closePath();
          c.fill();
          c.fillStyle = '#100c0c';
          c.beginPath();
          c.moveTo(x + 9, y + TILE);
          c.lineTo(x + 9, y + 24);
          c.quadraticCurveTo(x + TILE / 2, y + 6, x + TILE - 9, y + 24);
          c.lineTo(x + TILE - 9, y + TILE);
          c.closePath();
          c.fill();
        } else {
          c.fillStyle = '#5a3c22';
          c.fillRect(x + 6, y + 8, TILE - 12, TILE - 8);
          c.fillStyle = '#7a5334';
          c.fillRect(x + 9, y + 11, TILE - 18, TILE - 11);
          c.fillStyle = '#e8c86a';
          c.fillRect(x + TILE - 16, y + 26, 4, 4);
        }
      } else {
        // 室内门：木门 + 门框
        c.fillStyle = '#3d2f24';
        c.fillRect(x, y, TILE, TILE);
        c.fillStyle = '#7a5334';
        c.fillRect(x + 4, y + 2, TILE - 8, TILE - 2);
        c.fillStyle = '#9b7350';
        c.fillRect(x + 7, y + 5, TILE - 14, TILE - 8);
        c.fillStyle = '#e8c86a';
        c.fillRect(x + TILE - 16, y + TILE / 2, 4, 4);
      }
      break;
    }
    /* ---------------- 矿洞 ---------------- */
    case T.MINE_WALL: {
      c.fillStyle = '#2f2724';
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = '#3d332e';
      c.fillRect(x, y, TILE, TILE - 3);
      // 岩块纹理
      const rr = hash(tx * 7, ty * 11);
      c.fillStyle = '#4a3f39';
      c.fillRect(x + 4 + rr * 20, y + 6 + rr * 18, 12, 8);
      c.fillStyle = 'rgba(0,0,0,.22)';
      c.fillRect(x, y + TILE - 5, TILE, 5);
      break;
    }
    case T.MINE_FLOOR: {
      c.fillStyle = '#4a4038';
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = '#544940';
      c.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      // 碎石
      for (let i = 0; i < 5; i++) {
        const rr = hash(tx * 13 + i, ty * 17 + i * 3);
        c.fillStyle = i % 2 ? '#5e5249' : '#3f362f';
        c.fillRect(Math.floor(x + 5 + rr * (TILE - 12)), Math.floor(y + 6 + hash(tx + i, ty + i) * (TILE - 14)), 4, 3);
      }
      break;
    }
    case T.LADDER: {
      c.fillStyle = '#4a4038';
      c.fillRect(x, y, TILE, TILE);
      // 梯子：两根竖梁 + 横档
      c.fillStyle = '#8a6a3e';
      c.fillRect(x + 12, y + 2, 5, TILE - 4);
      c.fillRect(x + TILE - 17, y + 2, 5, TILE - 4);
      c.fillStyle = '#a8844e';
      for (let i = 0; i < 5; i++) {
        c.fillRect(x + 12, y + 6 + i * 9, TILE - 24, 4);
      }
      break;
    }
    default: {
      c.fillStyle = pal.grass;
      c.fillRect(x, y, TILE, TILE);
    }
  }
}

/* ---------------- 室内家具 ---------------- */

/** 房间内一圈暖色光晕，让室内不像一块平的色板 */
/* ---------------- 室内：墙体立面 ---------------- */

/** 窗户在房间里的相对位置（0~1），底图与动态层共用 */
export function windowRects(scene: string): Array<{ x: number; y: number; w: number; h: number }> {
  const r = ROOMS[scene as IndoorScene];
  if (!r) return [];
  const L = r.x0 * TILE;
  const R = (r.x1 + 1) * TILE;
  const width = R - L;
  const T0 = r.y0 * TILE;
  const winY = T0 - TILE * 1.55;
  const winW = 44;
  const winH = 34;
  // 房间宽就开两扇，窄就一扇
  const two = width >= TILE * 11;
  if (two) {
    return [
      { x: L + width * 0.22 - winW / 2, y: winY, w: winW, h: winH },
      { x: L + width * 0.72 - winW / 2, y: winY, w: winW, h: winH }
    ];
  }
  return [{ x: L + width / 2 - winW / 2, y: winY, w: winW, h: winH }];
}

/**
 * 室内墙体：把上方画成「看得见墙面」的立面，两侧与下方只留墙沿。
 * 这是让俯视室内「像房间」而不是「一堆砖」的关键。
 */
function drawIndoorWalls(c: Ctx, scene: string) {
  const r = ROOMS[scene as IndoorScene];
  if (!r) return;

  const L = r.x0 * TILE;
  const R = (r.x1 + 1) * TILE;
  const T0 = r.y0 * TILE;
  const B = (r.y1 + 1) * TILE;
  const W = MAP_W * TILE;
  const H = MAP_H * TILE;

  // 1) 房间外压暗：突出「房间在一个更大的建筑内部」
  //    注意跳过门格那一格，否则门会被一起压暗
  const doorPx = r.door.tx * TILE;
  c.fillStyle = 'rgba(8,6,5,.80)';
  c.fillRect(0, 0, W, T0);
  c.fillRect(0, B + TILE, W, H - B - TILE);        // 下墙行以下
  c.fillRect(0, B, doorPx, TILE);                   // 下墙行·门左
  c.fillRect(doorPx + TILE, B, W - doorPx - TILE, TILE); // 下墙行·门右
  c.fillRect(0, 0, L, H);
  c.fillRect(R, 0, W - R, H);

  // 2) 上方墙立面（向外 2.6 格，能看到「墙面」）
  const facadeH = TILE * 2.6;
  const fy = T0 - facadeH;

  // 墙面：上暗下亮的渐变（光从窗户和地面反弹）
  const g = c.createLinearGradient(0, fy, 0, T0);
  g.addColorStop(0, '#241a14');
  g.addColorStop(0.30, '#463229');
  g.addColorStop(0.72, '#6b5040');
  g.addColorStop(1, '#7d6149');
  c.fillStyle = g;
  c.fillRect(L, fy, R - L, facadeH);

  // 墙板竖纹
  c.fillStyle = 'rgba(0,0,0,.14)';
  for (let x = L + 30; x < R; x += 52) c.fillRect(x, fy + 6, 1, facadeH - 26);
  // 横向腰线
  c.fillStyle = 'rgba(255,230,190,.07)';
  c.fillRect(L, fy + facadeH * 0.30, R - L, 1);

  // 墙裙（踢脚线）
  c.fillStyle = '#2e211a';
  c.fillRect(L, T0 - 18, R - L, 18);
  c.fillStyle = '#4a3527';
  c.fillRect(L, T0 - 18, R - L, 3);
  c.fillStyle = 'rgba(0,0,0,.22)';
  c.fillRect(L, T0 - 3, R - L, 3);

  // 3) 窗户框（玻璃颜色在动态层，随时间变）
  for (const w of windowRects(scene)) {
    // 外框
    c.fillStyle = '#3a2a1e';
    c.fillRect(w.x - 3, w.y - 3, w.w + 6, w.h + 6);
    c.fillStyle = '#5a4230';
    c.fillRect(w.x - 2, w.y - 2, w.w + 4, w.h + 4);
    // 玻璃底色（中性，动态层会覆盖）
    c.fillStyle = '#6a7a86';
    c.fillRect(w.x, w.y, w.w, w.h);
    // 窗棂
    c.fillStyle = '#5a4230';
    c.fillRect(w.x + w.w / 2 - 1, w.y, 3, w.h);
    c.fillRect(w.x, w.y + w.h / 2 - 1, w.w, 3);
    // 窗台
    c.fillStyle = '#7d6149';
    c.fillRect(w.x - 5, w.y + w.h + 2, w.w + 10, 4);
    c.fillStyle = 'rgba(255,240,210,.18)';
    c.fillRect(w.x - 5, w.y + w.h + 2, w.w + 10, 1);
  }

  // 4) 左右侧墙：一窄条，表现墙的厚度
  c.fillStyle = '#4a3527';
  c.fillRect(L - 10, T0, 10, B - T0);
  c.fillRect(R, T0, 10, B - T0);
  c.fillStyle = 'rgba(255,230,190,.10)';
  c.fillRect(L - 10, T0, 3, B - T0);
  c.fillStyle = 'rgba(0,0,0,.3)';
  c.fillRect(R + 7, T0, 3, B - T0);

  // 5) 下墙：整一格高，门的位置留洞——门是「墙上的门」，不是「地板上的洞」
  const doorX = r.door.tx * TILE;
  const leftW = doorX - (L - 10);
  const rightX = doorX + TILE;
  const rightW = (R + 10) - rightX;

  c.fillStyle = '#3a2a1e';
  if (leftW > 0) c.fillRect(L - 10, B, leftW, TILE);
  if (rightW > 0) c.fillRect(rightX, B, rightW, TILE);
  // 墙顶高光 + 底部投影
  c.fillStyle = '#5a4230';
  if (leftW > 0) c.fillRect(L - 10, B, leftW, 3);
  if (rightW > 0) c.fillRect(rightX, B, rightW, 3);
  c.fillStyle = 'rgba(0,0,0,.28)';
  if (leftW > 0) c.fillRect(L - 10, B + TILE - 4, leftW, 4);
  if (rightW > 0) c.fillRect(rightX, B + TILE - 4, rightW, 4);

  // 门框：把门嵌进墙里
  c.fillStyle = '#241a14';
  c.fillRect(doorX - 3, B - 2, TILE + 6, 4);          // 门楣
  c.fillStyle = '#2e211a';
  c.fillRect(doorX - 3, B, 3, TILE);                   // 左门框
  c.fillRect(doorX + TILE, B, 3, TILE);                // 右门框
  c.fillStyle = '#4a3527';
  c.fillRect(doorX - 3, B - 2, TILE + 6, 1);

  // 门槛：一小条浅色石阶，表示「从这里出去」
  c.fillStyle = '#8a7a68';
  c.fillRect(doorX + 1, B + TILE - 5, TILE - 2, 5);
  c.fillStyle = 'rgba(255,240,210,.22)';
  c.fillRect(doorX + 1, B + TILE - 5, TILE - 2, 1);
}

/** 室内的窗户天光：颜色随时间和天气变 */
function drawIndoorWindowLight(c: Ctx, scene: string, time: number, weather: Weather) {
  const wins = windowRects(scene);
  if (wins.length === 0) return;

  let tint: string;
  let alpha: number;
  if (weather === 'rain') { tint = '#8fa6b8'; alpha = 0.72; }
  else if (weather === 'snow') { tint = '#cfdce8'; alpha = 0.78; }
  else if (time < 420) { tint = '#5a6a8a'; alpha = 0.72; }        // 黎明前
  else if (time < 540) { tint = '#ffd9a0'; alpha = 0.80; }        // 清晨
  else if (time < 1020) { tint = '#fff4d0'; alpha = 0.86; }       // 白天
  else if (time < 1140) { tint = '#ffb87a'; alpha = 0.82; }       // 傍晚
  else { tint = '#2a3a5a'; alpha = 0.80; }                         // 夜

  for (const w of wins) {
    c.globalAlpha = alpha;
    c.fillStyle = tint;
    c.fillRect(w.x, w.y, w.w, w.h);
    c.globalAlpha = 1;
    // 斜向反光
    c.fillStyle = 'rgba(255,255,255,.16)';
    c.beginPath();
    c.moveTo(w.x + 4, w.y + w.h);
    c.lineTo(w.x + w.w * 0.55, w.y);
    c.lineTo(w.x + w.w * 0.78, w.y);
    c.lineTo(w.x + w.w * 0.3, w.y + w.h);
    c.closePath();
    c.fill();
  }
}

function drawIndoorLighting(c: Ctx, scene: string) {
  const r = ROOMS[scene as 'house' | 'coop' | 'barn'];
  if (!r) return;
  const rx = (r.x0 + r.x1 + 1) / 2 * TILE;
  const ry = (r.y0 + r.y1 + 1) / 2 * TILE;
  const g = c.createRadialGradient(rx, ry, 40, rx, ry, 280);
  g.addColorStop(0, 'rgba(255,225,160,.14)');
  g.addColorStop(1, 'rgba(255,225,160,0)');
  c.fillStyle = g;
  c.fillRect(r.x0 * TILE, r.y0 * TILE, (r.x1 - r.x0 + 1) * TILE, (r.y1 - r.y0 + 1) * TILE);
}

function drawFurniture(c: Ctx, scene: string) {
  // 地毯是**地面装饰**，必须先画——否则会盖住放在它上面的桌子
  const ordered = FURNITURE
    .filter((f) => f.scene === scene)
    .sort((a, b) => (a.kind === 'rug' ? 0 : 1) - (b.kind === 'rug' ? 0 : 1));

  for (const f of ordered) {
    const x = f.tx * TILE, y = f.ty * TILE;
    const w = f.w * TILE, h = f.h * TILE;

    switch (f.kind) {
      case 'rug': {
        c.fillStyle = 'rgba(160,80,70,.25)';
        c.fillRect(x + 2, y + 2, w - 4, h - 4);
        c.fillStyle = 'rgba(200,120,100,.22)';
        c.fillRect(x + 8, y + 8, w - 16, h - 16);
        c.strokeStyle = 'rgba(180,100,85,.35)';
        c.lineWidth = 2;
        c.strokeRect(x + 4, y + 4, w - 8, h - 8);
        break;
      }
      case 'bed': {
        // 床架
        c.fillStyle = '#6b4a2e';
        c.fillRect(x + 2, y + 2, w - 4, h - 4);
        c.fillStyle = '#8a6340';
        c.fillRect(x + 4, y + 4, w - 8, h - 8);
        // 床垫
        c.fillStyle = '#f2ece0';
        c.fillRect(x + 7, y + 8, w - 14, h - 14);
        c.fillStyle = '#fffdf7';
        c.fillRect(x + 7, y + 8, w - 14, 5);
        // 枕头
        c.fillStyle = '#e8eef5';
        c.fillRect(x + 10, y + 10, w - 20, 14);
        c.fillStyle = '#cfdae5';
        c.fillRect(x + 10, y + 20, w - 20, 3);
        // 被子
        c.fillStyle = '#8fb8d8';
        c.fillRect(x + 7, y + 28, w - 14, h - 36);
        c.fillStyle = '#a8cbe6';
        c.fillRect(x + 7, y + 28, w - 14, 4);
        // 被角
        c.fillStyle = '#7aa5c6';
        c.fillRect(x + 7, y + 28, 3, h - 36);
        break;
      }
      case 'shelf': {
        c.fillStyle = '#5a3c22';
        c.fillRect(x + 2, y + 4, w - 4, h - 8);
        c.fillStyle = '#8a6340';
        c.fillRect(x + 5, y + 7, w - 10, h - 14);
        // 书脊
        const cols = ['#c9563f', '#4a8fbe', '#6fae4e', '#e2a13c', '#b06a8f'];
        for (let i = 0; i < 6; i++) {
          c.fillStyle = cols[i % cols.length];
          c.fillRect(x + 8 + i * 7, y + 10, 5, h - 22);
        }
        c.fillStyle = 'rgba(0,0,0,.18)';
        c.fillRect(x + 5, y + h - 8, w - 10, 3);
        break;
      }
      case 'table': {
        c.fillStyle = '#6b4a2e';
        c.fillRect(x + 4, y + 6, w - 8, h - 14);
        c.fillStyle = '#a97c4f';
        c.fillRect(x + 6, y + 8, w - 12, h - 20);
        c.fillStyle = '#c1966a';
        c.fillRect(x + 6, y + 8, w - 12, 3);
        // 桌腿
        c.fillStyle = '#5a3c22';
        c.fillRect(x + 8, y + h - 10, 5, 8);
        c.fillRect(x + w - 13, y + h - 10, 5, 8);
        break;
      }
      case 'nest': {
        c.fillStyle = '#8a6a3e';
        c.fillRect(x + 4, y + 8, w - 8, h - 10);
        c.fillStyle = '#a8844e';
        c.fillRect(x + 6, y + 10, w - 12, h - 14);
        // 草垫
        c.fillStyle = '#c9a95e';
        for (let i = 0; i < 7; i++) {
          c.fillRect(x + 8 + i * 18, y + 14 + (i % 2) * 4, 14, 3);
        }
        // 蛋
        c.fillStyle = '#f7f2e8';
        c.beginPath(); c.ellipse(x + w / 2 - 20, y + 20, 5, 6, 0, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.ellipse(x + w / 2 + 18, y + 22, 5, 6, 0, 0, Math.PI * 2); c.fill();
        break;
      }
      case 'trough': {
        c.fillStyle = '#6b4a2e';
        c.fillRect(x + 2, y + 6, w - 4, h - 6);
        c.fillStyle = '#a97c4f';
        c.fillRect(x + 4, y + 8, w - 8, h - 12);
        // 槽内饲料
        c.fillStyle = '#c9a95e';
        c.fillRect(x + 7, y + 11, w - 14, h - 20);
        c.fillStyle = '#dcc07a';
        for (let i = 0; i < Math.floor(w / 20); i++) {
          c.fillRect(x + 9 + i * 20, y + 13, 8, 3);
        }
        break;
      }
      case 'hay': {
        c.fillStyle = '#a8843e';
        c.fillRect(x + 1, y + 4, w - 2, h - 6);
        c.fillStyle = '#c9a44e';
        c.fillRect(x + 3, y + 6, w - 6, h - 10);
        // 干草纹
        c.fillStyle = '#dcc06a';
        for (let i = 0; i < 5; i++) {
          c.fillRect(x + 5 + (i % 2) * 3, y + 8 + i * 8, w - 12, 2);
        }
        c.fillStyle = '#8a6a30';
        c.fillRect(x + 1, y + h - 6, w - 2, 4);
        break;
      }
      case 'chest': {
        // 旧木箱：带铜扣的深色木箱
        c.fillStyle = '#4a3018';
        c.fillRect(x + 2, y + 10, w - 4, h - 12);
        c.fillStyle = '#6b4a2e';
        c.fillRect(x + 4, y + 12, w - 8, h - 16);
        // 箱盖
        c.fillStyle = '#7d5738';
        c.fillRect(x + 3, y + 6, w - 6, 8);
        c.fillStyle = '#8f6544';
        c.fillRect(x + 3, y + 6, w - 6, 2);
        // 木纹
        c.fillStyle = '#5a3c22';
        c.fillRect(x + 4, y + 16, w - 8, 1);
        c.fillRect(x + 4, y + 22, w - 8, 1);
        // 铜扣
        c.fillStyle = '#c9a44e';
        c.fillRect(x + w / 2 - 4, y + 11, 8, 7);
        c.fillStyle = '#e8c86a';
        c.fillRect(x + w / 2 - 4, y + 11, 8, 2);
        c.fillStyle = '#8a6a2e';
        c.fillRect(x + w / 2 - 1, y + 14, 2, 3);
        break;
      }
      case 'counter': {
        // 长吧台：台面 + 前板 + 台面上的杯子
        c.fillStyle = '#5a3c22';
        c.fillRect(x + 2, y + 8, w - 4, h - 10);
        c.fillStyle = '#8a5f38';
        c.fillRect(x + 3, y + 9, w - 6, h - 12);
        // 台面
        c.fillStyle = '#c1966a';
        c.fillRect(x + 1, y + 6, w - 2, 5);
        c.fillStyle = '#d8b184';
        c.fillRect(x + 1, y + 6, w - 2, 2);
        // 前板木纹
        c.fillStyle = '#6b4a2e';
        for (let i = 0; i < Math.floor(w / 18); i++) {
          c.fillRect(x + 6 + i * 18, y + 13, 12, 1);
          c.fillRect(x + 6 + i * 18, y + 20, 12, 1);
        }
        // 杯子
        c.fillStyle = '#e8e2d0';
        c.fillRect(x + 10, y + 2, 6, 5);
        c.fillRect(x + 26, y + 2, 6, 5);
        c.fillStyle = '#c9a44e';
        c.fillRect(x + 10, y + 3, 6, 1);
        c.fillRect(x + 26, y + 3, 6, 1);
        break;
      }
      case 'barrel': {
        // 酒桶
        c.fillStyle = '#5a3c22';
        c.fillRect(x + 8, y + 8, 32, h - 10);
        c.fillStyle = '#8a5f38';
        c.fillRect(x + 10, y + 10, 28, h - 14);
        // 桶箍
        c.fillStyle = '#6b6b6b';
        c.fillRect(x + 8, y + 14, 32, 3);
        c.fillRect(x + 8, y + 26, 32, 3);
        c.fillStyle = '#9a9a9a';
        c.fillRect(x + 8, y + 14, 32, 1);
        c.fillRect(x + 8, y + 26, 32, 1);
        // 桶盖
        c.fillStyle = '#a97c4f';
        c.beginPath(); c.ellipse(x + 24, y + 9, 15, 5, 0, 0, Math.PI * 2); c.fill();
        break;
      }
      case 'forge': {
        // 铁匠炉：砖砌炉膛 + 火光
        c.fillStyle = '#4a3a34';
        c.fillRect(x + 2, y + 6, w - 4, h - 8);
        c.fillStyle = '#6b5548';
        c.fillRect(x + 4, y + 8, w - 8, h - 14);
        // 砖缝
        c.fillStyle = 'rgba(0,0,0,.2)';
        c.fillRect(x + 4, y + 16, w - 8, 1);
        c.fillRect(x + w / 2, y + 8, 1, 8);
        // 炉口火光
        c.fillStyle = '#2a1a14';
        c.fillRect(x + 14, y + 12, w - 28, h - 24);
        c.fillStyle = '#e8823a';
        c.fillRect(x + 17, y + 15, w - 34, h - 30);
        c.fillStyle = '#f5c04a';
        c.fillRect(x + 21, y + 18, w - 42, h - 36);
        break;
      }
      case 'anvil': {
        // 铁砧
        c.fillStyle = '#3d3a38';
        c.fillRect(x + 14, y + h - 12, 20, 10);
        c.fillStyle = '#4e4a47';
        c.fillRect(x + 8, y + 10, 32, 8);
        c.fillRect(x + 12, y + 18, 24, h - 22);
        c.fillStyle = '#6a6663';
        c.fillRect(x + 8, y + 10, 32, 2);
        break;
      }
      case 'blackboard': {
        // 黑板 + 粉笔字
        c.fillStyle = '#5a3c22';
        c.fillRect(x + 1, y + 6, w - 2, h - 8);
        c.fillStyle = '#3a4a42';
        c.fillRect(x + 4, y + 8, w - 8, h - 14);
        c.fillStyle = 'rgba(230,230,220,.55)';
        // 几行"字"
        for (let i = 0; i < 3; i++) {
          c.fillRect(x + 10, y + 14 + i * 8, w * 0.62 - i * 18, 2);
        }
        c.fillStyle = 'rgba(230,230,220,.35)';
        c.fillRect(x + 10, y + 38, w * 0.3, 2);
        break;
      }
      case 'stove': {
        // 灶台：石砌灶身 + 铁锅 + 火光
        c.fillStyle = '#5a5450';
        c.fillRect(x + 2, y + 10, w - 4, h - 12);
        c.fillStyle = '#6e6862';
        c.fillRect(x + 4, y + 12, w - 8, h - 18);
        // 灶口火光
        c.fillStyle = '#2a201c';
        c.fillRect(x + 10, y + 20, 16, 10);
        c.fillStyle = '#e8823a';
        c.fillRect(x + 12, y + 24, 12, 5);
        c.fillStyle = '#f5c04a';
        c.fillRect(x + 14, y + 26, 8, 3);
        // 铁锅
        c.fillStyle = '#3d3a38';
        c.beginPath();
        c.ellipse(x + w / 2, y + 10, 15, 6, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#4e4a47';
        c.beginPath();
        c.ellipse(x + w / 2, y + 9, 13, 4.5, 0, 0, Math.PI * 2);
        c.fill();
        // 锅里的汤
        c.fillStyle = '#c9a44e';
        c.beginPath();
        c.ellipse(x + w / 2, y + 9, 10, 3.4, 0, 0, Math.PI * 2);
        c.fill();
        // 锅把手
        c.fillStyle = '#3d3a38';
        c.fillRect(x + w / 2 + 13, y + 8, 5, 3);
        break;
      }
      case 'bench': {
        // 加工台：木质操作台 + 台面上的罐子与工具
        c.fillStyle = '#5a3c22';
        c.fillRect(x + 2, y + 8, w - 4, h - 10);
        c.fillStyle = '#a97c4f';
        c.fillRect(x + 4, y + 10, w - 8, h - 16);
        // 台面高光
        c.fillStyle = '#c1966a';
        c.fillRect(x + 4, y + 10, w - 8, 3);
        // 桌腿
        c.fillStyle = '#4a3018';
        c.fillRect(x + 6, y + h - 8, 4, 8);
        c.fillRect(x + w - 10, y + h - 8, 4, 8);
        // 罐子
        c.fillStyle = '#7a8a9a';
        c.fillRect(x + 10, y + 12, 9, 11);
        c.fillStyle = '#98a8b8';
        c.fillRect(x + 10, y + 12, 9, 2);
        c.fillStyle = '#c9a44e';
        c.fillRect(x + 9, y + 9, 11, 4);
        // 小桶
        c.fillStyle = '#8a6340';
        c.fillRect(x + 26, y + 14, 12, 9);
        c.fillStyle = '#b98d5c';
        c.fillRect(x + 26, y + 14, 12, 2);
        c.fillStyle = '#6b4a2e';
        c.fillRect(x + 26, y + 17, 12, 1);
        c.fillRect(x + 26, y + 20, 12, 1);
        break;
      }
    }

    // 家具底部统一加一条接触阴影
    c.fillStyle = 'rgba(40,30,20,.14)';
    c.fillRect(x + 2, y + h - 3, w - 4, 3);
  }
}

/**
 * 地图边界与树篱：用**灌木丛**，不是一棵棵独立的树。
 * 交界处的格子会互相咬合成一道有厚度的绿篱，顶部高度按格子哈希起伏，
 * 所以整条边界看上去是连续、自然的，而不是一列重复的圆球。
 */
function drawThicket(c: Ctx, cx: number, baseY: number, seed: number, scale: number) {
  // 三道叶簇：贴地一层 → 中间一层 → 顶部一层，越往上越小
  const layers: Array<{ dy: number; r: number; dx: number }> = [
    { dy: 7, r: 16, dx: (hash(seed, 3) - 0.5) * 8 },
    { dy: 15, r: 13.5, dx: (hash(seed, 7) - 0.5) * 10 },
    { dy: 22 + hash(seed, 11) * 5, r: 10.5, dx: (hash(seed, 13) - 0.5) * 9 }
  ];

  for (const L of layers) {
    canopy(
      c, cx + L.dx, baseY - L.dy * scale, L.r * scale, seed + L.dy,
      pal.foliageLine, pal.foliage[0], pal.foliage[1], pal.foliage[2]
    );
  }

  // 两根探出的细枝，破掉"三个球叠起来"的感觉
  c.strokeStyle = shift(pal.trunk, -12);
  c.lineWidth = 1.6;
  const tw = (hash(seed, 17) - 0.5) * 10;
  c.beginPath();
  c.moveTo(cx + tw, baseY - 10 * scale);
  c.lineTo(cx + tw - 8, baseY - 22 * scale);
  c.moveTo(cx - tw * 0.6, baseY - 14 * scale);
  c.lineTo(cx - tw * 0.6 + 7, baseY - 26 * scale);
  c.stroke();

  // 零星浆果：只长在部分格子上，做出疏密
  if (hash(seed, 23) > 0.62) {
    const bx = cx + (hash(seed, 29) - 0.5) * 18;
    const by = baseY - (12 + hash(seed, 31) * 8) * scale;
    c.fillStyle = '#b8495f';
    c.beginPath(); c.arc(bx, by, 1.7, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(bx + 4, by + 3, 1.4, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,220,220,.55)';
    c.fillRect(bx - 0.5, by - 1.5, 1, 1);
  }
}

function drawHouse(c: Ctx) {
  const x0 = 3 * TILE, y0 = 2 * TILE;
  const w = 6 * TILE, h = 5 * TILE;
  const wallTop = y0 + 2.2 * TILE;

  softShadow(c, x0 + w / 2, y0 + h - 2, w * 0.5, 13, 0.26);

  // ---- 墙体 ----
  c.fillStyle = '#d8c4a0';
  c.fillRect(x0 + 5, wallTop - 1, w - 10, h - 2.2 * TILE + 1);
  c.fillStyle = '#f2e2c4';
  c.fillRect(x0 + 6, wallTop, w - 12, h - 2.2 * TILE);
  // 木纹横板
  c.fillStyle = '#e3cfab';
  for (let i = 0; i < 5; i++) {
    c.fillRect(x0 + 6, wallTop + i * 20 + 16, w - 12, 2);
    c.fillStyle = i % 2 ? '#e3cfab' : '#eaddc2';
  }
  // 顶部受光边
  c.fillStyle = '#fdf2da';
  c.fillRect(x0 + 6, wallTop, w - 12, 2);

  // 木构架（描边色）
  c.fillStyle = '#7a5334';
  c.fillRect(x0 + 5, wallTop - 1, 6, h - 2.2 * TILE + 1);
  c.fillRect(x0 + w - 11, wallTop - 1, 6, h - 2.2 * TILE + 1);
  c.fillStyle = '#9b7350';
  c.fillRect(x0 + 6, wallTop, 2, h - 2.2 * TILE);
  c.fillRect(x0 + w - 10, wallTop, 2, h - 2.2 * TILE);

  // ---- 屋顶（瓦片） ----
  const rTop = y0 - 6;
  const rBot = y0 + 2.4 * TILE;
  const halfTop = 52;
  c.fillStyle = '#8f3a29';
  c.beginPath();
  c.moveTo(x0 - 11, rBot + 1);
  c.lineTo(x0 + halfTop - 1, rTop - 1);
  c.lineTo(x0 + w - halfTop + 1, rTop - 1);
  c.lineTo(x0 + w + 11, rBot + 1);
  c.closePath();
  c.fill();

  c.fillStyle = '#c9563f';
  c.beginPath();
  c.moveTo(x0 - 10, rBot);
  c.lineTo(x0 + halfTop, rTop);
  c.lineTo(x0 + w - halfTop, rTop);
  c.lineTo(x0 + w + 10, rBot);
  c.closePath();
  c.fill();

  // 瓦片：横排 + 错位竖缝
  const rows = 5;
  for (let i = 0; i < rows; i++) {
    const t0 = i / rows;
    const yy = rTop + t0 * (rBot - rTop);
    const spread = 10 + ((i * halfTop) / rows);
    const left = x0 - 10 + spread * 0.4;
    const right = x0 + w + 10 - spread * 0.4;
    // 每排底部阴影线
    c.fillStyle = '#a8402e';
    c.fillRect(left, yy + (rBot - rTop) / rows - 2, right - left, 2);
    // 每排顶部高光
    c.fillStyle = '#e0795c';
    c.fillRect(left, yy, right - left, 1);
    // 竖向瓦缝（隔一排错位）
    c.fillStyle = '#b34a36';
    const gap = 12;
    const off = i % 2 ? gap / 2 : 0;
    for (let wx = left + off; wx < right; wx += gap) {
      c.fillRect(wx, yy + 1, 1, (rBot - rTop) / rows - 3);
    }
  }

  // 屋脊高光
  c.fillStyle = '#f0a08a';
  c.fillRect(x0 + halfTop, rTop, w - halfTop * 2, 2);

  // 屋檐
  c.fillStyle = '#6f2c1e';
  c.fillRect(x0 - 11, rBot - 4, w + 22, 6);
  c.fillStyle = '#8f3a29';
  c.fillRect(x0 - 11, rBot - 4, w + 22, 3);

  // ---- 烟囱 ----
  c.fillStyle = '#6b5240';
  c.fillRect(x0 + w - 72, y0 - 28, 24, 36);
  c.fillStyle = '#9c7a5a';
  c.fillRect(x0 + w - 70, y0 - 26, 20, 32);
  c.fillStyle = '#b08f6e';
  c.fillRect(x0 + w - 70, y0 - 26, 4, 32);
  // 烟囱帽
  c.fillStyle = '#6b5240';
  c.fillRect(x0 + w - 76, y0 - 32, 32, 8);
  c.fillStyle = '#8a6b52';
  c.fillRect(x0 + w - 74, y0 - 30, 28, 4);

  // ---- 门 ----
  const dx = x0 + 2 * TILE + 4;
  const dy = y0 + 3.5 * TILE;
  const dw = TILE - 8, dh = 1.5 * TILE;
  c.fillStyle = '#5a3c22';
  c.fillRect(dx - 1, dy - 1, dw + 2, dh + 1);
  c.fillStyle = '#6f4a2b';
  c.fillRect(dx, dy, dw, dh);
  c.fillStyle = '#8a5f38';
  c.fillRect(dx + 4, dy + 4, dw - 8, dh - 6);
  // 木纹
  c.fillStyle = '#7d5533';
  c.fillRect(dx + 8, dy + 6, 1, dh - 10);
  c.fillRect(dx + dw - 12, dy + 6, 1, dh - 10);
  // 门把
  c.fillStyle = '#e8c86a';
  c.fillRect(dx + dw - 14, dy + dh / 2 - 2, 5, 5);
  c.fillStyle = '#f7e3a0';
  c.fillRect(dx + dw - 14, dy + dh / 2 - 2, 2, 2);

  // ---- 窗（暖光 + 反光） ----
  const winY = y0 + 3.2 * TILE;
  const drawWindow = (wx: number) => {
    // 外框
    c.fillStyle = '#7a5334';
    c.fillRect(wx - 2, winY - 2, 44, 34);
    // 玻璃
    c.fillStyle = '#8ec4dc';
    c.fillRect(wx, winY, 40, 30);
    // 下暗上亮
    c.fillStyle = '#6fa8c4';
    c.fillRect(wx, winY + 16, 40, 14);
    // 反光斜条
    c.fillStyle = 'rgba(255,255,255,.42)';
    c.beginPath();
    c.moveTo(wx + 6, winY + 30);
    c.lineTo(wx + 18, winY);
    c.lineTo(wx + 27, winY);
    c.lineTo(wx + 15, winY + 30);
    c.closePath();
    c.fill();
    // 窗棂
    c.fillStyle = '#7a5334';
    c.fillRect(wx + 18, winY, 3, 30);
    c.fillRect(wx, winY + 13, 40, 3);
  };
  drawWindow(x0 + 26);
  drawWindow(x0 + w - 68);

  // 窗台
  c.fillStyle = '#9b7350';
  c.fillRect(x0 + 24, winY + 32, 44, 3);
  c.fillRect(x0 + w - 70, winY + 32, 44, 3);
}

/* ---------------- 畜栏与棚舍 ---------------- */

function drawPens(c: Ctx) {
  for (const p of Object.values(PENS)) {
    const x = p.x0 * TILE, y = p.y0 * TILE;
    const w = (p.x1 - p.x0 + 1) * TILE, h = (p.y1 - p.y0 + 1) * TILE;
    // 栏内地面略深
    c.fillStyle = 'rgba(120,150,80,.16)';
    c.fillRect(x, y, w, h);
    // 围栏柱
    c.fillStyle = '#9c7a4f';
    const post = (px: number, py: number) => c.fillRect(px - 2, py - 12, 4, 14);
    for (let px = x; px <= x + w; px += TILE) { post(px, y); post(px, y + h); }
    for (let py = y + TILE; py < y + h; py += TILE) { post(x, py); post(x + w, py); }
    // 横栏
    c.fillStyle = '#b8905e';
    c.fillRect(x, y - 8, w, 3);
    c.fillRect(x, y - 3, w, 3);
    c.fillRect(x, y + h - 8, w, 3);
    c.fillRect(x, y + h - 3, w, 3);
    c.fillRect(x - 1, y - 8, 3, h + 8);
    c.fillRect(x + w - 2, y - 8, 3, h + 8);
  }
}

function drawCoop(c: Ctx) {
  const b = BUILDINGS.coop;
  const x = b.x * TILE, y = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
  c.fillStyle = 'rgba(60,40,20,.18)';
  c.beginPath(); c.ellipse(x + w / 2, y + h - 2, w * 0.5, 10, 0, 0, Math.PI * 2); c.fill();
  // 墙
  c.fillStyle = '#e8d3a8';
  c.fillRect(x + 4, y + 20, w - 8, h - 20);
  c.fillStyle = '#c9ab77';
  c.fillRect(x + 4, y + 20, w - 8, 4);
  // 屋顶
  c.fillStyle = '#c9743f';
  c.beginPath();
  c.moveTo(x - 6, y + 24); c.lineTo(x + w / 2, y - 8); c.lineTo(x + w + 6, y + 24);
  c.closePath(); c.fill();
  c.fillStyle = '#a85c30';
  c.fillRect(x - 6, y + 21, w + 12, 4);
  // 门
  c.fillStyle = '#6f4a2b';
  c.fillRect(x + w / 2 - 12, y + h - 30, 24, 30);
  c.fillStyle = '#8a5f38';
  c.fillRect(x + w / 2 - 9, y + h - 27, 18, 27);
  // 标识
  c.font = '14px serif';
  c.fillText('🐔', x + 8, y + h - 8);
}

function drawBarn(c: Ctx) {
  const b = BUILDINGS.barn;
  const x = b.x * TILE, y = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
  c.fillStyle = 'rgba(60,40,20,.18)';
  c.beginPath(); c.ellipse(x + w / 2, y + h - 2, w * 0.5, 12, 0, 0, Math.PI * 2); c.fill();
  // 墙（红）
  c.fillStyle = '#c0574a';
  c.fillRect(x + 4, y + 24, w - 8, h - 24);
  c.fillStyle = '#a34539';
  for (let i = 0; i < 3; i++) c.fillRect(x + 4, y + 34 + i * 18, w - 8, 3);
  // 白色门框
  c.fillStyle = '#f2ead8';
  c.fillRect(x + w / 2 - 22, y + h - 40, 44, 40);
  c.fillStyle = '#8a4a3a';
  c.fillRect(x + w / 2 - 18, y + h - 36, 36, 36);
  c.strokeStyle = '#f2ead8'; c.lineWidth = 3;
  c.beginPath();
  c.moveTo(x + w / 2 - 18, y + h - 36); c.lineTo(x + w / 2 + 18, y + h);
  c.moveTo(x + w / 2 + 18, y + h - 36); c.lineTo(x + w / 2 - 18, y + h);
  c.stroke();
  // 屋顶
  c.fillStyle = '#8a4a3a';
  c.beginPath();
  c.moveTo(x - 8, y + 28); c.lineTo(x + w * 0.25, y - 6); c.lineTo(x + w * 0.75, y - 6); c.lineTo(x + w + 8, y + 28);
  c.closePath(); c.fill();
  c.fillStyle = '#6f3a2e';
  c.fillRect(x - 8, y + 25, w + 16, 4);
  c.font = '15px serif';
  c.fillText('🐄', x + 10, y + h - 8);
}

/* ---------------- 小镇建筑 ---------------- */

/** 每种建筑的招牌 */
const TOWN_SIGN: Record<TownBuildingKind, { text: string; color: string } | null> = {
  store: { text: '杂货店', color: '#f7e9c4' },
  tavern: { text: '酒馆', color: '#f7e9c4' },
  smith: { text: '铁匠铺', color: '#e2dcd0' },
  clinic: { text: '诊所', color: '#eef6f8' },
  school: { text: '学堂', color: '#f2e8d4' },
  tower: null,
  house: null
};

/* ---------------- 小镇建筑（上世纪乡镇风格） ---------------- */

/**
 * 建筑材料配色：白灰墙、青砖、石材台基。
 * 不用纯饱和色——老房子被雨淋了几十年，颜色要压灰。
 */
const TOWN_MATERIAL = {
  plaster: { base: '#e4dbc6', dark: '#c9bda2', hi: '#f4efdf' },
  brick:   { base: '#b3a894', dark: '#93887a', hi: '#cdc2ae' },
  stone:   { base: '#9a9488', dark: '#7a7468', hi: '#b5afa2' }
} as const;

/** 每类建筑的形制：墙material、瓦色、脊色、木作色 */
interface TownBuildStyle {
  wall: keyof typeof TOWN_MATERIAL;
  roof: string;
  ridge: string;
  trim: string;
  /** 雨棚 / 幌子布色 */
  cloth?: string;
}

const TOWN_BUILD_STYLE: Record<string, TownBuildStyle> = {
  store:  { wall: 'plaster', roof: '#5b7a8c', ridge: '#3a4f5c', trim: '#6b4a2e', cloth: '#3f6b8a' },
  tavern: { wall: 'plaster', roof: '#8e4a3a', ridge: '#5e2e24', trim: '#4a3527', cloth: '#a8433a' },
  smith:  { wall: 'brick',   roof: '#57534d', ridge: '#33302d', trim: '#3e3a35' },
  clinic: { wall: 'plaster', roof: '#7e8e96', ridge: '#525f66', trim: '#4e5e64' },
  school: { wall: 'brick',   roof: '#87603f', ridge: '#553c27', trim: '#6b4a2e' },
  house:  { wall: 'plaster', roof: '#6d5b4e', ridge: '#443a31', trim: '#5a3c22' }
};

/** 两个颜色按比例混合（a 为主，t 越大越偏 b） */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

/**
 * 一片瓦顶。
 * ridgeAtBottom = true 表示屋脊在下、檐口在上（北向门、看见的是北面）。
 */
function drawTileRoof(
  c: Ctx, roofL: number, roofR: number, top: number, bottom: number,
  ridgeAtBottom: boolean, tile: string, ridge: string
) {
  const hgt = bottom - top;
  if (hgt <= 4) return;

  // 瓦面
  c.fillStyle = tile;
  c.fillRect(roofL, top, roofR - roofL, hgt);

  // 瓦垄（竖向筒瓦）：每条左亮右暗，间距 7px
  for (let xx = roofL + 2; xx < roofR - 2; xx += 7) {
    c.fillStyle = 'rgba(255,255,255,.09)';
    c.fillRect(xx, top + 2, 2, hgt - 4);
    c.fillStyle = 'rgba(0,0,0,.12)';
    c.fillRect(xx + 4, top + 2, 2, hgt - 4);
  }

  // 横向瓦楞：越靠檐越深
  for (let i = 1; i < 7; i++) {
    const ly = top + (hgt * i) / 7;
    c.fillStyle = `rgba(0,0,0,${0.04 + i * 0.013})`;
    c.fillRect(roofL + 2, Math.round(ly), roofR - roofL - 4, 1);
  }

  // 檐口：瓦当半圆 + 檐板
  const eaveEdge = ridgeAtBottom ? top : bottom;
  const dir = ridgeAtBottom ? 1 : -1;
  c.fillStyle = shift(tile, -52);
  c.fillRect(roofL, ridgeAtBottom ? top : bottom - 4, roofR - roofL, 4);
  for (let xx = roofL + 3; xx < roofR - 4; xx += 7) {
    const cy = eaveEdge + dir * 3.4;
    c.fillStyle = shift(tile, -30);
    c.beginPath(); c.arc(xx + 3, cy, 3.3, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,.16)';
    c.beginPath(); c.arc(xx + 3, cy - dir, 1.5, 0, Math.PI * 2); c.fill();
  }

  // 正脊
  const ridgeY = ridgeAtBottom ? bottom - 5 : top - 5;
  c.fillStyle = ridge;
  c.fillRect(roofL - 3, ridgeY, roofR - roofL + 6, 10);
  c.fillStyle = shift(ridge, 30);
  c.fillRect(roofL - 3, ridgeY, roofR - roofL + 6, 2);

  // 脊端起翘（鸱吻的简化）
  const tip = ridgeAtBottom ? 1 : -1;
  for (const ex of [roofL - 2, roofR + 2]) {
    const out = ex < roofL ? -7 : 7;
    c.fillStyle = ridge;
    c.beginPath();
    c.moveTo(ex, ridgeY + (tip > 0 ? 10 : 0));
    c.lineTo(ex + out, ridgeY + (tip > 0 ? 15 : -5));
    c.lineTo(ex, ridgeY + (tip > 0 ? 1 : 9));
    c.closePath(); c.fill();
  }
}

/** 木格窗：内凹窗洞 + 暖光 + 木棂 + 窗楣窗台 */
function drawPeriodWindow(c: Ctx, x: number, y: number, w: number, h: number) {
  // 窗洞内凹阴影
  c.fillStyle = 'rgba(32,24,18,.55)';
  c.fillRect(x - 2, y - 2, w + 4, h + 4);

  // 玻璃（偏冷）
  c.fillStyle = '#5f7480';
  c.fillRect(x, y, w, h);
  // 室内透出的暖光落在下半部
  c.fillStyle = 'rgba(216,172,104,.32)';
  c.fillRect(x, y + h * 0.46, w, h * 0.54);
  // 玻璃反光（斜条）
  c.fillStyle = 'rgba(255,255,255,.20)';
  c.beginPath();
  c.moveTo(x + 2, y + h - 2); c.lineTo(x + w * 0.50, y + 1);
  c.lineTo(x + w * 0.72, y + 1); c.lineTo(x + w * 0.24, y + h - 2);
  c.closePath(); c.fill();

  // 木棂：一竖两横
  c.fillStyle = '#6b4a2e';
  c.fillRect(x + w / 2 - 1, y, 2, h);
  c.fillRect(x, y + h * 0.44, w, 2);

  // 窗框
  c.strokeStyle = '#553a22'; c.lineWidth = 2;
  c.strokeRect(x - 1, y - 1, w + 2, h + 2);

  // 窗楣（木过梁）
  c.fillStyle = '#7a5535';
  c.fillRect(x - 3, y - 6, w + 6, 4);
  c.fillStyle = 'rgba(255,255,255,.14)';
  c.fillRect(x - 3, y - 6, w + 6, 1);

  // 窗台 + 台面投影
  c.fillStyle = '#8a6a48';
  c.fillRect(x - 3, y + h + 1, w + 6, 3);
  c.fillStyle = 'rgba(0,0,0,.26)';
  c.fillRect(x - 3, y + h + 4, w + 6, 2);
}

/** 内凹木门：门槛石、门套、门板、门簪 */
function drawPeriodDoor(
  c: Ctx, x: number, y: number, dw: number, dh: number,
  opening: 'up' | 'down' | 'left' | 'right'
) {
  // 门洞（内凹）
  c.fillStyle = 'rgba(26,20,15,.62)';
  c.fillRect(x - 2, y - 2, dw + 4, dh + 4);

  // 门套（木框）
  c.fillStyle = '#4a3018';
  c.fillRect(x, y, dw, dh);

  // 门板：竖向木板 + 板缝
  const innerX = x + 3;
  const innerW = dw - 6;
  c.fillStyle = '#8a5f38';
  c.fillRect(innerX, y + 3, innerW, dh - 3);
  c.fillStyle = 'rgba(0,0,0,.16)';
  for (let i = 1; i < 4; i++) {
    c.fillRect(innerX + (innerW * i) / 4, y + 3, 1, dh - 3);
  }
  // 上部高光（受光）
  c.fillStyle = 'rgba(255,232,190,.16)';
  c.fillRect(innerX, y + 3, innerW, 2);

  // 门簪（横向加固木条）
  c.fillStyle = '#6b4a2e';
  c.fillRect(innerX, y + dh * 0.22, innerW, 3);
  c.fillRect(innerX, y + dh * 0.74, innerW, 3);

  // 门环
  c.fillStyle = '#c9a44e';
  const hx = x + dw / 2;
  const hy = y + dh * 0.52;
  c.beginPath(); c.arc(hx, hy, 2.6, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#7a5a20';
  c.beginPath(); c.arc(hx, hy, 1.2, 0, Math.PI * 2); c.fill();

  // 门槛石 + 门前石阶（按朝向伸出）
  const stepY = opening === 'down' ? y + dh : opening === 'up' ? y - 5 : y + dh - 2;
  c.fillStyle = '#a89880';
  if (opening === 'left' || opening === 'right') {
    const sx = opening === 'left' ? x - 6 : x + dw;
    c.fillRect(sx, y + 3, 6, dh - 6);
    c.fillStyle = 'rgba(255,240,210,.22)';
    c.fillRect(sx, y + 3, 6, 1);
  } else {
    c.fillRect(x - 4, stepY, dw + 8, 5);
    c.fillStyle = 'rgba(255,240,210,.22)';
    c.fillRect(x - 4, stepY, dw + 8, 1);
  }
}

/** 招牌：木牌 + 铁艺挑架（挂在檐下） */
function drawShopSign(c: Ctx, x: number, w: number, y: number, text: string, bg: string) {
  const sw = Math.min(52, text.length * 13 + 14);
  const sx = x + w / 2 - sw / 2;

  // 挑架
  c.strokeStyle = '#3a2a1c'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x + w / 2 - 6, y - 8); c.lineTo(x + w / 2 - 6, y - 1); c.stroke();
  c.beginPath(); c.moveTo(x + w / 2 + 6, y - 8); c.lineTo(x + w / 2 + 6, y - 1); c.stroke();

  // 牌面
  c.fillStyle = '#4a3018';
  c.fillRect(sx - 2, y - 2, sw + 4, 18);
  c.fillStyle = bg;
  c.fillRect(sx, y, sw, 14);
  c.fillStyle = 'rgba(255,255,255,.20)';
  c.fillRect(sx, y, sw, 1);
  // 木纹
  c.fillStyle = 'rgba(120,90,50,.16)';
  c.fillRect(sx, y + 5, sw, 1);
  c.fillRect(sx, y + 10, sw, 1);

  // 字
  c.fillStyle = '#4a2e18';
  c.font = 'bold 10px "PingFang SC",sans-serif';
  c.textAlign = 'center';
  c.fillText(text, x + w / 2, y + 10.5);
  c.textAlign = 'left';
}

/** 一栋上世纪风格的房子 */
function drawPeriodBuilding(c: Ctx, b: TownBuilding, x: number, y: number, w: number, h: number) {
  const style = TOWN_BUILD_STYLE[b.kind] ?? TOWN_BUILD_STYLE.house;
  const mat = TOWN_MATERIAL[style.wall];
  // 民宅统一成青瓦（保留一点原本色相的变化，年代感更准）
  const tile = b.kind === 'house' ? mixHex(shift(b.roof, -30), '#6f757c', 0.66) : style.roof;
  const ridge = b.kind === 'house' ? mixHex(shift(b.roof, -66), '#464b51', 0.72) : style.ridge;

  // 所有建筑统一朝南：瓦顶在上、墙面和门在下，玩家从下方走过来进门。
  // （曾经给北向门的民宅做过「墙在上、瓦顶在下」的翻转，看起来像房子倒过来了，已废弃。）

  // 地面投影
  c.fillStyle = 'rgba(48,36,24,.20)';
  c.beginPath(); c.ellipse(x + w / 2, y + h - 3, w * 0.55, 11, 0, 0, Math.PI * 2); c.fill();

  // 版面：墙区与瓦顶区
  const sideW = 8;
  const wallL = x + sideW;
  const wallR = x + w - sideW;
  const wallTop = y + Math.round(h * 0.52);
  const wallBottom = y + h - 16;
  const wallH = Math.max(16, wallBottom - wallTop);

  // 侧墙（表现进深）
  c.fillStyle = shift(mat.dark, -20);
  c.fillRect(x + 1, wallTop, sideW, wallH + 12);
  c.fillRect(x + w - sideW - 1, wallTop, sideW, wallH + 12);

  // 主墙
  c.fillStyle = mat.base;
  c.fillRect(wallL, wallTop, wallR - wallL, wallH + 12);

  // 风化：檐下阴影 + 墙脚返潮 + 竖向水痕
  const vg = c.createLinearGradient(0, wallTop, 0, wallTop + wallH + 12);
  vg.addColorStop(0, 'rgba(86,66,46,.26)');
  vg.addColorStop(0.20, 'rgba(86,66,46,.05)');
  vg.addColorStop(0.66, 'rgba(86,66,46,0)');
  vg.addColorStop(1, 'rgba(66,52,38,.22)');
  c.fillStyle = vg;
  c.fillRect(wallL, wallTop, wallR - wallL, wallH + 12);

  for (let i = 0; i < 5; i++) {
    const sx = wallL + 10 + hash(b.x * 9 + i, b.y * 5) * (wallR - wallL - 20);
    const sh = 12 + hash(b.y + i, b.x * 7) * (wallH * 0.55);
    c.fillStyle = 'rgba(80,64,46,.07)';
    c.fillRect(Math.round(sx), wallTop + 6, 2, Math.round(sh));
  }

  // 砖缝（只有砖墙才有）
  if (style.wall === 'brick') {
    c.fillStyle = 'rgba(58,48,40,.13)';
    for (let yy = wallTop + 9; yy < wallTop + wallH + 10; yy += 9) {
      c.fillRect(wallL, Math.round(yy), wallR - wallL, 1);
      const off = (Math.round((yy - wallTop) / 9) % 2) * 11;
      for (let xx = wallL + off; xx < wallR; xx += 22) c.fillRect(Math.round(xx), Math.round(yy), 1, 9);
    }
  }

  // 台基（石砌）：贴在墙脚下方
  const plinthY = wallTop + wallH + 12;
  c.fillStyle = TOWN_MATERIAL.stone.dark;
  c.fillRect(x + 2, plinthY, w - 4, 12);
  c.fillStyle = TOWN_MATERIAL.stone.base;
  c.fillRect(x + 2, plinthY, w - 4, 10);
  c.fillStyle = TOWN_MATERIAL.stone.hi;
  c.fillRect(x + 2, plinthY, w - 4, 1);
  c.fillStyle = 'rgba(50,44,36,.30)';
  for (let xx = x + 13; xx < x + w - 6; xx += 17) c.fillRect(Math.round(xx), plinthY + 1, 1, 9);
  c.fillRect(x + 2, plinthY + 9, w - 4, 1);

  // 墙角隅石（白灰墙上压深色条，做出"转角是石头砌的"）
  c.fillStyle = 'rgba(90,78,62,.30)';
  c.fillRect(wallL, wallTop, 4, wallH + 12);
  c.fillRect(wallR - 4, wallTop, 4, wallH + 12);
  c.fillStyle = 'rgba(255,250,235,.16)';
  c.fillRect(wallL, wallTop, 1, wallH + 12);
  c.fillRect(wallR - 1, wallTop, 1, wallH + 12);

  // ── 瓦顶（统一：屋脊在上，檐口压在墙顶）──
  const roofL = x - 7;
  const roofR = x + w + 7;
  drawTileRoof(c, roofL, roofR, y + 4, wallTop, false, tile, ridge);
  c.fillStyle = 'rgba(40,30,20,.30)';
  c.fillRect(roofL + 3, wallTop, roofR - roofL - 6, 7);

  // ── 墙上元素统一排版：雨棚 → 招牌 → 窗 → 门，互不重叠 ──
  const hasSign = !!TOWN_SIGN[b.kind];
  const awningH = b.kind === 'store' ? 8 : 0;
  const topPad = 4 + awningH + (hasSign ? 22 : 0);
  const winY = wallTop + topPad + 2;
  const doorDH = Math.min(34, Math.max(20, wallH - topPad - 10));
  const doorTop = wallTop + wallH - doorDH + 10;
  const winH = Math.min(22, doorTop - winY - 6);

  // ── 窗 ──
  if (winH >= 12) {
    const cols = Math.max(2, Math.floor((w - 34) / 44));
    const winW = 25;
    const gap = (wallR - wallL - cols * winW) / (cols + 1);
    for (let i = 0; i < cols; i++) {
      const wx = Math.round(wallL + gap + i * (winW + gap));
      // 门所在的位置留空
      if (i === Math.floor(cols / 2)) continue;
      drawPeriodWindow(c, wx, winY, winW, winH);
    }
  }

  // ── 门：一律在正面（南侧）下方居中，玩家走到下方按空格进门 ──
  const dw = 26;
  const dx = Math.round(x + w / 2 - dw / 2);
  drawPeriodDoor(c, dx, Math.round(doorTop), dw, doorDH, 'down');

  // ── 招牌 ──
  const sign = TOWN_SIGN[b.kind];
  if (sign) {
    drawShopSign(c, x, w, wallTop + 4 + awningH, sign.text, sign.color);
  }

  // ── 各店特征 ──
  drawShopExtras(c, b, x, y, w, wallTop, plinthY, style);
}

/** 各店铺的性格化细节 */
function drawShopExtras(
  c: Ctx, b: TownBuilding, x: number, y: number, w: number,
  wallTop: number, plinthY: number, style: TownBuildStyle
) {
  if (b.kind === 'smith') {
    // 砖砌烟囱（烟在动态层画）
    const chX = x + w - 26;
    c.fillStyle = '#6b5548';
    c.fillRect(chX, y - 10, 12, 22);
    c.fillStyle = '#846a58';
    c.fillRect(chX, y - 10, 12, 3);
    c.fillStyle = 'rgba(0,0,0,.22)';
    c.fillRect(chX + 2, y - 5, 8, 1);
    c.fillRect(chX + 2, y - 1, 8, 1);
    // 门口堆的煤 / 铁料
    c.fillStyle = '#3a3632';
    c.beginPath(); c.ellipse(x + 16, plinthY + 2, 9, 4, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#4e4a45';
    c.beginPath(); c.arc(x + 13, plinthY - 1, 3, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + 19, plinthY, 2.6, 0, Math.PI * 2); c.fill();
  } else if (b.kind === 'tavern') {
    // 布幌子（挂在侧边）+ 灯笼
    const bx = x + w - 14;
    c.fillStyle = '#3a2a1c';
    c.fillRect(bx, wallTop + 6, 2, 10);
    c.fillStyle = style.cloth ?? '#a8433a';
    c.fillRect(bx - 5, wallTop + 15, 12, 26);
    c.fillStyle = 'rgba(255,255,255,.18)';
    c.fillRect(bx - 5, wallTop + 15, 12, 2);
    c.fillStyle = 'rgba(0,0,0,.16)';
    c.fillRect(bx - 5, wallTop + 26, 12, 1);
    // 幌子上的字（竖排，简化成一个色块）
    c.fillStyle = 'rgba(250,240,215,.85)';
    c.fillRect(bx - 2, wallTop + 20, 6, 6);
    c.fillStyle = style.cloth ?? '#a8433a';
    c.fillRect(bx - 1, wallTop + 22, 4, 2);
    // 灯笼
    c.fillStyle = '#c9563f';
    c.beginPath(); c.ellipse(x + 15, wallTop + 16, 5, 6.5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,220,140,.55)';
    c.beginPath(); c.ellipse(x + 15, wallTop + 15, 2.6, 3.6, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#8a3a2e';
    c.fillRect(x + 13, wallTop + 9, 5, 2);
    c.fillRect(x + 13, wallTop + 22, 5, 2);
  } else if (b.kind === 'clinic') {
    // 白底红十字牌
    c.fillStyle = '#f2f6f6';
    c.fillRect(x + w / 2 - 9, wallTop + 2, 18, 18);
    c.strokeStyle = '#8a9aa4'; c.lineWidth = 1;
    c.strokeRect(x + w / 2 - 9, wallTop + 2, 18, 18);
    c.fillStyle = '#c0392b';
    c.fillRect(x + w / 2 - 5, wallTop + 8, 10, 3);
    c.fillRect(x + w / 2 - 1.5, wallTop + 4, 3, 11);
    // 门口两盆药草
    for (const px of [x + 12, x + w - 16]) {
      c.fillStyle = '#8a5a3a';
      c.fillRect(px, plinthY - 6, 8, 6);
      c.fillStyle = '#4a8a4a';
      c.beginPath(); c.arc(px + 4, plinthY - 8, 4.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#5fa05a';
      c.beginPath(); c.arc(px + 3, plinthY - 9, 2, 0, Math.PI * 2); c.fill();
    }
  } else if (b.kind === 'school') {
    // 檐下挂的铜钟 + 墙面黑板
    const bx = x + w / 2;
    c.fillStyle = '#3a2a1c';
    c.fillRect(bx - 1, wallTop + 4, 2, 5);
    c.fillStyle = '#b08a3a';
    c.beginPath();
    c.moveTo(bx - 6, wallTop + 16);
    c.quadraticCurveTo(bx - 6, wallTop + 7, bx, wallTop + 7);
    c.quadraticCurveTo(bx + 6, wallTop + 7, bx + 6, wallTop + 16);
    c.closePath(); c.fill();
    c.fillStyle = '#d8b45a';
    c.beginPath(); c.arc(bx, wallTop + 14, 2, 0, Math.PI * 2); c.fill();
  } else if (b.kind === 'store') {
    // 雨棚（条纹布）：挂在檐下、招牌之上
    const ay = wallTop + 2;
    const n = Math.max(4, Math.round((w - 10) / 11));
    const cw = (w - 10) / n;
    for (let i = 0; i < n; i++) {
      c.fillStyle = i % 2 === 0 ? '#e8e0cc' : (style.cloth ?? '#3f6b8a');
      c.fillRect(x + 5 + i * cw, ay, cw + 0.5, 7);
    }
    c.fillStyle = 'rgba(0,0,0,.20)';
    c.fillRect(x + 5, ay + 7, w - 10, 3);
    // 货箱
    c.fillStyle = '#8a6a48';
    c.fillRect(x + w - 24, plinthY - 10, 14, 10);
    c.fillStyle = '#a8845c';
    c.fillRect(x + w - 24, plinthY - 10, 14, 2);
    c.fillStyle = 'rgba(0,0,0,.18)';
    c.fillRect(x + w - 24, plinthY - 5, 14, 1);
  } else if (b.kind === 'house') {
    // 民居：窗台花盆 / 晾衣绳
    if (w >= TILE * 3) {
      c.fillStyle = '#8a5a3a';
      c.fillRect(x + 12, plinthY - 7, 9, 7);
      c.fillStyle = '#5a9a48';
      c.beginPath(); c.arc(x + 15, plinthY - 9, 3.6, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#e86a9a';
      c.beginPath(); c.arc(x + 18, plinthY - 11, 2, 0, Math.PI * 2); c.fill();
    }
  }
}

function drawTownBuildings(c: Ctx) {
  for (const b of TOWN_BUILDINGS) {
    const x = b.x * TILE, y = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
    if (b.kind === 'tower') { drawTower(c, x, y, w, h); continue; }
    drawPeriodBuilding(c, b, x, y, w, h);
  }
  drawFountain(c);
  drawWell(c);
}

/** 小镇水井：石台 + 井口 + 辘轳架（绳与桶在动态层，会晃） */
function drawWell(c: Ctx) {
  const wl = TOWN_WELL;
  const x = wl.x * TILE, y = wl.y * TILE;
  const cx = x + wl.w * TILE / 2;
  const cy = y + wl.h * TILE / 2;

  // 影子
  c.fillStyle = 'rgba(60,40,20,.22)';
  c.beginPath(); c.ellipse(cx, y + wl.h * TILE - 4, 40, 10, 0, 0, Math.PI * 2); c.fill();

  // 石台
  c.fillStyle = '#8a8478';
  c.beginPath(); c.ellipse(cx, cy + 8, 38, 20, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#a8a294';
  c.beginPath(); c.ellipse(cx, cy + 5, 34, 17, 0, 0, Math.PI * 2); c.fill();

  // 井口（深色）
  c.fillStyle = '#2a2420';
  c.beginPath(); c.ellipse(cx, cy + 4, 22, 11, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#14100e';
  c.beginPath(); c.ellipse(cx, cy + 4, 16, 8, 0, 0, Math.PI * 2); c.fill();

  // 井沿石砖
  c.strokeStyle = '#7a7468'; c.lineWidth = 3;
  c.beginPath(); c.ellipse(cx, cy + 5, 30, 15, 0, 0, Math.PI * 2); c.stroke();

  // 木架（两根柱子 + 横梁）
  c.fillStyle = '#6b4a2e';
  c.fillRect(cx - 30, y - 22, 5, 34);
  c.fillRect(cx + 25, y - 22, 5, 34);
  c.fillStyle = '#8a5f38';
  c.fillRect(cx - 32, y - 26, 64, 6);
  c.fillStyle = '#a97c4f';
  c.fillRect(cx - 32, y - 26, 64, 2);
}


/** 钟楼：细高的塔身 + 表盘 */
function drawTower(c: Ctx, x: number, y: number, w: number, h: number) {
  c.fillStyle = 'rgba(60,40,20,.2)';
  c.beginPath(); c.ellipse(x + w / 2, y + h - 2, w * 0.55, 9, 0, 0, Math.PI * 2); c.fill();

  // 塔身
  c.fillStyle = '#b0a89a';
  c.fillRect(x + 4, y + 18, w - 8, h - 20);
  c.fillStyle = '#c8c0b0';
  c.fillRect(x + 6, y + 20, w - 12, h - 24);
  // 石缝
  c.fillStyle = 'rgba(0,0,0,.1)';
  for (let i = 0; i < 4; i++) c.fillRect(x + 6, y + 30 + i * 16, w - 12, 2);

  // 尖顶
  c.fillStyle = '#6b6b6b';
  c.beginPath();
  c.moveTo(x + 1, y + 20);
  c.lineTo(x + w / 2, y - 14);
  c.lineTo(x + w - 1, y + 20);
  c.closePath(); c.fill();
  c.fillStyle = '#8a8a8a';
  c.beginPath();
  c.moveTo(x + w / 2, y - 14);
  c.lineTo(x + w - 1, y + 20);
  c.lineTo(x + w * 0.62, y + 20);
  c.closePath(); c.fill();

  // 表盘
  const cx = x + w / 2;
  const cy = y + 40;
  c.fillStyle = '#f7f2e4';
  c.beginPath(); c.arc(cx, cy, 11, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#5a4a38'; c.lineWidth = 2;
  c.beginPath(); c.arc(cx, cy, 11, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = '#3d2b1f'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx, cy - 7); c.stroke();
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + 5, cy + 3); c.stroke();

  // 门
  c.fillStyle = '#4a3a2e';
  c.fillRect(cx - 9, y + h - 26, 18, 22);
}

/** 广场喷泉（静态部分：池沿、水面、中央石柱；涟漪与水花在动态层） */
function drawFountain(c: Ctx) {
  const f = TOWN_FOUNTAIN;
  const x = f.x * TILE, y = f.y * TILE, w = f.w * TILE, h = f.h * TILE;
  const cx = x + w / 2;

  // 池沿
  c.fillStyle = '#9a958c';
  c.beginPath(); c.ellipse(cx, y + h * 0.62, w * 0.46, h * 0.34, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#b5b0a6';
  c.beginPath(); c.ellipse(cx, y + h * 0.58, w * 0.42, h * 0.30, 0, 0, Math.PI * 2); c.fill();
  // 水面
  c.fillStyle = '#72c6e0';
  c.beginPath(); c.ellipse(cx, y + h * 0.58, w * 0.34, h * 0.24, 0, 0, Math.PI * 2); c.fill();
  // 中央小柱
  c.fillStyle = '#a8a39a';
  c.fillRect(cx - 5, y + h * 0.28, 10, h * 0.32);
  c.fillStyle = '#c9c4ba';
  c.fillRect(cx - 3, y + h * 0.28, 4, h * 0.30);
}

/* ---------------- 小镇里"会动"的东西 ---------------- */

/**
 * 烟、灯笼、井水、喷泉水花。
 * 这些必须在**动态层**逐帧画——底图只在换季/换场景时重绘一次。
 */
function drawTownAnimated(c: Ctx, nowMs: number) {
  // ── 铁匠铺烟囱的烟：4 团错开上升、摆动、扩散、变淡 ──
  for (const b of TOWN_BUILDINGS) {
    if (b.kind !== 'smith') continue;
    const x = b.x * TILE, y = b.y * TILE, w = b.w * TILE;
    const chX = x + w - 26;
    for (let i = 0; i < 4; i++) {
      const t = ((nowMs / 2600) + i * 0.25) % 1;
      const sway = Math.sin(t * Math.PI * 2.2 + i * 1.7) * (2 + t * 10);
      const sx = chX + 6 + sway;
      const sy = y - 14 - t * 48;
      const rr = 3 + t * 7;
      const a = 0.42 * (1 - t) * (1 - t);
      c.fillStyle = `rgba(198,198,192,${a})`;
      c.beginPath(); c.arc(sx, sy, rr, 0, Math.PI * 2); c.fill();
    }
  }

  // ── 酒馆灯笼的光晕：双频正弦模拟"跳动" ──
  for (const b of TOWN_BUILDINGS) {
    if (b.kind !== 'tavern') continue;
    const x = b.x * TILE, y = b.y * TILE, h = b.h * TILE;
    const wallTop = y + Math.round(h * 0.52);
    const lx = x + 15, ly = wallTop + 15;
    const flick = 0.5 + 0.5 * Math.sin(nowMs / 163) * Math.sin(nowMs / 71 + 1.3);
    const g = c.createRadialGradient(lx, ly, 1, lx, ly, 24);
    g.addColorStop(0, `rgba(255,198,104,${0.30 + flick * 0.26})`);
    g.addColorStop(0.55, `rgba(255,180,90,${0.10 + flick * 0.10})`);
    g.addColorStop(1, 'rgba(255,180,90,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(lx, ly, 24, 0, Math.PI * 2); c.fill();
    // 灯芯
    c.fillStyle = `rgba(255,240,190,${0.45 + flick * 0.5})`;
    c.beginPath(); c.ellipse(lx, ly, 2.3, 3.4, 0, 0, Math.PI * 2); c.fill();
  }

  // ── 水井：水面微光 + 绳与桶轻轻摆 ──
  {
    const wl = TOWN_WELL;
    const x = wl.x * TILE, y = wl.y * TILE;
    const cx = x + wl.w * TILE / 2;
    const cy = y + wl.h * TILE / 2;

    // 井水的反光（井口里一圈）
    const glint = (Math.sin(nowMs / 900) + 1) / 2;
    c.strokeStyle = `rgba(150,200,232,${0.20 + glint * 0.32})`;
    c.lineWidth = 1.4;
    c.beginPath();
    c.ellipse(cx, cy + 4, 12 + glint * 4, 5.5 + glint * 2, 0, 0, Math.PI * 2);
    c.stroke();

    // 吊桶与绳（绳随桶摆）
    const sway = Math.sin(nowMs / 1500) * 2.4;
    const bx = cx + sway;
    const byTop = y - 20;
    const byBottom = cy - 8;
    c.strokeStyle = '#c9b896'; c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(cx, byTop);
    c.quadraticCurveTo((cx + bx) / 2, (byTop + byBottom) / 2 + 2, bx, byBottom);
    c.stroke();
    // 桶
    c.fillStyle = '#7a5434';
    c.fillRect(bx - 7, byBottom, 14, 12);
    c.fillStyle = '#9a7248';
    c.fillRect(bx - 7, byBottom, 14, 2);
    c.fillStyle = '#5a3c22';
    c.fillRect(bx - 7, byBottom + 5, 14, 1);
    c.fillStyle = 'rgba(0,0,0,.18)';
    c.fillRect(bx - 7, byBottom + 10, 14, 2);
  }

  // ── 广场喷泉：涟漪 + 水柱 + 溅落的水珠 ──
  {
    const f = TOWN_FOUNTAIN;
    const x = f.x * TILE, y = f.y * TILE, w = f.w * TILE, h = f.h * TILE;
    const cx = x + w / 2;
    const wy = y + h * 0.58;
    const t = Math.sin(nowMs / 600) * 0.5 + 0.5;

    // 三道涟漪（向外扩、渐淡）
    for (let i = 0; i < 3; i++) {
      const phase = ((nowMs / 2200) + i / 3) % 1;
      const rr = 9 + phase * 22;
      c.strokeStyle = `rgba(255,255,255,${0.30 * (1 - phase)})`;
      c.lineWidth = 1.4;
      c.beginPath(); c.ellipse(cx, wy, rr, rr * 0.68, 0, 0, Math.PI * 2); c.stroke();
    }

    // 水柱（高度随时间微变）
    const pulse = 0.72 + 0.28 * Math.sin(nowMs / 430);
    const colTop = y + h * 0.10;
    c.fillStyle = 'rgba(184,232,246,.68)';
    c.fillRect(cx - 2, colTop, 4, h * 0.22 * pulse);
    // 柱顶的水团
    c.fillStyle = `rgba(210,242,252,${0.62 + t * 0.2})`;
    c.beginPath(); c.arc(cx, colTop, 3.2 + pulse, 0, Math.PI * 2); c.fill();

    // 溅落的水珠：向外抛、落下
    for (let i = 0; i < 6; i++) {
      const ph = ((nowMs / 1100) + i / 6) % 1;
      const ang = (i / 6) * Math.PI * 2 + nowMs / 2600;
      const dx = Math.cos(ang) * (5 + ph * 17);
      const dy = -Math.sin(ph * Math.PI) * 11 + ph * 20;
      c.fillStyle = `rgba(214,242,252,${0.55 * (1 - ph)})`;
      c.beginPath();
      c.arc(cx + dx, colTop + dy, 1.5, 0, Math.PI * 2);
      c.fill();
    }
  }
}

/* ---------------- 动物 ---------------- */

function drawAnimal(c: Ctx, a: Animal, nowMs: number, pos?: { x: number; y: number }) {
  const px = pos ? pos.x : a.x;
  const py = pos ? pos.y : a.y;
  const bob = a.moving && !pos ? Math.sin(nowMs / 120 + px) * 1.2 : 0;
  const x = px, y = py + bob;
  const faceLeft = a.dir === 'left';
  // 幼崽整体缩小
  const scale = a.adult ? 1 : 0.62;

  softShadow(c, x, py + 2, (a.kind === 'cow' ? 15 : 9) * scale, 3.6 * scale, 0.28);

  c.save();
  c.translate(x, y);
  if (faceLeft) c.scale(-1, 1);
  if (scale !== 1) c.scale(scale, scale);

  const white = MAT.white;

  if (a.kind === 'chicken') {
    // 尾（先画，压在身体后）
    c.fillStyle = shift(white.base, -40);
    c.beginPath(); c.moveTo(-7, -11); c.lineTo(-14, -16); c.lineTo(-6, -14); c.closePath(); c.fill();
    c.fillStyle = shift(white.base, -14);
    c.beginPath(); c.moveTo(-8, -10); c.lineTo(-13, -15); c.lineTo(-7, -13); c.closePath(); c.fill();

    // 身体：描边 + 本体 + 受光
    c.fillStyle = white.line;
    c.beginPath(); c.ellipse(0, -8, 10, 8, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = white.base;
    c.beginPath(); c.ellipse(0, -8, 9, 7, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = white.hi;
    c.beginPath(); c.ellipse(-2, -11, 5.5, 4, -0.3, 0, Math.PI * 2); c.fill();

    // 头
    c.fillStyle = white.line;
    c.beginPath(); c.arc(7, -14, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = white.base;
    c.beginPath(); c.arc(7, -14, 5, 0, Math.PI * 2); c.fill();
    c.fillStyle = white.hi;
    c.beginPath(); c.arc(5.5, -16, 2.4, 0, Math.PI * 2); c.fill();

    // 冠
    c.fillStyle = '#b8352c';
    c.fillRect(4, -21, 4, 5);
    c.fillStyle = '#d94f43';
    c.fillRect(5, -20, 3, 4); c.fillRect(8, -21, 3, 5);
    c.fillStyle = '#ec7a6a';
    c.fillRect(5, -20, 3, 1); c.fillRect(8, -21, 3, 1);

    // 喙
    c.fillStyle = '#b87a24';
    c.beginPath(); c.moveTo(11, -15); c.lineTo(17, -13); c.lineTo(11, -11); c.closePath(); c.fill();
    c.fillStyle = '#e8a13c';
    c.beginPath(); c.moveTo(11, -14); c.lineTo(16, -13); c.lineTo(11, -12); c.closePath(); c.fill();

    // 眼（带高光）
    c.fillStyle = '#3d2b1f'; c.fillRect(8, -16, 3, 3);
    c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(8, -16, 1, 1);

    // 腿
    c.strokeStyle = '#b87a24'; c.lineWidth = 2.4;
    const step = a.moving ? Math.sin(nowMs / 100) * 2 : 0;
    c.beginPath(); c.moveTo(-2, -2); c.lineTo(-2 + step, 2); c.moveTo(3, -2); c.lineTo(3 - step, 2); c.stroke();
    c.strokeStyle = '#e8a13c'; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(-2, -2); c.lineTo(-2 + step, 2); c.moveTo(3, -2); c.lineTo(3 - step, 2); c.stroke();
  } else if (a.kind === 'sheep') {
    // 羊：蓬松的云朵状羊毛（毛越长越蓬）
    const fluffy = Math.min(1, (a.wool ?? 0) / 100);
    const r = 9 + fluffy * 5;
    const puffs: Array<[number, number, number]> = [
      [-8, -10, r], [2, -13, r * 1.05], [10, -9, r * 0.9], [-2, -6, r * 0.95], [6, -5, r * 0.85]
    ];
    // 描边层
    c.fillStyle = '#b8ac98';
    for (const [dx, dy, rr] of puffs) {
      c.beginPath(); c.arc(dx, dy, rr + 1.2, 0, Math.PI * 2); c.fill();
    }
    // 本体
    c.fillStyle = '#f7f4ec';
    for (const [dx, dy, rr] of puffs) {
      c.beginPath(); c.arc(dx, dy, rr, 0, Math.PI * 2); c.fill();
    }
    // 左上受光
    c.fillStyle = '#fffdf7';
    c.beginPath(); c.arc(-6, -14, r * 0.55, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(3, -16, r * 0.45, 0, Math.PI * 2); c.fill();
    // 头
    c.fillStyle = '#c4b49c';
    c.beginPath(); c.ellipse(15, -14, 7, 6, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e8ded0';
    c.beginPath(); c.ellipse(15, -14, 6, 5, 0, 0, Math.PI * 2); c.fill();
    // 耳朵
    c.fillStyle = '#d9cbb8';
    c.beginPath(); c.ellipse(11, -19, 3, 2, -0.5, 0, Math.PI * 2); c.fill();
    // 眼
    c.fillStyle = '#3d2b1f'; c.fillRect(16, -16, 2, 2);
    // 腿
    c.fillStyle = '#cfc2b0';
    const sstep = a.moving ? Math.sin(nowMs / 160) * 2 : 0;
    c.fillRect(-8, -4 + sstep * 0.3, 3, 6);
    c.fillRect(-2, -4 - sstep * 0.3, 3, 6);
    c.fillRect(5, -4 + sstep * 0.3, 3, 6);
    c.fillRect(10, -4 - sstep * 0.3, 3, 6);
  } else {
    // 牛：描边 + 本体 + 受光
    c.fillStyle = '#b0a894';
    c.beginPath(); c.ellipse(0, -12, 17, 11, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f7f2e8';
    c.beginPath(); c.ellipse(0, -12, 16, 10, 0, 0, Math.PI * 2); c.fill();
    // 背部受光
    c.fillStyle = '#fffdf7';
    c.beginPath(); c.ellipse(-3, -16, 10, 4.5, -0.15, 0, Math.PI * 2); c.fill();
    // 斑
    c.fillStyle = '#4a3a30';
    c.beginPath(); c.ellipse(-6, -14, 5, 4, 0.4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(5, -9, 4, 3, -0.3, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#65524a';
    c.beginPath(); c.ellipse(-6, -15, 2.4, 1.8, 0.4, 0, Math.PI * 2); c.fill();
    // 头
    c.fillStyle = '#b0a894';
    c.beginPath(); c.ellipse(15, -16, 8, 7, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f7f2e8';
    c.beginPath(); c.ellipse(15, -16, 7, 6, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fffdf7';
    c.beginPath(); c.ellipse(13, -19, 3.4, 2.2, -0.3, 0, Math.PI * 2); c.fill();
    // 鼻子
    c.fillStyle = '#c99880';
    c.beginPath(); c.ellipse(18, -13, 4.4, 3.4, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#a87860';
    c.fillRect(16, -14, 1, 1); c.fillRect(20, -14, 1, 1);
    // 角 / 耳
    c.fillStyle = '#a8946a';
    c.fillRect(11, -24, 4, 5); c.fillRect(17, -24, 4, 5);
    c.fillStyle = '#d0bc90';
    c.fillRect(12, -23, 2, 3); c.fillRect(18, -23, 2, 3);
    // 眼（带高光）
    c.fillStyle = '#3d2b1f'; c.fillRect(13, -19, 3, 3);
    c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(13, -19, 1, 1);
    // 腿
    c.fillStyle = '#c9bda6';
    const step = a.moving ? Math.sin(nowMs / 140) * 2 : 0;
    c.fillRect(-11, -4 + step * 0.3, 5, 7);
    c.fillRect(-3, -4 - step * 0.3, 5, 7);
    c.fillRect(4, -4 + step * 0.3, 5, 7);
    c.fillRect(10, -4 - step * 0.3, 4, 6);
    // 乳房
    c.fillStyle = '#e8b8a0';
    c.beginPath(); c.ellipse(-2, -3, 4, 3, 0, 0, Math.PI * 2); c.fill();
  }
  c.restore();

  // 状态提示
  const def = ANIMAL_DEFS[a.kind];
  const tall = a.kind === 'cow' ? 34 : a.kind === 'sheep' ? 36 : 26;
  if (a.pregnantDays > 0) {
    // 怀孕：飘一颗心
    c.fillStyle = '#e06080';
    c.font = `${13 + Math.sin(nowMs / 400) * 1.5}px serif`;
    c.fillText('♥', x - 5, y - tall + 4);
  } else if (!a.adult) {
    // 幼崽：标个小小的「幼」
    c.fillStyle = 'rgba(80,120,180,.9)';
    c.font = 'bold 10px "PingFang SC",sans-serif';
    c.fillText('幼', x - 5, y - tall * 0.6);
  } else if (isProductReady(a)) {
    c.font = '13px serif';
    c.fillText(def.productIcon, x - 6, y - tall + Math.sin(nowMs / 300) * 2);
  } else if (!a.fedToday) {
    c.fillStyle = 'rgba(200,80,60,.9)';
    c.font = 'bold 12px sans-serif';
    c.fillText('!', x - 2, y - (tall - 2));
  }
}

/* ---------------- 主绘制 ---------------- */

export function render(state: GameState, dt: number, nowMs: number) {
  if (!ctx) return;

  // 相机
  const targetCamX = state.player.x - VIEW_W / 2;
  const targetCamY = state.player.y - VIEW_H / 2;
  const maxX = MAP_W * TILE - VIEW_W;
  const maxY = MAP_H * TILE - VIEW_H;
  camX += (Math.max(0, Math.min(maxX, targetCamX)) - camX) * Math.min(1, dt * 9);
  camY += (Math.max(0, Math.min(maxY, targetCamY)) - camY) * Math.min(1, dt * 9);
  const ox = Math.round(-camX);
  const oy = Math.round(-camY);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = pal.grass;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 静态底图
  ctx.drawImage(base, Math.round(camX), Math.round(camY), VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);

  ctx.save();
  ctx.translate(ox, oy);

  const sceneId = state.scene;
  const indoor = sceneId !== 'farm';

  // 耕地与作物（只在农场；未解锁的地块不画）
  if (!indoor) {
    // 小镇里会动的东西（烟、灯笼、井水、喷泉）：必须在动态层，否则永远静止
    drawTownAnimated(ctx, nowMs);
    for (let i = 0; i < state.plots.length; i++) {
      if (!areaUnlocked(plotAreaOf(i), state.farmUnlocked)) continue;
      const { tx, ty } = plotTileOf(i);
      drawPlot(ctx, state.plots[i], tx * TILE, ty * TILE, nowMs);
    }
    drawWaterShimmer(ctx, nowMs);
  }

  // 需要按 y 排序的实体
  interface Entity { y: number; draw: () => void }
  const ents: Entity[] = [];

  if (!indoor) {
    for (const node of state.nodes) {
      if (node.hp <= 0 && node.regrowDay <= 0) continue;
      ents.push({
        y: node.ty * TILE + TILE,
        draw: () => drawNode(ctx, node, nowMs)
      });
    }

    for (const o of OBJECTS) {
      ents.push({
        y: o.ty * TILE + TILE,
        draw: () => drawObject(ctx, o.kind, o.tx * TILE, o.ty * TILE, nowMs)
      });
    }

    for (const a of state.animals) {
      ents.push({ y: a.y + 2, draw: () => drawAnimal(ctx, a, nowMs) });
    }

    for (const v of state.villagers ?? []) {
      if (v.active === false) continue;
      ents.push({ y: v.y + 2, draw: () => drawVillager(ctx, v, nowMs) });
    }
  } else {
    // 室内：只显示住在这个棚里的动物，位置按序号排布
    const dwellers = state.animals.filter((a) => sceneOfAnimal(a.kind) === sceneId);
    dwellers.forEach((a, i) => {
      const pos = indoorAnimalPos(sceneId as 'coop' | 'barn', i);
      ents.push({ y: pos.y + 2, draw: () => drawAnimal(ctx, a, nowMs, pos) });
    });
  }

  ents.push({
    y: state.player.y + 2,
    draw: () => drawFarmer(ctx, state.player.x, state.player.y, state.player.dir, state.player.walkT, state.player.moving, nowMs)
  });

  ents.sort((a, b) => a.y - b.y);
  for (const e of ents) e.draw();

  // 交互提示
  drawPrompt(ctx, state, nowMs);

  // 粒子 / 飘字
  updateAndDrawParticles(ctx, dt);
  updateAndDrawFloats(ctx, dt);

  ctx.restore();

  // 季节色罩 → 昼夜 → 降水（室内只有昼夜，没有雨雪）
  if (!indoor) drawSeasonTint(ctx);
  drawDayNight(ctx, state);
  if (!indoor) {
    if (state.weather === 'rain') drawRain(ctx, nowMs);
    else if (state.weather === 'snow') drawSnow(ctx, nowMs);
  } else {
    // 窗户的天光画在昼夜之后——夜里它就是房间里唯一的亮处
    ctx.save();
    ctx.translate(-camX, -camY);
    drawIndoorWindowLight(ctx, sceneId, state.time, state.weather);
    ctx.restore();
  }
}

/* ---------------- 耕地 ---------------- */

function drawPlot(c: Ctx, plot: Plot, x: number, y: number, nowMs: number) {
  const cx = x + TILE / 2;

  if (plot.tilled) {
    const sh = plot.watered ? MAT.soilWet : MAT.soil;
    // 外沿（略深，形成田埂）
    c.fillStyle = sh.line;
    c.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    // 土面
    c.fillStyle = sh.base;
    c.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
    // 上缘受光
    c.fillStyle = sh.hi;
    c.fillRect(x + 3, y + 3, TILE - 6, 1);
    // 垄沟：暗槽 + 上沿高光
    for (let i = 0; i < 3; i++) {
      const gy = y + 11 + i * 12;
      c.fillStyle = sh.dark;
      c.fillRect(x + 7, gy, TILE - 14, 4);
      c.fillStyle = sh.hi;
      c.fillRect(x + 7, gy - 1, TILE - 14, 1);
    }
    if (plot.watered) {
      // 湿润反光
      c.fillStyle = 'rgba(140,210,240,.16)';
      c.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
    }
  } else {
    // 未开垦：土块 + 杂草
    c.fillStyle = '#8a7550';
    c.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    c.fillStyle = '#9b855c';
    c.fillRect(x + 2, y + 2, TILE - 4, 1);
    // 土块
    for (let i = 0; i < 5; i++) {
      const r = hash(x + i * 3, y + i * 5);
      c.fillStyle = i % 2 ? '#7d6944' : '#a08a60';
      c.fillRect(Math.floor(x + 5 + r * 34), Math.floor(y + 6 + hash(y + i, x) * 32), 4, 3);
    }
    // 杂草
    for (let i = 0; i < 4; i++) {
      const r = hash(x + i, y + i * 3);
      const px = Math.floor(x + 8 + r * 28);
      const py = Math.floor(y + 12 + hash(y + i, x) * 24);
      c.fillStyle = '#5f8a44';
      c.fillRect(px, py, 2, 6);
      c.fillStyle = '#7aa85c';
      c.fillRect(px, py, 2, 2);
    }
  }

  if (plot.crop) {
    drawCrop(c, cx, y + TILE - 6, plot, plot.crop, nowMs);
  }
}

/** 圆润果实：描边 + 本体 + 左上高光，统一光照 */
function fruitBall(c: Ctx, x: number, y: number, r: number, color: string) {
  c.fillStyle = shift(color, -46);
  c.beginPath(); c.arc(x, y, r + 1, 0, Math.PI * 2); c.fill();
  c.fillStyle = color;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = shift(color, 34);
  c.beginPath();
  c.ellipse(x - r * 0.3, y - r * 0.34, r * 0.4, r * 0.3, -0.5, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,.6)';
  c.beginPath();
  c.ellipse(x - r * 0.34, y - r * 0.38, r * 0.16, r * 0.12, -0.5, 0, Math.PI * 2);
  c.fill();
}

/** 叶片：描边 + 本体 + 叶脉高光 */
function leafBlob(c: Ctx, x: number, y: number, rx: number, ry: number, rot: number, color: string) {
  c.fillStyle = shift(color, -40);
  c.beginPath(); c.ellipse(x, y, rx + 1, ry + 1, rot, 0, Math.PI * 2); c.fill();
  c.fillStyle = color;
  c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); c.fill();
  c.fillStyle = shift(color, 22);
  c.beginPath();
  c.ellipse(x - rx * 0.2, y - ry * 0.25, rx * 0.5, ry * 0.34, rot, 0, Math.PI * 2);
  c.fill();
}

function drawCrop(c: Ctx, cx: number, baseY: number, plot: Plot, cropId: CropId, nowMs: number) {
  const def = CROPS[cropId];
  const g = Math.min(1, plot.stage / def.days);
  const ready = plot.stage >= def.days;

  // 刚播下：土堆 + 小芽
  if (plot.stage === 0) {
    c.fillStyle = '#5a3f27';
    c.beginPath();
    c.ellipse(cx, baseY - 2, 9, 4, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#6e4f31';
    c.beginPath();
    c.ellipse(cx - 1, baseY - 3, 7, 3, 0, 0, Math.PI * 2);
    c.fill();
    // 小芽
    c.fillStyle = shift(def.leaf, -42);
    c.fillRect(cx - 2, baseY - 11, 4, 9);
    c.fillStyle = def.leaf;
    c.fillRect(cx - 2, baseY - 11, 3, 8);
    c.fillStyle = shift(def.leaf, 26);
    c.fillRect(cx - 2, baseY - 11, 1, 6);
    return;
  }

  const stemH = 8 + 26 * g;
  const sway = Math.sin(nowMs / 700 + cx) * (ready ? 1.2 : 0.6);

  // 茎：深色描边 + 本色 + 受光侧
  c.strokeStyle = shift(def.leaf, -44);
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(cx, baseY);
  c.quadraticCurveTo(cx + sway, baseY - stemH * 0.6, cx + sway * 1.4, baseY - stemH);
  c.stroke();
  c.strokeStyle = def.leaf;
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(cx, baseY);
  c.quadraticCurveTo(cx + sway, baseY - stemH * 0.6, cx + sway * 1.4, baseY - stemH);
  c.stroke();
  c.strokeStyle = shift(def.leaf, 30);
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(cx - 0.6, baseY);
  c.quadraticCurveTo(cx + sway - 0.6, baseY - stemH * 0.6, cx + sway * 1.4 - 0.6, baseY - stemH);
  c.stroke();

  // 叶：左右两片 + 顶叶
  const leafY = baseY - stemH * 0.75;
  for (const s of [-1, 1]) {
    leafBlob(c, cx + sway * 0.6 + s * 8 * g + s * 3, leafY - s * 3, 9 * g + 3, 5 * g + 2, s * 0.5, def.leaf);
  }
  leafBlob(c, cx + sway * 1.2, baseY - stemH - 2, 6 * g + 2, 4 * g + 2, 0, shift(def.leaf, 16));

  if (!ready) return;

  // 成熟果实
  const fy = baseY - stemH * 0.55;
  switch (def.shape) {
    case 'root': {
      c.fillStyle = shift(def.fruit, -46);
      c.beginPath(); c.ellipse(cx, baseY - 4, 11, 9, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = def.fruit;
      c.beginPath(); c.ellipse(cx, baseY - 4, 10, 8, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = shift(def.fruit, 26);
      c.beginPath(); c.ellipse(cx - 3, baseY - 7, 4.5, 3.2, -0.3, 0, Math.PI * 2); c.fill();
      break;
    }
    case 'round': {
      fruitBall(c, cx - 6, fy, 7, def.fruit);
      fruitBall(c, cx + 7, fy + 4, 6.5, shift(def.fruit, 18));
      break;
    }
    case 'long': {
      c.fillStyle = shift(def.fruit, -46);
      c.beginPath(); c.ellipse(cx + 4, fy - 2, 6, 12, 0.18, 0, Math.PI * 2); c.fill();
      c.fillStyle = def.fruit;
      c.beginPath(); c.ellipse(cx + 4, fy - 2, 5, 11, 0.18, 0, Math.PI * 2); c.fill();
      c.fillStyle = shift(def.fruit, 30);
      c.fillRect(cx + 2, fy - 10, 2, 12);
      // 玉米须
      c.fillStyle = '#c9d96a';
      c.fillRect(cx + 7, fy - 13, 1, 4);
      break;
    }
    case 'berry': {
      for (const [dx, dy] of [[-6, 0], [4, -3], [-1, 6], [8, 5]]) {
        fruitBall(c, cx + dx, fy + dy, 4.5, def.fruit);
      }
      break;
    }
    case 'gourd': {
      c.fillStyle = shift(def.fruit, -46);
      c.beginPath(); c.ellipse(cx, baseY - 8, 14, 11, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = def.fruit;
      c.beginPath(); c.ellipse(cx, baseY - 8, 13, 10, 0, 0, Math.PI * 2); c.fill();
      // 瓜棱
      c.fillStyle = shift(def.fruit, -22);
      c.fillRect(cx - 5, baseY - 16, 2, 16);
      c.fillRect(cx + 4, baseY - 16, 2, 16);
      c.fillStyle = shift(def.fruit, 30);
      c.beginPath(); c.ellipse(cx - 5, baseY - 12, 3.5, 2.6, -0.3, 0, Math.PI * 2); c.fill();
      // 瓜蒂
      c.fillStyle = '#5f8a44';
      c.fillRect(cx - 2, baseY - 20, 4, 5);
      break;
    }
    case 'leafy': {
      for (const [dx, dy, rot] of [[-7, -2, -0.5], [0, -5, 0], [7, -2, 0.5], [-3, 1, -0.2], [4, 1, 0.2]]) {
        leafBlob(c, cx + dx, baseY + dy - 4, 5, 8, rot, dy < -3 ? shift(def.fruit, 18) : def.fruit);
      }
      break;
    }
    case 'flower': {
      // 花卉：细直茎 + 两侧叶 + 顶部花瓣环绕花心
      const fy = baseY - 30;
      c.strokeStyle = shift(def.leaf, -30);
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(cx, baseY); c.lineTo(cx + sway * 0.5, fy); c.stroke();
      c.strokeStyle = def.leaf;
      c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(cx, baseY); c.lineTo(cx + sway * 0.5, fy); c.stroke();

      // 两片叶
      leafBlob(c, cx - 6, baseY - 12, 7, 3.4, -0.5, def.leaf);
      leafBlob(c, cx + 6, baseY - 19, 6, 3.0, 0.5, def.leaf);

      // 花瓣：五片围一圈
      const pr = 4.6;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2 + sway * 0.05;
        const px = cx + Math.cos(a) * pr;
        const py = fy + Math.sin(a) * pr;
        c.fillStyle = shift(def.fruit, -40);
        c.beginPath(); c.ellipse(px, py, 4.4, 4.0, a, 0, Math.PI * 2); c.fill();
        c.fillStyle = def.fruit;
        c.beginPath(); c.ellipse(px, py, 3.6, 3.2, a, 0, Math.PI * 2); c.fill();
        c.fillStyle = shift(def.fruit, 26);
        c.beginPath(); c.ellipse(px, py - 0.8, 1.8, 1.5, a, 0, Math.PI * 2); c.fill();
      }
      // 花心
      c.fillStyle = '#e8b23a';
      c.beginPath(); c.arc(cx, fy, 3.2, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f5d06a';
      c.beginPath(); c.arc(cx - 0.8, fy - 0.8, 1.6, 0, Math.PI * 2); c.fill();
      break;
    }
  }

  // 成熟微光
  const tw = (Math.sin(nowMs / 300 + cx) + 1) / 2;
  c.fillStyle = `rgba(255,246,190,${0.2 + tw * 0.28})`;
  c.beginPath();
  c.arc(cx + 9, fy - 10, 2.6, 0, Math.PI * 2);
  c.fill();
}

/* ---------------- 水波 ---------------- */

function drawWaterShimmer(c: Ctx, nowMs: number) {
  const t = nowMs / 1000;
  c.fillStyle = 'rgba(255,255,255,.22)';
  for (let i = 0; i < 14; i++) {
    const px = 19 * TILE + ((i * 97) % (7 * TILE));
    const py = 13 * TILE + ((i * 61) % (7 * TILE));
    const off = Math.sin(t * 1.6 + i) * 8;
    c.fillRect(px + off, py, 12, 2);
  }
}

/* ---------------- 物体 ---------------- */

function drawObject(c: Ctx, kind: 'bin' | 'order' | 'store' | 'board', x: number, y: number, nowMs: number) {
  c.fillStyle = 'rgba(60,40,20,.22)';
  c.beginPath();
  c.ellipse(x + TILE / 2, y + TILE - 6, 20, 6, 0, 0, Math.PI * 2);
  c.fill();

  if (kind === 'bin') {
    // 出货箱
    c.fillStyle = '#a9743f';
    c.fillRect(x + 5, y + 16, TILE - 10, 26);
    c.fillStyle = '#8b5c30';
    c.fillRect(x + 5, y + 16, TILE - 10, 5);
    c.fillStyle = '#c08a4e';
    c.fillRect(x + 8, y + 24, TILE - 16, 3);
    c.fillRect(x + 8, y + 32, TILE - 16, 3);
    c.fillStyle = '#6b4a2b';
    c.fillRect(x + 5, y + 16, 3, 26);
    c.fillRect(x + TILE - 8, y + 16, 3, 26);
    // 箱盖
    c.fillStyle = '#b9803f';
    c.fillRect(x + 2, y + 9, TILE - 4, 8);
    c.fillStyle = '#d9a55e';
    c.fillRect(x + 2, y + 9, TILE - 4, 3);
    // 标识
    c.fillStyle = '#f7e9c4';
    c.fillRect(x + 18, y + 25, 12, 9);
    c.fillStyle = '#8b5c30';
    c.fillRect(x + 21, y + 28, 6, 3);
    // 闪烁
    const tw = (Math.sin(nowMs / 500) + 1) / 2;
    c.fillStyle = `rgba(255,240,180,${tw * 0.5})`;
    c.fillRect(x + 32, y + 12, 3, 3);
  } else if (kind === 'order') {
    // 订购箱（信箱）
    c.fillStyle = '#6b4a2b';
    c.fillRect(x + 21, y + 26, 6, 18);
    c.fillStyle = '#4a8fbe';
    c.fillRect(x + 8, y + 10, TILE - 16, 18);
    c.fillStyle = '#3a749c';
    c.fillRect(x + 8, y + 10, TILE - 16, 4);
    c.fillStyle = '#f7e9c4';
    c.fillRect(x + 14, y + 17, 18, 3);
    // 小旗
    const wave = Math.sin(nowMs / 400) * 2;
    c.fillStyle = '#d9534f';
    c.fillRect(x + TILE - 12, y + 2, 3, 14);
    c.fillRect(x + TILE - 9 + wave, y + 3, 9, 6);
  } else if (kind === 'board') {
    // 委托板：木牌 + 贴着的几张小纸条
    // 两根立柱
    c.fillStyle = '#5a3c22';
    c.fillRect(x + 10, y + 16, 5, TILE - 20);
    c.fillRect(x + TILE - 15, y + 16, 5, TILE - 20);
    // 板面
    c.fillStyle = '#6b4a2e';
    c.fillRect(x + 5, y + 8, TILE - 10, 26);
    c.fillStyle = '#a97c4f';
    c.fillRect(x + 7, y + 10, TILE - 14, 22);
    c.fillStyle = '#c1966a';
    c.fillRect(x + 7, y + 10, TILE - 14, 2);
    // 纸条
    c.fillStyle = '#f7f0dc';
    c.fillRect(x + 11, y + 13, 10, 7);
    c.fillRect(x + 24, y + 13, 9, 7);
    c.fillRect(x + 11, y + 22, 13, 6);
    c.fillStyle = '#c9bda0';
    c.fillRect(x + 12, y + 15, 8, 1);
    c.fillRect(x + 12, y + 17, 6, 1);
    c.fillRect(x + 25, y + 15, 7, 1);
    c.fillRect(x + 12, y + 24, 11, 1);
    // 顶部小钉
    c.fillStyle = '#8a8a8a';
    c.fillRect(x + 11, y + 11, 2, 2);
    c.fillRect(x + 24, y + 11, 2, 2);
  } else {
    // 杂货店门口：货摊 + 遮阳棚
    c.fillStyle = '#a9743f';
    c.fillRect(x + 6, y + 26, TILE - 12, 16);
    c.fillStyle = '#8b5c30';
    c.fillRect(x + 6, y + 26, TILE - 12, 4);
    c.fillStyle = '#f2d45c'; c.fillRect(x + 10, y + 20, 7, 7);
    c.fillStyle = '#e34b3d'; c.fillRect(x + 20, y + 20, 7, 7);
    c.fillStyle = '#6fae4e'; c.fillRect(x + 30, y + 20, 7, 7);
    const wave = Math.sin(nowMs / 400) * 1.5;
    c.fillStyle = '#4a8fbe';
    c.fillRect(x + 2, y + 4 + wave * 0.3, TILE - 4, 7);
    c.fillStyle = '#3a749c';
    c.fillRect(x + 2, y + 9 + wave * 0.3, TILE - 4, 3);
  }
}

/* ---------------- 角色 ---------------- */

/**
 * 带描边 + 顶部高光的矩形部件。
 * 像素风角色的轮廓靠这个统一出来，不用逐部件算轮廓。
 */
function part(
  c: Ctx, x: number, y: number, w: number, h: number,
  fill: string, line: string, hi?: string
): void {
  c.fillStyle = line;
  c.fillRect(x - 1, y - 1, w + 2, h + 2);
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
  if (hi) {
    c.fillStyle = hi;
    c.fillRect(x, y, w, 2);
  }
}

function drawFarmer(c: Ctx, px: number, py: number, dir: Dir, walkT: number, moving: boolean, nowMs: number) {
  const bob = moving ? Math.sin(walkT * 12) * 1.2 : 0;
  const swing = moving ? Math.sin(walkT * 12) : 0;
  // 站立时轻微呼吸：身体上下浮 0.5px
  const breath = moving ? 0 : Math.sin(nowMs / 900) * 0.5;
  // 每隔约 3.6 秒眨一次眼
  const blink = (nowMs % 3600) < 130;

  softShadow(c, px, py + 1, 9, 3.4, 0.3);

  c.save();
  c.translate(Math.round(px), Math.round(py + bob + breath));

  const skin = MAT.skin.base;
  const skinHi = MAT.skin.hi;
  const skinLine = MAT.skin.line;
  const shirt = CHAR.farmerShirt.base;
  const shirtHi = CHAR.farmerShirt.hi;
  const shirtLine = CHAR.farmerShirt.line;
  const overall = CHAR.farmerOverall.base;
  const overallHi = CHAR.farmerOverall.hi;
  const hat = CHAR.hat.base;
  const hatHi = CHAR.hat.hi;
  const hatLine = CHAR.hat.line;
  const boot = MAT.ink.base;

  // 腿（不描边，避免小尺寸糊成一团）
  c.fillStyle = overall;
  c.fillRect(-7, -12 + swing * 1.5, 6, 12);
  c.fillRect(1, -12 - swing * 1.5, 6, 12);
  c.fillStyle = overallHi;
  c.fillRect(-7, -12 + swing * 1.5, 2, 10);
  c.fillStyle = boot;
  c.fillRect(-8, -4 + swing * 1.5, 7, 4);
  c.fillRect(0, -4 - swing * 1.5, 7, 4);

  // 身体（白衬衫 + 蓝背带裤）
  part(c, -9, -26, 18, 15, shirt, shirtLine, shirtHi);
  c.fillStyle = overall;
  c.fillRect(-8, -20, 16, 9);
  c.fillStyle = overallHi;
  c.fillRect(-8, -20, 16, 2);
  // 背带
  c.fillStyle = overall;
  c.fillRect(-8, -26, 4, 8);
  c.fillRect(4, -26, 4, 8);

  // 手臂
  const armY1 = -24 + swing * 2;
  const armY2 = -24 - swing * 2;
  if (dir === 'left') {
    part(c, -13, armY1, 5, 11, shirt, shirtLine);
    c.fillStyle = skin;
    c.fillRect(-13, armY1 + 10, 5, 4);
  } else if (dir === 'right') {
    part(c, 8, armY2, 5, 11, shirt, shirtLine);
    c.fillStyle = skin;
    c.fillRect(8, armY2 + 10, 5, 4);
  } else {
    part(c, -13, armY1, 5, 11, shirt, shirtLine);
    part(c, 8, armY2, 5, 11, shirt, shirtLine);
    c.fillStyle = skin;
    c.fillRect(-13, armY1 + 10, 5, 4);
    c.fillRect(8, armY2 + 10, 5, 4);
  }

  // 头
  part(c, -8, -40, 16, 15, skin, skinLine, skinHi);
  if (dir !== 'up') {
    // 头发（刘海）
    c.fillStyle = '#7a5230';
    c.fillRect(-8, -40, 16, 4);
    c.fillStyle = '#8f6438';
    c.fillRect(-8, -40, 16, 1);
    // 眼睛（眨眼时压成一条线）
    c.fillStyle = '#3d2b1f';
    if (dir === 'down') {
      if (blink) {
        c.fillRect(-5, -32, 3, 1);
        c.fillRect(3, -32, 3, 1);
      } else {
        c.fillRect(-5, -33, 3, 3);
        c.fillRect(3, -33, 3, 3);
        // 眼里高光
        c.fillStyle = 'rgba(255,255,255,.75)';
        c.fillRect(-5, -33, 1, 1);
        c.fillRect(3, -33, 1, 1);
        c.fillStyle = '#e8a48a';
        c.fillRect(-1, -30, 3, 2);
      }
    } else if (dir === 'left') {
      c.fillRect(-6, blink ? -32 : -33, 3, blink ? 1 : 3);
    } else {
      c.fillRect(3, blink ? -32 : -33, 3, blink ? 1 : 3);
    }
  } else {
    // 背面：整片头发
    c.fillStyle = '#7a5230';
    c.fillRect(-8, -40, 16, 15);
    c.fillStyle = '#8f6438';
    c.fillRect(-8, -40, 16, 1);
  }

  // 草帽（帽檐 + 帽冠 + 缎带）
  c.fillStyle = hatLine;
  c.fillRect(-13, -43, 26, 6);
  c.fillStyle = hat;
  c.fillRect(-12, -42, 24, 4);
  c.fillStyle = hatHi;
  c.fillRect(-12, -42, 24, 1);

  c.fillStyle = hatLine;
  c.fillRect(-9, -49, 18, 8);
  c.fillStyle = hat;
  c.fillRect(-8, -48, 16, 7);
  c.fillStyle = hatHi;
  c.fillRect(-8, -48, 6, 2);

  // 缎带
  c.fillStyle = '#c4553f';
  c.fillRect(-8, -45, 16, 2);
  c.fillStyle = '#d9755c';
  c.fillRect(-8, -45, 16, 1);

  c.restore();
}

/* ---------------- 村民 ---------------- */

function drawVillager(c: Ctx, v: Villager, nowMs: number) {
  const def = VILLAGER_DEFS[v.id];
  const shirt = def?.shirt ?? '#8a8a8a';
  const bob = v.moving ? Math.sin(nowMs / 120 + v.x) * 1.2 : 0;
  const swing = v.moving ? Math.sin(nowMs / 120 + v.x) : 0;

  softShadow(c, v.x, v.y + 1, 9, 3.4, 0.3);

  c.save();
  c.translate(Math.round(v.x), Math.round(v.y + bob));

  const skin = MAT.skin.base;
  const skinHi = MAT.skin.hi;
  const skinLine = MAT.skin.line;
  const pants = '#6b5a4c';
  const hair = '#4a3a2e';
  const hairHi = '#6b5544';
  const boot = MAT.ink.base;
  const shirtHi = shift(shirt, 26);
  const shirtLine = shift(shirt, -52);

  // 腿（不描边）
  c.fillStyle = pants;
  c.fillRect(-7, -12 + swing * 1.5, 6, 12);
  c.fillRect(1, -12 - swing * 1.5, 6, 12);
  c.fillStyle = shift(pants, 18);
  c.fillRect(-7, -12 + swing * 1.5, 2, 10);
  c.fillStyle = boot;
  c.fillRect(-8, -4 + swing * 1.5, 7, 4);
  c.fillRect(0, -4 - swing * 1.5, 7, 4);

  // 身体（描边 + 本色 + 受光）
  part(c, -9, -26, 18, 15, shirt, shirtLine, shirtHi);
  // 衣摆暗部
  c.fillStyle = shift(shirt, -22);
  c.fillRect(-8, -13, 16, 2);

  // 手臂
  const ay1 = -24 + swing * 2;
  const ay2 = -24 - swing * 2;
  if (v.dir === 'left') {
    part(c, -13, ay1, 5, 11, shirt, shirtLine);
    c.fillStyle = skin; c.fillRect(-13, ay1 + 10, 5, 4);
  } else if (v.dir === 'right') {
    part(c, 8, ay2, 5, 11, shirt, shirtLine);
    c.fillStyle = skin; c.fillRect(8, ay2 + 10, 5, 4);
  } else {
    part(c, -13, ay1, 5, 11, shirt, shirtLine);
    part(c, 8, ay2, 5, 11, shirt, shirtLine);
    c.fillStyle = skin;
    c.fillRect(-13, ay1 + 10, 5, 4);
    c.fillRect(8, ay2 + 10, 5, 4);
  }

  // 头（描边 + 受光）
  part(c, -8, -40, 16, 15, skin, skinLine, skinHi);

  // 头发
  if (v.dir !== 'up') {
    c.fillStyle = hair;
    c.fillRect(-9, -43, 18, 6);
    c.fillRect(-9, -40, 3, 8);
    c.fillRect(6, -40, 3, 8);
    c.fillStyle = hairHi;
    c.fillRect(-9, -43, 18, 2);
  } else {
    c.fillStyle = hair;
    c.fillRect(-9, -43, 18, 18);
    c.fillStyle = hairHi;
    c.fillRect(-9, -43, 18, 2);
  }

  // 眼睛（带高光）
  if (v.dir !== 'up') {
    c.fillStyle = '#3d2b1f';
    if (v.dir === 'down') {
      c.fillRect(-5, -33, 3, 3); c.fillRect(3, -33, 3, 3);
      c.fillStyle = 'rgba(255,255,255,.8)';
      c.fillRect(-5, -33, 1, 1); c.fillRect(3, -33, 1, 1);
    } else if (v.dir === 'left') {
      c.fillRect(-6, -33, 3, 3);
    } else {
      c.fillRect(3, -33, 3, 3);
    }
  }

  c.restore();

  // 头顶名牌（靠近时才显示，避免杂乱）
  if (def) {
    c.font = 'bold 11px "PingFang SC",sans-serif';
    c.textAlign = 'center';
    const w = c.measureText(def.name).width + 12;
    // 描边底 + 填充
    c.fillStyle = 'rgba(45,32,22,.55)';
    c.fillRect(v.x - w / 2 - 1, v.y - 59, w + 2, 16);
    c.fillStyle = 'rgba(245,235,215,.94)';
    c.fillRect(v.x - w / 2, v.y - 58, w, 14);
    c.fillStyle = '#4a3320';
    c.fillText(def.name, v.x, v.y - 48);

    // 正在做的事：让「他有自己的生活」看得见
    if (v.doing) {
      c.font = '10px "PingFang SC",sans-serif';
      const dw = c.measureText(v.doing).width + 10;
      c.fillStyle = 'rgba(45,32,22,.42)';
      c.fillRect(v.x - dw / 2 - 1, v.y - 73, dw + 2, 13);
      c.fillStyle = 'rgba(230,220,200,.9)';
      c.fillRect(v.x - dw / 2, v.y - 72, dw, 11);
      c.fillStyle = '#5a4530';
      c.fillText(v.doing, v.x, v.y - 63.5);
    }
    c.textAlign = 'left';
  }
}

/* ---------------- 资源节点 ---------------- */

/* ============================================================
   四种木材节点的绘制：灌木 / 小树 / 大树 / 老树桩
   ------------------------------------------------------------
   写实一点的做法，关键是两条：

   1. 叶子不用椭圆。用 9 边多边形 + 半径抖动，边缘是碎的；
      再叠十几团并集，轮廓就不会是"一个球"。
   2. 明暗靠**整团掩膜上移**：先用最深色画一遍，再上移 2px 用中间色画，
      再上移 4px 缩小用亮色画。这样受光面自然落在左上方，
      比逐团加高光干净得多。
   ============================================================ */

/** 多边形填充 */
function poly(c: Ctx, pts: Array<[number, number]>) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
  c.fill();
}

/** 一片碎边叶团：9 个顶点的多边形，半径带抖动 */
function woodBlob(c: Ctx, x: number, y: number, r: number, seed: number, squash = 0.84) {
  const N = 9;
  c.beginPath();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const j = 0.74 + hash(seed + i * 7, i * 13) * 0.52;   // 0.74 ~ 1.26
    const px = x + Math.cos(a) * r * j;
    const py = y + Math.sin(a) * r * j * squash;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
  c.fill();
}

/**
 * 树冠：十几团叶的并集，分三遍推移明暗。
 * R 是树冠半径，seed 用格子坐标保证每棵树形态稳定。
 */
function canopy(
  c: Ctx, cx: number, cy: number, R: number, seed: number,
  outline: string, dark: string, mid: string, light: string
) {
  const N = 12;
  const pass = (dx: number, dy: number, scale: number, color: string) => {
    c.fillStyle = color;
    // 中间一大团打底
    woodBlob(c, cx + dx, cy + dy, R * 0.6 * scale, seed + 911);
    // 外圈小团，位置抖开，形成碎边
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + hash(seed, i) * 0.6;
      const dist = R * 0.5 * (0.62 + hash(seed + i * 3, i * 5) * 0.62);
      const px = cx + Math.cos(a) * dist * scale + dx;
      const py = cy + Math.sin(a) * dist * 0.72 * scale + dy;
      const rr = R * (0.34 + hash(seed + i * 11, i * 7) * 0.3) * scale;
      woodBlob(c, px, py, rr, seed + i * 17);
    }
  };

  pass(0, 0, 1.02, outline);   // 轮廓（最深）
  pass(0, -1, 0.98, dark);     // 暗部
  pass(-1, -3, 0.86, mid);     // 中调，整体上移
  pass(-2, -6, 0.58, light);   // 顶部受光

  // 树冠底部压一道暗边，让"伞盖"有厚度
  c.fillStyle = outline;
  woodBlob(c, cx, cy + R * 0.52, R * 0.5, seed + 33, 0.34);
}

/** 树干：梯形（上窄下宽）+ 左右明暗 + 树皮纹 + 根部外扩 */
function trunk(
  c: Ctx, cx: number, top: number, base: number,
  wTop: number, wBase: number, flare = true
) {
  // 描边
  c.fillStyle = pal.trunkLine;
  poly(c, [
    [cx - wTop - 1, top], [cx + wTop + 1, top],
    [cx + wBase + 1, base], [cx - wBase - 1, base]
  ]);
  // 本体
  c.fillStyle = pal.trunk;
  poly(c, [
    [cx - wTop, top], [cx + wTop, top],
    [cx + wBase, base], [cx - wBase, base]
  ]);
  // 左侧受光
  c.fillStyle = shift(pal.trunk, 26);
  poly(c, [
    [cx - wTop, top], [cx - wTop * 0.1, top],
    [cx - wBase * 0.3, base], [cx - wBase, base]
  ]);
  // 右侧背光
  c.fillStyle = shift(pal.trunk, -28);
  poly(c, [
    [cx + wTop * 0.5, top], [cx + wTop, top],
    [cx + wBase, base], [cx + wBase * 0.55, base]
  ]);
  // 树皮横纹
  c.fillStyle = 'rgba(52,34,18,.28)';
  const rows = Math.max(2, Math.floor((base - top) / 8));
  for (let i = 1; i <= rows; i++) {
    const y = top + ((base - top) * i) / (rows + 1);
    const wy = wTop + ((wBase - wTop) * (y - top)) / Math.max(1, base - top);
    c.fillRect(cx - wy * 0.7, Math.round(y), Math.max(2, wy * 1.1), 1);
  }
  // 根部外扩
  if (flare) {
    c.fillStyle = pal.trunk;
    poly(c, [
      [cx - wBase + 1, base - 7], [cx - wBase - 5, base],
      [cx - wBase - 1, base], [cx - wBase + 3, base - 6]
    ]);
    poly(c, [
      [cx + wBase - 1, base - 7], [cx + wBase + 5, base],
      [cx + wBase + 1, base], [cx + wBase - 3, base - 6]
    ]);
    c.fillStyle = 'rgba(40,26,14,.22)';
    c.fillRect(cx - wBase - 4, base - 1, wBase * 2 + 8, 2);
  }
}

/** 砍痕 */
function chopMarks(c: Ctx, cx: number, top: number, base: number, halfW: number, dmg: number) {
  if (dmg <= 0.02) return;
  const n = dmg > 0.66 ? 3 : dmg > 0.33 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const y = base - 7 - i * 8;
    if (y < top + 2) break;
    const w = halfW * 1.6;
    c.fillStyle = '#c8a274';
    poly(c, [
      [cx - w, y], [cx + w, y + 1], [cx + w * 0.7, y + 4], [cx - w * 0.8, y + 3]
    ]);
    c.fillStyle = 'rgba(52,34,18,.4)';
    c.fillRect(cx - w * 0.8, y + 3, w * 1.5, 1);
  }
}

/* ---------------- 灌木 ---------------- */

function drawShrub(c: Ctx, cx: number, baseY: number, dmg: number, nowMs: number, tx: number, ty: number) {
  const sway = Math.sin(nowMs / 1200 + tx) * 0.7;
  const s = 1 - dmg * 0.3;
  const seed = tx * 31 + ty * 7;

  c.fillStyle = 'rgba(56,38,20,.18)';
  c.beginPath(); c.ellipse(cx, baseY + 2, 15 * s, 4, 0, 0, Math.PI * 2); c.fill();

  // 贴地的一丛：没有树干，冠底压得更低
  canopy(
    c, cx + sway, baseY - 9 * s, 12 * s, seed,
    pal.foliageLine, pal.foliage[0], pal.foliage[1], pal.foliage[2]
  );

  // 两根探出来的细枝，避免看起来像一堆草
  c.strokeStyle = shift(pal.trunk, -6);
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(cx - 4 + sway, baseY - 2);
  c.lineTo(cx - 9 + sway, baseY - 12 * s);
  c.moveTo(cx + 5 + sway, baseY - 2);
  c.lineTo(cx + 10 + sway, baseY - 10 * s);
  c.stroke();

  // 浆果
  if (dmg < 0.5) {
    c.fillStyle = '#b8495f';
    c.beginPath(); c.arc(cx - 5 + sway, baseY - 8 * s, 1.6, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(cx + 6 + sway, baseY - 6 * s, 1.4, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,220,220,.55)';
    c.fillRect(cx - 6 + sway, baseY - 9 * s, 1, 1);
  }
}

/* ---------------- 小树 ---------------- */

function drawSapling(c: Ctx, cx: number, baseY: number, dmg: number, nowMs: number, tx: number, ty: number) {
  const sway = Math.sin(nowMs / 1000 + tx) * (0.8 + dmg * 2);
  const top = baseY - 19;
  const seed = tx * 17 + ty * 13;

  c.fillStyle = 'rgba(56,38,20,.18)';
  c.beginPath(); c.ellipse(cx, baseY + 2, 12, 4, 0, 0, Math.PI * 2); c.fill();

  trunk(c, cx + sway * 0.25, top, baseY, 1.8, 3.2);

  const R = 10.5 * (1 - dmg * 0.22);
  canopy(
    c, cx + sway, baseY - 26, R, seed,
    pal.foliageLine, pal.foliage[0], pal.foliage[1], pal.foliage[2]
  );

  chopMarks(c, cx, top, baseY, 3.2, dmg);
}

/* ---------------- 大树 ---------------- */

function drawBigTree(c: Ctx, cx: number, baseY: number, dmg: number, nowMs: number, tx: number, ty: number) {
  const sway = Math.sin(nowMs / 1200 + tx) * (1 + dmg * 3.5);
  const top = baseY - 32;
  const seed = tx * 23 + ty * 11;

  c.fillStyle = 'rgba(56,38,20,.22)';
  c.beginPath(); c.ellipse(cx, baseY + 3, 23, 6, 0, 0, Math.PI * 2); c.fill();

  trunk(c, cx + sway * 0.2, top, baseY, 4.5, 7.5);

  // 两根斜出的枝条，破掉"棒棒糖"的轮廓
  c.strokeStyle = pal.trunk;
  c.lineWidth = 2.6;
  c.beginPath();
  c.moveTo(cx + sway * 0.2, top + 6);
  c.lineTo(cx - 14 + sway * 0.6, top - 6);
  c.moveTo(cx + sway * 0.2, top + 2);
  c.lineTo(cx + 15 + sway * 0.6, top - 10);
  c.stroke();

  // 主冠（大）+ 侧冠（小、偏下），形成不对称
  const R = 17 * (1 - dmg * 0.26);
  canopy(
    c, cx - 11 + sway * 0.7, baseY - 44, R * 0.78, seed + 5,
    pal.foliageLine, pal.foliage[0], pal.foliage[1], pal.foliage[2]
  );
  canopy(
    c, cx + 12 + sway * 0.7, baseY - 47, R * 0.7, seed + 9,
    pal.foliageLine, pal.foliage[0], pal.foliage[1], pal.foliage[2]
  );
  canopy(
    c, cx + sway * 0.8, baseY - 54, R, seed,
    pal.foliageLine, pal.foliage[0], pal.foliage[1], pal.foliage[2]
  );

  chopMarks(c, cx, top, baseY, 7.5, dmg);
}

/* ---------------- 老树桩 ---------------- */

function drawStump(c: Ctx, cx: number, baseY: number, dmg: number, tx: number, ty: number) {
  const w = 10.5;
  const R = 6.5;
  const top = baseY - 14;
  const seed = tx * 29 + ty * 5;

  c.fillStyle = 'rgba(56,38,20,.2)';
  c.beginPath(); c.ellipse(cx, baseY + 2, 15, 4, 0, 0, Math.PI * 2); c.fill();

  // 桩身：略呈梯形，底部外扩
  c.fillStyle = pal.trunkLine;
  poly(c, [
    [cx - w, top], [cx + w, top],
    [cx + w + 3, baseY], [cx - w - 3, baseY]
  ]);
  c.fillStyle = pal.trunk;
  poly(c, [
    [cx - w + 1, top + 1], [cx + w - 1, top + 1],
    [cx + w + 2, baseY - 1], [cx - w - 2, baseY - 1]
  ]);
  c.fillStyle = shift(pal.trunk, 26);
  poly(c, [
    [cx - w + 1, top + 1], [cx - w * 0.35, top + 1],
    [cx - w * 0.45, baseY - 1], [cx - w - 2, baseY - 1]
  ]);
  c.fillStyle = shift(pal.trunk, -30);
  poly(c, [
    [cx + w * 0.45, top + 1], [cx + w - 1, top + 1],
    [cx + w + 2, baseY - 1], [cx + w * 0.55, baseY - 1]
  ]);

  // 树皮纵纹（不规则断口）
  c.fillStyle = 'rgba(48,30,16,.3)';
  for (let i = 0; i < 5; i++) {
    const px = cx - w + 2 + hash(seed + i, i * 3) * (w * 2 - 4);
    const h = 4 + hash(seed + i * 5, i) * 8;
    c.fillRect(Math.round(px), Math.round(top + 3 + hash(seed, i) * 4), 1, Math.round(h));
  }

  // 根部
  c.fillStyle = pal.trunk;
  poly(c, [
    [cx - w - 2, baseY - 5], [cx - w - 7, baseY],
    [cx - w - 1, baseY], [cx - w + 2, baseY - 4]
  ]);
  poly(c, [
    [cx + w + 2, baseY - 5], [cx + w + 7, baseY],
    [cx + w + 1, baseY], [cx + w - 2, baseY - 4]
  ]);

  // 断面：年轮 + 朽洞
  c.fillStyle = '#b08256';
  c.beginPath(); c.ellipse(cx, top + 1, w - 0.5, R * 0.62, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#8a6038';
  c.lineWidth = 1;
  for (const k of [0.72, 0.46, 0.24]) {
    c.beginPath();
    c.ellipse(cx, top + 1, (w - 1) * k, (R * 0.62 - 0.4) * k, 0, 0, Math.PI * 2);
    c.stroke();
  }
  c.fillStyle = '#3e2c18';
  c.beginPath(); c.ellipse(cx + 2.5, top + 1.4, 2.6, 1.5, 0, 0, Math.PI * 2); c.fill();

  // 青苔
  c.fillStyle = 'rgba(92,136,68,.8)';
  poly(c, [
    [cx - w - 1, baseY - 6], [cx - w + 5, baseY - 7],
    [cx - w + 6, baseY - 1], [cx - w - 2, baseY - 1]
  ]);
  c.fillStyle = 'rgba(118,164,86,.75)';
  c.fillRect(cx - w + 1, baseY - 6, 3, 2);

  // 被挖开的裂痕
  if (dmg > 0.3) {
    c.strokeStyle = 'rgba(62,44,24,.65)';
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(cx - 5, top + 2); c.lineTo(cx - 2, baseY - 6);
    c.stroke();
  }
  if (dmg > 0.66) {
    c.beginPath();
    c.moveTo(cx + 6, top + 2); c.lineTo(cx + 3, baseY - 7);
    c.stroke();
  }
}

/** 四类木材节点的统一入口 */
function drawWoodNode(c: Ctx, node: ResNode, cx: number, baseY: number, nowMs: number) {
  const dmg = node.maxHp > 0 ? 1 - node.hp / node.maxHp : 1;

  // 砍倒后：灌木消失、树桩消失，小树/大树留茬
  if (node.hp <= 0) {
    if (node.kind === 'shrub' || node.kind === 'stump') return;
    const big = node.kind === 'tree';
    const w = big ? 8.5 : 5;
    c.fillStyle = 'rgba(56,38,20,.16)';
    c.beginPath(); c.ellipse(cx, baseY + 2, w + 5, 3.6, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = pal.trunkLine;
    poly(c, [
      [cx - w, baseY - (big ? 11 : 7)], [cx + w, baseY - (big ? 11 : 7)],
      [cx + w + 2, baseY], [cx - w - 2, baseY]
    ]);
    c.fillStyle = pal.trunk;
    poly(c, [
      [cx - w + 1, baseY - (big ? 10 : 6)], [cx + w - 1, baseY - (big ? 10 : 6)],
      [cx + w + 1, baseY - 1], [cx - w - 1, baseY - 1]
    ]);
    c.fillStyle = '#b08256';
    c.beginPath();
    c.ellipse(cx, baseY - (big ? 10 : 6), w - 0.5, (big ? 4 : 3), 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#8a6038'; c.lineWidth = 1;
    c.beginPath();
    c.ellipse(cx, baseY - (big ? 10 : 6), (w - 1) * 0.55, (big ? 2.2 : 1.6), 0, 0, Math.PI * 2);
    c.stroke();
    return;
  }

  if (node.kind === 'shrub') drawShrub(c, cx, baseY, dmg, nowMs, node.tx, node.ty);
  else if (node.kind === 'sapling') drawSapling(c, cx, baseY, dmg, nowMs, node.tx, node.ty);
  else if (node.kind === 'stump') drawStump(c, cx, baseY, dmg, node.tx, node.ty);
  else drawBigTree(c, cx, baseY, dmg, nowMs, node.tx, node.ty);
}

function drawNode(c: Ctx, node: ResNode, nowMs: number) {
  const x = node.tx * TILE;
  const y = node.ty * TILE;
  const cx = x + TILE / 2;
  const baseY = y + TILE - 6;

  c.fillStyle = 'rgba(60,40,20,.2)';
  c.beginPath();
  c.ellipse(cx, baseY + 4, 20, 6, 0, 0, Math.PI * 2);
  c.fill();

  if (isWoodKind(node.kind)) {
    drawWoodNode(c, node, cx, baseY, nowMs);
  } else if (node.kind === 'rock') {
    const dmg = node.hp <= 0 ? 1 : 1 - node.hp / node.maxHp;
    if (node.hp <= 0) {
      c.fillStyle = '#a9a29a';
      c.fillRect(cx - 10, baseY - 6, 8, 6);
      c.fillRect(cx + 2, baseY - 4, 7, 4);
      return;
    }
    c.fillStyle = '#b3aca4';
    c.beginPath();
    c.moveTo(cx - 15, baseY);
    c.lineTo(cx - 12, baseY - 16);
    c.lineTo(cx - 3, baseY - 22);
    c.lineTo(cx + 9, baseY - 18);
    c.lineTo(cx + 15, baseY - 4);
    c.lineTo(cx + 11, baseY);
    c.closePath();
    c.fill();
    c.fillStyle = '#cdc7c0';
    c.beginPath();
    c.moveTo(cx - 12, baseY - 16);
    c.lineTo(cx - 3, baseY - 22);
    c.lineTo(cx + 2, baseY - 14);
    c.lineTo(cx - 7, baseY - 10);
    c.closePath();
    c.fill();
    c.strokeStyle = '#8d8680';
    c.lineWidth = 2;
    if (dmg > 0.3) {
      c.beginPath();
      c.moveTo(cx - 4, baseY - 18);
      c.lineTo(cx + 1, baseY - 9);
      c.stroke();
    }
    if (dmg > 0.6) {
      c.beginPath();
      c.moveTo(cx + 6, baseY - 14);
      c.lineTo(cx - 1, baseY - 3);
      c.stroke();
    }
  } else if (node.kind === 'oreCopper' || node.kind === 'oreIron' || node.kind === 'oreGem') {
    const oreStyle = {
      oreCopper: { rock: '#6b5a48', vein: '#c07a3e', glow: '#e8a05c' },
      oreIron: { rock: '#4f4a46', vein: '#8a9aa8', glow: '#b8c8d8' },
      oreGem: { rock: '#463f52', vein: '#9a6ad0', glow: '#d0a0ff' }
    }[node.kind];
    const dmg = node.hp <= 0 ? 1 : 1 - node.hp / node.maxHp;

    if (node.hp <= 0) {
      c.fillStyle = oreStyle.rock;
      c.fillRect(cx - 9, baseY - 5, 7, 5);
      c.fillRect(cx + 3, baseY - 3, 6, 3);
      return;
    }

    // 岩体
    c.fillStyle = oreStyle.rock;
    c.beginPath();
    c.moveTo(cx - 16, baseY);
    c.lineTo(cx - 13, baseY - 18);
    c.lineTo(cx - 4, baseY - 24);
    c.lineTo(cx + 8, baseY - 20);
    c.lineTo(cx + 16, baseY - 5);
    c.lineTo(cx + 12, baseY);
    c.closePath();
    c.fill();
    // 顶部受光
    c.fillStyle = shift(oreStyle.rock, 24);
    c.beginPath();
    c.moveTo(cx - 13, baseY - 18);
    c.lineTo(cx - 4, baseY - 24);
    c.lineTo(cx + 3, baseY - 16);
    c.lineTo(cx - 6, baseY - 11);
    c.closePath();
    c.fill();

    // 矿脉：发光的结晶
    const pulse = 0.7 + Math.sin(nowMs / 420 + node.tx) * 0.3;
    c.fillStyle = oreStyle.vein;
    for (const [dx, dy, r] of [[-6, -14, 3.4], [3, -9, 2.8], [-1, -17, 2.2], [7, -16, 2.4]]) {
      c.beginPath();
      c.arc(cx + dx, baseY + dy, r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 0.5 * pulse;
    c.fillStyle = oreStyle.glow;
    for (const [dx, dy, r] of [[-6, -14, 2.0], [3, -9, 1.6]]) {
      c.beginPath();
      c.arc(cx + dx, baseY + dy, r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // 敲击裂纹
    if (dmg > 0.3) {
      c.strokeStyle = '#2a2420';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx - 5, baseY - 18);
      c.lineTo(cx + 2, baseY - 8);
      c.stroke();
    }
    if (dmg > 0.6) {
      c.beginPath();
      c.moveTo(cx + 7, baseY - 15);
      c.lineTo(cx - 2, baseY - 3);
      c.stroke();
    }
  } else {
    // 杂草
    const sway = Math.sin(nowMs / 600 + node.tx * 2) * 2;
    c.strokeStyle = '#7fa84f';
    c.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const off = -10 + i * 5;
      c.beginPath();
      c.moveTo(cx + off, baseY);
      c.quadraticCurveTo(cx + off + sway, baseY - 10, cx + off + sway * 1.6, baseY - 18 - (i % 2) * 4);
      c.stroke();
    }
    c.fillStyle = '#93b858';
    for (let i = 0; i < 3; i++) {
      c.fillRect(cx - 8 + i * 7, baseY - 16 - (i % 2) * 3, 3, 4);
    }
  }
}

/* ---------------- 交互提示 ---------------- */

function drawPrompt(c: Ctx, state: GameState, nowMs: number) {
  if (state.player.moving) return;

  let label = '';
  let warn = false;
  let cx = 0;
  let cy = 0;

  // 优先：面朝的村民
  const nearV = villagerNear(state, state.player.x, state.player.y, state.player.dir);
  if (nearV) {
    const def = VILLAGER_DEFS[nearV.id];
    label = `和 ${def?.name ?? '村民'} 聊聊`;
    cx = nearV.x;
    cy = nearV.y - 66 + Math.sin(nowMs / 420) * 2;
  } else {
  // 其次：面朝的动物
  const near = animalNearInScene(state, state.player.x, state.player.y, state.player.dir);
  if (near) {
    const def = ANIMAL_DEFS[near.kind];
    label = `照顾 ${def.name}`;
    cx = near.x;
    cy = near.y - (near.kind === 'cow' ? 40 : 30) + Math.sin(nowMs / 420) * 2;
  } else {
    const { tx, ty } = facingTile(state.player);
    const info = resolveTarget(state, tx, ty);
    if (!info) return;
    label = info.label;
    if (info.needsSeed) {
      const ref = state.hotbar[state.equipSlot];
      if (!ref || ref.type !== 'seed') { label = '需要种子'; warn = true; }
    } else if (info.tool) {
      const held = heldTool(state);
      if (held !== info.tool) {
        if (hotbarHasTool(state, info.tool)) {
          label = `${info.label} ⇄${TOOLS[info.tool].icon}`;
        } else {
          label = `缺 ${TOOLS[info.tool].name}`;
          warn = true;
        }
      }
    }
    cx = tx * TILE + TILE / 2;
    cy = ty * TILE - 6 + Math.sin(nowMs / 420) * 2;
  }
  }

  c.font = 'bold 12px "PingFang SC","Microsoft YaHei",sans-serif';
  const w = c.measureText(label).width + 34;
  c.fillStyle = warn ? 'rgba(120,40,32,.9)' : 'rgba(45,32,22,.86)';
  roundRect(c, cx - w / 2, cy - 20, w, 19, 9);
  c.fill();

  c.fillStyle = '#ffe9a8';
  c.fillRect(cx - w / 2 + 6, cy - 15, 20, 10);
  c.fillStyle = '#3d2b1f';
  c.font = 'bold 9px "PingFang SC",sans-serif';
  c.fillText('空格', cx - w / 2 + 7, cy - 7);

  c.fillStyle = '#fff4d8';
  c.font = 'bold 12px "PingFang SC","Microsoft YaHei",sans-serif';
  c.fillText(label, cx - w / 2 + 30, cy - 7);
}

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ---------------- 粒子与飘字 ---------------- */

function updateAndDrawParticles(c: Ctx, dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    c.globalAlpha = Math.max(0, p.life / p.max);
    c.fillStyle = p.color;
    c.fillRect(p.x, p.y, p.size, p.size);
  }
  c.globalAlpha = 1;
}

function updateAndDrawFloats(c: Ctx, dt: number) {
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.life -= dt;
    if (f.life <= 0) { floats.splice(i, 1); continue; }
    f.y -= 28 * dt;
    c.globalAlpha = Math.min(1, f.life / (f.max * 0.5));
    c.font = `bold ${f.size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    c.textAlign = 'center';
    c.fillStyle = 'rgba(0,0,0,.45)';
    c.fillText(f.text, f.x + 1, f.y + 1);
    c.fillStyle = f.color;
    c.fillText(f.text, f.x, f.y);
    c.textAlign = 'left';
  }
  c.globalAlpha = 1;
}

/* ---------------- 昼夜 / 雨 ---------------- */

function drawDayNight(c: Ctx, state: GameState) {
  const t = state.time;
  let alpha = 0;
  let tint = '20,28,64';
  if (t >= 18 * 60 && t < 21 * 60) {
    alpha = ((t - 18 * 60) / (3 * 60)) * 0.28;
    tint = '90,50,30';
  } else if (t >= 21 * 60) {
    alpha = 0.28 + Math.min(0.22, ((t - 21 * 60) / (4 * 60)) * 0.22);
    tint = '20,28,64';
  }
  if (alpha > 0.001) {
    c.fillStyle = `rgba(${tint},${alpha})`;
    c.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

function drawRain(c: Ctx, nowMs: number) {
  c.fillStyle = 'rgba(60,90,130,.13)';
  c.fillRect(0, 0, VIEW_W, VIEW_H);
  c.strokeStyle = 'rgba(190,220,245,.55)';
  c.lineWidth = 1.5;
  const t = nowMs / 1000;
  for (let i = 0; i < 90; i++) {
    const seed = i * 7919;
    const x = ((seed % 1000) / 1000) * (VIEW_W + 200) - 100 + t * 30;
    const y = (((seed * 3) % 1000) / 1000) * VIEW_H + t * 620;
    const px = ((x % (VIEW_W + 200)) + VIEW_W + 200) % (VIEW_W + 200) - 100;
    const py = y % (VIEW_H + 60);
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px - 4, py + 14);
    c.stroke();
  }
}

/** 季节环境色罩：很淡，只为烘托氛围 */
function drawSeasonTint(c: Ctx) {
  if (pal.tintAlpha <= 0) return;
  c.fillStyle = `rgba(${pal.tint},${pal.tintAlpha})`;
  c.fillRect(0, 0, VIEW_W, VIEW_H);
}

/** 飘雪：缓慢下落 + 左右摆动的小雪点 */
function drawSnow(c: Ctx, nowMs: number) {
  c.fillStyle = 'rgba(180,200,230,.10)';
  c.fillRect(0, 0, VIEW_W, VIEW_H);
  const t = nowMs / 1000;
  c.fillStyle = 'rgba(255,255,255,.85)';
  for (let i = 0; i < 70; i++) {
    const seed = i * 6271;
    const speed = 40 + (seed % 50);
    const x = ((seed % 1000) / 1000) * VIEW_W + Math.sin(t * 1.2 + i) * 18;
    const y = (((seed * 7) % 1000) / 1000) * VIEW_H + t * speed;
    const px = ((x % VIEW_W) + VIEW_W) % VIEW_W;
    const py = y % (VIEW_H + 20);
    const size = 1.5 + (i % 3);
    c.beginPath();
    c.arc(px, py, size, 0, Math.PI * 2);
    c.fill();
  }
}

export function worldToScreen(x: number, y: number): { x: number; y: number } {
  return { x: x - camX, y: y - camY };
}

/** 当前相机位置（点击移动要做屏幕→世界坐标换算） */
export function getCamera(): { x: number; y: number } {
  return { x: camX, y: camY };
}

/** 兼容调试入口 */
export function debugCamera(): { x: number; y: number } {
  return { x: camX, y: camY };
}

/** 调试：直接采样底图（世界坐标，绕过相机），用于验证静态建筑/围栏是否画出 */
export function debugSampleBase(wx: number, wy: number): [number, number, number] | null {
  if (!base) return null;
  const c = base.getContext('2d');
  if (!c || wx < 0 || wy < 0 || wx >= base.width || wy >= base.height) return null;
  const d = c.getImageData(Math.round(wx), Math.round(wy), 1, 1).data;
  return [d[0], d[1], d[2]];
}
