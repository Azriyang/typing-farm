/* ============================================================
   relics.ts — 爷爷的遗物
   ------------------------------------------------------------
   4 段回忆，按天数依次解锁。作用不是"给奖励"，
   而是回答一个根本问题：**你为什么会在这里。**

   写作原则：
   - 克制。不煽情，不解释太多。
   - 每段只给一个具体物件 + 一两句原话。
   - 让玩家自己补完情感，而不是被喂。
   ============================================================ */

export interface Relic {
  id: string;
  /** 物件名 */
  name: string;
  /** 图标 */
  icon: string;
  /** 第几天解锁 */
  unlockDay: number;
  /** 正文（按段落） */
  lines: string[];
}

export const RELICS: Relic[] = [
  {
    id: 'letter',
    name: '一封信',
    icon: '✉️',
    unlockDay: 1,
    lines: [
      '信封上没有邮票，只有一行字：交给来收这块地的人。',
      '「你来了，说明我走了。这块地我种了四十年，不富，但饿不着人。',
      '　别急着卖。先住满一年。一年之后你还想走，我不拦你。」',
      '落款是爷爷的名字，笔画有点抖。'
    ]
  },
  {
    id: 'photo',
    name: '一张旧照片',
    icon: '📷',
    unlockDay: 9,
    lines: [
      '照片边角已经卷了。上面是个年轻人，扛着锄头站在田埂上，笑得有点傻。',
      '背面用铅笔写着一行字：「第一年。收成不好，但总算活下来了。」',
      '你算了算年份——爷爷那年，大概和你现在一样大。'
    ]
  },
  {
    id: 'hoe',
    name: '一把旧锄头',
    icon: '🔨',
    unlockDay: 17,
    lines: [
      '锄头磨得只剩半截，木柄上缠着发黑的布条。',
      '布条缝里塞着一张小纸条：「手上有茧，心里才踏实。」',
      '你握住它——柄上有一处凹陷，正好卡进你的掌心。',
      '那是他握了几十年的位置。'
    ]
  },
  {
    id: 'ledger',
    name: '一本记账本',
    icon: '📒',
    unlockDay: 25,
    lines: [
      '本子是四年前停下的。最后一页写着：',
      '「今年雨水少，收成只有往年一半。还是留了一袋种子给明年。」',
      '后面全是空白。你翻到封底内侧，发现一行潦草的字，像是随手划上的：',
      '「地不会骗人。你对它好，它就记着。」',
      '',
      '……这句话你在镇上听过。阿茂也这么说。'
    ]
  }
];

export function relicById(id: string): Relic | null {
  return RELICS.find((r) => r.id === id) ?? null;
}

/** 到这一天为止应该解锁哪些 */
export function unlockedRelics(day: number): Relic[] {
  return RELICS.filter((r) => day >= r.unlockDay);
}

/** 新解锁的那一件（用于提示）；没有则返回 null */
export function newlyUnlocked(day: number, known: string[]): Relic | null {
  for (const r of RELICS) {
    if (r.unlockDay === day && !known.includes(r.id)) return r;
  }
  return null;
}