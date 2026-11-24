/* ============================================================
   palette.ts — 统一调色板（清新田园风）
   ------------------------------------------------------------
   规则：
   1. 每个材质固定 4 阶：hi 高光 / base 基础 / mid 阴影 / line 描边
   2. 描边不用纯黑，用该材质最深的一阶（偏暖），避免脏边
   3. 阴影偏蓝紫（色相偏移），不用纯黑降明度，避免发灰
   4. 光照统一从左上打，高光落在左上侧
   5. 整体低饱和、明度层级拉开，避免颜色互相打架
   ============================================================ */

export interface Shade {
  /** 高光（受光面） */
  hi: string;
  /** 基础色 */
  base: string;
  /** 中间调（背光面） */
  mid: string;
  /** 深阴影 */
  dark: string;
  /** 描边 */
  line: string;
}

/** 只给 base / line 的简写工具：中间调自动派生 */
function shade(base: string, line: string, hi?: string): Shade {
  return {
    hi: hi ?? lighten(base, 14),
    base,
    mid: darken(base, 12),
    dark: darken(base, 26),
    line
  };
}

/** 十六进制加减亮度（逐通道，保持色相） */
export function shift(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

function lighten(hex: string, amt: number): string { return shift(hex, amt); }
function darken(hex: string, amt: number): string { return shift(hex, -amt); }

/* ---------------- 静态材质 ---------------- */

export const MAT = {
  /** 土路 */
  path: shade('#ddc9a3', '#9c7f55', '#ecdcc0'),
  /** 耕地（干） */
  soil: shade('#b8946a', '#7d5c3a', '#cfa87a'),
  /** 耕地（湿） */
  soilWet: shade('#8a6746', '#553a24', '#9d7852'),
  /** 水 */
  water: shade('#72c6e0', '#31708c', '#9adcef'),
  /** 木材 */
  wood: shade('#c1966a', '#6b4a2e', '#d8b184'),
  /** 石材 */
  stone: shade('#bdb7ae', '#6f6862', '#d6d1c9'),
  /** 砖红屋顶 */
  roofRed: shade('#d9755c', '#8f3524', '#e89480'),
  /** 蓝屋顶 */
  roofBlue: shade('#6aa6c9', '#366a89', '#8fc4de'),
  /** 绿屋顶 */
  roofGreen: shade('#7fb262', '#476e33', '#9ccb80'),
  /** 粉屋顶 */
  roofPink: shade('#c07f9c', '#7a4560', '#d79db7'),
  /** 金屋顶 */
  roofGold: shade('#d4a94a', '#8a6720', '#e8c56f'),
  /** 皮肤 */
  skin: shade('#f2c9a2', '#a97a53', '#fadcbb'),
  /** 白色（鸡/羊/奶） */
  white: shade('#f5f1e7', '#a89e8c', '#fffdf7'),
  /** 深色（牛斑/毛发） */
  ink: shade('#4a3a30', '#2b201a', '#65524a')
} as const;

/* ---------------- 角色配色 ---------------- */

export const CHAR = {
  /** 玩家 */
  farmerShirt: shade('#f0e6d2', '#9c8d74'),
  farmerOverall: shade('#5b7fb5', '#33507a'),
  hat: shade('#e8c86a', '#a8862f', '#f5dc94'),
  boot: shade('#5b3d26', '#33210f')
} as const;

/* ---------------- 描边工具 ---------------- */

/**
 * 给一个"方块状"物体画描边：在目标矩形外扩 1~2px 画深色底。
 * 用于草地格、地块这类矩形物体。
 */
export function strokeRect(
  c: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  color: string, width = 1
): void {
  c.fillStyle = color;
  c.fillRect(x - width, y, w + width * 2, width);          // 上
  c.fillRect(x - width, y + h, w + width * 2, width);      // 下
  c.fillRect(x - width, y, width, h);                      // 左
  c.fillRect(x + w, y, width, h);                          // 右
}

/**
 * 圆形/椭圆物体的柔和落地阴影：三层递减，比单层纯黑更有空气感。
 */
export function softShadow(
  c: CanvasRenderingContext2D,
  cx: number, cy: number, rx: number, ry: number,
  alpha = 0.18
): void {
  for (let i = 3; i >= 1; i--) {
    const k = 1 + i * 0.22;
    c.fillStyle = `rgba(40,30,25,${alpha / (i * 1.7)})`;
    c.beginPath();
    c.ellipse(cx, cy, rx * k, ry * k, 0, 0, Math.PI * 2);
    c.fill();
  }
}

/**
 * 左上光源下的球面高光：一个偏左上的小亮点。
 */
export function sphereLight(
  c: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  color: string
): void {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(cx - r * 0.34, cy - r * 0.36, r * 0.42, r * 0.34, -0.5, 0, Math.PI * 2);
  c.fill();
}