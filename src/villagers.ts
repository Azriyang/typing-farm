/* ============================================================
   villagers.ts — 村民：定义、台词、游走、好感、送礼偏好
   ------------------------------------------------------------
   小镇补上社交维度。对话 = 打字：打出村民说的话涨好感。
   好感解锁更暖的对话与杂货店折扣；送礼投其所好涨得更快。
   ============================================================ */

import type { Villager, DialoguePhrase, Dir, GameState, Season, Weather } from './types';
import { TILE, TOWN_OPEN, MAP_W, MAP_H, isBlockedTile } from './world';
import { findPath, simplifyPath } from './pathfind';
import { seasonOfDay } from './seasons';

/* ============================================================
   日程：NPC 自己的一天
   ------------------------------------------------------------
   不做寻路，只做「朝目标点走 + 到了就待着」。
   目标是玩家能感知的「有生活」，不是「聪明」。
   ============================================================ */

/** 一个可去的地点（tile 坐标） */
export interface Spot {
  tx: number;
  ty: number;
  /** 到达判定半径（tile） */
  radius: number;
}

/** 全天可去的地点表 */
export const SPOTS = {
  /** 小镇西口的自家菜地，阿茂在这儿忙 */
  farmEdge: { tx: 35, ty: 11, radius: 2 },
  /** 小镇河边，小渔钓鱼 */
  pondBank: { tx: 48, ty: 18, radius: 1.6 },
  /** 小镇广场 */
  plaza: { tx: 52, ty: 11, radius: 3 },
  /** 酒馆门口 */
  tavernFront: { tx: 40, ty: 6, radius: 1.4 },
  /** 铁匠铺门口 */
  smithFront: { tx: 45, ty: 6, radius: 1.4 },
  /** 诊所门口 */
  clinicFront: { tx: 49, ty: 6, radius: 1.4 },
  /** 学堂门口 */
  schoolFront: { tx: 54, ty: 6, radius: 1.4 },
  /** 钟楼下 */
  towerFoot: { tx: 59, ty: 6, radius: 1.2 },
  /** 杂货店门口 */
  shopFront: { tx: 36, ty: 6, radius: 1.4 },
  /** 镇口，进出小镇的路 */
  townGate: { tx: 34, ty: 9, radius: 1.6 },
  /** 屋檐下（雨天避雨） */
  underRoof: { tx: 36, ty: 6, radius: 1.0 }
} as const;

/** 按季节变化的「花最多的地方」——阿晴会追着花走 */
export function flowerSpot(season: Season): Spot {
  switch (season) {
    case 'spring': return { tx: 36, ty: 10, radius: 1.6 };   // 镇西花圃
    case 'summer': return { tx: 60, ty: 10, radius: 1.5 };   // 广场东侧
    case 'autumn': return { tx: 63, ty: 12, radius: 1.8 };
    default: return SPOTS.townGate;                          // 冬天没花，去镇口
  }
}

export interface ScheduleEntry {
  /** 起始分钟（含） */
  from: number;
  /** 结束分钟（不含） */
  to: number;
  /** 目标地点；函数形式用于随季节变化的地点 */
  spot: Spot | ((season: Season) => Spot);
  /** 只在特定天气生效（不填 = 任何天气） */
  onlyWeather?: Weather;
  /** 只在特定季节生效 */
  onlySeason?: Season;
  /** 待着时做的事（只用于提示，不影响逻辑） */
  doing: string;
}

/**
 * 解析某个 NPC 在此刻该去哪、做什么。
 * 按顺序取**第一条满足条件**的日程——所以「雨天」这类特殊条目要写在前面。
 * 返回 null 表示这个时间他不出门（在家）。
 */
