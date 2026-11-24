/* ============================================================
   seasons.ts — 四季：推导、天气、生长倍率、色板
   ------------------------------------------------------------
   一年 32 天，每季 8 天。季节给经营加上时间维度：
   当季作物正常长，反季 ×2 慢；地图随季节换色，冬天飘雪。
   ============================================================ */

import type { CropDef, Season, Weather } from './types';

export const SEASON_LEN = 8;
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export const SEASON_LABEL: Record<Season, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬'
};

export const SEASON_ICON: Record<Season, string> = {
  spring: '🌸',
  summer: '☀️',
  autumn: '🍂',
  winter: '❄️'
};

/** 第几天属于哪个季节（day 从 1 起） */
export function seasonOfDay(day: number): Season {
  return SEASONS[Math.floor((day - 1) / SEASON_LEN) % 4];
}

/** 当前季节里的第几天（1~8） */
export function dayInSeason(day: number): number {
  return ((day - 1) % SEASON_LEN) + 1;
}

/** 第几年（从 1 起） */
export function yearOfDay(day: number): number {
  return Math.floor((day - 1) / (SEASON_LEN * 4)) + 1;
}

/** 明天是否换季 */
export function seasonChangesAfter(day: number): boolean {
  return dayInSeason(day) === SEASON_LEN;
}

/* ---------------- 天气 ---------------- */

/** 各季节降水概率；冬天降水是雪 */
const PRECIP_CHANCE: Record<Season, number> = {
  spring: 0.35,
  summer: 0.15,
  autumn: 0.20,
  winter: 0.40
};

export function rollWeather(season: Season): Weather {
  if (Math.random() >= PRECIP_CHANCE[season]) return 'sunny';
  return season === 'winter' ? 'snow' : 'rain';
}

/** 雨会自动浇灌；雪不会（冬天得手动浇水） */
export function weatherWaters(w: Weather): boolean {
  return w === 'rain';
}

export const WEATHER_LABEL: Record<Weather, string> = {
  sunny: '晴',
  rain: '雨',
  snow: '雪'
};

export const WEATHER_ICON: Record<Weather, string> = {
  sunny: '☀️',
  rain: '🌧️',
  snow: '🌨️'
};

/* ---------------- 生长 ---------------- */

/** 当季 1 倍速，反季 2 倍慢 */
export function growthMultiplier(crop: CropDef, season: Season): number {
  return crop.season === season ? 1 : 2;
}

export function isInSeason(crop: CropDef, season: Season): boolean {
  return crop.season === season;
}

/* ---------------- 节日 ---------------- */

export type FestivalId = 'sowing' | 'summer' | 'harvest' | 'star';

export interface FestivalDef {
  id: FestivalId;
  name: string;
  icon: string;
  /** 一句话介绍 */
  intro: string;
  /** 效果说明 */
  effect: string;
}

/** 每季最后一天是节日 */
export const FESTIVALS: Record<Season, FestivalDef> = {
  spring: {
    id: 'sowing', name: '播种祭', icon: '🌱',
    intro: '全村一起下种的日子，种子铺也打折。',
    effect: '种子半价'
  },
  summer: {
    id: 'summer', name: '夏日祭', icon: '🎆',
    intro: '白天最长的一天，大家的劲头都足。',
    effect: '体力消耗减半'
  },
  autumn: {
    id: 'harvest', name: '丰收祭', icon: '🌾',
    intro: '一年的收成在这天被称量。',
    effect: '出货价格 +50%'
  },
  winter: {
    id: 'star', name: '星霜祭', icon: '✨',
    intro: '雪夜里抬头看星星的旧俗。',
    effect: '所有产出品质 +1 星'
  }
};

/** 节日只在每季最后一天 */
export function festivalOfDay(day: number): FestivalDef | null {
  return dayInSeason(day) === SEASON_LEN ? FESTIVALS[seasonOfDay(day)] : null;
}

/** 明天是否节日（睡前提示用） */
export function festivalTomorrow(day: number): FestivalDef | null {
  return festivalOfDay(day + 1);
}

export interface FestivalEffects {
  seedMult: number;
  staminaMult: number;
  sellMult: number;
  qualityBonus: number;
  festival: FestivalDef | null;
}

/** 当天的节日修正；非节日全部为中性值 */
export function festivalEffects(day: number): FestivalEffects {
  const f = festivalOfDay(day);
  return {
    seedMult: f?.id === 'sowing' ? 0.5 : 1,
    staminaMult: f?.id === 'summer' ? 0.5 : 1,
    sellMult: f?.id === 'harvest' ? 1.5 : 1,
    qualityBonus: f?.id === 'star' ? 1 : 0,
    festival: f
  };
}

/* ---------------- 色板 ---------------- */

export interface Palette {
  /** 草地 base */
  grass: string;
  /** 草地高光 */
  grassHi: string;
  /** 草地阴影 */
  grassDark: string;
  /** 草地描边（同时作为"深色草"） */
  grassLine: string;
  /** 树冠 [深, 中, 浅] */
  foliage: [string, string, string];
  /** 树冠描边 */
  foliageLine: string;
  trunk: string;
  trunkLine: string;
  flowerStem: string;
  /** 是否开花（冬天不开） */
  bloom: boolean;
  /** 环境色罩 rgba 前缀与透明度 */
  tint: string;
  tintAlpha: number;
}

export const PALETTES: Record<Season, Palette> = {
  spring: {
    grass: '#8ccb68', grassHi: '#a8dd85', grassDark: '#6ba84d', grassLine: '#4a7a33',
    foliage: ['#5a9a48', '#6fb457', '#88c96b'], foliageLine: '#3c6b2f',
    trunk: '#8a6340', trunkLine: '#5a4028',
    flowerStem: '#5f9e48', bloom: true,
    tint: '255,240,200', tintAlpha: 0.03
  },
  summer: {
    grass: '#6fb454', grassHi: '#8bc972', grassDark: '#54923e', grassLine: '#3a6b2a',
    foliage: ['#3f7a35', '#529243', '#66a84f'], foliageLine: '#2a5522',
    trunk: '#8a6340', trunkLine: '#5a4028',
    flowerStem: '#4e8a3c', bloom: true,
    tint: '255,220,120', tintAlpha: 0.05
  },
  autumn: {
    grass: '#c0a355', grassHi: '#d6bb70', grassDark: '#9e8440', grassLine: '#6f5a28',
    foliage: ['#c9743f', '#d99a3c', '#e0b04a'], foliageLine: '#8a4a24',
    trunk: '#8a6340', trunkLine: '#5a4028',
    flowerStem: '#a98c3f', bloom: true,
    tint: '230,150,60', tintAlpha: 0.07
  },
  winter: {
    grass: '#dbe4e9', grassHi: '#eef4f7', grassDark: '#bcc9d0', grassLine: '#8a9aa3',
    foliage: ['#9fb2ba', '#b8c6cc', '#d0dade'], foliageLine: '#6d7e86',
    trunk: '#7a6350', trunkLine: '#4e3d2e',
    flowerStem: '#b8c6cc', bloom: false,
    tint: '160,190,230', tintAlpha: 0.08
  }
};
