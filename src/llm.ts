/* ============================================================
   llm.ts — NPC 对话的「受控生成」
   ------------------------------------------------------------
   这不是自由聊天。给模型的是一道**有约束的造句任务**：

     角色是谁、正在做什么、说话什么风格
     + 今天该复习的 2~3 个单词
     → 说一句不超过 12 个词的话，必须用上其中 2 个

   这样台词是活的，但**打的词仍然在玩家的学习闭环里**。

   三条硬规则：
   1. 只在 Electron 下可用（API key 在主进程，前端永远拿不到）
   2. 生成结果必须真的用上了指定词，否则丢弃、退回预置台词
   3. 一律**预生成 + 缓存**，聊天时同步取用，不能现场等网络
   ============================================================ */

import { storage } from './platform';
import type { DialoguePhrase } from './types';

/* ---------------- 桥 ---------------- */

interface LlmBridge {
  available(): boolean;
  ask(payload: { system: string; user: string }): Promise<{ ok: boolean; content?: string; error?: string }>;
  getConfig(): Promise<AiConfig>;
  setConfig(patch: Partial<AiConfig> & { apiKey?: string }): Promise<AiConfig>;
}

interface AiConfig {
  enabled: boolean;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  maxWords: number;
}

function bridge(): LlmBridge | null {
  const w = window as unknown as { __FARM_DESKTOP__?: { llm?: LlmBridge } };
  return w.__FARM_DESKTOP__?.llm ?? null;
}

/** 当前环境能不能用 AI 对话 */
export function aiSupported(): boolean {
  return !!bridge();
}

/** 主进程是否已启用并配好 key */
export function aiReady(): boolean {
  const b = bridge();
  if (!b) return false;
  try {
    return b.available();
  } catch {
    return false;
  }
}

export async function getAiConfig(): Promise<AiConfig | null> {
  const b = bridge();
  if (!b) return null;
  try {
    return await b.getConfig();
  } catch {
    return null;
  }
}

export async function setAiConfig(patch: Partial<AiConfig> & { apiKey?: string }): Promise<AiConfig | null> {
  const b = bridge();
  if (!b) return null;
  try {
    return await b.setConfig(patch);
  } catch {
    return null;
  }
}

/* ---------------- 缓存（预生成的台词） ---------------- */

const CACHE_KEY = 'typing-farm-ai-lines-v1';
const CACHE_MAX = 60;

interface CachedLine {
  en: string;
  zh: string;
  /** 第几天生成的；跨天作废 */
  day: number;
}

type CacheMap = Record<string, CachedLine>;

let cache: CacheMap = {};
let cacheLoaded = false;

function loadCache(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = storage.get(CACHE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as CacheMap;
    if (data && typeof data === 'object') cache = data;
  } catch {
    cache = {};
  }
}

function persistCache(): void {
  try {
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) {
      // 超出上限就按 day 从旧到新裁掉
      keys
        .sort((a, b) => (cache[a].day ?? 0) - (cache[b].day ?? 0))
        .slice(0, keys.length - CACHE_MAX)
        .forEach((k) => delete cache[k]);
    }
    storage.set(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* 缓存写失败不影响游戏 */
  }
}

function cacheKey(villagerId: string, day: number): string {
  return villagerId + '|' + day;
}

/** 同步取一条今天已经生成好的台词；没有就返回 null */
export function takeCachedLine(villagerId: string, day: number): DialoguePhrase | null {
  loadCache();
  const hit = cache[cacheKey(villagerId, day)];
  if (!hit || hit.day !== day) return null;
  return { en: hit.en, zh: hit.zh };
}

export function hasCachedLine(villagerId: string, day: number): boolean {
  loadCache();
  const hit = cache[cacheKey(villagerId, day)];
  return !!hit && hit.day === day;
}

export function clearAiCache(): void {
  cache = {};
  cacheLoaded = true;
  persistCache();
}

/* ---------------- 生成 ---------------- */

/** 生成时给模型的角色卡 */
export interface VillagerBrief {
  id: string;
  name: string;
  role: string;
  /** 说话风格 */
  voice: string;
  /** 口头禅 */
  catchphrase?: string;
  /** 此刻在做什么 */
  doing?: string;
  /** 季节（中文） */
  season: string;
  /** 好感（0~5 心），影响亲疏 */
  hearts: number;
}