export function resolveSchedule(
  def: VillagerDef,
  time: number,
  weather: Weather,
  season: Season
): { spot: Spot; doing: string } | null {
  for (const e of def.schedule ?? []) {
    if (time < e.from || time >= e.to) continue;
    if (e.onlyWeather && e.onlyWeather !== weather) continue;
    if (e.onlySeason && e.onlySeason !== season) continue;
    const spot = typeof e.spot === 'function' ? e.spot(season) : e.spot;
    return { spot, doing: e.doing };
  }
  return null;
}

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
  /** 一天的日程；不在任何条目覆盖的时间里就不出门 */
  schedule?: ScheduleEntry[];
  /** 生日（一年 32 天里的第几天） */
  birthday: number;
  /** 生日当天的招呼语 */
  birthdayLine: string;
  /** 生日当天聊天要打的英文 */
  birthdayPhrase: DialoguePhrase;
}

export const VILLAGER_DEFS: Record<string, VillagerDef> = {
  farmer: {
    id: 'farmer', name: '阿茂', role: '老农', icon: '🧑‍🌾', shirt: '#7a9a4e',
    likes: ['crop.'], dislikes: ['fish.'],
    greet: '哟，来帮我看看庄稼？',
    birthday: 5,
    birthdayLine: '生日？……我自个儿都忘了。你有心了。',
    birthdayPhrase: { en: 'you remembered my birthday', zh: '你记得我的生日' },
    reactions: {
      like: ['哈哈，好庄稼人就该懂这些！', '嗯，这东西实在，我喜欢。', '到底是土地里出来的，好啊！'],
      neutral: ['哦，谢谢你了。', '嗯，收下了。'],
      dislike: ['唉，我这把年纪可弄不来这个。', '这…我留着也没用啊。', '鱼腥味…我可不碰。']
    },
    schedule: [
      { from: 360, to: 720, spot: SPOTS.farmEdge, doing: '锄自己的小菜地' },
      { from: 720, to: 840, spot: SPOTS.plaza, doing: '吃午饭' },
      { from: 840, to: 1080, spot: SPOTS.farmEdge, doing: '翻土' },
      { from: 1080, to: 1320, spot: SPOTS.plaza, doing: '和人聊天' }
    ],
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
    birthday: 13,
    birthdayLine: '哈，你还记得！晚上我请你吃鱼。',
    birthdayPhrase: { en: 'thanks for remembering me', zh: '谢谢你记得我' },
    reactions: {
      like: ['哈！你懂我！', '这可是好东西，谢啦！', '水里来的，我最爱！'],
      neutral: ['谢了，朋友。', '嗯，我收下了。'],
      dislike: ['这玩意儿…我还是更想要鱼。', '咳，这个我不太在行。', '木头…我可不拿它下钩。']
    },
    schedule: [
      { from: 360, to: 1320, spot: SPOTS.underRoof, onlyWeather: 'rain', doing: '避雨' },
      { from: 360, to: 1120, spot: SPOTS.pondBank, doing: '在河边钓鱼' },
      { from: 1120, to: 1320, spot: SPOTS.plaza, doing: '收拾渔具' }
    ],
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
    birthday: 21,
    birthdayLine: '记得我生日的人不多。这份心意我收下了。',
    birthdayPhrase: { en: 'few people remember my birthday', zh: '记得我生日的人不多' },
    reactions: {
      like: ['哎呀，这正是我需要的，多谢！', '好货！你真是我的贵人。', '这个我收得开心！'],
      neutral: ['谢谢惠顾，我收下了。', '嗯，不错的心意。'],
      dislike: ['这个…店里可不收这种货啊。', '咳，这东西我这儿用不上。', '石头…我这儿又不是石料铺。']
    },
    schedule: [
      { from: 480, to: 1200, spot: SPOTS.shopFront, doing: '看店' },
      { from: 1200, to: 1320, spot: SPOTS.plaza, doing: '打烊散步' }
    ],
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
    likes: ['crop.strawberry', 'mat.fiber', 'flower.'], dislikes: ['mat.stone'],
    greet: '嗨！今天的花开得真好。',
    birthday: 29,
    birthdayLine: '你记得呀！我今天特别开心～',
    birthdayPhrase: { en: 'you know it is my birthday', zh: '你知道今天是我生日' },
    reactions: {
      like: ['哇，我好喜欢！谢谢你！', '你怎么知道我想要这个～', '好开心呀！'],
      neutral: ['谢谢你的礼物。', '嗯，我会好好收着的。'],
      dislike: ['这个…我不是很需要呢。', '呜，这个我有点怕…', '硬邦邦的…我不太喜欢。']
    },
    schedule: [
      // 雨天 / 雪天不出去看花
      { from: 360, to: 1320, spot: SPOTS.underRoof, onlyWeather: 'rain', doing: '躲雨' },
      { from: 360, to: 1320, spot: SPOTS.underRoof, onlyWeather: 'snow', doing: '躲雪' },
      // 上午去当季花开得最好的地方
      { from: 360, to: 720, spot: (s: Season) => flowerSpot(s), doing: '看花' },
      { from: 720, to: 1080, spot: SPOTS.plaza, doing: '和人聊天' },
      { from: 1080, to: 1320, spot: SPOTS.plaza, doing: '看日落' }
    ],
    phrases: [
      { en: 'the flowers bloom so nicely', zh: '花开得真好' },
      { en: 'i like sweet strawberries', zh: '我喜欢甜草莓' },
      { en: 'the sunset here is pretty', zh: '这里的日落很美' },
      { en: 'do you like the town', zh: '你喜欢小镇吗' },
      { en: 'let us watch the stars tonight', zh: '今晚一起看星星吧' }
    ]
  },

  /* ================= 新镇民 ================= */

  tavern: {
    id: 'tavern', name: '阿梅', role: '酒馆老板娘', icon: '🍺', shirt: '#c9703f',
    likes: ['food.', 'prod.egg'], dislikes: ['mat.stone'],
    greet: '来啦？坐，今天有热汤。',
    birthday: 3,
    birthdayLine: '哟，还知道我今天生日？快坐下，我请你一杯。',
    birthdayPhrase: { en: 'you came to my birthday', zh: '你来给我过生日' },
    reactions: {
      like: ['这东西经我的手，能变成好菜！', '哎呀，你懂我口味。', '收下了，回头给你留个座。'],
      neutral: ['谢啦，我拿去切切看。', '嗯，有用的东西。'],
      dislike: ['这个…我厨房里放不下。', '唉，我这只懂吃的。']
    },
    schedule: [
      { from: 480, to: 1260, spot: SPOTS.tavernFront, doing: '招呼客人' },
      { from: 1260, to: 1320, spot: SPOTS.plaza, doing: '收摊' }
    ],
    phrases: [
      { en: 'the soup is hot today', zh: '今天的汤是热的' },
      { en: 'everyone eats here at noon', zh: '中午大家都来这儿吃' },
      { en: 'a warm meal fixes most things', zh: '一顿热饭能解决大部分事' },
      { en: 'i hear everything in this town', zh: '这镇上什么事我都听得见' },
      { en: 'sit down and rest a while', zh: '坐下歇会儿吧' }
    ]
  },

  smith: {
    id: 'smith', name: '老周', role: '铁匠', icon: '🔨', shirt: '#5a5a5a',
    likes: ['mat.iron', 'mat.copper', 'mat.gem'], dislikes: ['flower.'],
    greet: '东西放那儿。烫。',
    birthday: 11,
    birthdayLine: '……今天？唔。反正炉子不能停。',
    birthdayPhrase: { en: 'you know my birthday', zh: '你知道我的生日' },
    reactions: {
      like: ['好料。能用。', '嗯，这个我熔得动。', '……谢了。'],
      neutral: ['放着吧。', '哦。'],
      dislike: ['我用不上这个。', '拿回去。']
    },
    schedule: [
      { from: 480, to: 1140, spot: SPOTS.smithFront, doing: '打铁' },
      { from: 1140, to: 1320, spot: SPOTS.plaza, doing: '收炉' }
    ],
    phrases: [
      { en: 'the fire must not go out', zh: '炉火不能断' },
      { en: 'good ore makes good tools', zh: '好矿出好工具' },
      { en: 'metal remembers every blow', zh: '金属记得每一下敲打' },
      { en: 'bring me ore and i will work', zh: '拿矿来，我就开工' }
    ]
  },

  doctor: {
    id: 'doctor', name: '小林', role: '医生', icon: '💊', shirt: '#e8eef0',
    likes: ['flower.', 'crop.spinach'], dislikes: ['food.friedegg'],
    greet: '脸色不太好哦。有好好吃饭吗？',
    birthday: 19,
    birthdayLine: '哎呀，被病人记住生日，这可真是……谢谢。',
    birthdayPhrase: { en: 'i did not expect this', zh: '我没想到会这样' },
    reactions: {
      like: ['这个对身体好，我收下了。', '谢谢，我会用在诊室里。', '你很有心，记得自己也吃点好的。'],
      neutral: ['谢谢。放这儿吧。', '嗯，我记下了。'],
      dislike: ['这个…不太健康呢。', '少吃点这类东西哦。']
    },
    schedule: [
      { from: 540, to: 1020, spot: SPOTS.clinicFront, doing: '看诊' },
      { from: 1020, to: 1320, spot: SPOTS.plaza, doing: '散步' }
    ],
    phrases: [
      { en: 'sleep well and eat well', zh: '睡好，吃好' },
      { en: 'do not work until you drop', zh: '别干到倒下' },
      { en: 'a walk helps more than medicine', zh: '散步比吃药管用' },
      { en: 'rest is part of the work', zh: '休息也是干活的一部分' }
    ]
  },

  kid: {
    id: 'kid', name: '小满', role: '镇上的小孩', icon: '🎈', shirt: '#e8c84a',
    likes: ['crop.strawberry', 'craft.jam', 'flower.'], dislikes: ['mat.stone'],
    greet: '哇！你是农场来的吗？你家有牛吗！',
    birthday: 7,
    birthdayLine: '你居然记得！大人都不记得！',
    birthdayPhrase: { en: 'nobody else remembered', zh: '别人都不记得' },
    reactions: {
      like: ['哇啊啊！给我的吗！', '我要拿给阿晴看！', '好好好，你最好了！'],
      neutral: ['哦…谢谢。', '嗯，我收着。'],
      dislike: ['这个不好玩。', '唔…我不要。']
    },
    schedule: [
      { from: 360, to: 540, spot: SPOTS.plaza, doing: '跑来跑去' },
      { from: 540, to: 900, spot: SPOTS.schoolFront, doing: '上课' },
      { from: 900, to: 1320, spot: SPOTS.plaza, doing: '玩' }
    ],
    phrases: [
      { en: 'do you have cows', zh: '你有牛吗' },
      { en: 'i want to be a farmer too', zh: '我也想当农夫' },
      { en: 'the fountain is cold in winter', zh: '冬天的喷泉好冷' },
      { en: 'grandpa han tells good stories', zh: '韩爷爷会讲故事' }
    ]
  },

  teacher: {
    id: 'teacher', name: '老韩', role: '退休教师', icon: '📖', shirt: '#6b5a44',
    likes: ['flower.', 'crop.pumpkin'], dislikes: ['food.ketchup'],
    greet: '哦，年轻人。今天认了几个字？',
    birthday: 23,
    birthdayLine: '教了一辈子书，倒很少被人记住生日。多谢。',
    birthdayPhrase: { en: 'a teacher is rarely remembered', zh: '老师很少被记得' },
    reactions: {
      like: ['好东西。知识之树结的果。', '这个我收下，用来讲课正好。', '你有心，胜过许多学生。'],
      neutral: ['嗯，收下了。', '多谢。'],
      dislike: ['这个…用处不大。', '不必了，谢谢。']
    },
    schedule: [
      { from: 480, to: 780, spot: SPOTS.schoolFront, doing: '讲课' },
      { from: 780, to: 1320, spot: SPOTS.plaza, doing: '晒太阳读书' }
    ],
    phrases: [
      { en: 'words are seeds too', zh: '词语也是种子' },
      { en: 'read a little every day', zh: '每天读一点' },
      { en: 'a word learned is a field planted', zh: '学会一个词，就像种下一块地' },
      { en: 'your grandfather read poorly', zh: '你爷爷识字不多' }
    ]
  },

  traveler: {
    id: 'traveler', name: '阿岚', role: '旅人', icon: '🎨', shirt: '#4a9a9a',
    likes: ['flower.', 'fish.'], dislikes: ['mat.wood'],
    greet: '这地方的光很好。我可能会多待几天。',
    birthday: 31,
    birthdayLine: '生日？在路上的人不太过这个。不过……谢谢。',
    birthdayPhrase: { en: 'i stopped counting long ago', zh: '我早就不数了' },
    reactions: {
      like: ['这个颜色我喜欢。', '好，收进我的行囊。', '谢谢，我会画下它。'],
      neutral: ['谢了，路上能用到。', '嗯，收下了。'],
      dislike: ['太重了，背不动。', '这个我用不上。']
    },
    schedule: [
      { from: 360, to: 600, spot: SPOTS.towerFoot, doing: '画钟楼' },
      { from: 600, to: 1080, spot: SPOTS.plaza, doing: '写生' },
      { from: 1080, to: 1320, spot: SPOTS.towerFoot, doing: '看夕阳' }
    ],
    phrases: [
      { en: 'i have been to many towns', zh: '我去过很多小镇' },
      { en: 'this light is good today', zh: '今天的光很好' },
      { en: 'every town forgets slowly', zh: '每个镇子都在慢慢被忘记' },
      { en: 'people here still stay', zh: '这里的人还留得住' }
    ]
  }
};

