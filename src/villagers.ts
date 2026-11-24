/* ============================================================
   villagers.ts — 村民：定义、台词、游走、好感、送礼偏好
   ------------------------------------------------------------
   小镇补上社交维度。对话 = 打字：打出村民说的话涨好感。
   好感解锁更暖的对话与杂货店折扣；送礼投其所好涨得更快。
   ============================================================ */

import type { Villager, DialoguePhrase, Dir, GameState } from './types';
import { TILE, TOWN_OPEN } from './world';

export interface VillagerDef {
  id: string;
  name: string;
  role: string;
  icon: string;
  /** 上衣颜色（渲染用） */
  shirt: string;
  /** 喜欢的物品 id 或前缀（以 . 结尾表示整类） */
  likes: string[];
  dislikes: string[];
  phrases: DialoguePhrase[];
  /** 见面招呼语 */
  greet: string;
  /** 送礼反应台词：玩家靠语气判断喜恶，不显示数值 */
  reactions: Record<'like' | 'neutral' | 'dislike', string[]>;
}

export const VILLAGER_DEFS: Record<string, VillagerDef> = {
  farmer: {
    id: 'farmer', name: '阿茂', role: '老农', icon: '🧑‍🌾', shirt: '#7a9a4e',
    likes: ['crop.'], dislikes: ['fish.'],
    greet: '哟，来帮我看看庄稼？',
    reactions: {
      like: ['哈哈，好庄稼人就该懂这些！', '嗯，这东西实在，我喜欢。', '到底是土地里出来的，好啊！'],
      neutral: ['哦，谢谢你了。', '嗯，收下了。'],
      dislike: ['唉，我这把年纪可弄不来这个。', '这…我留着也没用啊。', '鱼腥味…我可不碰。']
    },
    phrases: [
      { en: 'the soil is good this year', zh: '今年的土不错' },
      { en: 'rain helps the crops grow', zh: '雨水帮庄稼生长' },
      { en: 'hard work brings harvest', zh: '辛劳换来收成' },
      { en: 'my fields need more water', zh: '我的田还缺水' },
      { en: 'a farmer reads the sky', zh: '农夫看天吃饭' }
    ]
  },
  fisher: {
    id: 'fisher', name: '小渔', role: '渔夫', icon: '🎣', shirt: '#4a7fae',
    likes: ['fish.'], dislikes: ['mat.wood'],
    greet: '今天河面很静，适合下钩。',
    reactions: {
      like: ['哈！你懂我！', '这可是好东西，谢啦！', '水里来的，我最爱！'],
      neutral: ['谢了，朋友。', '嗯，我收下了。'],
      dislike: ['这玩意儿…我还是更想要鱼。', '咳，这个我不太在行。', '木头…我可不拿它下钩。']
    },
    phrases: [
      { en: 'the fish bite at dawn', zh: '鱼儿清晨咬钩' },
      { en: 'patience catches the big one', zh: '耐心钓大鱼' },
      { en: 'the river is calm today', zh: '今天河面很静' },
      { en: 'a good bait helps a lot', zh: '好鱼饵帮大忙' },
      { en: 'i love the smell of water', zh: '我喜欢水的气息' }
    ]
  },
  shopkeeper: {
    id: 'shopkeeper', name: '掌柜', role: '杂货店主', icon: '🧺', shirt: '#b0743f',
    likes: ['prod.'], dislikes: ['mat.stone'],
    greet: '欢迎光临，要点什么？',
    reactions: {
      like: ['哎呀，这正是我需要的，多谢！', '好货！你真是我的贵人。', '这个我收得开心！'],
      neutral: ['谢谢惠顾，我收下了。', '嗯，不错的心意。'],
      dislike: ['这个…店里可不收这种货啊。', '咳，这东西我这儿用不上。', '石头…我这儿又不是石料铺。']
    },
    phrases: [
      { en: 'fresh goods every morning', zh: '每天早上进新货' },
      { en: 'a fair price for all', zh: '童叟无欺' },
      { en: 'come back when you need seeds', zh: '需要种子再来' },
      { en: 'business is good this season', zh: '这季生意不错' },
      { en: 'quality matters most to me', zh: '我最看重品质' }
    ]
  },
  girl: {
    id: 'girl', name: '阿晴', role: '爱花的姑娘', icon: '🌸', shirt: '#c96a8f',
    likes: ['crop.strawberry', 'mat.fiber'], dislikes: ['mat.stone'],
    greet: '嗨！今天的花开得真好。',
    reactions: {
      like: ['哇，我好喜欢！谢谢你！', '你怎么知道我想要这个～', '好开心呀！'],
      neutral: ['谢谢你的礼物。', '嗯，我会好好收着的。'],
      dislike: ['这个…我不是很需要呢。', '呜，这个我有点怕…', '硬邦邦的…我不太喜欢。']
    },
    phrases: [
      { en: 'the flowers bloom so nicely', zh: '花开得真好' },
      { en: 'i like sweet strawberries', zh: '我喜欢甜草莓' },
      { en: 'the sunset here is pretty', zh: '这里的日落很美' },
      { en: 'do you like the town', zh: '你喜欢小镇吗' },
      { en: 'let us watch the stars tonight', zh: '今晚一起看星星吧' }
    ]
  }
};

