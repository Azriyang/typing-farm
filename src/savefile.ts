/* ============================================================
   savefile.ts — 存档的导出与导入
   ------------------------------------------------------------
   为什么要这个：
     网页版的存档在玩家自己的 localStorage 里，按域名隔离。
     换浏览器、清缓存、Safari 七天没访问，都会丢档。
     而且开发时看不到朋友的存档，出 bug 只能靠他描述。

   所以给一份可以带走、可以发出去的 .json。

   格式：
     {
       "format": "typing-farm-save",
       "formatVersion": 1,
       "gameVersion": "0.1.0",
       "exportedAt": "2025-11-25T...",
       "keys": { "typing-farm-save-v1": "<原始 JSON 字符串>", ... }
     }

   刻意把每个 key 的值存成**字符串**（原样搬运），
   这样导入时不需要理解内容结构，游戏自己的 normalizeState 会做迁移。
   ============================================================ */

import { storage } from './platform';
import { CFG } from './config';
import { LEARNING_KEY } from './learning';

const FORMAT = 'typing-farm-save';
const FORMAT_VERSION = 1;

/** 需要一起搬走的 key。AI 台词缓存不导出——它每天都会重新生成。 */
const KEYS = [CFG.SAVE_KEY, LEARNING_KEY];

export interface SaveBundle {
  format: string;
  formatVersion: number;
  gameVersion: string;
  exportedAt: string;
  keys: Record<string, string>;
}

export interface ExportResult {
  ok: boolean;
  reason?: string;
  /** 存档里读出的一点信息，用于界面展示 */
  day?: number;
  coins?: number;
  mastered?: number;
}

/** 从主存档里挖出一点摘要用于界面显示 */
export function summarize(): { day: number; coins: number; mastered: number } | null {
  try {
    const raw = storage.get(CFG.SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { day?: number; coins?: number };
    let mastered = 0;
    const lraw = storage.get(LEARNING_KEY);
    if (lraw) {
      const l = JSON.parse(lraw) as { words?: Record<string, { days?: number }> };
      if (l.words) {
        for (const p of Object.values(l.words)) {
          if ((p.days ?? 0) >= 3) mastered++;
        }
      }
    }
    return {
      day: typeof s.day === 'number' ? s.day : 0,
      coins: typeof s.coins === 'number' ? s.coins : 0,
      mastered
    };
  } catch {
    return null;
  }
}

/** 打包成字符串（不直接下载，方便测试与将来复用） */
export function buildBundle(gameVersion = '0.1.0'): { ok: boolean; reason?: string; text?: string } {
  const keys: Record<string, string> = {};
  for (const k of KEYS) {
    const v = storage.get(k);
    if (v != null) keys[k] = v;
  }
  if (!keys[CFG.SAVE_KEY]) {
    return { ok: false, reason: '还没有存档可以导出' };
  }
  const bundle: SaveBundle = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    gameVersion,
    exportedAt: new Date().toISOString(),
    keys
  };
  return { ok: true, text: JSON.stringify(bundle, null, 2) };
}

/** 触发浏览器下载 */
export function exportToFile(gameVersion = '0.1.0'): ExportResult {
  const built = buildBundle(gameVersion);
  if (!built.ok || !built.text) return { ok: false, reason: built.reason };

  const d = new Date();
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('') + '-' + [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0')
  ].join('');

  const blob = new Blob([built.text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `typing-farm-save-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 稍后才释放，避免某些浏览器还没读完就被回收
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);

  const sum = summarize();
  return { ok: true, day: sum?.day, coins: sum?.coins, mastered: sum?.mastered };
}

export interface ImportResult {
  ok: boolean;
  reason?: string;
  /** 导入后需要提醒用户的额外信息 */
  warning?: string;
}

/** 校验并解析一段存档文本，不写入 */
export function parseBundle(text: string): { ok: boolean; reason?: string; bundle?: SaveBundle } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: '文件不是合法的 JSON' };
  }
  const b = data as Partial<SaveBundle>;
  if (!b || typeof b !== 'object') return { ok: false, reason: '文件内容为空' };
  if (b.format !== FORMAT) {
    return { ok: false, reason: '这不是本游戏的存档文件' };
  }
  if (typeof b.formatVersion !== 'number' || b.formatVersion > FORMAT_VERSION) {
    return { ok: false, reason: '存档格式版本太新，请更新游戏' };
  }
  if (!b.keys || typeof b.keys !== 'object') {
    return { ok: false, reason: '存档里没有数据' };
  }
  const main = b.keys[CFG.SAVE_KEY];
  if (typeof main !== 'string') {
    return { ok: false, reason: '存档缺少主进度数据' };
  }
  // 主存档必须能被解析，且看起来像这个游戏的存档
  try {
    const s = JSON.parse(main) as { version?: number; plots?: unknown };
    if (typeof s.version !== 'number' || !Array.isArray(s.plots)) {
      return { ok: false, reason: '主进度数据不完整，可能已损坏' };
    }
  } catch {
    return { ok: false, reason: '主进度数据无法解析' };
  }
  return { ok: true, bundle: b as SaveBundle };
}

/**
 * 导入并写入 storage。
 * 只覆盖白名单里的 key——存档文件里多出来的 key 一律忽略，
 * 免得被人塞进奇怪的东西。
 */
export function importFromText(text: string): ImportResult {
  const parsed = parseBundle(text);
  if (!parsed.ok || !parsed.bundle) return { ok: false, reason: parsed.reason };

  const keys = parsed.bundle.keys;
  let written = 0;
  for (const k of KEYS) {
    const v = keys[k];
    if (typeof v === 'string') {
      storage.set(k, v);
      written++;
    }
  }
  if (written === 0) return { ok: false, reason: '没有可写入的数据' };

  const extra = Object.keys(keys).filter((k) => !KEYS.includes(k));
  return {
    ok: true,
    warning: extra.length > 0
      ? `存档里有 ${extra.length} 项本版本不认识的数据，已忽略`
      : undefined
  };
}

/** 读一个用户选的文件 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ''));
    fr.onerror = () => reject(new Error('读取文件失败'));
    fr.readAsText(file);
  });
}

/** 清空存档（重开用） */
export function wipeSave(): void {
  for (const k of KEYS) storage.remove(k);
}
