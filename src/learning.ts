/* ============================================================
   learning.ts — 单词学习进度
   ------------------------------------------------------------
   核心原则（用户提出）：**照着打不算掌握**。
   所以掌握必须同时满足：
     1. 强制回忆——词的中段被挖空，必须从中文想起英文
     2. 跨天验证——同一个词在 3 个不同天各打对一次
   同一天重复打对只算 1 次，防止一口气刷满。
   ============================================================ */

import { storage } from './platform';

/** 单个词的学习状态 */
export interface WordProgress {
  /** 被打过多少次（含打错） */
  seen: number;
  /** 在多少个**不同天**打对过 */
  days: number;
  /** 最近一次打对的日期（防止同一天重复计数） */
  lastDay: number;
  /** 累计打错次数 */
  errors: number;
}

/** 掌握阈值：需要在 3 个不同天打对 */
export const MASTER_DAYS = 3;

/** 每天最多引入几个新词 */
export const DAILY_NEW_LIMIT = 12;

const KEY = 'typing-farm-learning-v1';

let progress: Record<string, WordProgress> = {};
/** 今天已经引入的新词数 */
let todayNew = 0;
/** todayNew 对应的日期 */
let todayDay = 0;

function load(): void {
  try {
    const raw = storage.get(KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as { words?: Record<string, WordProgress>; day?: number; newCount?: number };
    if (data.words && typeof data.words === 'object') progress = data.words;
    if (typeof data.day === 'number') todayDay = data.day;
    if (typeof data.newCount === 'number') todayNew = data.newCount;
  } catch {
    progress = {};
  }
}
load();

function persist(): void {
  try {
    storage.set(KEY, JSON.stringify({ words: progress, day: todayDay, newCount: todayNew }));
  } catch {
    /* 存储满了就放弃保存进度，不影响游戏 */
  }
}

/** 新的一天：重置每日配额计数 */
export function startDay(day: number): void {
  if (day === todayDay) return;
  todayDay = day;
  todayNew = 0;
  persist();
}

export function getProgress(word: string): WordProgress | undefined {
  return progress[word];
}

export function isMastered(word: string): boolean {
  const p = progress[word];
  return !!p && p.days >= MASTER_DAYS;
}

export function hasSeen(word: string): boolean {
  return !!progress[word] && progress[word].seen > 0;
}

/** 今天还能引入几个新词 */
export function remainingNewQuota(): number {
  return Math.max(0, DAILY_NEW_LIMIT - todayNew);
}

/** 记录一次「遇到」 */
export function markSeen(word: string): void {
  const p = progress[word] ?? { seen: 0, days: 0, lastDay: -1, errors: 0 };
  const isNew = p.seen === 0;
  p.seen++;
  progress[word] = p;
  if (isNew) todayNew++;
  persist();
}

/** 记录一次打对（跨天才累计） */
export function markCorrect(word: string, day: number): void {
  const p = progress[word] ?? { seen: 0, days: 0, lastDay: -1, errors: 0 };
  if (p.lastDay !== day) {
    p.days++;
    p.lastDay = day;
  }
  progress[word] = p;
  persist();
}

/** 记录一次打错 */
export function markWrong(word: string): void {
  const p = progress[word] ?? { seen: 0, days: 0, lastDay: -1, errors: 0 };
  p.errors++;
  progress[word] = p;
  persist();
}

/**
 * 这个字现在该给多少提示：
 * - 0：从没遇过 → 完整显示（学习阶段）
 * - 1~2：见过 → 只给首字母，其余挖空（回忆测试）
 * - >= MASTER_DAYS：已掌握 → 完整显示（复习时不该再卡）
 */
export function maskFor(word: string): number {
  const p = progress[word];
  if (!p || p.seen === 0) return 0;
  if (p.days >= MASTER_DAYS) return 0;
  // 挖空起点：保留首字母
  return 1;
}

/* ---------------- 统计 ---------------- */

export interface LearningStats {
  /** 已经遇到过的词数 */
  seen: number;
  /** 已掌握的词数 */
  mastered: number;
  /** 今天新引入的词数 */
  todayNew: number;
  /** 今日新词配额 */
  quota: number;
}

export function stats(): LearningStats {
  let mastered = 0;
  for (const w of Object.keys(progress)) {
    if (progress[w].days >= MASTER_DAYS) mastered++;
  }
  return {
    seen: Object.keys(progress).length,
    mastered,
    todayNew,
    quota: DAILY_NEW_LIMIT
  };
}

/** 取词时的优先级权重：天数越少越该出现 */
export function priorityOf(word: string): number {
  const p = progress[word];
  if (!p) return 0;              // 新词（受配额限制）
  if (p.days >= MASTER_DAYS) return 3; // 已掌握：少出
  return 1 + p.days * 0.5;       // 学得越少越优先
}

export function resetAll(): void {
  progress = {};
  todayNew = 0;
  todayDay = 0;
  persist();
}