export const VILLAGER_ORDER = ['farmer', 'fisher', 'shopkeeper', 'girl', 'tavern', 'smith', 'doctor', 'kid', 'teacher', 'traveler'];

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

/**
 * 花卉是社交筹码：即使不算「喜欢」，好感也给得更多。
 * 花卖不了几个钱，种它就是为了送人。
 */
export const FLOWER_GIFT_BONUS = 5;

export function isFlowerItem(itemId: string): boolean {
  return itemId.startsWith('flower.');
}

/** 这件礼物实际加多少好感 */
export function giftGain(def: VillagerDef, itemId: string, day?: number): number {
  const reaction = giftReaction(def, itemId);
  const base = GIFT_GAIN[reaction];
  let gain = reaction !== 'dislike' && isFlowerItem(itemId) ? base + FLOWER_GIFT_BONUS : base;
  // 生日当天翻倍——送礼要挑日子
  if (day !== undefined && reaction !== 'dislike' && isBirthdayToday(def.id, day)) {
    gain *= BIRTHDAY_GIFT_MULT;
  }
  return gain;
}

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
    x, y, dir: 'down', moving: false, wanderT: Math.random() * 2, tx: x, ty: y,
    active: false
  };
}

/**
 * 按日程驱动 NPC 的一天。
 * 不做寻路——只朝目标点直线走，走不动就换个方向蹭一下。
 * 目的是让人「有生活」，不是让人「聪明」。
 */
