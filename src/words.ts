/* ============================================================
   words.ts — 词库系统
   ------------------------------------------------------------
   设计要点：
   1. 打什么词 与 做什么事 解耦。动作只声明「需要一个多难的词」。
   2. 难度 = 价值。值钱的东西要求更难的词。
   3. 难度不只看长度：重复字符、字符多样性、左右手交替都计入。
      zzzz 和 plow 一样长，但难度天差地别。
   4. 自定义词库按难度分自动归档；取词用洗牌袋，一轮内不重复。
   ============================================================ */

import type { Word } from './types';
import { storage } from './platform';

export type WordCategory = 'farm' | 'chop' | 'mine' | 'cut' | 'fish' | 'animal';

export const CATEGORY_LABEL: Record<WordCategory, string> = {
  farm: '耕作',
  chop: '砍树',
  mine: '挖矿',
  cut: '割草',
  fish: '钓鱼',
  animal: '照料'
};

/* ---------------- 难度评分 ---------------- */

/** 标准指法的左手键位 */
const LEFT_HAND = new Set('qwertasdfgzxcvb');

const scoreCache = new Map<string, number>();

/**
 * 打字难度分。以字母数为基础，再按真实手感修正：
 * - 连续重复字符：按住一个键连打，很容易 → 减分
 * - 字符多样性低：来回就那几个键 → 减分
 * - 同手连击：左手或右手连续敲，比交替慢 → 加分
 * - 罕见字母（q/z/x/j）：每个不同的罕见字母少量加分
 *
 * 校准目标：正常单词的分数 ≈ 字母数；zzzz 这类词远低于字母数。
 */
export function difficulty(word: string): number {
  const cached = scoreCache.get(word);
  if (cached != null) return cached;

  const n = word.length;
  if (n === 0) return 0;

  let s = n;

  let repeats = 0;
  for (let i = 1; i < n; i++) if (word[i] === word[i - 1]) repeats++;
  s -= repeats * 0.8;

  const unique = new Set(word).size;
  s -= (1 - unique / n) * n * 0.5;

  let sameHand = 0;
  for (let i = 1; i < n; i++) {
    if (LEFT_HAND.has(word[i - 1]) === LEFT_HAND.has(word[i])) sameHand++;
  }
  s += sameHand * 0.25;

  let rare = 0;
  for (const ch of new Set(word)) if ('qzxj'.includes(ch)) rare++;
  s += rare * 0.3;

  const result = Math.max(1, Math.round(s * 100) / 100);
  scoreCache.set(word, result);
  return result;
}

/* ---------------- 难度档 ---------------- */

export interface Band {
  /** 难度分下限（含） */
  min: number;
  /** 难度分上限（不含） */
  max: number;
  label: string;
}

export const BANDS: Band[] = [
  { min: 0, max: 3.5, label: '入门' },
  { min: 3.5, max: 4.5, label: '轻松' },
  { min: 4.5, max: 5.5, label: '中等' },
  { min: 5.5, max: 6.5, label: '进阶' },
  { min: 6.5, max: 7.5, label: '困难' },
  { min: 7.5, max: 9, label: '高手' },
  { min: 9, max: 999, label: '极限' }
];

/** 价值 → 难度档（价格越高，要打的词越难） */
export function bandForValue(value: number): number {
  if (value < 50) return 0;
  if (value < 100) return 1;
  if (value < 180) return 2;
  if (value < 300) return 3;
  if (value < 450) return 4;
  if (value < 650) return 5;
  return 6;
}

/* ---------------- 内置词库 ---------------- */