export const VILLAGER_ORDER = ['farmer', 'fisher', 'shopkeeper', 'girl'];

/* ---------------- 好感 ---------------- */

export const FRIENDSHIP_MAX = 100;
export const HEART_STEP = 20;

export function hearts(friendship: number): number {
  return Math.max(0, Math.min(5, Math.floor(friendship / HEART_STEP)));
}

export function addFriendship(v: Villager, delta: number): void {
  v.friendship = Math.max(0, Math.min(FRIENDSHIP_MAX, v.friendship + delta));
}

/** 杂货店折扣：掌柜好感 ≥3 心时种子 9 折 */
export function shopDiscount(state: GameState): number {
  const keeper = state.villagers.find((v) => v.id === 'shopkeeper');
  return keeper && hearts(keeper.friendship) >= 3 ? 0.9 : 1;
}

/* ---------------- 送礼 ---------------- */

export type GiftReaction = 'like' | 'neutral' | 'dislike';

function matches(itemId: string, patterns: string[]): boolean {
  return patterns.some((p) => (p.endsWith('.') ? itemId.startsWith(p) : itemId === p));
}

export function giftReaction(def: VillagerDef, itemId: string): GiftReaction {
  if (matches(itemId, def.likes)) return 'like';
  if (matches(itemId, def.dislikes)) return 'dislike';
  return 'neutral';
}

export const GIFT_GAIN: Record<GiftReaction, number> = { like: 15, neutral: 5, dislike: -3 };

/* ---------------- 创建与游走 ---------------- */

function townBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: TOWN_OPEN.x0 * TILE + 20,
    maxX: (TOWN_OPEN.x1 + 1) * TILE - 20,
    minY: TOWN_OPEN.y0 * TILE + 24,
    maxY: (TOWN_OPEN.y1 + 1) * TILE - 16
  };
}

export function createVillager(id: string): Villager {
  const b = townBounds();
  const x = b.minX + Math.random() * (b.maxX - b.minX);
  const y = b.minY + Math.random() * (b.maxY - b.minY);
  return {
    id, friendship: 0, talkedToday: false, giftedToday: false,
    x, y, dir: 'down', moving: false, wanderT: Math.random() * 2, tx: x, ty: y
  };
}

export function updateVillagers(state: GameState, dt: number): void {
  const b = townBounds();
  for (const v of state.villagers) {
    v.wanderT -= dt;
    const dx = v.tx - v.x;
    const dy = v.ty - v.y;
    const dist = Math.hypot(dx, dy);
    if (v.wanderT <= 0 || dist < 3) {
      if (Math.random() < 0.4) { v.tx = v.x; v.ty = v.y; }
      else {
        v.tx = b.minX + Math.random() * (b.maxX - b.minX);
        v.ty = b.minY + Math.random() * (b.maxY - b.minY);
      }
      v.wanderT = 2 + Math.random() * 4;
    }
    if (dist > 2) {
      const sp = 20;
      v.x += (dx / dist) * sp * dt;
      v.y += (dy / dist) * sp * dt;
      v.moving = true;
      v.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    } else {
      v.moving = false;
    }
    v.x = Math.max(b.minX, Math.min(b.maxX, v.x));
    v.y = Math.max(b.minY, Math.min(b.maxY, v.y));
  }
}

const DIR_VEC: Record<Dir, [number, number]> = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]
};

export function villagerNear(state: GameState, px: number, py: number, dir: Dir): Villager | null {
  const [dvx, dvy] = DIR_VEC[dir];
  const fx = px + dvx * 34;
  const fy = py + dvy * 34;
  let best: Villager | null = null;
  let bestD = 52;
  for (const v of state.villagers) {
    const d = Math.hypot(v.x - fx, v.y - fy);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

export function villagerById(state: GameState, id: string): Villager | null {
  for (const v of state.villagers) if (v.id === id) return v;
  return null;
}

export function pickPhrase(def: VillagerDef): DialoguePhrase {
  return def.phrases[Math.floor(Math.random() * def.phrases.length)];
}

/** 送礼反应台词：只给语气，不给数值 */
export function pickReaction(def: VillagerDef, reaction: GiftReaction): string {
  const lines = def.reactions[reaction];
  return lines[Math.floor(Math.random() * lines.length)];
}

/** 睡觉重置每日聊天 / 送礼次数 */
export function settleVillagersOvernight(state: GameState): void {
  for (const v of state.villagers) {
    v.talkedToday = false;
    v.giftedToday = false;
  }
}
