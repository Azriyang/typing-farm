/* ============================================================
   render.ts — Canvas 像素渲染
   ============================================================ */

import { CROPS } from './config';
import {
  TILE, MAP_W, MAP_H, VIEW_W, VIEW_H, T, tileAt, OBJECTS,
  plotTileOf, facingTile, BUILDINGS, PENS, TOWN_BUILDINGS,
  areaUnlocked, plotAreaOf, getScene, FURNITURE, ROOMS, sceneOfAnimal, indoorAnimalPos,
  FARM_DOORS
} from './world';
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
      drawTree(c, x + TILE / 2, y + TILE - 6, 1 + r * 0.12);
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
  for (const f of FURNITURE) {
    if (f.scene !== scene) continue;
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

function drawTree(c: Ctx, cx: number, baseY: number, scale: number) {
  const h = 34 * scale;
  const trunkTop = baseY - 16;

  // 树干（描边 + 木色 + 左侧高光）
  c.fillStyle = pal.trunkLine;
  c.fillRect(cx - 4, trunkTop, 8, 16);
  c.fillStyle = pal.trunk;
  c.fillRect(cx - 3, trunkTop, 6, 16);
  c.fillStyle = shift(pal.trunk, 22);
  c.fillRect(cx - 2, trunkTop + 1, 2, 13);

  // 树冠：先描边层，再本体，最后高光层
  const R = 20 * scale, Ry = 16 * scale;
  const ccy = baseY - 16 - h * 0.35;
  c.fillStyle = pal.foliageLine;
  c.beginPath();
  c.ellipse(cx, ccy, R + 2, Ry + 2, 0, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = pal.foliage[0];
  c.beginPath();
  c.ellipse(cx, ccy, R, Ry, 0, 0, Math.PI * 2);
  c.fill();

  // 中层（偏左上，受光）
  c.fillStyle = pal.foliage[1];
  c.beginPath();
  c.ellipse(cx - 6 * scale, ccy - 6 * scale, 15 * scale, 12 * scale, 0, 0, Math.PI * 2);
  c.fill();

  // 亮层（偏右下，反光）
  c.fillStyle = pal.foliage[2];
  c.beginPath();
  c.ellipse(cx + 7 * scale, ccy + 2 * scale, 13 * scale, 11 * scale, 0, 0, Math.PI * 2);
  c.fill();

  // 左上高光斑
  c.fillStyle = shift(pal.foliage[2], 16);
  c.beginPath();
  c.ellipse(cx - 8 * scale, ccy - 8 * scale, 7 * scale, 5 * scale, -0.5, 0, Math.PI * 2);
  c.fill();
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

function drawTownBuildings(c: Ctx) {
  for (const b of TOWN_BUILDINGS) {
    const x = b.x * TILE, y = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
    const north = b.y < 8; // 门朝街道（北侧建筑门在下，南侧建筑门在上）
    c.fillStyle = 'rgba(60,40,20,.18)';
    c.beginPath(); c.ellipse(x + w / 2, y + h - 2, w * 0.5, 10, 0, 0, Math.PI * 2); c.fill();
    // 墙
    c.fillStyle = b.kind === 'store' ? '#e8dcc0' : '#efdcba';
    c.fillRect(x + 4, y + 22, w - 8, h - 22);
    c.fillStyle = 'rgba(0,0,0,.08)';
    for (let i = 0; i < 3; i++) c.fillRect(x + 4, y + 32 + i * 20, w - 8, 3);
    // 屋顶
    c.fillStyle = b.roof;
    c.beginPath();
    c.moveTo(x - 6, y + 26); c.lineTo(x + w * 0.25, y - 4); c.lineTo(x + w * 0.75, y - 4); c.lineTo(x + w + 6, y + 26);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(0,0,0,.2)';
    c.fillRect(x - 6, y + 23, w + 12, 4);
    // 门（朝向街道一侧）
    const doorY = north ? y + h - 34 : y + 22;
    c.fillStyle = '#6f4a2b';
    c.fillRect(x + w / 2 - 13, doorY, 26, 34);
    c.fillStyle = '#8a5f38';
    c.fillRect(x + w / 2 - 10, doorY + 3, 20, 31);
    c.fillStyle = '#e8c86a';
    c.fillRect(x + w / 2 + 5, doorY + 16, 3, 3);
    // 窗
    c.fillStyle = '#7fb8d4';
    c.fillRect(x + 12, y + 34, 20, 16);
    c.fillRect(x + w - 32, y + 34, 20, 16);
    c.strokeStyle = '#8e6a44'; c.lineWidth = 2;
    c.strokeRect(x + 12, y + 34, 20, 16);
    c.strokeRect(x + w - 32, y + 34, 20, 16);
    // 店铺招牌
    if (b.kind === 'store') {
      c.fillStyle = '#f7e9c4';
      c.fillRect(x + w / 2 - 24, y + 26, 48, 14);
      c.fillStyle = '#8a5a2b';
      c.font = 'bold 10px "PingFang SC",sans-serif';
      c.textAlign = 'center';
      c.fillText('杂货店', x + w / 2, y + 36);
      c.textAlign = 'left';
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

function drawNode(c: Ctx, node: ResNode, nowMs: number) {
  const x = node.tx * TILE;
  const y = node.ty * TILE;
  const cx = x + TILE / 2;
  const baseY = y + TILE - 6;

  c.fillStyle = 'rgba(60,40,20,.2)';
  c.beginPath();
  c.ellipse(cx, baseY + 4, 20, 6, 0, 0, Math.PI * 2);
  c.fill();

  if (node.kind === 'tree') {
    if (node.hp <= 0) {
      // 树桩
      c.fillStyle = '#7a5433';
      c.fillRect(cx - 9, baseY - 10, 18, 12);
      c.fillStyle = '#a97c4f';
      c.beginPath();
      c.ellipse(cx, baseY - 10, 9, 4, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#8a6038';
      c.beginPath();
      c.ellipse(cx, baseY - 10, 5, 2, 0, 0, Math.PI * 2);
      c.fill();
      return;
    }
    const dmg = 1 - node.hp / node.maxHp;
    const sway = Math.sin(nowMs / 900 + node.tx) * (1.5 + dmg * 4);
    // 树干
    c.fillStyle = pal.trunk;
    c.fillRect(cx - 4 + sway * 0.3, baseY - 22, 8, 22);
    // 树冠
    const r = 22 - dmg * 6;
    c.fillStyle = pal.foliage[0];
    c.beginPath();
    c.ellipse(cx + sway, baseY - 34, r, r * 0.82, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = pal.foliage[1];
    c.beginPath();
    c.ellipse(cx + sway - 7, baseY - 40, r * 0.72, r * 0.6, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = pal.foliage[2];
    c.beginPath();
    c.ellipse(cx + sway + 8, baseY - 32, r * 0.6, r * 0.52, 0, 0, Math.PI * 2);
    c.fill();
    // 砍痕
    if (dmg > 0) {
      c.fillStyle = '#c8a274';
      c.fillRect(cx - 4, baseY - 16, 8, 3);
      if (dmg > 0.3) c.fillRect(cx - 4, baseY - 10, 8, 3);
      if (dmg > 0.6) c.fillRect(cx - 4, baseY - 4, 8, 3);
    }
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