const BUILT_IN: Record<WordCategory, string[]> = {
  farm: [
    'sow', 'hoe', 'dig', 'reap', 'seed', 'grow', 'soil', 'weed', 'yield', 'grain',
    'water', 'plant', 'ripen', 'shade', 'sprout', 'bundle', 'garden', 'manure',
    'sown', 'loam', 'husk',
    'harvest', 'fertile', 'orchard', 'produce', 'blossom', 'compost', 'drizzle',
    'seedling', 'moisture', 'irrigate', 'farmland', 'sunlight', 'cultivate',
    'bountiful', 'greenhouse', 'harvesting', 'prosperous', 'agriculture', 'cultivation'
  ],
  chop: [
    'axe', 'saw', 'fell', 'hew', 'bark', 'chop', 'trunk', 'split', 'stump', 'cleave',
    'timber', 'lumber', 'branch', 'shatter', 'splinter', 'woodland', 'hardwood',
    'chainsaw', 'heartwood', 'timberline', 'lumberjack'
  ],
  mine: [
    'ore', 'dig', 'pick', 'rock', 'mine', 'deep', 'shaft', 'stone', 'geode', 'quarry',
    'tunnel', 'rubble', 'cavern', 'marble', 'boulder', 'crystal', 'granite', 'mineral',
    'magma', 'silver', 'garnet', 'quartz',
    'pickaxe', 'bedrock', 'gemstone', 'excavate', 'tunneling', 'quarrying', 'excavation'
  ],
  cut: [
    'cut', 'mow', 'snip', 'trim', 'grass', 'weed', 'shear', 'slice', 'slash', 'swath',
    'hack', 'mown',
    'prune', 'scythe', 'machete', 'thistle', 'bramble', 'thicket', 'pruning',
    'undergrowth', 'overgrowth', 'shrubbery', 'clearance', 'vegetation', 'wilderness'
  ],
  fish: [
    'tug', 'net', 'cast', 'hook', 'line', 'reel', 'bait', 'pond', 'deep', 'pull',
    'drag', 'haul', 'yank', 'land', 'float', 'shore', 'catch', 'heave', 'splash',
    'bobber', 'ripple', 'strike', 'tackle', 'battle', 'silver', 'golden', 'trophy',
    'angler', 'current', 'halibut', 'harpoon', 'mariner', 'mackerel', 'seabream',
    'undertow', 'riverbank', 'tidewater', 'fisherman', 'struggle', 'treasure', 'monster',
    'leviathan', 'whirlpool', 'anglerfish', 'monstrous'
  ],
  animal: [
    'hen', 'cow', 'egg', 'pet', 'pat', 'hay', 'feed', 'milk', 'coop', 'barn',
    'nest', 'pail', 'herd', 'calf', 'foal', 'lamb',
    'grain', 'trough', 'fodder', 'basket', 'clutch', 'dairy', 'bucket', 'stable',
    'pasture', 'feather', 'udder', 'rooster', 'heifer',
    'squeeze', 'gather', 'collect', 'scratch', 'gentle', 'stroke', 'milking',
    'livestock', 'shepherd', 'ruminant', 'milkmaid', 'henhouse'
  ]
};

/* ---------------- 自定义词库 ---------------- */

export interface CustomSet {
  id: string;
  name: string;
  bind: 'all' | WordCategory;
  words: string[];
  enabled: boolean;
}

const CUSTOM_KEY = 'typing-farm-wordsets-v1';

let customSets: CustomSet[] = [];
/** 词库变更计数：洗牌袋据此失效重建 */
let libraryVersion = 0;

function loadCustom(): void {
  try {
    const raw = storage.get(CUSTOM_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as CustomSet[];
    if (Array.isArray(data)) {
      customSets = data.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.words));
    }
  } catch {
    customSets = [];
  }
}

loadCustom();

export function getCustomSets(): CustomSet[] {
  return customSets;
}

export function persistCustom(): void {
  libraryVersion++;
  storage.set(CUSTOM_KEY, JSON.stringify(customSets));
}

export function setCustomSets(sets: CustomSet[]): void {
  customSets = sets;
  persistCustom();
}

export function upsertCustom(set: CustomSet): void {
  const i = customSets.findIndex((s) => s.id === set.id);
  if (i >= 0) customSets[i] = set;
  else customSets.push(set);
  persistCustom();
}

export function removeCustom(id: string): void {
  customSets = customSets.filter((s) => s.id !== id);
  persistCustom();
}

export function toggleCustom(id: string): void {
  const s = customSets.find((x) => x.id === id);
  if (!s) return;
  s.enabled = !s.enabled;
  persistCustom();
}

/** 清洗用户输入：只留小写字母，长度 2~14，去重 */
export function normalizeWords(text: string): string[] {
  const raw = text
    .split(/[\s,，、;；\n\r]+/)
    .map((w) => w.trim().toLowerCase().replace(/[^a-z]/g, ''))
    .filter((w) => w.length >= 2 && w.length <= 14);
  return [...new Set(raw)];
}

