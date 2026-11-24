/* ============================================================
   render.ts — Canvas 像素渲染
   ============================================================ */

import { CROPS } from './config';
import {
  TILE, MAP_W, MAP_H, VIEW_W, VIEW_H, T, tileAt, OBJECTS,
  plotTileOf, facingTile, BUILDINGS, PENS, TOWN_BUILDINGS,
  areaUnlocked, plotAreaOf
} from './world';
import { resolveTarget, heldTool, hotbarHasTool } from './action';
import { animalNear, ANIMAL_DEFS, isProductReady } from './animals';
import { villagerNear, VILLAGER_DEFS } from './villagers';
import { TOOLS } from './tools';
import { PALETTES } from './seasons';
import type { Palette } from './seasons';
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

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amt)));
  g = Math.max(0, Math.min(255, Math.round(g + amt)));
  b = Math.max(0, Math.min(255, Math.round(b + amt)));
  return `rgb(${r},${g},${b})`;
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
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      drawTile(c, tx, ty, tileAt(tx, ty));
    }
  }
  drawHouse(c);
  drawPens(c);
  drawCoop(c);
  drawBarn(c);
  drawTownBuildings(c);
}

function drawTile(c: Ctx, tx: number, ty: number, t: number) {
  const x = tx * TILE, y = ty * TILE;
  const r = hash(tx, ty);

  switch (t) {
    case T.GRASS:
    case T.FLOWER: {
      c.fillStyle = pal.grass;
      c.fillRect(x, y, TILE, TILE);
      // 草簇
      c.fillStyle = pal.grassDark;
      for (let i = 0; i < 5; i++) {
        const rr = hash(tx * 7 + i, ty * 13 + i * 3);
        const px = x + 6 + rr * (TILE - 14);
        const py = y + 8 + hash(tx + i * 5, ty + i) * (TILE - 18);
        c.fillRect(Math.floor(px), Math.floor(py), 3, 2);
      }
      if (t === T.FLOWER && pal.bloom) {
        const cols = ['#f2d45c', '#f08fb0', '#ffffff', '#e07f5a'];
        for (let i = 0; i < 3; i++) {
          const rr = hash(tx * 31 + i, ty * 17 + i);
          const px = x + 8 + rr * (TILE - 18);
          const py = y + 10 + hash(tx + i * 9, ty * 3 + i) * (TILE - 22);
          c.fillStyle = cols[Math.floor(rr * cols.length)];
          c.fillRect(Math.floor(px), Math.floor(py), 3, 3);
          c.fillStyle = pal.flowerStem;
          c.fillRect(Math.floor(px + 1), Math.floor(py + 4), 1, 3);
        }
      }
      break;
    }
    case T.PATH: {
      c.fillStyle = '#dcc79f';
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = '#cdb389';
      for (let i = 0; i < 6; i++) {
        const rr = hash(tx * 11 + i, ty * 23 + i * 5);
        c.fillRect(
          Math.floor(x + 4 + rr * (TILE - 12)),
          Math.floor(y + 4 + hash(tx + i, ty * 7 + i) * (TILE - 12)),
          4, 3
        );
      }
      break;
    }
    case T.WATER: {
      c.fillStyle = '#5aa9d6';
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = '#79c3e6';
      c.fillRect(x + 4 + r * 10, y + 10 + r * 20, 18, 3);
      c.fillRect(x + 22, y + 30 + r * 8, 14, 3);
      // 岸边
      c.fillStyle = 'rgba(255,255,255,.14)';
      c.fillRect(x, y, TILE, 2);
      break;
    }
    case T.SOIL: {
      c.fillStyle = '#a9855a';
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = '#96754b';
      for (let i = 0; i < 7; i++) {
        const rr = hash(tx * 3 + i, ty * 19 + i);
        c.fillRect(
          Math.floor(x + 3 + rr * (TILE - 10)),
          Math.floor(y + 3 + hash(tx + i * 2, ty + i) * (TILE - 10)),
          5, 3
        );
      }
      break;
    }
    case T.WALL:
    case T.ROOF:
    case T.DOOR:
      // 由 drawHouse 统一绘制
      c.fillStyle = pal.grass;
      c.fillRect(x, y, TILE, TILE);
      break;
    case T.TREE: {
      c.fillStyle = pal.grass;
      c.fillRect(x, y, TILE, TILE);
      drawTree(c, x + TILE / 2, y + TILE - 6, 1 + r * 0.12);
      break;
    }
    default: {
      c.fillStyle = pal.grass;
      c.fillRect(x, y, TILE, TILE);
    }
  }
}