export function updateVillagers(state: GameState, dt: number): void {
  const season = seasonOfDay(state.day);

  for (const v of state.villagers) {
    const def = VILLAGER_DEFS[v.id];
    if (!def) continue;

    const plan = resolveSchedule(def, state.time, state.weather, season);

    // 这个时间不出门 —— 藏起来，也不可交互
    if (!plan) {
      v.active = false;
      v.moving = false;
      continue;
    }

    const spotKey = plan.spot.tx + ',' + plan.spot.ty;
    const goalX = plan.spot.tx * TILE + TILE / 2;
    const goalY = plan.spot.ty * TILE + TILE / 2;
    const farFromGoal = Math.hypot(goalX - v.x, goalY - v.y);

    // 刚从家里出来，或换了目的地而且很远 → 直接到场（视为「从别处赶来」）
    // 近距离则用 A* 真走过去，所以能绕开池塘、房屋、围栏
    if (!v.active || (v.spotKey !== spotKey && farFromGoal > 320)) {
      const sp = plan.spot;
      v.x = sp.tx * TILE + TILE / 2 + (Math.random() - 0.5) * TILE * 1.2;
      v.y = sp.ty * TILE + TILE / 2 + (Math.random() - 0.5) * TILE * 1.2;
      v.tx = v.x;
      v.ty = v.y;
      v.lookT = 0;
      v.path = null;
    }

    // 目标变了 → 重新算路
    if (v.spotKey !== spotKey || !v.path) {
      const fromTileX = Math.floor(v.x / TILE);
      const fromTileY = Math.floor(v.y / TILE);
      const raw = findPath(fromTileX, fromTileY, plan.spot.tx, plan.spot.ty, (tx, ty) => !isBlockedTile(tx, ty));
      v.path = raw ? simplifyPath(raw) : null;
    }
    v.spotKey = spotKey;
    v.active = true;
    v.doing = plan.doing;

    const dist = Math.hypot(goalX - v.x, goalY - v.y);
    const arrived = dist <= plan.spot.radius * TILE;

    if (arrived) {
      // 到了：站定，偶尔环顾四周
      v.moving = false;
      v.path = null;
      v.lookT = (v.lookT ?? 0) - dt;
      if (v.lookT <= 0) {
        const dirs: Dir[] = ['down', 'left', 'right', 'up'];
        v.dir = dirs[Math.floor(Math.random() * dirs.length)];
        v.lookT = 2.5 + Math.random() * 3;
      }
      // 轻微调整站位，免得一直站在同一个像素
      if (Math.random() < 0.004) {
        v.x += (Math.random() - 0.5) * 20;
        v.y += (Math.random() - 0.5) * 16;
      }
    } else if (v.path && v.path.length > 0) {
      // 沿 A* 路径走
      const next = v.path[0];
      const wx = next.tx * TILE + TILE / 2;
      const wy = next.ty * TILE + TILE / 2;
      const ndx = wx - v.x;
      const ndy = wy - v.y;
      const nd = Math.hypot(ndx, ndy);
      if (nd < 4) {
        v.path.shift();
      } else {
        const sp = 42;
        const step = Math.min(nd, sp * dt);
        v.x += (ndx / nd) * step;
        v.y += (ndy / nd) * step;
        v.moving = true;
        v.dir = Math.abs(ndx) > Math.abs(ndy) ? (ndx > 0 ? 'right' : 'left') : (ndy > 0 ? 'down' : 'up');
      }
    } else {
      // 没算出路径（被围住）→ 原地待着，别乱蹭
      v.moving = false;
    }

    // 兜底：别跑出地图
    v.x = Math.max(20, Math.min(MAP_W * TILE - 20, v.x));
    v.y = Math.max(20, Math.min(MAP_H * TILE - 20, v.y));
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
    if (v.active === false) continue;
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

/* ---------------- 生日 ---------------- */

/** 今天是谁的生日（按一年 32 天循环） */
export function birthdayVillager(day: number): VillagerDef | null {
  const d = ((day - 1) % 32) + 1;
  for (const id of VILLAGER_ORDER) {
    const def = VILLAGER_DEFS[id];
    if (def && def.birthday === d) return def;
  }
  return null;
}

/** 某个村民今天过不过生日 */
export function isBirthdayToday(villagerId: string, day: number): boolean {
  const def = VILLAGER_DEFS[villagerId];
  if (!def) return false;
  return def.birthday === ((day - 1) % 32) + 1;
}

/** 聊天的台词：生日优先用生日那句 */
export function pickChatPhrase(def: VillagerDef, day: number): DialoguePhrase {
  if (isBirthdayToday(def.id, day)) return def.birthdayPhrase;
  return pickPhrase(def);
}

/** 生日当天送礼的好感倍率 */
export const BIRTHDAY_GIFT_MULT = 2;

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