/* ---------------- 候选词 ---------------- */

function inBand(word: string, band: Band): boolean {
  const s = difficulty(word);
  return s >= band.min && s < band.max;
}

/** 该类别是否被自定义词库接管 */
function hasCustom(cat: WordCategory): boolean {
  return customSets.some((s) => s.enabled && s.words.length > 0 && (s.bind === 'all' || s.bind === cat));
}

function customFor(cat: WordCategory, band: Band): string[] {
  const out: string[] = [];
  for (const set of customSets) {
    if (!set.enabled) continue;
    if (set.bind !== 'all' && set.bind !== cat) continue;
    for (const w of set.words) if (inBand(w, band)) out.push(w);
  }
  return out;
}

function builtInFor(cat: WordCategory, band: Band): string[] {
  return BUILT_IN[cat].filter((w) => inBand(w, band));
}

/**
 * 取候选词。
 * 一旦有启用的自定义词库绑定到该类别，就**只用自定义词**，内置词不再掺进来。
 */
function candidates(cat: WordCategory, band: Band): string[] {
  if (hasCustom(cat)) return customFor(cat, band);
  return builtInFor(cat, band);
}

/* ---------------- 洗牌袋 + 近期避让 ---------------- */

interface Bag {
  version: number;
  words: string[];
}

const bags = new Map<string, Bag>();
/** 最近打过的词（跨动作），尽量避免短期内重复 */
const recent: string[] = [];
const RECENT_MAX = 8;

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 从某档的洗牌袋里取一个词；袋空了才重洗，保证一轮内不重复 */
function drawFromBag(cat: WordCategory, bandIndex: number, list: string[]): string {
  const key = `${cat}:${bandIndex}`;
  let bag = bags.get(key);
  if (!bag || bag.version !== libraryVersion || bag.words.length === 0) {
    bag = { version: libraryVersion, words: shuffle(list) };
    bags.set(key, bag);
  }

  // 优先取不在近期记录里的词
  let idx = bag.words.findIndex((w) => !recent.includes(w));
  if (idx < 0) idx = 0;
  const word = bag.words.splice(idx, 1)[0];

  recent.push(word);
  if (recent.length > RECENT_MAX) recent.shift();
  return word;
}

/** 按类别与难度取一个词；该档没词就向邻近档借 */
export function pickWord(cat: WordCategory, bandIndex: number): string {
  const b = Math.max(0, Math.min(BANDS.length - 1, bandIndex));

  for (let spread = 0; spread < BANDS.length; spread++) {
    for (const sign of spread === 0 ? [0] : [-1, 1]) {
      const bi = b + sign * spread;
      if (bi < 0 || bi >= BANDS.length) continue;
      const list = candidates(cat, BANDS[bi]);
      if (list.length > 0) return drawFromBag(cat, bi, list);
    }
  }

  // 兜底：该类别任何可用词
  const all = candidates(cat, { min: 0, max: 999, label: '' });
  if (all.length > 0) return drawFromBag(cat, -1, all);
  return 'farm';
}

/** 取一个带中文提示与难度分的 Word */
export function makeWord(cat: WordCategory, bandIndex: number, zh: string): Word {
  const text = pickWord(cat, bandIndex);
  return { text, zh, diff: difficulty(text) };
}

/** 取 n 个词（洗牌袋保证不重复） */
export function makeWords(cat: WordCategory, bandIndex: number, zh: string, n: number): Word[] {
  const out: Word[] = [];
  for (let i = 0; i < n; i++) out.push(makeWord(cat, bandIndex, zh));
  return out;
}

/* ---------------- 统计与预览 ---------------- */

/** 每档有多少词可用（词库界面的覆盖表） */
export function bandStats(cat: WordCategory): number[] {
  return BANDS.map((b) => candidates(cat, b).length);
}

export function totalWords(cat: WordCategory): number {
  return new Set(candidates(cat, { min: 0, max: 999, label: '' })).size;
}

/** 一组词落在各难度档的数量（保存自定义词库前的分布预览） */
export function distribution(words: string[]): number[] {
  const out = BANDS.map(() => 0);
  for (const w of words) {
    const s = difficulty(w);
    const i = BANDS.findIndex((b) => s >= b.min && s < b.max);
    if (i >= 0) out[i]++;
  }
  return out;
}