function drawTree(c: Ctx, cx: number, baseY: number, scale: number) {
  const h = 34 * scale;
  c.fillStyle = pal.trunk;
  c.fillRect(cx - 3, baseY - 16, 6, 16);
  c.fillStyle = pal.foliage[0];
  c.beginPath();
  c.ellipse(cx, baseY - 16 - h * 0.35, 20 * scale, 16 * scale, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = pal.foliage[1];
  c.beginPath();
  c.ellipse(cx - 6, baseY - 16 - h * 0.5, 15 * scale, 12 * scale, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = pal.foliage[2];
  c.beginPath();
  c.ellipse(cx + 7, baseY - 16 - h * 0.3, 13 * scale, 11 * scale, 0, 0, Math.PI * 2);
  c.fill();
}

function drawHouse(c: Ctx) {
  const x0 = 3 * TILE, y0 = 2 * TILE;
  const w = 6 * TILE, h = 5 * TILE;

  // 影子
  c.fillStyle = 'rgba(60,40,20,.18)';
  c.beginPath();
  c.ellipse(x0 + w / 2, y0 + h - 4, w * 0.52, 16, 0, 0, Math.PI * 2);
  c.fill();

  // 墙体
  c.fillStyle = '#efdcba';
  c.fillRect(x0 + 6, y0 + 2.2 * TILE, w - 12, h - 2.2 * TILE);
  c.fillStyle = '#dcc39a';
  for (let i = 0; i < 5; i++) {
    c.fillRect(x0 + 6, y0 + 2.2 * TILE + i * 22 + 18, w - 12, 3);
  }
  // 木构架
  c.fillStyle = '#8e6a44';
  c.fillRect(x0 + 6, y0 + 2.2 * TILE, 5, h - 2.2 * TILE);
  c.fillRect(x0 + w - 11, y0 + 2.2 * TILE, 5, h - 2.2 * TILE);

  // 屋顶
  c.fillStyle = '#c9563f';
  c.beginPath();
  c.moveTo(x0 - 10, y0 + 2.4 * TILE);
  c.lineTo(x0 + 52, y0 - 6);
  c.lineTo(x0 + w - 52, y0 - 6);
  c.lineTo(x0 + w + 10, y0 + 2.4 * TILE);
  c.closePath();
  c.fill();
  c.fillStyle = '#b34a36';
  for (let i = 1; i < 5; i++) {
    const yy = y0 - 6 + (i * 2.4 * TILE) / 5;
    const spread = 10 + ((i * 52) / 5);
    c.fillRect(x0 - 10 + spread * 0.4, yy, w + 20 - spread * 0.8, 3);
  }
  // 屋檐
  c.fillStyle = '#8f3a29';
  c.fillRect(x0 - 10, y0 + 2.4 * TILE - 5, w + 20, 6);

  // 烟囱
  c.fillStyle = '#9c7a5a';
  c.fillRect(x0 + w - 70, y0 - 26, 22, 34);
  c.fillStyle = '#7d5f45';
  c.fillRect(x0 + w - 74, y0 - 30, 30, 8);

  // 门
  const dx = x0 + 2 * TILE + 4;
  c.fillStyle = '#6f4a2b';
  c.fillRect(dx, y0 + 3.5 * TILE, TILE - 8, 1.5 * TILE);
  c.fillStyle = '#8a5f38';
  c.fillRect(dx + 4, y0 + 3.5 * TILE + 4, TILE - 16, 1.5 * TILE - 8);
  c.fillStyle = '#e8c86a';
  c.fillRect(dx + TILE - 18, y0 + 4.2 * TILE, 4, 4);

  // 窗
  c.fillStyle = '#7fb8d4';
  c.fillRect(x0 + 26, y0 + 3.2 * TILE, 40, 30);
  c.fillStyle = '#5d93b0';
  c.fillRect(x0 + 44, y0 + 3.2 * TILE, 3, 30);
  c.fillRect(x0 + 26, y0 + 3.2 * TILE + 13, 40, 3);
  c.strokeStyle = '#8e6a44';
  c.lineWidth = 3;
  c.strokeRect(x0 + 26, y0 + 3.2 * TILE, 40, 30);
  c.strokeStyle = '#ffffff';
  c.lineWidth = 2;
  c.strokeRect(x0 + w - 66, y0 + 3.2 * TILE, 40, 30);
  c.fillStyle = '#7fb8d4';
  c.fillRect(x0 + w - 64, y0 + 3.2 * TILE + 2, 36, 26);
  c.fillStyle = '#5d93b0';
  c.fillRect(x0 + w - 48, y0 + 3.2 * TILE + 2, 3, 26);
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

function drawAnimal(c: Ctx, a: Animal, nowMs: number) {
  const bob = a.moving ? Math.sin(nowMs / 120 + a.x) * 1.2 : 0;
  const x = a.x, y = a.y + bob;
  const faceLeft = a.dir === 'left';
  // 幼崽整体缩小
  const scale = a.adult ? 1 : 0.62;

  c.fillStyle = 'rgba(60,40,20,.22)';
  c.beginPath();
  c.ellipse(x, a.y + 2, (a.kind === 'cow' ? 16 : 9) * scale, 4 * scale, 0, 0, Math.PI * 2);
  c.fill();

  c.save();
  c.translate(x, y);
  if (faceLeft) c.scale(-1, 1);
  if (scale !== 1) c.scale(scale, scale);

  if (a.kind === 'chicken') {
    // 身体
    c.fillStyle = '#f5f0e6';
    c.beginPath(); c.ellipse(0, -8, 9, 7, 0, 0, Math.PI * 2); c.fill();
    // 尾
    c.fillStyle = '#e0d6c2';
    c.beginPath(); c.moveTo(-8, -10); c.lineTo(-13, -15); c.lineTo(-7, -13); c.closePath(); c.fill();
    // 头
    c.fillStyle = '#f5f0e6';
    c.beginPath(); c.arc(7, -14, 5, 0, Math.PI * 2); c.fill();
    // 冠
    c.fillStyle = '#d94f43';
    c.fillRect(5, -20, 3, 4); c.fillRect(8, -21, 3, 5);
    // 喙
    c.fillStyle = '#e8a13c';
    c.beginPath(); c.moveTo(11, -14); c.lineTo(16, -13); c.lineTo(11, -12); c.closePath(); c.fill();
    // 眼
    c.fillStyle = '#3d2b1f'; c.fillRect(8, -15, 2, 2);
    // 腿
    c.strokeStyle = '#e8a13c'; c.lineWidth = 2;
    const step = a.moving ? Math.sin(nowMs / 100) * 2 : 0;
    c.beginPath(); c.moveTo(-2, -2); c.lineTo(-2 + step, 2); c.moveTo(3, -2); c.lineTo(3 - step, 2); c.stroke();
  } else if (a.kind === 'sheep') {
    // 羊：蓬松的云朵状羊毛
    const fluffy = Math.min(1, (a.wool ?? 0) / 100);
    const r = 9 + fluffy * 5; // 毛长长了会变大
    c.fillStyle = '#f7f4ec';
    for (const [dx, dy, rr] of [[-8, -10, r], [2, -13, r * 1.05], [10, -9, r * 0.9], [-2, -6, r * 0.95], [6, -5, r * 0.85]]) {
      c.beginPath(); c.arc(dx, dy, rr, 0, Math.PI * 2); c.fill();
    }
    // 头
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
    // 牛身体
    c.fillStyle = '#f2ede2';
    c.beginPath(); c.ellipse(0, -12, 16, 10, 0, 0, Math.PI * 2); c.fill();
    // 斑
    c.fillStyle = '#4a3a30';
    c.beginPath(); c.ellipse(-6, -15, 5, 4, 0.4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(5, -9, 4, 3, -0.3, 0, Math.PI * 2); c.fill();
    // 头
    c.fillStyle = '#f2ede2';
    c.beginPath(); c.ellipse(15, -16, 7, 6, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e8b8a0';
    c.beginPath(); c.ellipse(18, -13, 4, 3, 0, 0, Math.PI * 2); c.fill();
    // 角 / 耳
    c.fillStyle = '#c9b89a';
    c.fillRect(12, -23, 3, 4); c.fillRect(17, -23, 3, 4);
    // 眼
    c.fillStyle = '#3d2b1f'; c.fillRect(14, -18, 2, 2);
    // 腿
    c.fillStyle = '#e0d6c2';
    const step = a.moving ? Math.sin(nowMs / 140) * 2 : 0;
    c.fillRect(-10, -4 + step * 0.3, 4, 6);
    c.fillRect(-3, -4 - step * 0.3, 4, 6);
    c.fillRect(4, -4 + step * 0.3, 4, 6);
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

  // 耕地与作物（未解锁的地块不画，底图上是普通草地）
  for (let i = 0; i < state.plots.length; i++) {
    if (!areaUnlocked(plotAreaOf(i), state.farmUnlocked)) continue;
    const { tx, ty } = plotTileOf(i);
    drawPlot(ctx, state.plots[i], tx * TILE, ty * TILE, nowMs);
  }

  // 水波
  drawWaterShimmer(ctx, nowMs);

  // 需要按 y 排序的实体
  interface Entity { y: number; draw: () => void }
  const ents: Entity[] = [];

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
    ents.push({ y: v.y + 2, draw: () => drawVillager(ctx, v, nowMs) });
  }

  ents.push({
    y: state.player.y + 2,
    draw: () => drawFarmer(ctx, state.player.x, state.player.y, state.player.dir, state.player.walkT, state.player.moving)
  });

  ents.sort((a, b) => a.y - b.y);
  for (const e of ents) e.draw();

  // 交互提示
  drawPrompt(ctx, state, nowMs);

  // 粒子 / 飘字
  updateAndDrawParticles(ctx, dt);
  updateAndDrawFloats(ctx, dt);

  ctx.restore();

  // 季节色罩 → 昼夜 → 降水
  drawSeasonTint(ctx);
  drawDayNight(ctx, state);
  if (state.weather === 'rain') drawRain(ctx, nowMs);
  else if (state.weather === 'snow') drawSnow(ctx, nowMs);
}

/* ---------------- 耕地 ---------------- */

function drawPlot(c: Ctx, plot: Plot, x: number, y: number, nowMs: number) {
  const cx = x + TILE / 2;

  if (plot.tilled) {
    c.fillStyle = plot.watered ? '#5f4128' : '#7a5233';
    c.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    // 垄沟
    c.fillStyle = plot.watered ? '#503620' : '#6b482c';
    for (let i = 0; i < 3; i++) {
      c.fillRect(x + 6, y + 10 + i * 12, TILE - 12, 4);
    }
    if (plot.watered) {
      c.fillStyle = 'rgba(120,200,240,.20)';
      c.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    }
  } else {
    // 未开垦：杂草
    c.fillStyle = '#8f7a52';
    c.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    c.fillStyle = '#7aa85c';
    for (let i = 0; i < 4; i++) {
      const r = hash(x + i, y + i * 3);
      c.fillRect(x + 8 + r * 28, y + 10 + hash(y + i, x) * 26, 3, 5);
    }
  }

  if (plot.crop) {
    drawCrop(c, cx, y + TILE - 6, plot, plot.crop, nowMs);
  }
}

function drawCrop(c: Ctx, cx: number, baseY: number, plot: Plot, cropId: CropId, nowMs: number) {
  const def = CROPS[cropId];
  const g = Math.min(1, plot.stage / def.days);
  const ready = plot.stage >= def.days;

  if (plot.stage === 0) {
    c.fillStyle = '#5a3f27';
    c.beginPath();
    c.ellipse(cx, baseY - 2, 9, 4, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = def.leaf;
    c.fillRect(cx - 2, baseY - 10, 4, 8);
    c.fillRect(cx - 6, baseY - 12, 5, 3);
    return;
  }

  const stemH = 8 + 26 * g;
  const sway = Math.sin(nowMs / 700 + cx) * (ready ? 1.2 : 0.6);

  // 茎
  c.strokeStyle = shade(def.leaf, -18);
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(cx, baseY);
  c.quadraticCurveTo(cx + sway, baseY - stemH * 0.6, cx + sway * 1.4, baseY - stemH);
  c.stroke();

  // 叶
  const leafY = baseY - stemH * 0.75;
  c.fillStyle = def.leaf;
  for (const s of [-1, 1]) {
    c.beginPath();
    c.ellipse(cx + sway * 0.6 + s * 8 * g + s * 3, leafY - s * 3, 9 * g + 3, 5 * g + 2, s * 0.5, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = shade(def.leaf, 16);
  c.beginPath();
  c.ellipse(cx + sway * 1.2, baseY - stemH - 2, 6 * g + 2, 4 * g + 2, 0, 0, Math.PI * 2);
  c.fill();

  if (!ready) return;

  // 成熟果实
  const fy = baseY - stemH * 0.55;
  c.fillStyle = def.fruit;
  switch (def.shape) {
    case 'root': {
      c.beginPath();
      c.ellipse(cx, baseY - 4, 10, 8, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = shade(def.fruit, 30);
      c.beginPath();
      c.ellipse(cx - 2, baseY - 6, 4, 3, 0, 0, Math.PI * 2);
      c.fill();
      break;
    }
    case 'round': {
      const n = 2;
      for (let i = 0; i < n; i++) {
        c.fillStyle = i % 2 ? shade(def.fruit, 20) : def.fruit;
        c.beginPath();
        c.arc(cx + (i === 0 ? -6 : 7), fy + i * 4, 7, 0, Math.PI * 2);
        c.fill();
      }
      break;
    }
    case 'long': {
      c.fillStyle = def.fruit;
      c.beginPath();
      c.ellipse(cx + 4, fy - 2, 5, 11, 0.18, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = shade(def.fruit, 26);
      c.fillRect(cx + 2, fy - 10, 3, 12);
      break;
    }
    case 'berry': {
      c.fillStyle = def.fruit;
      for (const [dx, dy] of [[-6, 0], [4, -3], [-1, 6], [8, 5]]) {
        c.beginPath();
        c.arc(cx + dx, fy + dy, 4.5, 0, Math.PI * 2);
        c.fill();
      }
      break;
    }
    case 'gourd': {
      c.fillStyle = def.fruit;
      c.beginPath();
      c.ellipse(cx, baseY - 8, 13, 10, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = shade(def.fruit, -22);
      c.fillRect(cx - 3, baseY - 16, 3, 8);
      break;
    }
    case 'leafy': {
      // 菠菜：一丛贴地的叶片
      for (const [dx, dy, rot] of [[-7, -2, -0.5], [0, -5, 0], [7, -2, 0.5], [-3, 1, -0.2], [4, 1, 0.2]]) {
        c.fillStyle = shade(def.fruit, dy < -3 ? 18 : 0);
        c.beginPath();
        c.ellipse(cx + dx, baseY + dy - 4, 5, 8, rot, 0, Math.PI * 2);
        c.fill();
      }
      break;
    }
  }

  // 成熟微光
  const tw = (Math.sin(nowMs / 300 + cx) + 1) / 2;
  c.fillStyle = `rgba(255,246,190,${0.18 + tw * 0.22})`;
  c.beginPath();
  c.arc(cx + 9, fy - 10, 2.4, 0, Math.PI * 2);
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

function drawObject(c: Ctx, kind: 'bin' | 'order' | 'store', x: number, y: number, nowMs: number) {
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

function drawFarmer(c: Ctx, px: number, py: number, dir: Dir, walkT: number, moving: boolean) {
  const bob = moving ? Math.sin(walkT * 12) * 1.2 : 0;
  const swing = moving ? Math.sin(walkT * 12) : 0;

  // 影子
  c.fillStyle = 'rgba(60,40,20,.25)';
  c.beginPath();
  c.ellipse(px, py + 1, 11, 4, 0, 0, Math.PI * 2);
  c.fill();

  c.save();
  c.translate(Math.round(px), Math.round(py + bob));

  const skin = '#f3c9a0';
  const shirt = '#f0e6d2';
  const overall = '#4a6fa5';
  const hat = '#e8c86a';
  const hatDark = '#c9a748';
  const boot = '#5b3d26';

  // 腿
  c.fillStyle = overall;
  c.fillRect(-7, -12 + swing * 1.5, 6, 12);
  c.fillRect(1, -12 - swing * 1.5, 6, 12);
  c.fillStyle = boot;
  c.fillRect(-7, -4 + swing * 1.5, 6, 4);
  c.fillRect(1, -4 - swing * 1.5, 6, 4);

  // 身体
  c.fillStyle = shirt;
  c.fillRect(-9, -26, 18, 15);
  c.fillStyle = overall;
  c.fillRect(-8, -20, 16, 9);
  c.fillRect(-8, -26, 5, 8);
  c.fillRect(3, -26, 5, 8);
  c.fillStyle = '#3d5c88';
  c.fillRect(-8, -20, 16, 2);

  // 手臂
  c.fillStyle = shirt;
  if (dir === 'left') {
    c.fillRect(-13, -24 + swing * 2, 5, 11);
  } else if (dir === 'right') {
    c.fillRect(8, -24 - swing * 2, 5, 11);
  } else {
    c.fillRect(-13, -24 + swing * 2, 5, 11);
    c.fillRect(8, -24 - swing * 2, 5, 11);
  }
  c.fillStyle = skin;
  c.fillRect(dir === 'left' ? -13 : (dir === 'right' ? 8 : -13), -14 + swing * 2, 5, 4);
  if (dir !== 'left' && dir !== 'right') c.fillRect(8, -14 - swing * 2, 5, 4);

  // 头
  c.fillStyle = skin;
  c.fillRect(-8, -40, 16, 15);
  c.fillStyle = '#6b4a2e';
  if (dir !== 'up') {
    c.fillRect(-8, -40, 16, 4);
    // 眼睛
    c.fillStyle = '#3d2b1f';
    if (dir === 'down') {
      c.fillRect(-5, -33, 3, 3);
      c.fillRect(3, -33, 3, 3);
      c.fillStyle = '#e8a48a';
      c.fillRect(-1, -30, 3, 2);
    } else if (dir === 'left') {
      c.fillRect(-6, -33, 3, 3);
    } else {
      c.fillRect(3, -33, 3, 3);
    }
  } else {
    c.fillStyle = '#6b4a2e';
    c.fillRect(-8, -40, 16, 15);
  }

  // 草帽
  c.fillStyle = hat;
  c.fillRect(-12, -42, 24, 4);
  c.fillRect(-8, -48, 16, 7);
  c.fillStyle = hatDark;
  c.fillRect(-12, -39, 24, 2);
  c.fillStyle = '#c4553f';
  c.fillRect(-8, -44, 16, 2);

  c.restore();
}

/* ---------------- 村民 ---------------- */

function drawVillager(c: Ctx, v: Villager, nowMs: number) {
  const def = VILLAGER_DEFS[v.id];
  const shirt = def?.shirt ?? '#8a8a8a';
  const bob = v.moving ? Math.sin(nowMs / 120 + v.x) * 1.2 : 0;
  const swing = v.moving ? Math.sin(nowMs / 120 + v.x) : 0;

  c.fillStyle = 'rgba(60,40,20,.25)';
  c.beginPath();
  c.ellipse(v.x, v.y + 1, 11, 4, 0, 0, Math.PI * 2);
  c.fill();

  c.save();
  c.translate(Math.round(v.x), Math.round(v.y + bob));

  const skin = '#f3c9a0';
  const pants = '#5a4a3e';
  const hair = '#4a3a2e';
  const boot = '#3d2b1f';

  // 腿
  c.fillStyle = pants;
  c.fillRect(-7, -12 + swing * 1.5, 6, 12);
  c.fillRect(1, -12 - swing * 1.5, 6, 12);
  c.fillStyle = boot;
  c.fillRect(-7, -4 + swing * 1.5, 6, 4);
  c.fillRect(1, -4 - swing * 1.5, 6, 4);

  // 身体
  c.fillStyle = shirt;
  c.fillRect(-9, -26, 18, 15);
  c.fillStyle = 'rgba(0,0,0,.15)';
  c.fillRect(-9, -13, 18, 2);

  // 手臂
  c.fillStyle = shirt;
  if (v.dir === 'left') c.fillRect(-13, -24 + swing * 2, 5, 11);
  else if (v.dir === 'right') c.fillRect(8, -24 - swing * 2, 5, 11);
  else { c.fillRect(-13, -24 + swing * 2, 5, 11); c.fillRect(8, -24 - swing * 2, 5, 11); }
  c.fillStyle = skin;
  if (v.dir === 'left') c.fillRect(-13, -14 + swing * 2, 5, 4);
  else if (v.dir === 'right') c.fillRect(8, -14 - swing * 2, 5, 4);
  else { c.fillRect(-13, -14 + swing * 2, 5, 4); c.fillRect(8, -14 - swing * 2, 5, 4); }

  // 头
  c.fillStyle = skin;
  c.fillRect(-8, -40, 16, 15);
  // 头发
  c.fillStyle = hair;
  c.fillRect(-8, -42, 16, 5);
  c.fillRect(-8, -40, 3, 6);
  c.fillRect(5, -40, 3, 6);
  // 眼睛
  if (v.dir !== 'up') {
    c.fillStyle = '#3d2b1f';
    if (v.dir === 'down') { c.fillRect(-5, -33, 3, 3); c.fillRect(3, -33, 3, 3); }
    else if (v.dir === 'left') c.fillRect(-6, -33, 3, 3);
    else c.fillRect(3, -33, 3, 3);
  }

  c.restore();

  // 头顶名牌（靠近时才显示，避免杂乱）
  if (def) {
    c.font = 'bold 11px "PingFang SC",sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(45,32,22,.75)';
    const w = c.measureText(def.name).width + 10;
    c.fillRect(v.x - w / 2, v.y - 58, w, 14);
    c.fillStyle = '#fff4d8';
    c.fillText(def.name, v.x, v.y - 48);
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
  const near = animalNear(state, state.player.x, state.player.y, state.player.dir);
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

/** 调试：当前相机位置 */
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
