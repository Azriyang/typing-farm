/* ============================================================
   difficulty.ts — 全局难度
   ------------------------------------------------------------
   难度只影响「打字手感」，不影响经济收益——
   避免出现「想赚钱就必须玩难」的压迫感。
   ============================================================ */

export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface DifficultyDef {
  id: DifficultyId;
  name: string;
  icon: string;
  /** 一句话说明 */
  desc: string;
  /** 时限倍率（>1 更宽松） */
  timeMult: number;
  /** 容错加成（可负） */
  toleranceBonus: number;
  /** 词长档位偏移（负数=更短） */
  bandShift: number;
  /** 超时扣体力的比例（相对该次消耗） */
  failPenalty: number;
  /** 打错时是否清空连击 */
  comboBreakOnError: boolean;
  /** 打字时是否显示中文提示（轻松档更醒目） */
  showZhHint: boolean;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  easy: {
    id: 'easy',
    name: '轻松',
    icon: '🌱',
    desc: '时限 +70%、容错 2 次、词更短、打错不清连击',
    timeMult: 1.7,
    toleranceBonus: 2,
    bandShift: -1,
    failPenalty: 0.25,
    comboBreakOnError: false,
    showZhHint: true
  },
  normal: {
    id: 'normal',
    name: '标准',
    icon: '🌤️',
    desc: '原本的节奏：时限正常、工具等级决定容错',
    timeMult: 1.0,
    toleranceBonus: 0,
    bandShift: 0,
    failPenalty: 0.5,
    comboBreakOnError: true,
    showZhHint: true
  },
  hard: {
    id: 'hard',
    name: '挑战',
    icon: '🔥',
    desc: '时限 -15%、容错 -1、词更长、超时扣满',
    timeMult: 0.85,
    toleranceBonus: -1,
    bandShift: 1,
    failPenalty: 1.0,
    comboBreakOnError: true,
    showZhHint: false
  }
};

export const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'normal', 'hard'];

export function difficultyOf(id: DifficultyId | undefined): DifficultyDef {
  return DIFFICULTIES[id ?? 'normal'] ?? DIFFICULTIES.normal;
}

/** 把难度套用到一次打字的参数上 */
export function applyDifficulty(
  d: DifficultyDef,
  baseTolerance: number,
  baseTimeMult: number
): { tolerance: number; timeMult: number } {
  return {
    tolerance: Math.max(0, baseTolerance + d.toleranceBonus),
    timeMult: Math.max(0.3, baseTimeMult * d.timeMult)
  };
}

/** 难度对词长档位的影响 */
export function shiftBand(d: DifficultyDef, band: number, max: number): number {
  return Math.max(0, Math.min(max, band + d.bandShift));
}