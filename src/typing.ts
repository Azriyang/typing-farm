/* ============================================================
   typing.ts — 英文打字引擎
   ============================================================ */

import { CFG } from './config';
import type { Word } from './types';

export interface TypingResult {
  perfect: boolean;
  errors: number;
  durationMs: number;
}

export interface TypingHandlers {
  onComplete: (r: TypingResult) => void;
  onFail: () => void;
  onKey: (ok: boolean) => void;
}

export class TypingSession {
  words: Word[] = [];
  index = 0;
  typed = '';
  errors = 0;
  tolerance = 0;
  active = false;
  /** 当前单词的失败闪烁 */
  shakeAt = 0;

  private handlers: TypingHandlers;
  private limit = 0;
  private wordStart = 0;
  private totalStart = 0;

  constructor(handlers: TypingHandlers) {
    this.handlers = handlers;
  }

  start(words: Word[], tolerance: number, timeMult: number, now: number): void {
    this.words = words;
    this.index = 0;
    this.typed = '';
    this.errors = 0;
    this.tolerance = tolerance;
    this.active = true;
    this.totalStart = now;
    this.beginWord(now, timeMult);
  }

  private timeMult = 1;

  private beginWord(now: number, mult?: number): void {
    if (mult != null) this.timeMult = mult;
    const w = this.words[this.index];
    const len = w.text.length;
    // 时限跟着难度分走：zzzz 这种重复词给更少时间，拗口词给更多
    const diff = w.diff ?? len;
    const ratio = Math.max(0.5, Math.min(1.4, diff / Math.max(1, len)));
    this.limit = (CFG.TIME_BASE + CFG.TIME_PER_CHAR * len * ratio) * this.timeMult;
    this.wordStart = now;
    this.typed = '';
  }

  get currentWord(): Word | null {
    return this.active ? this.words[this.index] ?? null : null;
  }

  get remaining(): number {
    const elapsed = performance.now() - this.wordStart;
    return Math.max(0, this.limit - elapsed);
  }

  get progress(): number {
    return this.limit <= 0 ? 0 : Math.max(0, Math.min(1, this.remaining / this.limit));
  }

  get chainDone(): number {
    return this.index;
  }

  get chainTotal(): number {
    return this.words.length;
  }

  /** 处理一次按键，返回是否消耗了该按键 */
  handleKey(key: string, now: number): boolean {
    if (!this.active) return false;
    const word = this.currentWord;
    if (!word) return false;

    if (key.length !== 1) return false;
    const ch = key.toLowerCase();
    if (!/[a-z ]/.test(ch)) return false;

    const expected = word.text[this.typed.length];
    if (expected == null) return false;

    if (ch === expected) {
      this.typed += ch;
      this.handlers.onKey(true);
      if (this.typed.length >= word.text.length) {
        this.index++;
        if (this.index >= this.words.length) {
          this.finish(now);
        } else {
          this.beginWord(now);
        }
      }
      return true;
    }

    // 打错
    this.errors++;
    this.shakeAt = now;
    this.handlers.onKey(false);
    return true;
  }

  private finish(now: number): void {
    this.active = false;
    this.handlers.onComplete({
      perfect: this.errors <= this.tolerance,
      errors: this.errors,
      durationMs: now - this.totalStart
    });
  }

  /** 每帧调用：检查超时 */
  update(now: number): void {
    if (!this.active) return;
    if (now - this.wordStart > this.limit) {
      this.active = false;
      this.handlers.onFail();
    }
  }

  cancel(): void {
    this.active = false;
  }
}
