/* ============================================================
   romance.ts — 恋爱线（两个可攻略角色）
   ------------------------------------------------------------
   阿晴：温柔、含蓄、话里有留白
   阿梅：爽快、直接、自嘲里带真心

   结构：3 个好感事件 → 告白。
   每个事件都是一次「听她说 → 打一句关键的话」，
   保持打字玩法不变，不另开系统。
   ============================================================ */

export interface RomanceEvent {
  /** 需要几颗心才能触发 */
  hearts: number;
  /** 玩家的引子（面板上显示） */
  intro: string[];
  /** 要打的那句话 */
  say: { en: string; zh: string };
  /** 打完对方说的话 */
  outro: string[];
}

export interface RomanceLine {
  /** 告白时她要打的那句 */
  confess: { en: string; zh: string };
  /** 告白成功后的回应 */
  accept: string[];
  /** 关系确立后，日常聊天的开场白 */
  after: string;
}

export interface RomanceScript {
  events: RomanceEvent[];
  love: RomanceLine;
}

export const ROMANCE: Record<string, RomanceScript> = {
  /* ================= 阿晴 ================= */
  girl: {
    events: [
      {
        hearts: 2,
        intro: [
          '她蹲在花田边，手指碰着一朵还没开的花苞。',
          '「我小时候，这一片全都是花。」',
          '「后来没人种了，就只剩下这一小丛。」',
          '她抬头看你，好像有点不好意思。'
        ],
        say: { en: 'i can help you plant more', zh: '我可以帮你多种一些' },
        outro: [
          '她愣了一下，然后笑起来，眼睛弯成一条线。',
          '「……你说真的？」',
          '「那我明天就来帮忙。」'
        ]
      },
      {
        hearts: 3,
        intro: [
          '傍晚的广场上，她在看天。',
          '「你说，为什么大家都往城里去呢。」',
          '「我有个朋友，去年也走了。她说这里没有未来。」',
          '她没有看你，声音很轻。'
        ],
        say: { en: 'i am not going anywhere', zh: '我不会走的' },
        outro: [
          '她转过头，看了你很久。',
          '「……嗯。」',
          '「那就好。」',
          '她没再说别的，但也没有走开。'
        ]
      },
      {
        hearts: 4,
        intro: [
          '下雨了，你们躲在屋檐下。',
          '「其实我也想过走的。」她说。',
          '「车票都买好了。走到车站，又回来了。」',
          '「我也不知道为什么。」',
          '雨声很大，她的声音很小。'
        ],
        say: { en: 'i am glad you came back', zh: '我很高兴你回来了' },
        outro: [
          '她抬起头，眼睛里映着雨光。',
          '「……你这个人啊。」',
          '她往你这边靠了一点，肩膀碰到了。',
          '两个人都没动。'
        ]
      }
    ],
    love: {
      confess: { en: 'i want to stay with you', zh: '我想和你在一起' },
      accept: [
        '她的脸一下子红了，比春天的花还红。',
        '「……你、你说话算话。」',
        '「我等这句话，等了很久了。」'
      ],
      after: '她看见你，脚步都会轻快一点。'
    }
  },

  /* ================= 阿梅 ================= */
  tavern: {
    events: [
      {
        hearts: 2,
        intro: [
          '打烊了，她把最后一张椅子翻到桌上。',
          '「一个人撑这家店，六年了。」',
          '「锅要刷、账要记、酒要进——全都是我。」',
          '她抹了把额头，笑了一下。',
          '「听着挺惨的是吧？其实也还好。」'
        ],
        say: { en: 'you are not alone now', zh: '现在你不是一个人了' },
        outro: [
          '她手上的动作停了一下。',
          '「……你这话说得。」',
          '「行吧，那明天的碗你洗。」',
          '她背过身去，但耳朵有点红。'
        ]
      },
      {
        hearts: 3,
        intro: [
          '她给你倒了杯不太烈的酒，自己也倒了一杯。',
          '「以前这条街上有七家店。」',
          '「现在还剩几家？我、杂货店、铁匠铺……没了。」',
          '「人走了，店就关了。店关了，人走得更快。」',
          '她一口喝完。'
        ],
        say: { en: 'this town still has hope', zh: '这个镇子还有希望' },
        outro: [
          '她盯着空杯子看了很久。',
          '「希望啊。」',
          '「行，那我就再撑几年，看看你说的希望长什么样。」'
        ]
      },
      {
        hearts: 4,
        intro: [
          '今天她喝得比平时多。',
          '「我跟你说个事，你别笑我。」',
          '「我二十五岁那年，行李都收拾好了，准备去城里开个小馆子。」',
          '「走到镇口，回头看了一眼。」',
          '「看见我爹留下的那块招牌，就回来了。」',
          '「你说我是不是很傻。」'
        ],
        say: { en: 'that was not silly at all', zh: '这一点也不傻' },
        outro: [
          '她愣了很久，然后用力揉了揉眼睛。',
          '「……酒太冲了。」',
          '「你别看了，去把窗关上。」',
          '你没动。她也没再催。'
        ]
      }
    ],
    love: {
      confess: { en: 'i want to spend my life here', zh: '我想把余生留在这里' },
      accept: [
        '她放下手里的杯子，很认真地看你。',
        '「你可想好了。我这人不好伺候，脾气也差。」',
        '「而且——」她顿了顿，声音低下去，',
        '「而且我会当真的。」'
      ],
      after: '她开始给你留靠窗的那个位子。'
    }
  }
};

/** 这个村民能不能攻略 */
export function isRomanceable(id: string): boolean {
  return !!ROMANCE[id];
}

/** 某个好感进度下，下一个该看的事件（没有就返回 null） */
export function nextEvent(id: string, hearts: number, seen: number): RomanceEvent | null {
  const script = ROMANCE[id];
  if (!script) return null;
  const idx = seen;
  if (idx >= script.events.length) return null;
  const e = script.events[idx];
  return hearts >= e.hearts ? e : null;
}

/** 能否告白：3 个事件都看完 */
export function canConfess(id: string, hearts: number, seen: number): boolean {
  const script = ROMANCE[id];
  if (!script) return false;
  return hearts >= 5 && seen >= script.events.length;
}