const SYSTEM_PROMPT = [
  '你是一个像素风农牧经营游戏里的 NPC，负责说一句符合角色设定的短台词。',
  '输出必须是严格的 JSON，形如 {"en":"...","zh":"..."}，不要任何解释、不要代码块标记。',
  'en 的要求：全小写、只用空格分隔的英文单词、不要标点符号、8~12 个词。',
  'zh 的要求：en 的自然中文意思，不超过 20 个字，不要引号。',
  '内容要求：像真人随口说的一句话，可以提天气、手上的活、镇上的事；不要自我介绍，不要问玩家问题。'
].join('\n');

function buildUserPrompt(brief: VillagerBrief, words: string[]): string {
  const lines: string[] = [];
  lines.push('角色：' + brief.name + '（' + brief.role + '）');
  lines.push('说话风格：' + brief.voice);
  if (brief.catchphrase) lines.push('口头禅：' + brief.catchphrase);
  if (brief.doing) lines.push('此刻正在：' + brief.doing);
  lines.push('季节：' + brief.season);
  lines.push('和玩家的熟悉程度：' + brief.hearts + '/5 心' + (brief.hearts >= 4 ? '（说话可以随意些）' : '（还比较客气）'));
  lines.push('');
  lines.push('必须用上下面这些词中的至少 2 个（原样出现，不要变形、不要加 ed/ing/s）：');
  lines.push(words.join(', '));
  lines.push('');
  lines.push('只输出 JSON。');
  return lines.join('\n');
}

/** 从模型回复里抠出 JSON（容忍代码块、前后废话） */
function parseLine(raw: string): { en: string; zh: string } | null {
  let text = raw.trim();
  // 去掉 ```json ... ``` 包裹
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // 取第一个 {...}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { en?: unknown; zh?: unknown };
    if (typeof obj.en !== 'string' || typeof obj.zh !== 'string') return null;
    return { en: obj.en, zh: obj.zh };
  } catch {
    return null;
  }
}

/** 规范化英文：小写、去掉标点、压缩空格 */
function normalizeEn(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 校验：词数、是否真的用上了指定词 */
function validate(en: string, words: string[], maxWords: number): boolean {
  const parts = en.split(' ').filter(Boolean);
  if (parts.length < 4 || parts.length > maxWords) return false;
  const set = new Set(parts);
  const used = words.filter((w) => set.has(w)).length;
  return used >= 2;
}

/**
 * 为某个村民生成一句台词并写入缓存。
 * 失败返回 null（调用方退回预置台词，不报错、不打扰玩家）。
 */
export async function generateLine(
  brief: VillagerBrief,
  words: string[],
  day: number,
  maxWords = 12
): Promise<DialoguePhrase | null> {
  const b = bridge();
  if (!b || !b.available()) return null;
  if (words.length < 2) return null;

  const user = buildUserPrompt(brief, words.slice(0, 4));
  const res = await b.ask({ system: SYSTEM_PROMPT, user });
  if (!res.ok || !res.content) return null;

  const parsed = parseLine(res.content);
  if (!parsed) return null;

  const en = normalizeEn(parsed.en);
  if (!validate(en, words, maxWords)) return null;

  const zh = parsed.zh.replace(/["「」]/g, '').trim();
  if (!zh) return null;

  const line: CachedLine = { en, zh, day };
  cache[cacheKey(brief.id, day)] = line;
  loadCache();
  cache[cacheKey(brief.id, day)] = line;
  persistCache();
  return { en, zh };
}

/** 正在生成的村民 id，避免重复并发请求 */
const inFlight = new Set<string>();

/**
 * 预生成：玩家进入小镇/新的一天时后台跑。
 * 串行请求（并发 1），避免一次打十几个请求出去。
 */
export async function prefetchLines(
  briefs: VillagerBrief[],
  wordsFor: (brief: VillagerBrief) => string[],
  day: number,
  maxWords = 12
): Promise<number> {
  if (!aiReady()) return 0;
  let made = 0;
  for (const brief of briefs) {
    if (hasCachedLine(brief.id, day)) continue;
    if (inFlight.has(brief.id)) continue;
    inFlight.add(brief.id);
    try {
      const line = await generateLine(brief, wordsFor(brief), day, maxWords);
      if (line) made++;
    } finally {
      inFlight.delete(brief.id);
    }
  }
  return made;
}
